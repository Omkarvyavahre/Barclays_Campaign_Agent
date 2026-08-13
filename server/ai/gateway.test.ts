import { describe, expect, it, vi } from 'vitest';

import { loadAiConfig } from './config';
import { AiServiceError } from './errors';
import { normalizeChatCompletion, requestStructuredCompletion } from './gateway';

const LIVE_ENV = {
  AI_MODE: 'gemini',
  AI_GATEWAY_BASE_URL: 'https://gateway.internal.example/v1',
  AI_GATEWAY_API_KEY: 'super-secret-key-value',
  GEMINI_MODEL: 'gemini-2.5-pro',
};

function completion(content: string, extra: Record<string, unknown> = {}) {
  return {
    model: 'gemini-2.5-pro',
    choices: [{ finish_reason: 'stop', message: { content } }],
    usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 },
    ...extra,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('structured-output normalisation', () => {
  it('normalises content, usage and model into one internal shape', () => {
    const result = normalizeChatCompletion(completion('{"a":1}'), 'fallback-model');
    expect(result.data).toEqual({ a: 1 });
    expect(result.model).toBe('gemini-2.5-pro');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({ promptTokens: 11, completionTokens: 22, totalTokens: 33 });
  });

  it('captures reasoning tokens when the gateway reports them', () => {
    const payload = completion('{"a":1}', {
      usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11, completion_tokens_details: { reasoning_tokens: 40 } },
    });
    expect(normalizeChatCompletion(payload, 'fallback').usage.reasoningTokens).toBe(40);
  });

  it('accepts input/output token aliases', () => {
    const payload = completion('{"a":1}', { usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 } });
    const usage = normalizeChatCompletion(payload, 'fallback').usage;
    expect(usage.promptTokens).toBe(3);
    expect(usage.completionTokens).toBe(4);
  });

  it('falls back to the configured model when the payload omits one', () => {
    const payload = { choices: [{ message: { content: '{"a":1}' } }] };
    expect(normalizeChatCompletion(payload, 'fallback-model').model).toBe('fallback-model');
  });

  it('rejects non-JSON content as invalid_response', () => {
    expect(() => normalizeChatCompletion(completion('not json'), 'm')).toThrowError(
      expect.objectContaining({ category: 'invalid_response' }),
    );
  });

  it('rejects an empty choices array', () => {
    expect(() => normalizeChatCompletion({ choices: [] }, 'm')).toThrowError(
      expect.objectContaining({ category: 'invalid_response' }),
    );
  });
});

describe('gateway transport', () => {
  it('posts an OpenAI-compatible json_schema request with bearer auth', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(completion('{"ok":true}')));
    const config = loadAiConfig(LIVE_ENV);

    await requestStructuredCompletion(
      config,
      { messages: [{ role: 'user', content: 'hello' }], schemaName: 'demo', schema: { type: 'object' } },
      { fetch: fetchSpy },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gateway.internal.example/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer super-secret-key-value');

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gemini-2.5-pro');
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
  });

  it.each([
    [401, 'auth_error'],
    [403, 'forbidden'],
    [429, 'upstream_error'],
    [500, 'upstream_error'],
    [504, 'timeout'],
  ])('maps HTTP %i to %s', async (status, category) => {
    const fetchSpy = vi.fn(async () => jsonResponse({ error: 'upstream detail' }, status));
    await expect(
      requestStructuredCompletion(
        loadAiConfig(LIVE_ENV),
        { messages: [{ role: 'user', content: 'x' }], schemaName: 'd', schema: {} },
        { fetch: fetchSpy },
      ),
    ).rejects.toMatchObject({ category });
  });

  it('maps an aborted request to timeout', async () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchSpy = vi.fn(async () => {
      throw abortError;
    });
    await expect(
      requestStructuredCompletion(
        loadAiConfig(LIVE_ENV),
        { messages: [{ role: 'user', content: 'x' }], schemaName: 'd', schema: {} },
        { fetch: fetchSpy },
      ),
    ).rejects.toMatchObject({ category: 'timeout' });
  });

  it('never leaks the upstream body through the safe payload', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ detail: 'gateway.internal.example rejected token abc123' }, 500));
    try {
      await requestStructuredCompletion(
        loadAiConfig(LIVE_ENV),
        { messages: [{ role: 'user', content: 'x' }], schemaName: 'd', schema: {} },
        { fetch: fetchSpy },
      );
      throw new Error('expected rejection');
    } catch (error) {
      const safe = JSON.stringify((error as AiServiceError).toSafePayload());
      expect(safe).not.toContain('gateway.internal.example');
      expect(safe).not.toContain('abc123');
    }
  });
});
