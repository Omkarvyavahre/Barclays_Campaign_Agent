/**
 * Canonical internal Gemini gateway configuration.
 *
 * Matches the Barclays Campaign Agent reference contract:
 *   AI_MODE, AI_BACKEND, AI_GATEWAY_BASE_URL, AI_GATEWAY_API_KEY,
 *   AI_GATEWAY_PROTOCOL, GEMINI_MODEL, AI_GATEWAY_TIMEOUT_MS
 *
 * SERVER ONLY. Never read these from client code.
 */

export type AiMode = 'mock' | 'gemini';

export type GatewayStructuredOutput = 'json_schema' | 'json_object' | 'none';

export type GatewayConfig = {
  baseUrl: string;
  apiKey: string;
  chatPath: string;
  authHeader: string;
  authScheme: string;
  protocol: 'openai';
  structuredOutput: GatewayStructuredOutput;
  model: string;
  timeoutMs: number;
  /** Full completions URL with secrets removed — for diagnostics only. */
  completionsUrl: string;
  host: string;
};

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

function envOr(name: string, fallback: string): string {
  const value = env(name);
  return value === '' ? fallback : value;
}

/**
 * Live Gemini is opt-in. Preferred: AI_MODE=gemini.
 * Backward compatible: GEMINI_LIVE=1 still enables live calls.
 */
export function isGeminiLive(): boolean {
  if (process.env.GEMINI_LIVE === '1') return true;
  return envOr('AI_MODE', 'mock').toLowerCase() === 'gemini';
}

export function aiBackend(): string {
  return envOr('AI_BACKEND', 'internal_gateway').toLowerCase();
}

/**
 * Reference contract: AI_GATEWAY_BASE_URL already includes the API base
 * (typically `https://<host>/v1`). Transport appends `/chat/completions`.
 *
 * Host-only values are normalized by appending `/v1` once so older .env
 * files keep working without producing `/v1/v1/...`.
 */
export function normalizeGatewayBaseUrl(raw: string): string {
  const trimmed = raw.replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (!url.pathname || url.pathname === '/') {
      return `${trimmed}/v1`;
    }
    return trimmed.replace(/\/+$/, '');
  } catch {
    return trimmed;
  }
}

export function buildGatewayCompletionsUrl(baseUrl: string, chatPath = '/chat/completions'): string {
  const base = normalizeGatewayBaseUrl(baseUrl);
  const path = chatPath.startsWith('/') ? chatPath : `/${chatPath}`;
  return `${base}${path}`;
}

export class GatewayConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayConfigError';
  }
}

/**
 * Reads and validates the gateway configuration.
 * Throws GatewayConfigError with variable names only — never secret values.
 */
export function readGatewayConfig(overrides: {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
} = {}): GatewayConfig {
  const backend = aiBackend();
  if (backend !== 'internal_gateway') {
    throw new GatewayConfigError(
      `AI_BACKEND="${backend}" is not supported; expected internal_gateway`
    );
  }

  const protocol = envOr('AI_GATEWAY_PROTOCOL', 'openai').toLowerCase();
  if (protocol !== 'openai') {
    throw new GatewayConfigError('AI_GATEWAY_PROTOCOL must be "openai"');
  }

  const rawBase = overrides.baseUrl ?? env('AI_GATEWAY_BASE_URL');
  const apiKey = overrides.apiKey ?? env('AI_GATEWAY_API_KEY');
  const model = overrides.model ?? env('GEMINI_MODEL');
  const chatPath = envOr('AI_GATEWAY_CHAT_PATH', '/chat/completions');

  const missing: string[] = [];
  if (!rawBase) missing.push('AI_GATEWAY_BASE_URL');
  else if (!rawBase.startsWith('https://')) missing.push('AI_GATEWAY_BASE_URL (must be https)');
  if (!apiKey) missing.push('AI_GATEWAY_API_KEY');
  if (!model) missing.push('GEMINI_MODEL');
  if (missing.length) {
    throw new GatewayConfigError(`missing or invalid: ${missing.join(', ')}`);
  }

  const baseUrl = normalizeGatewayBaseUrl(rawBase);
  const completionsUrl = buildGatewayCompletionsUrl(baseUrl, chatPath);
  let host = 'unknown';
  try {
    host = new URL(completionsUrl).host;
  } catch {
    /* ignore */
  }

  const structured = envOr('AI_GATEWAY_STRUCTURED_OUTPUT', 'json_object');
  const timeoutRaw = Number.parseInt(env('AI_GATEWAY_TIMEOUT_MS') || env('AI_REQUEST_TIMEOUT_MS'), 10);
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 30_000;

  return {
    baseUrl,
    apiKey,
    chatPath: chatPath.startsWith('/') ? chatPath : `/${chatPath}`,
    authHeader: envOr('AI_GATEWAY_AUTH_HEADER', 'Authorization'),
    authScheme:
      process.env.AI_GATEWAY_AUTH_SCHEME === undefined
        ? 'Bearer'
        : process.env.AI_GATEWAY_AUTH_SCHEME.trim(),
    protocol: 'openai',
    structuredOutput:
      structured === 'json_schema' || structured === 'none' ? structured : 'json_object',
    model,
    timeoutMs,
    completionsUrl,
    host
  };
}

/** Booleans / host only — safe for health endpoints and logs. */
export function describeGatewayConfig(): {
  configured: boolean;
  mode: string;
  backend: string;
  protocol: string | null;
  model: string | null;
  host: string | null;
  completionsPath: string | null;
} {
  const mode = envOr('AI_MODE', 'mock').toLowerCase();
  try {
    const config = readGatewayConfig();
    let path: string | null = null;
    try {
      path = new URL(config.completionsUrl).pathname;
    } catch {
      path = null;
    }
    return {
      configured: true,
      mode,
      backend: aiBackend(),
      protocol: config.protocol,
      model: config.model,
      host: config.host,
      completionsPath: path
    };
  } catch {
    return {
      configured: false,
      mode,
      backend: aiBackend(),
      protocol: env('AI_GATEWAY_PROTOCOL') || null,
      model: env('GEMINI_MODEL') || null,
      host: null,
      completionsPath: null
    };
  }
}
