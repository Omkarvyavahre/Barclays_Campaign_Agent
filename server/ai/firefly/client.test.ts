/**
 * @vitest-environment node
 *
 * Firefly async job polling — mocked only. No live provider calls.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createFireflyClient,
  describeTransportError,
  extractFirstImageUrl,
  extractFireflyOutputs,
  FIREFLY_CONNECT_TIMEOUT_MS,
  FIREFLY_JOB_TIMEOUT_MS,
  FIREFLY_POLL_INTERVAL_MS,
  FireflyClientError,
  normalizeFireflyJobStatus,
  parseAsyncJobAccepted,
  resolveFireflyConnectTimeoutMs
} from './client';
import {
  clearGeneratedImageRegistry,
  getRegisteredGeneratedImage,
  listRegisteredGeneratedIds
} from './storage';
import { FIREFLY_PROMPT_MAX_CHARS, buildFireflyPrompt } from './prompt';
import { assembleCreativeSpecification } from '../creative';
import { modifyAsset } from '../modify/modifyAsset';
import type { GeminiJsonClient } from '../gemini/types';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function binaryResponse(bytes: Uint8Array, status = 200): Response {
  return new Response(bytes, { status, headers: { 'Content-Type': 'image/png' } });
}

const TINY_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
]);

describe('Firefly async response helpers', () => {
  it('parses jobId + statusUrl and does not require initial outputs', () => {
    const accepted = parseAsyncJobAccepted({
      jobId: 'urn:ff:jobs:test:1',
      statusUrl: 'https://firefly-api.adobe.io/v3/status/urn:ff:jobs:test:1',
      cancelUrl: 'https://firefly-api.adobe.io/v3/cancel/urn:ff:jobs:test:1'
    });
    expect(accepted.jobId).toBe('urn:ff:jobs:test:1');
    expect(accepted.statusUrl).toContain('/v3/status/');
    expect(extractFireflyOutputs(accepted.raw)).toEqual([]);
  });

  it('extracts outputs from documented result.outputs envelope', () => {
    const url = extractFirstImageUrl({
      status: 'succeeded',
      result: {
        outputs: [{ seed: 1, image: { url: 'https://example.com/a.png' } }]
      }
    });
    expect(url).toBe('https://example.com/a.png');
  });

  it('normalizes job status casing', () => {
    expect(normalizeFireflyJobStatus('Succeeded')).toBe('succeeded');
    expect(normalizeFireflyJobStatus('RUNNING')).toBe('running');
  });
});

describe('Firefly connect budget', () => {
  it('stays above undici’s 10s default and honours FIREFLY_CONNECT_TIMEOUT_MS', () => {
    expect(FIREFLY_CONNECT_TIMEOUT_MS).toBeGreaterThan(10_000);
    expect(resolveFireflyConnectTimeoutMs({} as NodeJS.ProcessEnv)).toBe(FIREFLY_CONNECT_TIMEOUT_MS);
    expect(
      resolveFireflyConnectTimeoutMs({ FIREFLY_CONNECT_TIMEOUT_MS: '45000' } as NodeJS.ProcessEnv)
    ).toBe(45_000);
    expect(
      resolveFireflyConnectTimeoutMs({ FIREFLY_CONNECT_TIMEOUT_MS: 'not-a-number' } as NodeJS.ProcessEnv)
    ).toBe(FIREFLY_CONNECT_TIMEOUT_MS);
  });

  it('flattens a fetch cause chain into one sanitized line', () => {
    const error = new TypeError('fetch failed', {
      cause: Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' })
    });
    expect(describeTransportError(error)).toBe(
      'fetch failed <- UND_ERR_CONNECT_TIMEOUT: Connect Timeout Error'
    );
    expect(describeTransportError(new Error('socket hang up'))).toBe('socket hang up');
  });
});

describe('createFireflyClient async polling', () => {
  let tempDir: string;

  afterEach(() => {
    clearGeneratedImageRegistry();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  function mockFetchSequence(handlers: Array<(url: string, init?: RequestInit) => Response | Promise<Response>>) {
    let i = 0;
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ url, method });
      const handler = handlers[i++];
      if (!handler) throw new Error(`Unexpected fetch #${i} ${method} ${url}`);
      return handler(url, init);
    });
    return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
  }

  it('classifies an IMS transport failure instead of surfacing a bare fetch error', async () => {
    // undici rejects with `TypeError: fetch failed` when the TLS handshake cannot complete,
    // which on an inspecting corporate network means Node lacks the OS trust store.
    const fetchImpl = vi.fn(async (_input: string | URL | Request) => {
      void _input;
      throw new TypeError('fetch failed');
    });
    const client = createFireflyClient({
      live: true,
      clientId: 'cid',
      clientSecret: 'sec',
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    await expect(client.generateImage({ prompt: 'a premium abstract visual' })).rejects.toThrow(
      FireflyClientError
    );
    await expect(
      client.generateImage({ prompt: 'a premium abstract visual' })
    ).rejects.toMatchObject({ code: 'ims_unreachable' });

    const error = await client
      .generateImage({ prompt: 'a premium abstract visual' })
      .then(() => null)
      .catch((e: FireflyClientError) => e);
    expect(error?.message).toContain('Firefly IMS request failed before any HTTP response');
    expect(error?.message).toContain('--use-system-ca');
    // Only the IMS token call is attempted; no generation request is made.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('ims-na1.adobelogin.com');
  });

  it('names the undici cause when the generation request dies before any HTTP response', async () => {
    // Regression: corporate egress reaches firefly-api.adobe.io in ~8s, so jitter past undici's
    // 10s default connect timeout produced an undiagnosable bare `fetch failed`.
    const { fetchImpl, calls } = mockFetchSequence([
      () => jsonResponse({ access_token: 'tok-1', expires_in: 86000 }),
      () => {
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error('Connect Timeout Error'), {
            code: 'UND_ERR_CONNECT_TIMEOUT'
          })
        });
      }
    ]);
    const client = createFireflyClient({
      live: true,
      clientId: 'cid',
      clientSecret: 'sec',
      fetchImpl,
      connectTimeoutMs: 30_000
    });

    const error = await client
      .generateImage({ prompt: 'a premium abstract visual' })
      .then(() => null)
      .catch((e: FireflyClientError) => e);

    expect(error?.code).toBe('generate_request_failed');
    expect(error?.message).toContain('UND_ERR_CONNECT_TIMEOUT');
    expect(error?.message).toContain('30000 ms');
    // IMS succeeded first; the failure is the generate call, not auth.
    expect(calls[0]?.url).toContain('ims-na1.adobelogin.com');
    expect(calls[1]?.url).toContain('/v3/images/generate-async');
  });

  it('accepts initial async response without outputs and polls pending → succeeded', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ff-poll-'));
    const { fetchImpl, calls } = mockFetchSequence([
      () =>
        jsonResponse({
          access_token: 'tok-1',
          expires_in: 86000,
          token_type: 'bearer'
        }),
      () =>
        jsonResponse({
          jobId: 'urn:ff:jobs:test:abc',
          statusUrl: 'https://firefly-api.adobe.io/v3/status/urn:ff:jobs:test:abc',
          cancelUrl: 'https://firefly-api.adobe.io/v3/cancel/urn:ff:jobs:test:abc'
        }),
      () => jsonResponse({ status: 'pending', jobId: 'urn:ff:jobs:test:abc' }),
      () =>
        jsonResponse({
          status: 'succeeded',
          jobId: 'urn:ff:jobs:test:abc',
          result: {
            outputs: [{ seed: 42, image: { url: 'https://cdn.example.com/out.png' } }],
            contentClass: 'art'
          }
        }),
      () => binaryResponse(TINY_PNG)
    ]);

    const sleep = vi.fn(async () => undefined);
    const client = createFireflyClient({
      live: true,
      clientId: 'cid',
      clientSecret: 'sec',
      fetchImpl,
      generatedDir: tempDir,
      pollIntervalMs: 1,
      jobTimeoutMs: 5000,
      sleep
    });

    const result = await client.generateImage({
      prompt: 'Darken the background. Visual family: abstract digital. No generated logos.',
      contentClass: 'art'
    });

    expect(result.images).toHaveLength(1);
    expect(result.images[0]!.imageUrl).toMatch(/^\/api\/ai\/generated\//);
    expect(result.jobTelemetry?.pollCount).toBeGreaterThanOrEqual(2);
    expect(result.jobTelemetry?.statusTransitions).toEqual(['pending', 'succeeded']);
    expect(result.jobTelemetry?.generatedImageAvailable).toBe(true);
    expect(result.jobTelemetry?.statusUrlUsed).toBe(true);
    expect(calls.filter((c) => c.url.includes('/v3/images/generate-async'))).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes('/v3/status/'))).toHaveLength(2);
    expect(calls.filter((c) => c.url.includes('ims-na1'))).toHaveLength(1);
    expect(listRegisteredGeneratedIds()).toHaveLength(1);
    expect(sleep).toHaveBeenCalled();
  });

  it('supports running → succeeded and reuses one IMS token across polls', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ff-run-'));
    const { fetchImpl, calls } = mockFetchSequence([
      () => jsonResponse({ access_token: 'tok-reuse', expires_in: 86000 }),
      () =>
        jsonResponse({
          jobId: 'job-2',
          statusUrl: 'https://firefly-api.adobe.io/v3/status/job-2'
        }),
      () => jsonResponse({ status: 'running' }),
      () =>
        jsonResponse({
          status: 'succeeded',
          result: { outputs: [{ image: { url: 'https://cdn.example.com/b.png' } }] }
        }),
      () => binaryResponse(TINY_PNG)
    ]);

    const client = createFireflyClient({
      live: true,
      clientId: 'cid',
      clientSecret: 'sec',
      fetchImpl,
      generatedDir: tempDir,
      pollIntervalMs: 1,
      sleep: async () => undefined
    });

    await client.generateImage({ prompt: 'abstract digital darker background' });
    expect(calls.filter((c) => c.url.includes('ims-na1'))).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes('generate-async'))).toHaveLength(1);
  });

  it('handles multiple pending polls then success', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ff-multi-'));
    const { fetchImpl } = mockFetchSequence([
      () => jsonResponse({ access_token: 't', expires_in: 86000 }),
      () =>
        jsonResponse({
          jobId: 'job-3',
          statusUrl: 'https://firefly-api.adobe.io/v3/status/job-3'
        }),
      () => jsonResponse({ status: 'queued' }),
      () => jsonResponse({ status: 'pending' }),
      () => jsonResponse({ status: 'processing' }),
      () =>
        jsonResponse({
          status: 'succeeded',
          result: { outputs: [{ image: { url: 'https://cdn.example.com/c.png' } }] }
        }),
      () => binaryResponse(TINY_PNG)
    ]);

    const client = createFireflyClient({
      live: true,
      clientId: 'cid',
      clientSecret: 'sec',
      fetchImpl,
      generatedDir: tempDir,
      pollIntervalMs: 1,
      sleep: async () => undefined
    });
    const result = await client.generateImage({ prompt: 'prompt' });
    expect(result.jobTelemetry?.statusTransitions).toEqual([
      'queued',
      'pending',
      'processing',
      'succeeded'
    ]);
  });

  it('throws on failed provider job', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ff-fail-'));
    const { fetchImpl } = mockFetchSequence([
      () => jsonResponse({ access_token: 't', expires_in: 86000 }),
      () =>
        jsonResponse({
          jobId: 'job-f',
          statusUrl: 'https://firefly-api.adobe.io/v3/status/job-f'
        }),
      () => jsonResponse({ status: 'failed', message: 'model error' })
    ]);
    const client = createFireflyClient({
      live: true,
      clientId: 'cid',
      clientSecret: 'sec',
      fetchImpl,
      generatedDir: tempDir,
      pollIntervalMs: 1,
      sleep: async () => undefined
    });
    await expect(client.generateImage({ prompt: 'x' })).rejects.toMatchObject({
      message: expect.stringContaining('Firefly generation job failed'),
      code: 'job_failed'
    });
    expect(listRegisteredGeneratedIds()).toHaveLength(0);
  });

  it('throws on HTTP failure during polling', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ff-http-'));
    const { fetchImpl } = mockFetchSequence([
      () => jsonResponse({ access_token: 't', expires_in: 86000 }),
      () =>
        jsonResponse({
          jobId: 'job-h',
          statusUrl: 'https://firefly-api.adobe.io/v3/status/job-h'
        }),
      () => new Response('boom', { status: 503 })
    ]);
    const client = createFireflyClient({
      live: true,
      clientId: 'cid',
      clientSecret: 'sec',
      fetchImpl,
      generatedDir: tempDir,
      pollIntervalMs: 1,
      sleep: async () => undefined
    });
    await expect(client.generateImage({ prompt: 'x' })).rejects.toMatchObject({
      message: expect.stringContaining('Firefly generation status check failed'),
      code: 'status_check_failed'
    });
  });

  it('times out when job never completes', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ff-to-'));
    let now = 0;
    const realDateNow = Date.now;
    Date.now = () => now;
    try {
      const { fetchImpl } = mockFetchSequence([
        () => jsonResponse({ access_token: 't', expires_in: 86000 }),
        () =>
          jsonResponse({
            jobId: 'job-t',
            statusUrl: 'https://firefly-api.adobe.io/v3/status/job-t'
          }),
        () => {
          now = 10;
          return jsonResponse({ status: 'pending' });
        },
        () => {
          now = 10_000;
          return jsonResponse({ status: 'pending' });
        }
      ]);
      const client = createFireflyClient({
        live: true,
        clientId: 'cid',
        clientSecret: 'sec',
        fetchImpl,
        generatedDir: tempDir,
        pollIntervalMs: 1,
        jobTimeoutMs: 5,
        sleep: async () => {
          now += 10;
        }
      });
      await expect(client.generateImage({ prompt: 'x' })).rejects.toMatchObject({
        message: 'Firefly generation timed out',
        code: 'timeout'
      });
    } finally {
      Date.now = realDateNow;
    }
  });

  it('throws specific error when succeeded without image', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ff-empty-'));
    const { fetchImpl } = mockFetchSequence([
      () => jsonResponse({ access_token: 't', expires_in: 86000 }),
      () =>
        jsonResponse({
          jobId: 'job-e',
          statusUrl: 'https://firefly-api.adobe.io/v3/status/job-e'
        }),
      () => jsonResponse({ status: 'succeeded', result: { outputs: [] } })
    ]);
    const client = createFireflyClient({
      live: true,
      clientId: 'cid',
      clientSecret: 'sec',
      fetchImpl,
      generatedDir: tempDir,
      pollIntervalMs: 1,
      sleep: async () => undefined
    });
    await expect(client.generateImage({ prompt: 'x' })).rejects.toMatchObject({
      message: 'Firefly job succeeded but returned no usable image output',
      code: 'succeeded_without_image'
    });
    expect(listRegisteredGeneratedIds()).toHaveLength(0);
  });

  it('does not create a derivative when Firefly fails before persistence', async () => {
    const gemini: GeminiJsonClient = {
      generateJson: vi.fn(async () => ({
        text: JSON.stringify({
          requestedChange: 'Darken the background and simplify cyan ribbons.',
          visualFamily: 'abstract-digital',
          composition: 'Simplified flowing composition.',
          negativeSpace: 'left',
          tone: ['premium'],
          preserve: ['approved visual identity'],
          avoid: ['generated logos or simulated Barclays marks'],
          accessibility: ['maintain contrast']
        })
      }))
    };
    const firefly = {
      generateImage: vi.fn(async () => {
        throw new FireflyClientError('Firefly generation job failed', 'job_failed');
      })
    };
    await expect(
      modifyAsset(
        {
          mode: 'modify',
          campaignBrief: { product: 'iPortal' },
          asset: {
            id: 'DAM-IPORTAL-LN-001',
            lineage: 'Adobe DAM · DAM-IPORTAL-LN-001',
            channel: 'LinkedIn'
          },
          modification: {
            title: 'Discover what is possible with iPortal',
            description: 'Discover a simpler way to manage your digital banking with iPortal.',
            cta: 'Discover iPortal',
            prompt: 'Make the background darker.'
          },
          campaignContext: {
            businessDomain: 'corporate',
            campaignType: 'iPortal',
            channel: 'LinkedIn'
          },
          sourceDamAsset: {
            id: 'DAM-IPORTAL-LN-001',
            mimeType: 'image/png',
            imageBase64:
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
          },
          regenerate: true,
          generationPrompt: 'Create a new darker premium corporate visual.',
          existingSpecification: {
            businessDomain: 'corporate',
            campaignType: 'iPortal',
            channel: 'LinkedIn',
            content: {
              title: 'Discover what is possible with iPortal',
              description: 'Discover a simpler way to manage your digital banking with iPortal.',
              cta: 'Discover iPortal'
            },
            requestedChange: 'Create a new darker premium corporate visual.',
            visualFamily: 'abstract-digital',
            composition: 'Simplified flowing composition.',
            negativeSpace: 'left',
            tone: ['premium'],
            preserve: ['approved visual identity'],
            avoid: ['generated logos'],
            accessibility: ['maintain contrast'],
            sourceAsset: { id: 'DAM-IPORTAL-LN-001' }
          }
        },
        { gemini, firefly }
      )
    ).rejects.toMatchObject({ message: 'Creative generation failed' });
    expect(listRegisteredGeneratedIds()).toHaveLength(0);
  });

  it('keeps prompt-length validation intact', () => {
    const specification = assembleCreativeSpecification(
      {
        campaignBrief: { product: 'iPortal' },
        asset: { id: 'DAM-IPORTAL-LN-001', channel: 'LinkedIn' },
        modification: {
          title: 'Discover what is possible with iPortal',
          description: 'Discover a simpler way to manage your digital banking with iPortal.',
          cta: 'Discover iPortal',
          prompt: 'Make the background darker.'
        },
        campaignContext: {
          businessDomain: 'corporate',
          campaignType: 'iPortal',
          channel: 'LinkedIn'
        }
      },
      {
        requestedChange: 'Darken the background and simplify cyan ribbons.',
        visualFamily: 'abstract-digital',
        composition: 'Simplified flowing composition.',
        negativeSpace: 'left',
        tone: ['premium', 'modern'],
        preserve: ['approved visual identity', 'text-safe area'],
        avoid: ['generated logos or simulated Barclays marks', 'readable text'],
        accessibility: ['maintain contrast']
      }
    );
    const prompt = buildFireflyPrompt({
      specification,
      referenceSource: 'source-dam-asset'
    });
    expect(prompt.length).toBeLessThanOrEqual(FIREFLY_PROMPT_MAX_CHARS);
  });

  it('persists JPEG download bytes as .jpg when Content-Type is image/jpeg', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ff-jpeg-dl-'));
    const jpegBytes = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
      0x00, 0x01, 0x00, 0x00, 0xff, 0xd9
    ]);
    const { fetchImpl } = mockFetchSequence([
      () => jsonResponse({ access_token: 't', expires_in: 86000 }),
      () =>
        jsonResponse({
          jobId: 'job-jpg',
          statusUrl: 'https://firefly-api.adobe.io/v3/status/job-jpg'
        }),
      () =>
        jsonResponse({
          status: 'succeeded',
          result: { outputs: [{ image: { url: 'https://cdn.example.com/out.jpg' } }] }
        }),
      () =>
        new Response(jpegBytes, {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' }
        })
    ]);

    const client = createFireflyClient({
      live: true,
      clientId: 'cid',
      clientSecret: 'sec',
      fetchImpl,
      generatedDir: tempDir,
      pollIntervalMs: 1,
      sleep: async () => undefined
    });
    const result = await client.generateImage({ prompt: 'abstract' });
    const id = result.images[0]!.id;
    expect(existsSync(join(tempDir, `${id}.jpg`))).toBe(true);
    expect(existsSync(join(tempDir, `${id}.png`))).toBe(false);
    expect(getRegisteredGeneratedImage(id)?.mimeType).toBe('image/jpeg');
    expect(getRegisteredGeneratedImage(id)?.fileExtension).toBe('.jpg');
  });

  it('exports poll timing constants', () => {
    expect(FIREFLY_POLL_INTERVAL_MS).toBe(1000);
    expect(FIREFLY_JOB_TIMEOUT_MS).toBe(60_000);
  });
});
