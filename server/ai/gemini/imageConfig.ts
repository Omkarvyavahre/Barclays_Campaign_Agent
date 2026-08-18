/**
 * Server-side Gemini image-edit configuration.
 *
 * Uses GEMINI_IMAGE_* credentials — never AI_GATEWAY_API_KEY / Firefly secrets.
 * Safe summaries never include the API key or Authorization headers.
 */

import { normalizeGatewayBaseUrl } from '../gateway/config';

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

export type GeminiImageProtocol = 'openai_images_edits' | 'google_generate_content';

export type GeminiImageConfig = {
  apiKey: string;
  model: string;
  baseUrl: string;
  protocol: GeminiImageProtocol;
  timeoutMs: number;
  editsUrl: string;
  host: string;
};

export type GeminiImageCapabilitySummary = {
  geminiImageConfigured: boolean;
  geminiImageModelConfigured: boolean;
  protocol: GeminiImageProtocol | null;
  host: string | null;
  modelConfigured: boolean;
};

/**
 * Live image edits are opt-in. Prefer GEMINI_IMAGE_LIVE=1, else reuse AI_MODE/GEMINI_LIVE.
 */
export function isGeminiImageLive(): boolean {
  if (process.env.GEMINI_IMAGE_LIVE === '1') return true;
  if (process.env.GEMINI_LIVE === '1') return true;
  return env('AI_MODE').toLowerCase() === 'gemini';
}

function resolveProtocol(baseUrl: string): GeminiImageProtocol {
  const explicit = env('GEMINI_IMAGE_PROTOCOL').toLowerCase();
  if (explicit === 'google' || explicit === 'google_generate_content') {
    return 'google_generate_content';
  }
  if (explicit === 'openai' || explicit === 'openai_images_edits') {
    return 'openai_images_edits';
  }
  if (/generativelanguage\.googleapis\.com/i.test(baseUrl)) {
    return 'google_generate_content';
  }
  // PwC / LiteLLM OpenAI-compatible gateways expose Gemini image edit via /images/edits.
  return 'openai_images_edits';
}

/**
 * Image editing needs far longer than text completions, so it never inherits
 * AI_GATEWAY_TIMEOUT_MS (30s in practice, which aborts edits mid-flight).
 */
export const DEFAULT_GEMINI_IMAGE_TIMEOUT_MS = 120_000;

export function readGeminiImageTimeoutMs(): number {
  const raw = Number.parseInt(env('GEMINI_IMAGE_TIMEOUT_MS'), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_GEMINI_IMAGE_TIMEOUT_MS;
}

function resolveBaseUrl(): string {
  const dedicated = env('GEMINI_IMAGE_BASE_URL');
  if (dedicated) return normalizeGatewayBaseUrl(dedicated);
  const gateway = env('AI_GATEWAY_BASE_URL');
  if (gateway) return normalizeGatewayBaseUrl(gateway);
  return 'https://generativelanguage.googleapis.com/v1beta';
}

/**
 * Reads image-edit config. Throws with variable names only — never secret values.
 */
export function readGeminiImageConfig(overrides: {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
} = {}): GeminiImageConfig {
  const apiKey = overrides.apiKey ?? env('GEMINI_IMAGE_API_KEY');
  const model = overrides.model ?? env('GEMINI_IMAGE_MODEL');
  const rawBase = overrides.baseUrl ?? resolveBaseUrl();
  const missing: string[] = [];
  if (!apiKey) missing.push('GEMINI_IMAGE_API_KEY');
  if (!model) missing.push('GEMINI_IMAGE_MODEL');
  if (!rawBase) missing.push('GEMINI_IMAGE_BASE_URL');
  if (missing.length) {
    throw new Error(`missing or invalid: ${missing.join(', ')}`);
  }

  const baseUrl = rawBase.replace(/\/+$/, '');
  const protocol = resolveProtocol(baseUrl);
  const timeoutMs = readGeminiImageTimeoutMs();

  let host = 'unknown';
  let editsUrl = `${baseUrl}/images/edits`;
  try {
    const url = new URL(baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`);
    host = url.host;
    if (protocol === 'google_generate_content') {
      editsUrl = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`;
    } else {
      // AI_GATEWAY_BASE_URL already includes /v1 — append /images/edits only.
      editsUrl = `${baseUrl}/images/edits`;
    }
  } catch {
    /* keep defaults */
  }

  return {
    apiKey,
    model,
    baseUrl,
    protocol,
    timeoutMs,
    editsUrl,
    host
  };
}

/** Booleans / host only — safe for health endpoints and logs. */
export function describeGeminiImageConfig(): GeminiImageCapabilitySummary {
  const apiKey = env('GEMINI_IMAGE_API_KEY');
  const model = env('GEMINI_IMAGE_MODEL');
  try {
    const config = readGeminiImageConfig();
    return {
      geminiImageConfigured: Boolean(config.apiKey),
      geminiImageModelConfigured: Boolean(config.model),
      protocol: config.protocol,
      host: config.host,
      modelConfigured: Boolean(config.model)
    };
  } catch {
    return {
      geminiImageConfigured: Boolean(apiKey),
      geminiImageModelConfigured: Boolean(model),
      protocol: null,
      host: null,
      modelConfigured: Boolean(model)
    };
  }
}

export function isGeminiImageEditConfigured(): boolean {
  const summary = describeGeminiImageConfig();
  return summary.geminiImageConfigured && summary.geminiImageModelConfigured;
}
