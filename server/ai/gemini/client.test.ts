/**
 * Gemini client transport-diagnostics tests. `fetchImpl` is always injected, so these
 * tests make 0 provider calls.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGeminiClient, GeminiClientError } from './client';

const ENV_KEYS = [
  'AI_GATEWAY_BASE_URL',
  'AI_GATEWAY_API_KEY',
  'AI_GATEWAY_PROTOCOL',
  'AI_GATEWAY_STRUCTURED_OUTPUT',
  'GEMINI_MODEL',
  'GEMINI_LIVE',
  'AI_MODE',
  'AI_BACKEND'
] as const;

const snapshot: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) snapshot[key] = process.env[key];

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
  vi.restoreAllMocks();
});

function setEnv() {
  process.env.AI_MODE = 'gemini';
  process.env.AI_BACKEND = 'internal_gateway';
  process.env.AI_GATEWAY_BASE_URL = 'https://gateway.example.invalid/v1';
  process.env.AI_GATEWAY_API_KEY = 'test-key';
  process.env.AI_GATEWAY_PROTOCOL = 'openai';
  process.env.GEMINI_MODEL = 'test-model';
  process.env.AI_GATEWAY_STRUCTURED_OUTPUT = 'json_object';
}

const REQUEST = { system: 'system', user: 'user' };

describe('createGeminiClient transport failures', () => {
  it('reports VPN guidance for an opaque fetch failure', async () => {
    setEnv();
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('getaddrinfo ENOTFOUND gateway.example.invalid'), {
          code: 'ENOTFOUND'
        })
      });
    });

    const client = createGeminiClient({ live: true, fetchImpl: fetchImpl as never });

    await expect(client.generateJson(REQUEST)).rejects.toBeInstanceOf(GeminiClientError);
    await expect(client.generateJson(REQUEST)).rejects.toThrow(/corporate network\/VPN/);
  });

  it('distinguishes a timeout from an unreachable gateway', async () => {
    setEnv();
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
    });

    const client = createGeminiClient({ live: true, fetchImpl: fetchImpl as never });

    await expect(client.generateJson(REQUEST)).rejects.toThrow(/timed out/);
  });

  it('still returns gateway completions on the success path', async () => {
    setEnv();
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe('https://gateway.example.invalid/v1/chat/completions');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }
        })
      };
    });

    const client = createGeminiClient({ live: true, fetchImpl: fetchImpl as never });
    const result = await client.generateJson(REQUEST);

    expect(result.text).toBe('{"ok":true}');
    expect(result.model).toBe('test-model');
    expect(result.usage?.totalTokens).toBe(18);
  });
});
