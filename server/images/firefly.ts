/**
 * Adobe Firefly Services transport.
 *
 * This module owns the wire format and nothing else: no prompts, no campaign
 * meaning, no V19 knowledge. Every request shape below is taken from Adobe's
 * published contract rather than inferred:
 *
 *  - IMS token:  POST {ims}/ims/token/v3            (client_credentials)
 *  - Reference:  POST {api}/v2/storage/image        -> { images: [{ id }] }
 *  - Generate:   POST {api}/v3/images/generate      with contentClass and
 *                                                      style.imageReference
 *                                                      .source.uploadId
 *  - Job status: GET  {api}/v3/status/{jobId}       (when the generate endpoint
 *                                                   answers asynchronously)
 *
 * Only documented fields are sent. Nothing speculative is added to the payload.
 */

import { ImageServiceError, classifyImageHttpStatus, classifyImageTransportError } from './errors.ts';
import type { ImageConfig } from './config.ts';
import { assertLiveImageConfig } from './config.ts';
import type { ImageContentClass, ImageSize } from './types.ts';

export const IMS_TOKEN_PATH = '/ims/token/v3';
export const REFERENCE_UPLOAD_PATH = '/v2/storage/image';
export const IMAGE_GENERATE_PATH = '/v3/images/generate';
export const JOB_STATUS_PATH = '/v3/status';

/**
 * Adobe's documented content classes for /v3/images/generate. Prompt wording
 * alone is not a reliable way to choose between them, so the class is requested
 * at API level; the response echoes the class Firefly applied.
 */
export const CONTENT_CLASSES: readonly ImageContentClass[] = ['photo', 'art'];

/** Refresh a little before expiry rather than racing it. */
const TOKEN_SKEW_MS = 60_000;
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const MAX_JOB_POLLS = 30;
const JOB_POLL_INTERVAL_MS = 2_000;

export type ImageFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface ImageDeps {
  fetch?: ImageFetch;
  now?: () => number;
  /** Injectable so tests never actually wait between job polls. */
  sleep?: (ms: number) => Promise<void>;
}

export interface AccessToken {
  token: string;
  expiresAt: number;
}

export interface FireflyGenerationRequest {
  prompt: string;
  size: ImageSize;
  uploadId: string;
  styleStrength: number;
  contentClass: ImageContentClass;
}

export interface FireflyGenerationResult {
  imageUrl: string;
  seed?: number;
  /** The class Firefly reports having applied, when it echoes one. */
  contentClass?: string;
}

interface Deps {
  fetch: ImageFetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

function resolveDeps(deps: ImageDeps): Deps {
  const doFetch = deps.fetch ?? (globalThis.fetch as ImageFetch | undefined);
  if (!doFetch) throw new ImageServiceError('configuration_error', 'no fetch implementation available');
  return {
    fetch: doFetch,
    now: deps.now ?? Date.now,
    sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
}

async function send(config: ImageConfig, deps: Deps, url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    return await deps.fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    throw new ImageServiceError(
      classifyImageTransportError(error),
      error instanceof Error ? error.message : 'transport failure',
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Upstream bodies can echo internal detail, so they are logged, never returned. */
async function failFromResponse(response: Response, label: string): Promise<never> {
  let detail = '';
  try {
    detail = (await response.text()).slice(0, 500);
  } catch {
    detail = '<unreadable body>';
  }
  throw new ImageServiceError(classifyImageHttpStatus(response.status), `${label} responded ${response.status}: ${detail}`);
}

async function readJson(response: Response, label: string): Promise<Record<string, unknown>> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ImageServiceError('invalid_response', `${label} response was not valid JSON`);
  }
  if (typeof payload !== 'object' || payload === null) {
    throw new ImageServiceError('invalid_response', `${label} response was not an object`);
  }
  return payload as Record<string, unknown>;
}

/* ------------------------------------------------------------------ *
 * Authentication
 * ------------------------------------------------------------------ */

const tokenCache = new Map<string, AccessToken>();

/** Exposed so tests and a future restart hook can drop cached credentials. */
export function clearTokenCache(): void {
  tokenCache.clear();
}

export async function requestAccessToken(config: ImageConfig, deps: ImageDeps = {}): Promise<AccessToken> {
  assertLiveImageConfig(config);
  const resolved = resolveDeps(deps);

  const cached = tokenCache.get(config.clientId);
  if (cached && cached.expiresAt - TOKEN_SKEW_MS > resolved.now()) return cached;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: config.scope,
  });

  const response = await send(config, resolved, `${config.imsBaseUrl}${IMS_TOKEN_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) await failFromResponse(response, 'IMS');

  const payload = await readJson(response, 'IMS');
  const token = payload.access_token;
  const expiresIn = payload.expires_in;
  if (typeof token !== 'string' || !token) {
    throw new ImageServiceError('invalid_response', 'IMS response contained no access_token');
  }

  const lifetimeMs = typeof expiresIn === 'number' && Number.isFinite(expiresIn) ? expiresIn * 1000 : 60 * 60 * 1000;
  const entry: AccessToken = { token, expiresAt: resolved.now() + lifetimeMs };
  tokenCache.set(config.clientId, entry);
  return entry;
}

function authHeaders(config: ImageConfig, token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'x-api-key': config.clientId, accept: 'application/json' };
}

/* ------------------------------------------------------------------ *
 * Reference upload
 * ------------------------------------------------------------------ */

export function extractUploadId(payload: Record<string, unknown>): string {
  const images = payload.images;
  const first = Array.isArray(images) ? (images[0] as Record<string, unknown> | undefined) : undefined;
  const id = first?.id;
  if (typeof id !== 'string' || !id) {
    throw new ImageServiceError('invalid_response', 'storage response contained no image id');
  }
  return id;
}

export async function uploadReferenceImage(
  config: ImageConfig,
  token: string,
  bytes: Uint8Array,
  contentType: string,
  deps: ImageDeps = {},
): Promise<string> {
  const resolved = resolveDeps(deps);
  const response = await send(config, resolved, `${config.apiBaseUrl}${REFERENCE_UPLOAD_PATH}`, {
    method: 'POST',
    headers: { ...authHeaders(config, token), 'content-type': contentType },
    body: new Uint8Array(bytes),
  });

  if (!response.ok) await failFromResponse(response, 'Firefly storage');
  return extractUploadId(await readJson(response, 'Firefly storage'));
}

/* ------------------------------------------------------------------ *
 * Generation
 * ------------------------------------------------------------------ */

/**
 * Reads the generated image location out of either documented answer shape:
 * a synchronous `outputs` array, or an async job result under `result.outputs`.
 * Returns undefined when the payload is a job that has not finished yet.
 */
export function extractGeneration(payload: Record<string, unknown>): FireflyGenerationResult | undefined {
  const result = payload.result as Record<string, unknown> | undefined;
  const containers: unknown[] = [payload.outputs, result?.outputs];

  for (const container of containers) {
    if (!Array.isArray(container) || container.length === 0) continue;
    const first = container[0] as Record<string, unknown> | undefined;
    const image = first?.image as Record<string, unknown> | undefined;
    const url = image?.url ?? image?.presignedUrl;
    if (typeof url === 'string' && url) {
      const seed = first?.seed;
      const contentClass = payload.contentClass ?? result?.contentClass;
      return {
        imageUrl: url,
        ...(typeof seed === 'number' ? { seed } : {}),
        ...(typeof contentClass === 'string' ? { contentClass } : {}),
      };
    }
  }

  const status = typeof payload.status === 'string' ? payload.status.toLowerCase() : '';
  if (status === 'failed' || status === 'cancelled' || status === 'canceled') {
    throw new ImageServiceError('upstream_error', `Firefly job reported status ${status}`);
  }
  return undefined;
}

function jobStatusUrl(config: ImageConfig, payload: Record<string, unknown>): string | undefined {
  const jobId = payload.jobId;
  if (typeof jobId === 'string' && jobId) {
    return `${config.apiBaseUrl}${JOB_STATUS_PATH}/${encodeURIComponent(jobId)}`;
  }
  // A returned statusUrl is only trusted if it stays on the configured host.
  const statusUrl = payload.statusUrl;
  if (typeof statusUrl === 'string' && statusUrl.startsWith(`${config.apiBaseUrl}/`)) return statusUrl;
  return undefined;
}

export async function generateImage(
  config: ImageConfig,
  token: string,
  request: FireflyGenerationRequest,
  deps: ImageDeps = {},
): Promise<FireflyGenerationResult> {
  const resolved = resolveDeps(deps);

  if (!CONTENT_CLASSES.includes(request.contentClass)) {
    throw new ImageServiceError('configuration_error', 'unsupported content class requested');
  }

  const response = await send(config, resolved, `${config.apiBaseUrl}${IMAGE_GENERATE_PATH}`, {
    method: 'POST',
    headers: { ...authHeaders(config, token), 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: request.prompt,
      contentClass: request.contentClass,
      numVariations: 1,
      size: request.size,
      style: {
        imageReference: { source: { uploadId: request.uploadId } },
        strength: request.styleStrength,
      },
    }),
  });

  if (!response.ok) await failFromResponse(response, 'Firefly generate');

  let payload = await readJson(response, 'Firefly generate');
  let generation = extractGeneration(payload);
  if (generation) return generation;

  // The endpoint answered with a job handle; poll its status until it resolves.
  const statusUrl = jobStatusUrl(config, payload);
  if (!statusUrl) throw new ImageServiceError('invalid_response', 'Firefly generate returned no output and no job handle');

  for (let attempt = 0; attempt < MAX_JOB_POLLS; attempt++) {
    await resolved.sleep(JOB_POLL_INTERVAL_MS);
    const poll = await send(config, resolved, statusUrl, { method: 'GET', headers: authHeaders(config, token) });
    if (!poll.ok) await failFromResponse(poll, 'Firefly status');

    payload = await readJson(poll, 'Firefly status');
    generation = extractGeneration(payload);
    if (generation) return generation;
  }

  throw new ImageServiceError('timeout', 'Firefly job did not complete within the poll budget');
}

/* ------------------------------------------------------------------ *
 * Download
 * ------------------------------------------------------------------ */

/**
 * Fetches the generated image from the presigned URL Firefly returns.
 *
 * The URL comes from an authenticated Adobe response, but it is still checked
 * to be https and the download is capped, so a malformed or hostile value
 * cannot turn this into an open fetch proxy.
 */
export async function downloadGeneratedImage(
  config: ImageConfig,
  url: string,
  deps: ImageDeps = {},
): Promise<Buffer> {
  if (!/^https:\/\//i.test(url)) {
    throw new ImageServiceError('invalid_response', 'generated image URL was not https');
  }
  const resolved = resolveDeps(deps);
  const response = await send(config, resolved, url, { method: 'GET' });
  if (!response.ok) await failFromResponse(response, 'Firefly download');

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new ImageServiceError('invalid_response', 'generated image was empty');
  if (buffer.length > MAX_DOWNLOAD_BYTES) throw new ImageServiceError('invalid_response', 'generated image was too large');
  return buffer;
}
