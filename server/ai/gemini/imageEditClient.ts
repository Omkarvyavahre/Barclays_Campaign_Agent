/**
 * Gemini image-edit client (Modify asset only).
 *
 * Primary protocol (PwC / LiteLLM OpenAI-compatible gateway):
 *   POST ${GEMINI_IMAGE_BASE_URL|/v1}/images/edits
 *   Authorization: Bearer <GEMINI_IMAGE_API_KEY>
 *   multipart: model, prompt, image [, response_format, n]
 *
 * Alternate (Google Generative Language API):
 *   POST .../models/{model}:generateContent?key=...
 *
 * Never logs the API key, Authorization headers, or image bytes.
 */

import {
  describeGeminiImageConfig,
  isGeminiImageLive,
  readGeminiImageConfig,
  type GeminiImageConfig
} from './imageConfig';
import { buildGeminiImageEditPrompt } from './imageEditPrompt';
import type { GeminiImageEditRequest, GeminiImageEditResponse } from './types';

export type GeminiImageEditErrorDetails = {
  category?: string;
  httpStatus?: number;
  providerCode?: string;
  protocol?: string;
  model?: string;
  endpointPath?: string;
  endpointHost?: string;
  sourceMimeType?: string;
  sourceByteLength?: number;
  timeoutMs?: number;
  aborted?: boolean;
  elapsedMs?: number;
};

export class GeminiImageEditError extends Error {
  readonly category?: string;
  readonly httpStatus?: number;
  readonly providerCode?: string;
  readonly protocol?: string;
  readonly model?: string;
  readonly endpointPath?: string;
  readonly endpointHost?: string;
  readonly sourceMimeType?: string;
  readonly sourceByteLength?: number;
  readonly timeoutMs?: number;
  readonly aborted?: boolean;
  readonly elapsedMs?: number;

  constructor(message: string, options: GeminiImageEditErrorDetails = {}) {
    super(message);
    this.name = 'GeminiImageEditError';
    this.category = options.category;
    this.httpStatus = options.httpStatus;
    this.providerCode = options.providerCode;
    this.protocol = options.protocol;
    this.model = options.model;
    this.endpointPath = options.endpointPath;
    this.endpointHost = options.endpointHost;
    this.sourceMimeType = options.sourceMimeType;
    this.sourceByteLength = options.sourceByteLength;
    this.timeoutMs = options.timeoutMs;
    this.aborted = options.aborted;
    this.elapsedMs = options.elapsedMs;
  }
}

export type GeminiImageEditClient = {
  editImage(request: GeminiImageEditRequest): Promise<GeminiImageEditResponse>;
};

export type GeminiImageEditClientOptions = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  live?: boolean;
  fetchImpl?: typeof fetch;
};

function extensionForMime(mimeType: string): string {
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  return 'png';
}

function endpointMeta(config: GeminiImageConfig): { host: string; path: string } {
  try {
    const url = new URL(config.editsUrl);
    return { host: url.host, path: url.pathname };
  } catch {
    return { host: config.host, path: '/images/edits' };
  }
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: string }).name;
  const message = error instanceof Error ? error.message : String(error);
  return (
    name === 'AbortError' ||
    /operation was aborted|aborted|timeout|The user aborted a request/i.test(message)
  );
}

/** Strip credential-shaped substrings from provider bodies before logging. */
export function sanitizeProviderDetail(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]')
    .replace(/("?(access_token|client_secret|api[_-]?key|authorization)"?\s*[:=]\s*)("?[^",\s]+"?)/gi, '$1[REDACTED]')
    .replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, 'data:image/[REDACTED]')
    .replace(/[A-Za-z0-9+/]{120,}={0,2}/g, '[BASE64_REDACTED]')
    .slice(0, 500);
}

function extractProviderError(rawText: string): { code?: string; message?: string } {
  try {
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    const err = (parsed.error ?? parsed) as Record<string, unknown>;
    const code =
      (typeof err.code === 'string' && err.code) ||
      (typeof err.type === 'string' && err.type) ||
      (typeof parsed.code === 'string' && parsed.code) ||
      undefined;
    const message =
      (typeof err.message === 'string' && err.message) ||
      (typeof parsed.message === 'string' && parsed.message) ||
      undefined;
    return { code, message: message ? sanitizeProviderDetail(message) : undefined };
  } catch {
    const trimmed = sanitizeProviderDetail(rawText.trim());
    return trimmed ? { message: trimmed } : {};
  }
}

function extractOpenAiImageB64(raw: Record<string, unknown>): { b64: string; mimeType?: string } | null {
  const data = raw.data as Array<{ b64_json?: string; url?: string; mime_type?: string }> | undefined;
  const first = data?.[0];
  if (first?.b64_json && typeof first.b64_json === 'string') {
    return { b64: first.b64_json, mimeType: first.mime_type };
  }
  return null;
}

function extractOpenAiImageUrl(raw: Record<string, unknown>): string | null {
  const data = raw.data as Array<{ url?: string }> | undefined;
  const url = data?.[0]?.url;
  return typeof url === 'string' && url.trim() ? url.trim() : null;
}

function extractGoogleInlineImage(raw: Record<string, unknown>): { b64: string; mimeType: string } | null {
  const candidates = raw.candidates as
    | Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }>
    | undefined;
  const parts = candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inline = part.inlineData;
    if (inline?.data) {
      return {
        b64: inline.data,
        mimeType: inline.mimeType || 'image/png'
      };
    }
  }
  return null;
}

async function decodeEditedImage(
  fetchImpl: typeof fetch,
  raw: Record<string, unknown>,
  protocol: GeminiImageConfig['protocol']
): Promise<{ bytes: Buffer; mimeType: string }> {
  if (protocol === 'google_generate_content') {
    const inline = extractGoogleInlineImage(raw);
    if (!inline) {
      throw new GeminiImageEditError('Gemini image edit returned no image bytes', {
        category: 'invalid_response'
      });
    }
    return {
      bytes: Buffer.from(inline.b64, 'base64'),
      mimeType: inline.mimeType
    };
  }

  const b64 = extractOpenAiImageB64(raw);
  if (b64) {
    return {
      bytes: Buffer.from(b64.b64, 'base64'),
      mimeType: b64.mimeType || 'image/png'
    };
  }

  const url = extractOpenAiImageUrl(raw);
  if (url) {
    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new GeminiImageEditError(`Gemini image download failed (HTTP ${response.status})`, {
        category: 'upstream_error',
        httpStatus: response.status
      });
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
    return { bytes, mimeType: contentType };
  }

  throw new GeminiImageEditError('Gemini image edit returned no image bytes', {
    category: 'invalid_response'
  });
}

function contextFields(
  request: GeminiImageEditRequest,
  config: GeminiImageConfig
): GeminiImageEditErrorDetails {
  const { host, path } = endpointMeta(config);
  return {
    protocol: config.protocol,
    model: config.model,
    endpointHost: host,
    endpointPath: path,
    sourceMimeType: request.image.mimeType,
    sourceByteLength: request.image.bytes.length,
    timeoutMs: config.timeoutMs
  };
}

/** Dev-only sanitized telemetry. Never includes credentials or image payloads. */
function logImageEditDev(
  event: string,
  ctx: GeminiImageEditErrorDetails,
  extra: Record<string, unknown> = {}
): void {
  if (process.env.NODE_ENV === 'production') return;
  console.log(
    `[gemini-image-edit] ${event}`,
    JSON.stringify({
      model: ctx.model ?? null,
      protocol: ctx.protocol ?? null,
      endpointHost: ctx.endpointHost ?? null,
      endpointPath: ctx.endpointPath ?? null,
      sourceMimeType: ctx.sourceMimeType ?? null,
      sourceByteLength: ctx.sourceByteLength ?? null,
      timeoutMs: ctx.timeoutMs ?? null,
      ...extra
    })
  );
}

async function editViaOpenAiImagesEdits(
  request: GeminiImageEditRequest,
  config: GeminiImageConfig,
  fetchImpl: typeof fetch
): Promise<GeminiImageEditResponse> {
  const ctx = contextFields(request, config);
  const prompt = buildGeminiImageEditPrompt({
    userInstruction: request.instruction,
    guardrails: request.guardrails
  });
  const form = new FormData();
  form.append('model', config.model);
  form.append('prompt', prompt);
  // response_format is sent today; gateway may reject unknown fields — surface that via status/body.
  form.append('response_format', 'b64_json');
  form.append('n', '1');
  const filename = `edit-source.${extensionForMime(request.image.mimeType)}`;
  form.append(
    'image',
    new Blob([new Uint8Array(request.image.bytes)], { type: request.image.mimeType }),
    filename
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const started = Date.now();
  logImageEditDev('request', ctx, { promptLength: prompt.length });
  let response: Response;
  try {
    response = await fetchImpl(config.editsUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`
      },
      body: form,
      signal: controller.signal
    });
  } catch (error) {
    const aborted = isAbortError(error);
    const elapsedMs = Date.now() - started;
    logImageEditDev(aborted ? 'timed out' : 'transport failed', ctx, {
      providerHttpStatus: null,
      elapsedMs,
      aborted
    });
    throw new GeminiImageEditError(
      aborted
        ? `Gemini image edit timed out after ${config.timeoutMs}ms (no HTTP response)`
        : error instanceof Error
          ? sanitizeProviderDetail(error.message)
          : 'Gemini image edit transport failed',
      {
        ...ctx,
        category: aborted ? 'timeout' : 'transport_error',
        aborted,
        elapsedMs
      }
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const elapsedMs = Date.now() - started;
    const rawText = await response.text().catch(() => '');
    const provider = extractProviderError(rawText);
    logImageEditDev('provider rejected', ctx, {
      providerHttpStatus: response.status,
      providerCode: provider.code ?? null,
      providerMessage: provider.message ?? null,
      elapsedMs,
      aborted: false
    });
    throw new GeminiImageEditError(
      provider.message
        ? `Gemini image edit failed (HTTP ${response.status}): ${provider.message}`
        : `Gemini image edit failed (HTTP ${response.status})`,
      {
        ...ctx,
        category: 'upstream_error',
        httpStatus: response.status,
        providerCode: provider.code,
        elapsedMs
      }
    );
  }

  const contentType = response.headers?.get?.('content-type') || '';
  const raw = (await response.json()) as Record<string, unknown>;
  try {
    const decoded = await decodeEditedImage(fetchImpl, raw, config.protocol);
    logImageEditDev('succeeded', ctx, {
      providerHttpStatus: response.status,
      elapsedMs: Date.now() - started,
      aborted: false,
      outputMimeType: decoded.mimeType,
      outputByteLength: decoded.bytes.length
    });
    return {
      bytes: decoded.bytes,
      mimeType: decoded.mimeType,
      model: config.model,
      provider: 'gemini-image'
    };
  } catch (error) {
    const elapsedMs = Date.now() - started;
    logImageEditDev('unreadable response', ctx, {
      providerHttpStatus: response.status,
      responseContentType: contentType || null,
      elapsedMs,
      aborted: false
    });
    if (error instanceof GeminiImageEditError) {
      throw new GeminiImageEditError(error.message, {
        ...ctx,
        category: error.category || 'invalid_response',
        httpStatus: response.status,
        elapsedMs
      });
    }
    throw new GeminiImageEditError('Gemini image edit returned an unreadable response', {
      ...ctx,
      category: 'invalid_response',
      httpStatus: response.status,
      providerCode: contentType || undefined,
      elapsedMs
    });
  }
}

async function editViaGoogleGenerateContent(
  request: GeminiImageEditRequest,
  config: GeminiImageConfig,
  fetchImpl: typeof fetch
): Promise<GeminiImageEditResponse> {
  const ctx = contextFields(request, config);
  const prompt = buildGeminiImageEditPrompt({
    userInstruction: request.instruction,
    guardrails: request.guardrails
  });
  const url = `${config.editsUrl}?key=${encodeURIComponent(config.apiKey)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const started = Date.now();
  logImageEditDev('request', ctx, { promptLength: prompt.length });
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: request.image.mimeType,
                  data: request.image.bytes.toString('base64')
                }
              },
              { text: prompt }
            ]
          }
        ],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE']
        }
      }),
      signal: controller.signal
    });
  } catch (error) {
    const aborted = isAbortError(error);
    const elapsedMs = Date.now() - started;
    logImageEditDev(aborted ? 'timed out' : 'transport failed', ctx, {
      providerHttpStatus: null,
      elapsedMs,
      aborted
    });
    throw new GeminiImageEditError(
      aborted
        ? `Gemini image edit timed out after ${config.timeoutMs}ms (no HTTP response)`
        : error instanceof Error
          ? sanitizeProviderDetail(error.message)
          : 'Gemini image edit transport failed',
      {
        ...ctx,
        category: aborted ? 'timeout' : 'transport_error',
        aborted,
        elapsedMs
      }
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const elapsedMs = Date.now() - started;
    const rawText = await response.text().catch(() => '');
    const provider = extractProviderError(rawText);
    logImageEditDev('provider rejected', ctx, {
      providerHttpStatus: response.status,
      providerCode: provider.code ?? null,
      providerMessage: provider.message ?? null,
      elapsedMs,
      aborted: false
    });
    throw new GeminiImageEditError(
      provider.message
        ? `Gemini image edit failed (HTTP ${response.status}): ${provider.message}`
        : `Gemini image edit failed (HTTP ${response.status})`,
      {
        ...ctx,
        category: 'upstream_error',
        httpStatus: response.status,
        providerCode: provider.code,
        elapsedMs
      }
    );
  }

  const raw = (await response.json()) as Record<string, unknown>;
  const decoded = await decodeEditedImage(fetchImpl, raw, config.protocol);
  logImageEditDev('succeeded', ctx, {
    providerHttpStatus: response.status,
    elapsedMs: Date.now() - started,
    aborted: false,
    outputMimeType: decoded.mimeType,
    outputByteLength: decoded.bytes.length
  });
  return {
    bytes: decoded.bytes,
    mimeType: decoded.mimeType,
    model: config.model,
    provider: 'gemini-image'
  };
}

/**
 * Returns a live image-edit client when credentials + live flag are present.
 * Returns null when image editing is not available (caller shows unsupported).
 */
export function createGeminiImageEditClient(
  options: GeminiImageEditClientOptions = {}
): GeminiImageEditClient | null {
  const live = options.live === true || isGeminiImageLive();
  if (!live) return null;

  const summary = describeGeminiImageConfig();
  const hasKey = Boolean((options.apiKey ?? process.env.GEMINI_IMAGE_API_KEY ?? '').trim());
  const hasModel = Boolean((options.model ?? process.env.GEMINI_IMAGE_MODEL ?? '').trim());
  if (!hasKey || !hasModel) {
    void summary;
    return null;
  }

  let config: GeminiImageConfig;
  try {
    config = readGeminiImageConfig({
      apiKey: options.apiKey,
      model: options.model,
      baseUrl: options.baseUrl
    });
  } catch {
    return null;
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return null;

  return {
    async editImage(request: GeminiImageEditRequest): Promise<GeminiImageEditResponse> {
      if (!request.image?.bytes?.length) {
        throw new GeminiImageEditError('Current asset image bytes are required', {
          category: 'invalid_request'
        });
      }
      if (!request.instruction?.trim()) {
        throw new GeminiImageEditError('Modification instruction is required', {
          category: 'invalid_request'
        });
      }

      if (config.protocol === 'google_generate_content') {
        return editViaGoogleGenerateContent(request, config, fetchImpl);
      }
      return editViaOpenAiImagesEdits(request, config, fetchImpl);
    }
  };
}

/** Attach editImage onto an existing JSON client when image credentials are live. */
export function withGeminiImageEdit(
  client: import('./types').GeminiJsonClient,
  options: GeminiImageEditClientOptions = {}
): import('./types').GeminiJsonClient {
  const image = createGeminiImageEditClient(options);
  if (!image) return client;
  return {
    generateJson: client.generateJson.bind(client),
    editImage: (request) => image.editImage(request)
  };
}
