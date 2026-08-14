/**
 * End-to-end behaviour of the image layer with a stubbed transport.
 *
 * No Adobe call is ever made here: every test either stays in mock mode or
 * injects a fetch stub.
 */

import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadImageConfig, type ImageConfig } from './config.ts';
import { ImageServiceError } from './errors.ts';
import { CONTENT_CLASSES, clearTokenCache, type ImageFetch } from './firefly.ts';
import { generateChannelImage } from './generator.ts';
import { PROMPT_CHAR_LIMIT } from './prompt.ts';
import { loadReference, referenceSlotForChannel } from './references.ts';
import { generatedDirectory } from './storage.ts';
import type { ImageGenerationRequest } from './types.ts';

const LIVE_ENV = {
  IMAGE_GENERATION_PROVIDER: 'firefly',
  ADOBE_FIREFLY_CLIENT_ID: 'test-client-id',
  ADOBE_FIREFLY_CLIENT_SECRET: 'test-client-secret',
};

const REQUEST: ImageGenerationRequest = {
  channel: 'linkedin',
  campaignContext: {
    objective: 'Grow iPortal adoption among SME business banking clients.',
    audience: 'Digital Adoption cohort',
    businessNeed: 'Manual payment-status chasing absorbs relationship team time.',
    proposition: 'One connected digital front door.',
    creativeDirection: 'Brief-led iPortal visual direction.',
  },
  outputContext: { headline: 'A step change in how you bank', cta: 'Discover iPortal' },
};

/** A genuine PNG, so dimension reading and signature checks are exercised. */
const PNG = loadReference(1).bytes;

/** A PNG header carrying real dimensions, standing in for a generated image. */
function pngBytes(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  return Buffer.concat([signature, ihdr]);
}

/** What the recipe asks for, and therefore the only size a candidate may be. */
const GENERATED = pngBytes(2688, 1536);

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function binaryResponse(bytes: Buffer, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => '<binary>',
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as Response;
}

interface Route {
  match: RegExp;
  respond: () => Response;
}

/** Routes stub responses by URL so call order does not have to be hardcoded. */
function stubTransport(routes: Route[]) {
  return vi.fn<ImageFetch>(async (url) => {
    const route = routes.find((candidate) => candidate.match.test(url));
    if (!route) throw new Error(`unexpected request to ${url}`);
    return route.respond();
  });
}

function happyRoutes(overrides: Partial<Record<'token' | 'upload' | 'generate' | 'download', () => Response>> = {}) {
  return [
    { match: /\/ims\/token\/v3$/, respond: overrides.token ?? (() => jsonResponse({ access_token: 'test-token', expires_in: 86_400 })) },
    { match: /\/v2\/storage\/image$/, respond: overrides.upload ?? (() => jsonResponse({ images: [{ id: 'upload-123' }] })) },
    {
      match: /\/v3\/images\/generate$/,
      respond:
        overrides.generate ??
        (() =>
          jsonResponse({
            contentClass: 'art',
            outputs: [{ seed: 42, image: { url: 'https://presigned.example/generated.png' } }],
          })),
    },
    { match: /presigned\.example/, respond: overrides.download ?? (() => binaryResponse(GENERATED)) },
  ];
}

const created: string[] = [];

function trackCreated(id: string | undefined) {
  if (id) created.push(id);
}

beforeEach(() => {
  clearTokenCache();
});

afterEach(() => {
  for (const id of created.splice(0)) {
    const path = join(generatedDirectory(), `${id}.png`);
    if (existsSync(path)) unlinkSync(path);
  }
});

describe('mock provider', () => {
  it('makes no Adobe call at all', async () => {
    const fetchSpy = stubTransport([]);
    const config = loadImageConfig({ IMAGE_GENERATION_PROVIDER: 'mock' });

    const outcome = await generateChannelImage(config, REQUEST, { fetch: fetchSpy });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(outcome).toEqual({ source: 'mock', asset: null, referenceSlot: 1 });
  });

  it('keeps the existing V19 creative for both channels', async () => {
    const config = loadImageConfig({});
    const fetchSpy = stubTransport([]);

    const linkedin = await generateChannelImage(config, REQUEST, { fetch: fetchSpy });
    const email = await generateChannelImage(config, { ...REQUEST, channel: 'email' }, { fetch: fetchSpy });

    expect(linkedin.asset).toBeNull();
    expect(email.asset).toBeNull();
    expect(email.referenceSlot).toBe(referenceSlotForChannel('email'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('live provider path', () => {
  let config: ImageConfig;

  beforeEach(() => {
    config = loadImageConfig(LIVE_ENV);
  });

  it('authenticates, uploads the reference, generates and stores the result', async () => {
    const fetchSpy = stubTransport(happyRoutes());
    const outcome = await generateChannelImage(config, REQUEST, { fetch: fetchSpy });
    trackCreated(outcome.asset?.id);

    expect(outcome.source).toBe('firefly');
    expect(outcome.referenceSlot).toBe(1);
    expect(outcome.seed).toBe(42);
    expect(outcome.asset?.url.startsWith('/api/images/asset/')).toBe(true);
    expect(outcome.asset?.channel).toBe('linkedin');
    expect(outcome.asset?.bytes).toBe(GENERATED.length);
    expect(outcome.asset?.width).toBe(2688);
    expect(outcome.asset?.height).toBe(1536);
    expect(existsSync(join(generatedDirectory(), `${outcome.asset?.id}.png`))).toBe(true);

    const [tokenCall, uploadCall, generateCall] = fetchSpy.mock.calls;
    expect(tokenCall[0]).toContain('/ims/token/v3');
    expect(uploadCall[0]).toContain('/v2/storage/image');
    expect(generateCall[0]).toContain('/v3/images/generate');
  });

  it('sends the documented reference-image payload and the safe prompt', async () => {
    const fetchSpy = stubTransport(happyRoutes());
    const outcome = await generateChannelImage(config, REQUEST, { fetch: fetchSpy });
    trackCreated(outcome.asset?.id);

    const generateCall = fetchSpy.mock.calls.find((call) => call[0].endsWith('/v3/images/generate'));
    const body = JSON.parse((generateCall?.[1].body as string) ?? '{}');

    expect(body.style.imageReference.source.uploadId).toBe('upload-123');
    expect(body.size).toEqual({ width: 2688, height: 1536 });
    expect(body.numVariations).toBe(1);
    expect(body.style.strength).toBeLessThan(50);
    expect(body.prompt).toContain('Premium abstract digital banking artwork');
    expect(body.prompt).toMatch(/No people, faces, office scenes.* anywhere in the image\./);
    // The artefact vocabulary that produced advertisement layouts must be gone.
    expect(body.prompt).not.toMatch(/\b(campaign|creative|headline|banner|LinkedIn)\b/i);
    // Firefly rejects anything longer, so the transport must never see more.
    expect(body.prompt.length).toBeLessThanOrEqual(PROMPT_CHAR_LIMIT);
    // Adobe's documented class for abstract artwork, requested at API level.
    expect(CONTENT_CLASSES).toContain(body.contentClass);
    expect(body.contentClass).toBe('art');
    expect(Object.keys(body).sort()).toEqual(['contentClass', 'numVariations', 'prompt', 'size', 'style']);
  });

  it('reports back the content class Firefly says it applied', async () => {
    const fetchSpy = stubTransport(happyRoutes());
    const outcome = await generateChannelImage(config, REQUEST, { fetch: fetchSpy });
    trackCreated(outcome.asset?.id);

    expect(outcome.contentClass).toBe('art');
    expect(outcome.seed).toBe(42);
  });

  it('sends the reference bytes, never a path', async () => {
    const fetchSpy = stubTransport(happyRoutes());
    const outcome = await generateChannelImage(config, REQUEST, { fetch: fetchSpy });
    trackCreated(outcome.asset?.id);

    const uploadCall = fetchSpy.mock.calls.find((call) => call[0].endsWith('/v2/storage/image'));
    const headers = uploadCall?.[1].headers as Record<string, string>;
    expect(headers['content-type']).toBe('image/png');
    expect(headers['x-api-key']).toBe('test-client-id');
    expect(uploadCall?.[1].body).toBeInstanceOf(Uint8Array);
    expect(String(uploadCall?.[1].body)).not.toContain('firefly-references');
  });

  it('follows an asynchronous job to completion', async () => {
    const statuses = [
      jsonResponse({ status: 'running' }),
      jsonResponse({ status: 'succeeded', result: { outputs: [{ image: { url: 'https://presigned.example/x.png' } }] } }),
    ];
    const fetchSpy = stubTransport([
      ...happyRoutes({ generate: () => jsonResponse({ jobId: 'job-1', statusUrl: 'https://firefly-api.adobe.io/v3/status/job-1' }) }),
      { match: /\/v3\/status\//, respond: () => statuses.shift() ?? jsonResponse({ status: 'running' }) },
    ]);

    const outcome = await generateChannelImage(config, REQUEST, { fetch: fetchSpy, sleep: async () => {} });
    trackCreated(outcome.asset?.id);

    expect(outcome.source).toBe('firefly');
    expect(outcome.asset).not.toBeNull();
    expect(fetchSpy.mock.calls.filter((call) => call[0].includes('/v3/status/'))).toHaveLength(2);
  });
});

describe('failures stay safe and leave the fixture usable', () => {
  const config = () => loadImageConfig(LIVE_ENV);

  async function categoryOf(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
      return 'no-error';
    } catch (error) {
      expect(error).toBeInstanceOf(ImageServiceError);
      return (error as ImageServiceError).category;
    }
  }

  it('reports missing credentials as configuration_error without calling Adobe', async () => {
    const fetchSpy = stubTransport(happyRoutes());
    const incomplete = loadImageConfig({ IMAGE_GENERATION_PROVIDER: 'firefly' });

    expect(await categoryOf(generateChannelImage(incomplete, REQUEST, { fetch: fetchSpy }))).toBe('configuration_error');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['auth_error', 401],
    ['forbidden', 403],
    ['upstream_error', 500],
  ])('maps an IMS %s response safely', async (category, status) => {
    const fetchSpy = stubTransport(happyRoutes({ token: () => jsonResponse({ error: 'nope' }, status) }));
    expect(await categoryOf(generateChannelImage(config(), REQUEST, { fetch: fetchSpy }))).toBe(category);
  });

  it('maps a Firefly rejection safely and stores nothing', async () => {
    const fetchSpy = stubTransport(happyRoutes({ generate: () => jsonResponse({ error: 'bad prompt' }, 400) }));
    expect(await categoryOf(generateChannelImage(config(), REQUEST, { fetch: fetchSpy }))).toBe('upstream_error');
  });

  it('maps an aborted request to timeout', async () => {
    const fetchSpy = vi.fn<ImageFetch>(async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    });
    expect(await categoryOf(generateChannelImage(config(), REQUEST, { fetch: fetchSpy }))).toBe('timeout');
  });

  it('rejects a generate response with neither output nor job handle', async () => {
    const fetchSpy = stubTransport(happyRoutes({ generate: () => jsonResponse({ nothing: true }) }));
    expect(await categoryOf(generateChannelImage(config(), REQUEST, { fetch: fetchSpy }))).toBe('invalid_response');
  });

  it('rejects a generated image that is not the size the recipe asked for', async () => {
    const fetchSpy = stubTransport(happyRoutes({ download: () => binaryResponse(pngBytes(1200, 627)) }));
    expect(await categoryOf(generateChannelImage(config(), REQUEST, { fetch: fetchSpy }))).toBe('invalid_response');
  });

  it('rejects a non-https generated image URL', async () => {
    const fetchSpy = stubTransport(
      happyRoutes({ generate: () => jsonResponse({ outputs: [{ image: { url: 'http://insecure.example/x.png' } }] }) }),
    );
    expect(await categoryOf(generateChannelImage(config(), REQUEST, { fetch: fetchSpy }))).toBe('invalid_response');
  });

  it('exposes no Adobe response body in the safe message', async () => {
    const fetchSpy = stubTransport(happyRoutes({ token: () => jsonResponse({ error_description: 'secret-detail' }, 401) }));
    try {
      await generateChannelImage(config(), REQUEST, { fetch: fetchSpy });
      expect.unreachable('should have thrown');
    } catch (error) {
      const safe = (error as ImageServiceError).toSafePayload();
      expect(JSON.stringify(safe)).not.toContain('secret-detail');
      expect(JSON.stringify(safe)).not.toContain('test-client-secret');
      expect(safe.error.category).toBe('auth_error');
    }
  });
});
