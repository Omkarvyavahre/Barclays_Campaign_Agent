/**
 * Shared Adobe Firefly Services client.
 *
 * Auth: IMS client_credentials → firefly-api.adobe.io
 * Generation: POST /v3/images/generate-async → poll statusUrl → outputs
 *
 * Live calls require `live: true` (or FIREFLY_LIVE=1) plus credentials.
 * Default remains live=false so tests make 0 provider calls.
 */

import { randomUUID } from 'node:crypto';
import {
  getDefaultGeneratedDir,
  persistGeneratedImageBytes,
  registerGeneratedImage
} from './storage';
import type {
  FireflyClient,
  FireflyClientOptions,
  FireflyGenerateRequest,
  FireflyGenerateResult,
  FireflyGeneratedImage,
  FireflyJobTelemetry
} from './types';

const IMS_TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';
const FIREFLY_BASE = 'https://firefly-api.adobe.io';
const FIREFLY_SCOPE =
  'openid,AdobeID,session,additional_info,read_organizations,firefly_api,ff_apis';

/** Controlled polling interval between status checks. */
export const FIREFLY_POLL_INTERVAL_MS = 1000;

/** Maximum time to wait for an async job to reach a terminal state. */
export const FIREFLY_JOB_TIMEOUT_MS = 60_000;

/**
 * Corporate egress reaches firefly-api.adobe.io in ~8s, and undici's 10s default
 * connect timeout turns ordinary jitter into a bare `fetch failed`.
 */
export const FIREFLY_CONNECT_TIMEOUT_MS = 30_000;

const PENDING_STATES = new Set(['pending', 'queued', 'running', 'processing', 'not_started', 'accepted']);
const SUCCESS_STATES = new Set(['succeeded', 'success', 'complete', 'completed']);
const FAILURE_STATES = new Set(['failed', 'error', 'cancelled', 'canceled']);

export class FireflyClientError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'FireflyClientError';
    this.code = code;
  }
}

type TokenCache = { accessToken: string; expiresAt: number };

type AsyncJobAccepted = {
  jobId?: string;
  statusUrl?: string;
  cancelUrl?: string;
  raw: Record<string, unknown>;
};

type FireflyOutput = { seed?: number; image?: { url?: string } };

function resolveCredentials(options: FireflyClientOptions): {
  clientId: string;
  clientSecret: string;
} {
  return {
    clientId: options.clientId ?? process.env.ADOBE_FIREFLY_CLIENT_ID ?? '',
    clientSecret: options.clientSecret ?? process.env.ADOBE_FIREFLY_CLIENT_SECRET ?? ''
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveFireflyConnectTimeoutMs(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = Number(env.FIREFLY_CONNECT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : FIREFLY_CONNECT_TIMEOUT_MS;
}

/**
 * `fetch failed` carries the real reason on `cause`, which is otherwise lost.
 * Flattens the chain into one sanitized line (codes only, never request bodies).
 */
export function describeTransportError(error: unknown): string {
  const seen: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 4; depth += 1) {
    const code = (current as { code?: unknown }).code;
    const label = [typeof code === 'string' ? code : null, current.message]
      .filter(Boolean)
      .join(': ');
    if (label && !seen.includes(label)) seen.push(label);
    current = (current as { cause?: unknown }).cause;
  }
  if (!seen.length) return error instanceof Error ? error.name : String(error);
  return seen.join(' <- ');
}

/**
 * undici's global dispatcher cannot be reconfigured per call, so the client owns one
 * with a wider connect budget. Loaded lazily; falls back to plain fetch if unavailable.
 */
function createConnectTolerantFetch(connectTimeoutMs: number): typeof fetch {
  // undici ships its own Response/RequestInit declarations, so the bridge is untyped by design.
  type LooseFetch = (input: unknown, init?: unknown) => Promise<unknown>;

  let pending: Promise<LooseFetch | null> | null = null;

  const load = async (): Promise<LooseFetch | null> => {
    try {
      const { Agent, fetch: undiciFetch } = await import('undici');
      const agent = new Agent({ connect: { timeout: connectTimeoutMs } });
      return (input, init) =>
        (undiciFetch as unknown as LooseFetch)(input, {
          ...((init ?? {}) as Record<string, unknown>),
          dispatcher: agent
        });
    } catch {
      return null;
    }
  };

  const wrapped: LooseFetch = async (input, init) => {
    pending ??= load();
    const impl = (await pending) ?? (globalThis.fetch as unknown as LooseFetch);
    return impl(input, init);
  };

  return wrapped as unknown as typeof fetch;
}

function sanitizeProviderSnippet(value: unknown): string {
  return JSON.stringify(value)
    .replace(/"access_token"\s*:\s*"[^"]+"/gi, '"access_token":"[REDACTED]"')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]')
    .slice(0, 400);
}

export function normalizeFireflyJobStatus(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase();
}

export function parseAsyncJobAccepted(json: Record<string, unknown>): AsyncJobAccepted {
  const statusUrl =
    (typeof json.statusUrl === 'string' && json.statusUrl) ||
    (json._links as { result?: { href?: string }; status?: { href?: string } } | undefined)?.result
      ?.href ||
    (json._links as { status?: { href?: string } } | undefined)?.status?.href ||
    undefined;

  const jobId = typeof json.jobId === 'string' ? json.jobId : undefined;
  const cancelUrl = typeof json.cancelUrl === 'string' ? json.cancelUrl : undefined;

  return { jobId, statusUrl, cancelUrl, raw: json };
}

/**
 * Extract image outputs from either the documented success envelope
 * (`result.outputs`) or a top-level `outputs` array (compat).
 */
export function extractFireflyOutputs(json: Record<string, unknown>): FireflyOutput[] {
  const nested = (json.result as { outputs?: FireflyOutput[] } | undefined)?.outputs;
  if (Array.isArray(nested)) return nested;
  if (Array.isArray(json.outputs)) return json.outputs as FireflyOutput[];
  return [];
}

export function extractFirstImageUrl(json: Record<string, unknown>): string | null {
  const outputs = extractFireflyOutputs(json);
  const url = outputs[0]?.image?.url;
  return typeof url === 'string' && url.trim() ? url.trim() : null;
}

async function fetchAccessToken(
  clientId: string,
  clientSecret: string,
  fetchImpl: typeof fetch,
  cache: { current: TokenCache | null }
): Promise<string> {
  const now = Date.now();
  if (cache.current && cache.current.expiresAt > now + 60_000) {
    return cache.current.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: FIREFLY_SCOPE
  });

  let response: Response;
  try {
    response = await fetchImpl(IMS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
  } catch (error) {
    // No HTTP response at all: transport/TLS. On a network that inspects TLS this is usually a
    // missing OS trust store, which Node only consults with --use-system-ca.
    const reason = describeTransportError(error);
    throw new FireflyClientError(
      `Firefly IMS request failed before any HTTP response (${reason}). ` +
        'Check network reachability and Node system CA trust (--use-system-ca).',
      'ims_unreachable'
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new FireflyClientError(
      `Firefly IMS HTTP ${response.status}: ${detail.slice(0, 400)}`,
      'ims_failed'
    );
  }

  const json = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new FireflyClientError('Firefly IMS response missing access_token', 'ims_failed');
  }

  cache.current = {
    accessToken: json.access_token,
    expiresAt: now + (json.expires_in ?? 86000) * 1000
  };
  return json.access_token;
}

async function uploadReferenceImage(
  accessToken: string,
  clientId: string,
  image: NonNullable<FireflyGenerateRequest['referenceImage']>,
  fetchImpl: typeof fetch
): Promise<{ uploadId?: string; url?: string }> {
  if (image.uploadId) return { uploadId: image.uploadId };
  if (image.url && !image.bytes) return { url: image.url };
  if (!image.bytes) {
    throw new FireflyClientError('Reference image requires uploadId, url, or bytes');
  }

  const mimeType = image.mimeType ?? 'image/png';
  const response = await fetchImpl(`${FIREFLY_BASE}/v2/storage/image`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'x-api-key': clientId,
      'Content-Type': mimeType,
      Accept: 'application/json'
    },
    body: new Uint8Array(image.bytes)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new FireflyClientError(`Firefly storage HTTP ${response.status}: ${detail.slice(0, 400)}`);
  }

  const json = (await response.json()) as { images?: Array<{ id?: string }>; id?: string };
  const uploadId = json.images?.[0]?.id ?? json.id;
  if (!uploadId) {
    throw new FireflyClientError('Firefly storage response missing upload id');
  }
  return { uploadId };
}

async function pollJobStatus(options: {
  statusUrl: string;
  accessToken: string;
  clientId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  intervalMs: number;
  sleep: (ms: number) => Promise<void>;
  telemetry: FireflyJobTelemetry;
}): Promise<Record<string, unknown>> {
  const { statusUrl, accessToken, clientId, fetchImpl, timeoutMs, intervalMs, sleep, telemetry } =
    options;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    telemetry.pollCount += 1;
    let response: Response;
    try {
      response = await fetchImpl(statusUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'x-api-key': clientId,
          Accept: 'application/json'
        }
      });
    } catch (error) {
      throw new FireflyClientError(
        `Firefly generation status check failed: ${error instanceof Error ? error.message : String(error)}`,
        'status_check_failed'
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new FireflyClientError(
        `Firefly generation status check failed: HTTP ${response.status} ${detail.slice(0, 300)}`,
        'status_check_failed'
      );
    }

    const json = (await response.json()) as Record<string, unknown>;
    const status = normalizeFireflyJobStatus(json.status ?? json.jobStatus);
    if (status) {
      const last = telemetry.statusTransitions[telemetry.statusTransitions.length - 1];
      if (last !== status) telemetry.statusTransitions.push(status);
    }
    telemetry.finalJobStatus = status || telemetry.finalJobStatus;

    if (SUCCESS_STATES.has(status)) {
      return json;
    }
    if (FAILURE_STATES.has(status)) {
      throw new FireflyClientError(
        `Firefly generation job failed: ${sanitizeProviderSnippet(json)}`,
        'job_failed'
      );
    }
    if (status && !PENDING_STATES.has(status)) {
      // Unknown non-terminal/non-success status: keep polling until timeout unless outputs appear.
      if (extractFirstImageUrl(json)) {
        return json;
      }
    } else if (!status && extractFirstImageUrl(json)) {
      // Some variants may omit status once outputs are present.
      return json;
    }

    await sleep(intervalMs);
  }

  throw new FireflyClientError('Firefly generation timed out', 'timeout');
}

async function downloadImage(
  url: string,
  fetchImpl: typeof fetch
): Promise<{ bytes: Buffer; contentType: string | null }> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new FireflyClientError(`Failed to download Firefly image HTTP ${response.status}`);
  }
  const ab = await response.arrayBuffer();
  return {
    bytes: Buffer.from(ab),
    contentType: response.headers.get('content-type')
  };
}

function authHeaders(accessToken: string, clientId: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'x-api-key': clientId,
    Accept: 'application/json'
  };
}

export function createFireflyClient(options: FireflyClientOptions = {}): FireflyClient {
  const live = options.live === true || process.env.FIREFLY_LIVE === '1';
  const creds = resolveCredentials(options);
  const connectTimeoutMs = options.connectTimeoutMs ?? resolveFireflyConnectTimeoutMs();
  const fetchImpl = options.fetchImpl ?? createConnectTolerantFetch(connectTimeoutMs);
  const generatedDir = options.generatedDir ?? getDefaultGeneratedDir();
  const tokenCache: { current: TokenCache | null } = { current: null };
  const pollIntervalMs = options.pollIntervalMs ?? FIREFLY_POLL_INTERVAL_MS;
  const jobTimeoutMs =
    options.jobTimeoutMs ??
    Number(process.env.FIREFLY_JOB_TIMEOUT_MS ?? process.env.FIREFLY_TIMEOUT_MS ?? FIREFLY_JOB_TIMEOUT_MS);
  const sleep = options.sleep ?? defaultSleep;

  return {
    async generateImage(request: FireflyGenerateRequest): Promise<FireflyGenerateResult> {
      if (!live) {
        throw new FireflyClientError(
          'Live Firefly calls are disabled. Inject a mock FireflyClient or set FIREFLY_LIVE=1 with Adobe credentials.'
        );
      }
      if (!creds.clientId || !creds.clientSecret) {
        throw new FireflyClientError(
          'Firefly credentials missing. Set ADOBE_FIREFLY_CLIENT_ID and ADOBE_FIREFLY_CLIENT_SECRET.'
        );
      }
      if (typeof fetchImpl !== 'function') {
        throw new FireflyClientError('No fetch implementation available for Firefly.');
      }
      if (!request.prompt?.trim()) {
        throw new FireflyClientError('Firefly prompt is required');
      }

      const started = Date.now();
      const accessToken = await fetchAccessToken(creds.clientId, creds.clientSecret, fetchImpl, tokenCache);

      const payload: Record<string, unknown> = {
        prompt: request.prompt,
        numVariations: request.numVariations ?? 1
      };
      if (request.contentClass) payload.contentClass = request.contentClass;
      if (request.size) payload.size = request.size;

      if (
        request.referenceImage &&
        (request.referenceImage.bytes || request.referenceImage.uploadId || request.referenceImage.url)
      ) {
        const uploaded = await uploadReferenceImage(
          accessToken,
          creds.clientId,
          request.referenceImage,
          fetchImpl
        );
        const source = uploaded.uploadId ? { uploadId: uploaded.uploadId } : { url: uploaded.url };
        payload.style = {
          imageReference: { source },
          ...(typeof request.styleStrength === 'number' ? { strength: request.styleStrength } : {})
        };
      }

      let generateResponse: Response;
      try {
        generateResponse = await fetchImpl(`${FIREFLY_BASE}/v3/images/generate-async`, {
          method: 'POST',
          headers: {
            ...authHeaders(accessToken, creds.clientId),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
      } catch (error) {
        throw new FireflyClientError(
          `Firefly generation request failed before any HTTP response ` +
            `(${describeTransportError(error)}). Connect budget ${connectTimeoutMs} ms.`,
          'generate_request_failed'
        );
      }

      const telemetry: FireflyJobTelemetry = {
        initialResponseStatus: generateResponse.status,
        statusUrlUsed: false,
        pollCount: 0,
        statusTransitions: [],
        generatedImageAvailable: false
      };

      if (!generateResponse.ok) {
        const detail = await generateResponse.text().catch(() => '');
        throw new FireflyClientError(
          `Firefly generation request failed: HTTP ${generateResponse.status} ${detail.slice(0, 300)}`,
          'generate_request_failed'
        );
      }

      const initialJson = (await generateResponse.json()) as Record<string, unknown>;
      const accepted = parseAsyncJobAccepted(initialJson);
      telemetry.fireflyJobId = accepted.jobId;

      // Absence of outputs on the initial async response is expected — poll statusUrl.
      let completedJson = initialJson;
      if (accepted.statusUrl) {
        telemetry.statusUrlUsed = true;
        completedJson = await pollJobStatus({
          statusUrl: accepted.statusUrl,
          accessToken,
          clientId: creds.clientId,
          fetchImpl,
          timeoutMs: jobTimeoutMs,
          intervalMs: pollIntervalMs,
          sleep,
          telemetry
        });
      } else if (accepted.jobId) {
        // Documented primary path uses statusUrl; construct only when Adobe omits it.
        const constructed = `${FIREFLY_BASE}/v3/status/${encodeURIComponent(accepted.jobId)}`;
        telemetry.statusUrlUsed = true;
        completedJson = await pollJobStatus({
          statusUrl: constructed,
          accessToken,
          clientId: creds.clientId,
          fetchImpl,
          timeoutMs: jobTimeoutMs,
          intervalMs: pollIntervalMs,
          sleep,
          telemetry
        });
      } else if (!extractFirstImageUrl(initialJson)) {
        throw new FireflyClientError(
          'Firefly generation request failed: async response missing statusUrl/jobId and outputs',
          'generate_request_failed'
        );
      }

      const finalStatus = normalizeFireflyJobStatus(
        completedJson.status ?? completedJson.jobStatus ?? telemetry.finalJobStatus
      );
      telemetry.finalJobStatus = finalStatus || telemetry.finalJobStatus;

      if (FAILURE_STATES.has(finalStatus)) {
        throw new FireflyClientError(
          `Firefly generation job failed: ${sanitizeProviderSnippet(completedJson)}`,
          'job_failed'
        );
      }

      const remoteUrl = extractFirstImageUrl(completedJson);
      if (!remoteUrl) {
        if (SUCCESS_STATES.has(finalStatus) || !finalStatus) {
          throw new FireflyClientError(
            'Firefly job succeeded but returned no usable image output',
            'succeeded_without_image'
          );
        }
        throw new FireflyClientError(
          'Firefly job succeeded but returned no usable image output',
          'succeeded_without_image'
        );
      }

      const downloaded = await downloadImage(remoteUrl, fetchImpl);
      const id = `ff-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const persisted = persistGeneratedImageBytes({
        bytes: downloaded.bytes,
        contentTypeHint: downloaded.contentType,
        generatedDir,
        id
      });
      if (options.registerGenerated) {
        options.registerGenerated(persisted.id, persisted.absolutePath, persisted.mimeType);
      } else {
        registerGeneratedImage(persisted.id, persisted.absolutePath, persisted.mimeType);
      }

      const output = extractFireflyOutputs(completedJson)[0];
      const images: FireflyGeneratedImage[] = [
        {
          id: persisted.id,
          imageUrl: persisted.publicUrl,
          remoteUrl,
          seed: output?.seed,
          contentClass: request.contentClass
        }
      ];

      telemetry.generatedImageAvailable = true;

      return {
        images,
        jobId: accepted.jobId ?? (typeof completedJson.jobId === 'string' ? completedJson.jobId : undefined),
        latencyMs: Date.now() - started,
        jobTelemetry: telemetry
      };
    }
  };
}
