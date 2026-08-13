import { describe, expect, it, vi } from 'vitest';

import { generateBrief } from './briefAgent';
import { loadAiConfig } from './config';
import { analyseDiscussion, buildDiscussionTranscript } from './coordinator';
import { AiServiceError, safeErrorPayload } from './errors';
import { BRIEF_FIELD_KEYS } from './schemas';
import { validBriefFields, validCoordinator, validDiscussion } from './schemas.test';

const MOCK_CONFIG = loadAiConfig({ AI_MODE: 'mock' });
const LIVE_CONFIG = loadAiConfig({
  AI_MODE: 'gemini',
  AI_GATEWAY_BASE_URL: 'https://gateway.internal.example/v1',
  AI_GATEWAY_API_KEY: 'super-secret-key-value',
  GEMINI_MODEL: 'gemini-2.5-pro',
});

function gatewayReturning(data: unknown) {
  return vi.fn(
    async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'gemini-2.5-pro',
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(data) } }],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        }),
        text: async () => '',
      }) as unknown as Response,
  );
}

describe('mock mode makes no external calls', () => {
  it('returns a null coordinator result without touching fetch', async () => {
    const fetchSpy = vi.fn();
    const outcome = await analyseDiscussion(MOCK_CONFIG, validDiscussion(), { fetch: fetchSpy });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(outcome).toEqual({ source: 'mock', result: null });
  });

  it('returns a null brief result without touching fetch', async () => {
    const fetchSpy = vi.fn();
    const outcome = await generateBrief(MOCK_CONFIG, { discussion: validDiscussion() }, { fetch: fetchSpy });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(outcome).toEqual({ source: 'mock', result: null });
  });
});

describe('coordinator agent', () => {
  it('returns a validated live result', async () => {
    const fetchSpy = gatewayReturning(validCoordinator());
    const outcome = await analyseDiscussion(LIVE_CONFIG, validDiscussion(), { fetch: fetchSpy });
    expect(outcome.source).toBe('live');
    expect(outcome.result?.recommendation).toBe('proceed_with_conditions');
    expect(outcome.usage?.totalTokens).toBe(3);
  });

  it('rejects malformed model output rather than passing it on', async () => {
    const fetchSpy = gatewayReturning({ campaignOpportunity: true });
    await expect(analyseDiscussion(LIVE_CONFIG, validDiscussion(), { fetch: fetchSpy })).rejects.toMatchObject({
      category: 'invalid_response',
    });
  });

  it('builds a transcript containing the discussion content', () => {
    const transcript = buildDiscussionTranscript(validDiscussion());
    expect(transcript).toContain('iPortal Adoption');
    expect(transcript).toContain('Commercial Lead');
    expect(transcript).toContain('deepen client relationships');
  });
});

describe('brief agent', () => {
  it('returns a validated 28-field brief', async () => {
    const fetchSpy = gatewayReturning({ campaignName: 'iPortal Digital Engagement Campaign', fields: validBriefFields() });
    const outcome = await generateBrief(LIVE_CONFIG, { discussion: validDiscussion() }, { fetch: fetchSpy });
    expect(outcome.source).toBe('live');
    expect(Object.keys(outcome.result?.fields ?? {})).toHaveLength(BRIEF_FIELD_KEYS.length);
  });

  it('rejects a partial brief', async () => {
    const fields = validBriefFields();
    delete fields.budget;
    const fetchSpy = gatewayReturning({ campaignName: 'Campaign', fields });
    await expect(generateBrief(LIVE_CONFIG, { discussion: validDiscussion() }, { fetch: fetchSpy })).rejects.toMatchObject({
      category: 'invalid_response',
    });
  });

  it('includes coordinator context in the prompt when supplied', async () => {
    const fetchSpy = gatewayReturning({ campaignName: 'Campaign', fields: validBriefFields() });
    await generateBrief(
      LIVE_CONFIG,
      { discussion: validDiscussion(), coordinator: validCoordinator() },
      { fetch: fetchSpy },
    );
    const body = JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    const userMessage = body.messages.find((m: { role: string }) => m.role === 'user').content;
    expect(userMessage).toContain('Approved Campaign Coordinator analysis');
    expect(userMessage).toContain('Digital Adoption');
  });
});

describe('safe error mapping', () => {
  it.each([
    ['auth_error', 502],
    ['forbidden', 502],
    ['upstream_error', 502],
    ['timeout', 504],
    ['invalid_response', 502],
    ['configuration_error', 500],
    ['bad_request', 400],
  ] as const)('maps %s to HTTP %i with a safe message', (category, status) => {
    const error = new AiServiceError(category, 'internal detail with https://gateway.internal.example and key abc123');
    expect(error.httpStatus).toBe(status);

    const payload = JSON.stringify(error.toSafePayload());
    expect(payload).not.toContain('gateway.internal.example');
    expect(payload).not.toContain('abc123');
    expect(JSON.parse(payload).error.category).toBe(category);
  });

  it('collapses an unknown thrown value into a safe upstream error', () => {
    const payload = safeErrorPayload(new Error('raw internal failure at https://gateway.internal.example'));
    expect(payload.error.category).toBe('upstream_error');
    expect(JSON.stringify(payload)).not.toContain('gateway.internal.example');
  });
});
