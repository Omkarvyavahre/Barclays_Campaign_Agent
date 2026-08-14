/**
 * Browser-side service bridge.
 *
 * The only thing this file knows how to do is call our own same-origin
 * `/api/ai/*` endpoints. It holds no credentials, no gateway address and no
 * provider configuration, and it must never gain any: everything about the
 * upstream provider lives behind the server API.
 */

import {
  AI_ENDPOINTS,
  IMAGE_ENDPOINTS,
  type AgentOutcome,
  type AiHealth,
  type BarclaysServices,
  type BridgeErrorCategory,
  type BridgeResponse,
  type BriefRequestPayload,
  type BriefResult,
  type CoordinatorResult,
  type DiscussionContext,
  type ImageChannel,
  type ImageHealth,
  type ImageOutcome,
  type ImageRequestPayload,
  type LatestImage,
} from './types';

export const BRIDGE_VERSION = '1.0.0';

/**
 * Narrower than `typeof fetch` on purpose: the bridge only ever calls it with a
 * relative same-origin path, and the type says so.
 */
export type BridgeFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface BridgeOptions {
  fetch?: BridgeFetch;
}

function networkFailure(): BridgeResponse<never> {
  return { ok: false, error: { category: 'network_error', message: 'Could not reach the campaign services API.' } };
}

async function post<T>(endpoint: string, body: unknown, options: BridgeOptions): Promise<BridgeResponse<T>> {
  const doFetch = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await doFetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return networkFailure();
  }
  return readResponse<T>(response);
}

async function get<T>(endpoint: string, options: BridgeOptions): Promise<BridgeResponse<T>> {
  const doFetch = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await doFetch(endpoint, { method: 'GET' });
  } catch {
    return networkFailure();
  }
  return readResponse<T>(response);
}

const KNOWN_CATEGORIES: readonly string[] = [
  'auth_error',
  'forbidden',
  'upstream_error',
  'timeout',
  'invalid_response',
  'configuration_error',
  'storage_error',
  'bad_request',
  'network_error',
];

function toCategory(value: unknown): BridgeErrorCategory {
  return typeof value === 'string' && KNOWN_CATEGORIES.includes(value)
    ? (value as BridgeErrorCategory)
    : 'upstream_error';
}

async function readResponse<T>(response: Response): Promise<BridgeResponse<T>> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      ok: false,
      error: { category: 'invalid_response', message: 'The campaign services API returned malformed data.' },
    };
  }

  const body = (payload ?? {}) as { ok?: boolean; error?: { category?: unknown; message?: unknown } } & Record<
    string,
    unknown
  >;

  if (body.ok !== true) {
    const message = typeof body.error?.message === 'string' ? body.error.message : 'The campaign services API rejected the request.';
    return { ok: false, error: { category: toCategory(body.error?.category), message } };
  }

  const { ok: _ok, ...rest } = body;
  return { ok: true, data: rest as T };
}

export function createBridge(options: BridgeOptions = {}): BarclaysServices {
  return {
    version: BRIDGE_VERSION,
    health() {
      return get<AiHealth>(AI_ENDPOINTS.health, options);
    },
    agents: {
      analyseDiscussion(discussion: DiscussionContext) {
        return post<AgentOutcome<CoordinatorResult>>(AI_ENDPOINTS.analyse, { discussion }, options);
      },
      generateBrief(request: BriefRequestPayload) {
        return post<AgentOutcome<BriefResult>>(AI_ENDPOINTS.brief, request, options);
      },
    },
    images: {
      health() {
        return get<ImageHealth>(IMAGE_ENDPOINTS.health, options);
      },
      // Campaign context in, an app-relative asset URL out. The Firefly prompt,
      // credentials and reference images all stay behind this endpoint.
      generate(request: ImageRequestPayload) {
        return post<ImageOutcome>(IMAGE_ENDPOINTS.generate, request, options);
      },
      // Reads back an already-generated background. Never triggers generation.
      latest(channel: ImageChannel) {
        return get<LatestImage>(`${IMAGE_ENDPOINTS.latest}?channel=${encodeURIComponent(channel)}`, options);
      },
    },
  };
}

/** Publishes the bridge for the V19 runtime adapter to consume. */
export function installBrowserBridge(options: BridgeOptions = {}): BarclaysServices {
  const bridge = createBridge(options);
  window.__BARCLAYS_SERVICES__ = bridge;
  return bridge;
}
