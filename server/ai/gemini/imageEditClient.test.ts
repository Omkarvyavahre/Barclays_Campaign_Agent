/**
 * @vitest-environment node
 *
 * Mocked Gemini image-edit client tests. Live provider calls = 0.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GEMINI_IMAGE_TIMEOUT_MS,
  describeGeminiImageConfig,
  isGeminiImageEditConfigured,
  readGeminiImageConfig
} from './imageConfig';
import {
  createGeminiImageEditClient,
  GeminiImageEditError,
  withGeminiImageEdit
} from './imageEditClient';
import { createGeminiClient } from './client';
import { handleGatewayHealthRequest } from '../http/gatewayHealthRoute';
import type { GeminiImageEditRequest } from './types';
import type { IncomingMessage, ServerResponse } from 'node:http';

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde
]);

const ENV_KEYS = [
  'GEMINI_IMAGE_API_KEY',
  'GEMINI_IMAGE_MODEL',
  'GEMINI_IMAGE_BASE_URL',
  'GEMINI_IMAGE_LIVE',
  'GEMINI_IMAGE_TIMEOUT_MS',
  'GEMINI_LIVE',
  'AI_MODE',
  'AI_GATEWAY_BASE_URL',
  'AI_GATEWAY_API_KEY',
  'AI_GATEWAY_TIMEOUT_MS',
  'GEMINI_MODEL'
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    ORIGINAL_ENV[key] = process.env[key];
    delete process.env[key];
  }
  process.env.AI_MODE = 'mock';
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

describe('Gemini image config', () => {
  it('reads the image API key server-side without exposing it', () => {
    process.env.GEMINI_IMAGE_API_KEY = 'sk-test-image-key-value';
    process.env.GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
    process.env.AI_GATEWAY_BASE_URL = 'https://example-gateway.test/v1';

    const summary = describeGeminiImageConfig();
    expect(summary.geminiImageConfigured).toBe(true);
    expect(summary.geminiImageModelConfigured).toBe(true);
    expect(isGeminiImageEditConfigured()).toBe(true);
    expect(JSON.stringify(summary)).not.toContain('sk-test-image-key-value');
  });

  it('reports model missing when only the key is set', () => {
    process.env.GEMINI_IMAGE_API_KEY = 'sk-test-image-key-value';
    delete process.env.GEMINI_IMAGE_MODEL;
    const summary = describeGeminiImageConfig();
    expect(summary.geminiImageConfigured).toBe(true);
    expect(summary.geminiImageModelConfigured).toBe(false);
    expect(isGeminiImageEditConfigured()).toBe(false);
  });
});

describe('Gemini image timeout', () => {
  function editRequest(): GeminiImageEditRequest {
    return {
      instruction: 'Remove all visible text.',
      image: { bytes: PNG, mimeType: 'image/png', assetId: 'DAM-0188' },
      guardrails: ['Do not render Title into the image.'],
      authoritativeContent: {
        title: 'Discover iPortal',
        description: 'A simpler way to manage digital banking.',
        cta: 'Learn more'
      }
    };
  }

  function configEnv(): void {
    process.env.GEMINI_IMAGE_API_KEY = 'sk-test-image-key-value';
    process.env.GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
    process.env.GEMINI_IMAGE_BASE_URL = 'https://example-gateway.test/v1';
  }

  it('defaults to 120000ms', () => {
    configEnv();
    expect(DEFAULT_GEMINI_IMAGE_TIMEOUT_MS).toBe(120_000);
    expect(readGeminiImageConfig().timeoutMs).toBe(120_000);
  });

  it('honours GEMINI_IMAGE_TIMEOUT_MS over the default', () => {
    configEnv();
    process.env.GEMINI_IMAGE_TIMEOUT_MS = '180000';
    expect(readGeminiImageConfig().timeoutMs).toBe(180_000);
  });

  it('never inherits the shorter text gateway timeout', () => {
    configEnv();
    process.env.AI_GATEWAY_TIMEOUT_MS = '30000';
    expect(readGeminiImageConfig().timeoutMs).toBe(120_000);

    process.env.GEMINI_IMAGE_TIMEOUT_MS = '120000';
    expect(readGeminiImageConfig().timeoutMs).toBe(120_000);
  });

  it('ignores an unusable GEMINI_IMAGE_TIMEOUT_MS and falls back to 120000ms', () => {
    configEnv();
    process.env.GEMINI_IMAGE_TIMEOUT_MS = 'not-a-number';
    expect(readGeminiImageConfig().timeoutMs).toBe(120_000);
    process.env.GEMINI_IMAGE_TIMEOUT_MS = '0';
    expect(readGeminiImageConfig().timeoutMs).toBe(120_000);
  });

  it('aborts on the image timeout, not at 30s, and classifies the failure as a timeout', async () => {
    configEnv();
    process.env.AI_GATEWAY_TIMEOUT_MS = '30000';
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          signal = init?.signal ?? undefined;
          signal?.addEventListener('abort', () => {
            const abortError = new Error('This operation was aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          });
        })
    ) as unknown as typeof fetch;

    const client = createGeminiImageEditClient({ live: true, fetchImpl })!;
    let settled = false;
    const pending = client
      .editImage(editRequest())
      .catch((error: unknown) => error)
      .finally(() => {
        settled = true;
      });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(false);
    expect(signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(60_001);
    const error = (await pending) as GeminiImageEditError;

    expect(signal?.aborted).toBe(true);
    expect(error).toBeInstanceOf(GeminiImageEditError);
    expect(error.category).toBe('timeout');
    expect(error.aborted).toBe(true);
    expect(error.timeoutMs).toBe(120_000);
    expect(error.httpStatus).toBeUndefined();
    expect(error.message).toMatch(/^Gemini image edit timed out/);
    expect(error.message).not.toMatch(/^Gemini image edit failed/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('logs sanitized diagnostics with elapsed time and never the key or image bytes', async () => {
    configEnv();
    const logged: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.map((arg) => String(arg)).join(' '));
    });

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ data: [{ b64_json: PNG.toString('base64') }] })
    })) as unknown as typeof fetch;

    const client = createGeminiImageEditClient({ live: true, fetchImpl })!;
    await client.editImage(editRequest());

    const joined = logged.join('\n');
    expect(joined).toContain('gemini-2.5-flash-image');
    expect(joined).toContain('openai_images_edits');
    expect(joined).toContain('/v1/images/edits');
    expect(joined).toContain('"sourceMimeType":"image/png"');
    expect(joined).toContain(`"sourceByteLength":${PNG.length}`);
    expect(joined).toContain('"timeoutMs":120000');
    expect(joined).toMatch(/"elapsedMs":\d+/);
    expect(joined).toContain('"providerHttpStatus":200');
    expect(joined).toContain('"aborted":false');
    expect(joined).not.toContain('sk-test-image-key-value');
    expect(joined).not.toContain('Bearer');
    expect(joined).not.toContain(PNG.toString('base64'));
  });
});

describe('createGeminiImageEditClient', () => {
  it('returns null when live image mode is off', () => {
    process.env.GEMINI_IMAGE_API_KEY = 'sk-test';
    process.env.GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
    expect(createGeminiImageEditClient({ live: false })).toBeNull();
  });

  it('posts multipart /images/edits with the user instruction unchanged as primary prompt', async () => {
    process.env.GEMINI_IMAGE_API_KEY = 'sk-test-image-key-value';
    process.env.GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
    process.env.GEMINI_IMAGE_BASE_URL = 'https://example-gateway.test/v1';

    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(String(_input)).toBe('https://example-gateway.test/v1/images/edits');
      expect(init?.method).toBe('POST');
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer sk-test-image-key-value');
      const form = init?.body as FormData;
      const prompt = String(form.get('prompt'));
      const userInstruction =
        'Remove all visible text and logos while preserving the existing background, colors, people and composition.';
      expect(prompt).toContain(`User edit instruction (authoritative):\n${userInstruction}`);
      expect(prompt).toContain('Return exactly one final edited image.');
      expect(prompt).toMatch(/split screen|side-by-side layout/);
      expect(prompt).toContain('Remove all requested text, letters, numbers, logos, and labels completely.');
      expect(prompt).toContain('Additional constraints:');
      expect(form.get('model')).toBe('gemini-2.5-flash-image');
      expect(form.get('response_format')).toBe('b64_json');
      expect(form.get('image')).toBeTruthy();
      expect(form.getAll('image')).toHaveLength(1);
      expect(form.get('n')).toBe('1');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ b64_json: PNG.toString('base64') }]
        })
      } as Response;
    }) as unknown as typeof fetch;

    const client = createGeminiImageEditClient({ live: true, fetchImpl });
    expect(client).not.toBeNull();
    const result = await client!.editImage({
      instruction:
        'Remove all visible text and logos while preserving the existing background, colors, people and composition.',
      image: { bytes: PNG, mimeType: 'image/png', assetId: 'DAM-0188' },
      guardrails: ['Do not render Title into the image.'],
      authoritativeContent: {
        title: 'Discover iPortal',
        description: 'A simpler way to manage digital banking.',
        cta: 'Learn more'
      }
    });

    expect(result.provider).toBe('gemini-image');
    expect(result.model).toBe('gemini-2.5-flash-image');
    expect(result.bytes.equals(PNG)).toBe(true);
    expect(result.mimeType).toMatch(/image\//);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('attaches editImage onto the JSON client without exposing secrets on the public surface', () => {
    process.env.GEMINI_IMAGE_API_KEY = 'sk-secret-should-not-leak';
    process.env.GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
    const combined = withGeminiImageEdit(createGeminiClient({ live: false }), {
      live: true,
      fetchImpl: vi.fn() as unknown as typeof fetch
    });
    expect(typeof combined.editImage).toBe('function');
    expect(JSON.stringify(combined)).not.toContain('sk-secret-should-not-leak');
  });
});

describe('gateway-health image capability summary', () => {
  it('exposes configuration booleans and never the API key', async () => {
    process.env.GEMINI_IMAGE_API_KEY = 'sk-health-secret';
    process.env.GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
    process.env.AI_GATEWAY_BASE_URL = 'https://example-gateway.test/v1';
    process.env.AI_GATEWAY_API_KEY = 'sk-text-gateway';
    process.env.GEMINI_MODEL = 'vertex_ai.gemini-3.6-flash';

    let statusCode = 0;
    let body = '';
    const res = {
      statusCode: 0,
      setHeader() {},
      end(payload: string) {
        statusCode = (this as { statusCode: number }).statusCode;
        body = payload;
      }
    } as unknown as ServerResponse;

    await handleGatewayHealthRequest({ method: 'GET' } as IncomingMessage, res);

    expect(statusCode).toBe(200);
    const parsed = JSON.parse(body);
    expect(parsed.geminiImageConfigured).toBe(true);
    expect(parsed.geminiImageModelConfigured).toBe(true);
    expect(body).not.toContain('sk-health-secret');
    expect(body).not.toContain('sk-text-gateway');
    expect(body).not.toMatch(/Bearer\s+\S+/);
  });
});
