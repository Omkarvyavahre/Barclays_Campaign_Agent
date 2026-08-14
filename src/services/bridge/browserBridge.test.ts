import { describe, expect, it, vi } from 'vitest';

import { createBridge } from './browserBridge';
import { AI_ENDPOINTS, IMAGE_ENDPOINTS, type DiscussionContext, type ImageRequestPayload } from './types';

const IMAGE_REQUEST: ImageRequestPayload = {
  channel: 'linkedin',
  campaignContext: {
    objective: 'Grow iPortal adoption among UKC clients.',
    audience: 'Digital Adoption cohort',
    businessNeed: 'Manual payment status chasing.',
    proposition: 'One connected digital front door.',
    creativeDirection: 'Brief-led iPortal visual direction',
  },
  outputContext: { headline: 'A step change in how you bank', cta: 'Discover iPortal' },
};

const DISCUSSION: DiscussionContext = {
  channel: 'iPortal Adoption',
  connectedSources: ['teams'],
  messages: [{ author: 'Commercial Lead', text: 'We should deepen client relationships.' }],
};

function respond(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 502, json: async () => body } as unknown as Response;
}

/** Typed so `mock.calls` keeps the (url, init) tuple shape. */
function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  return vi.fn(handler);
}

describe('browser bridge calls only our own server endpoints', () => {
  it('uses same-origin relative paths under /api/ai', async () => {
    const fetchSpy = stubFetch(async () => respond({ ok: true, source: 'mock', result: null }));
    const bridge = createBridge({ fetch: fetchSpy });

    await bridge.agents.analyseDiscussion(DISCUSSION);
    await bridge.agents.generateBrief({ discussion: DISCUSSION });
    await bridge.health();

    const urls = fetchSpy.mock.calls.map((call) => call[0]);
    expect(urls).toEqual([AI_ENDPOINTS.analyse, AI_ENDPOINTS.brief, AI_ENDPOINTS.health]);
    for (const url of urls) {
      expect(url.startsWith('/api/ai/')).toBe(true);
      expect(url).not.toMatch(/^https?:/);
    }
  });

  it('sends no authorization header and no provider configuration', async () => {
    const fetchSpy = stubFetch(async () => respond({ ok: true, source: 'mock', result: null }));
    await createBridge({ fetch: fetchSpy }).agents.analyseDiscussion(DISCUSSION);

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headerNames = Object.keys(init.headers as Record<string, string>).map((h: string) => h.toLowerCase());
    expect(headerNames).toEqual(['content-type']);

    const body = init.body as string;
    expect(body).not.toMatch(/authorization/i);
    expect(body).not.toMatch(/api[_-]?key/i);
    expect(body).not.toMatch(/gateway/i);
  });

  it('surfaces a mock outcome unchanged', async () => {
    const fetchSpy = vi.fn(async () => respond({ ok: true, source: 'mock', result: null }));
    const response = await createBridge({ fetch: fetchSpy }).agents.analyseDiscussion(DISCUSSION);
    expect(response).toEqual({ ok: true, data: { source: 'mock', result: null } });
  });
});

describe('browser bridge image generation', () => {
  it('uses same-origin relative paths under /api/images', async () => {
    const fetchSpy = stubFetch(async () => respond({ ok: true, source: 'mock', asset: null, referenceSlot: 1 }));
    const bridge = createBridge({ fetch: fetchSpy });

    await bridge.images.generate(IMAGE_REQUEST);
    await bridge.images.health();

    const urls = fetchSpy.mock.calls.map((call) => call[0]);
    expect(urls).toEqual([IMAGE_ENDPOINTS.generate, IMAGE_ENDPOINTS.health]);
    for (const url of urls) {
      expect(url.startsWith('/api/images/')).toBe(true);
      expect(url).not.toMatch(/^https?:/);
      expect(url).not.toMatch(/adobe|firefly-api|ims-na1/i);
    }
  });

  it('sends campaign context but no credential, prompt or Adobe detail', async () => {
    const fetchSpy = stubFetch(async () => respond({ ok: true, source: 'mock', asset: null, referenceSlot: 1 }));
    await createBridge({ fetch: fetchSpy }).images.generate(IMAGE_REQUEST);

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(Object.keys(init.headers as Record<string, string>).map((h) => h.toLowerCase())).toEqual(['content-type']);

    const body = init.body as string;
    expect(JSON.parse(body)).toEqual(IMAGE_REQUEST);
    expect(body).not.toMatch(/authorization/i);
    expect(body).not.toMatch(/client[_-]?secret/i);
    expect(body).not.toMatch(/adobe|uploadId|firefly-references/i);
  });

  it('surfaces a mock outcome unchanged so Stage 7 keeps the V19 creative', async () => {
    const fetchSpy = stubFetch(async () => respond({ ok: true, source: 'mock', asset: null, referenceSlot: 2 }));
    const response = await createBridge({ fetch: fetchSpy }).images.generate({ ...IMAGE_REQUEST, channel: 'email' });
    expect(response).toEqual({ ok: true, data: { source: 'mock', asset: null, referenceSlot: 2 } });
  });

  it('returns an app-relative asset URL when a live image is generated', async () => {
    const asset = { id: 'linkedin-abc', url: '/api/images/asset/linkedin-abc', channel: 'linkedin', width: 2688, height: 1536, bytes: 1024 };
    const fetchSpy = stubFetch(async () => respond({ ok: true, source: 'firefly', asset, referenceSlot: 1 }));
    const response = await createBridge({ fetch: fetchSpy }).images.generate(IMAGE_REQUEST);

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data.asset?.url.startsWith('/api/images/asset/')).toBe(true);
      expect(response.data.asset?.url).not.toMatch(/^https?:/);
    }
  });

  it('maps a storage failure to its safe category', async () => {
    const fetchSpy = stubFetch(async () =>
      respond({ ok: false, error: { category: 'storage_error', message: 'The generated image could not be stored.' } }, false),
    );
    const response = await createBridge({ fetch: fetchSpy }).images.generate(IMAGE_REQUEST);
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.category).toBe('storage_error');
  });

  it('reads back an existing background with a GET and no generation', async () => {
    const asset = { id: 'linkedin-abc', url: '/api/images/asset/linkedin-abc', channel: 'linkedin', width: 2688, height: 1536, bytes: 1024 };
    const fetchSpy = stubFetch(async () => respond({ ok: true, channel: 'linkedin', asset }));
    const response = await createBridge({ fetch: fetchSpy }).images.latest('linkedin');

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${IMAGE_ENDPOINTS.latest}?channel=linkedin`);
    expect(url.startsWith('/api/images/')).toBe(true);
    expect((init as RequestInit).method).toBe('GET');
    expect(response.ok && response.data.asset?.url).toBe('/api/images/asset/linkedin-abc');
  });

  it('reports no stored background as an empty result rather than an error', async () => {
    const fetchSpy = stubFetch(async () => respond({ ok: true, channel: 'linkedin', asset: null }));
    const response = await createBridge({ fetch: fetchSpy }).images.latest('linkedin');

    expect(response).toEqual({ ok: true, data: { channel: 'linkedin', asset: null } });
  });
});

describe('browser bridge error handling', () => {
  it('maps a server error payload to a safe category', async () => {
    const fetchSpy = vi.fn(async () => respond({ ok: false, error: { category: 'auth_error', message: 'rejected' } }, false));
    const response = await createBridge({ fetch: fetchSpy }).health();
    expect(response).toEqual({ ok: false, error: { category: 'auth_error', message: 'rejected' } });
  });

  it('downgrades an unrecognised category to upstream_error', async () => {
    const fetchSpy = vi.fn(async () => respond({ ok: false, error: { category: 'weird', message: 'x' } }, false));
    const response = await createBridge({ fetch: fetchSpy }).health();
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.category).toBe('upstream_error');
  });

  it('reports a transport failure as network_error rather than throwing', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('offline');
    });
    const response = await createBridge({ fetch: fetchSpy }).agents.generateBrief({ discussion: DISCUSSION });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.category).toBe('network_error');
  });

  it('reports malformed JSON as invalid_response', async () => {
    const fetchSpy = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error('bad json');
          },
        }) as unknown as Response,
    );
    const response = await createBridge({ fetch: fetchSpy }).health();
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.category).toBe('invalid_response');
  });
});
