import { describe, expect, it, vi } from 'vitest';

import { createBridge } from './browserBridge';
import { AI_ENDPOINTS, type DiscussionContext } from './types';

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
