/**
 * Shared Gemini JSON client — thin adapter over the canonical internal gateway.
 *
 * Transport contract matches the reference Campaign Agent gateway:
 *   POST ${AI_GATEWAY_BASE_URL}/chat/completions
 *   Authorization: Bearer <AI_GATEWAY_API_KEY>
 *   OpenAI-compatible chat completions body
 *
 * Creative Interpreter (and future agents) call generateJson() only.
 * Direct Google Generative Language API remains a last-resort fallback when
 * GEMINI_API_KEY is set and no gateway is configured.
 */

import {
  GatewayConfigError,
  GatewayError,
  gatewayErrorFromHttp,
  gatewayErrorFromTransport,
  isGeminiLive,
  readGatewayConfig
} from '../gateway';
import type { GeminiClientOptions, GeminiJsonClient, GeminiJsonRequest, GeminiJsonResponse } from './types';

const DEFAULT_GOOGLE_MODEL = 'gemini-2.0-flash';
const DEFAULT_GOOGLE_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiClientError extends Error {
  readonly category?: string;

  constructor(message: string, category?: string) {
    super(message);
    this.name = 'GeminiClientError';
    this.category = category;
  }
}

function toGeminiError(error: unknown): GeminiClientError {
  if (error instanceof GeminiClientError) return error;
  if (error instanceof GatewayError) {
    return new GeminiClientError(error.message, error.category);
  }
  if (error instanceof GatewayConfigError) {
    return new GeminiClientError(error.message, 'configuration_error');
  }
  return new GeminiClientError(error instanceof Error ? error.message : String(error));
}

function extractGatewayText(raw: Record<string, unknown>): string {
  const choices = raw.choices as Array<{ message?: { content?: string | Array<{ text?: string }> } }> | undefined;
  const content = choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => p.text ?? '').join('');
  return '';
}

function extractGoogleText(raw: Record<string, unknown>): string {
  const candidates = raw.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
  return candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
}

function extractUsage(raw: Record<string, unknown>): GeminiJsonResponse['usage'] {
  const usage = raw.usage as
    | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    | undefined;
  const meta = raw.usageMetadata as
    | { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
    | undefined;
  if (usage) {
    return {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens
    };
  }
  if (meta) {
    return {
      promptTokens: meta.promptTokenCount,
      completionTokens: meta.candidatesTokenCount,
      totalTokens: meta.totalTokenCount
    };
  }
  return undefined;
}

function responseFormat(
  structuredOutput: 'json_schema' | 'json_object' | 'none',
  request: GeminiJsonRequest
): Record<string, unknown> {
  if (structuredOutput === 'none') return {};
  if (
    structuredOutput === 'json_schema' &&
    request.jsonSchema &&
    request.schemaName
  ) {
    return {
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: request.schemaName,
          strict: true,
          schema: request.jsonSchema
        }
      }
    };
  }
  return { response_format: { type: 'json_object' } };
}

export function createGeminiClient(options: GeminiClientOptions = {}): GeminiJsonClient {
  const live = options.live === true || isGeminiLive();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  return {
    async generateJson(request: GeminiJsonRequest): Promise<GeminiJsonResponse> {
      if (!live) {
        throw new GeminiClientError(
          'Live Gemini calls are disabled. Inject a mock GeminiJsonClient, set AI_MODE=gemini, or set GEMINI_LIVE=1 with gateway credentials.',
          'configuration_error'
        );
      }
      if (typeof fetchImpl !== 'function') {
        throw new GeminiClientError('No fetch implementation available for Gemini.', 'configuration_error');
      }

      const gatewayConfigured = Boolean(
        (options.baseUrl ?? process.env.AI_GATEWAY_BASE_URL) &&
          (options.apiKey ?? process.env.AI_GATEWAY_API_KEY)
      );

      if (gatewayConfigured) {
        return generateViaGateway(request, options, fetchImpl);
      }

      const googleKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? '';
      if (googleKey) {
        return generateViaGoogle(request, options, fetchImpl, googleKey);
      }

      throw new GeminiClientError(
        'Gemini credentials missing. Set AI_GATEWAY_BASE_URL + AI_GATEWAY_API_KEY (preferred) or GEMINI_API_KEY.',
        'configuration_error'
      );
    }
  };
}

async function generateViaGateway(
  request: GeminiJsonRequest,
  options: GeminiClientOptions,
  fetchImpl: typeof fetch
): Promise<GeminiJsonResponse> {
  let config;
  try {
    config = readGatewayConfig({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      model: options.model
    });
  } catch (error) {
    throw toGeminiError(error);
  }

  const url = config.completionsUrl;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const started = Date.now();
  let response: Response;

  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [config.authHeader]: config.authScheme
          ? `${config.authScheme} ${config.apiKey}`
          : config.apiKey
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user }
        ],
        ...responseFormat(config.structuredOutput, request)
      }),
      signal: controller.signal
    });
  } catch (error) {
    throw toGeminiError(gatewayErrorFromTransport(error, config.timeoutMs, config.host));
  } finally {
    clearTimeout(timer);
  }

  const latencyMs = Date.now() - started;
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw toGeminiError(gatewayErrorFromHttp(response.status, detail.length));
  }

  const raw = (await response.json()) as Record<string, unknown>;
  const text = extractGatewayText(raw);
  if (!text.trim()) {
    throw new GeminiClientError('Gemini returned an empty response.', 'invalid_response');
  }

  return {
    text,
    raw,
    model: config.model,
    latencyMs,
    usage: extractUsage(raw)
  };
}

async function generateViaGoogle(
  request: GeminiJsonRequest,
  options: GeminiClientOptions,
  fetchImpl: typeof fetch,
  apiKey: string
): Promise<GeminiJsonResponse> {
  const model = options.model ?? process.env.GEMINI_MODEL ?? DEFAULT_GOOGLE_MODEL;
  const baseUrl = (options.baseUrl ?? DEFAULT_GOOGLE_BASE).replace(/\/$/, '');
  const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const started = Date.now();
  let response: Response;

  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: 'user', parts: [{ text: request.user }] }],
        generationConfig: {
          responseMimeType: request.responseMimeType ?? 'application/json',
          temperature: 0.2
        }
      })
    });
  } catch (error) {
    throw toGeminiError(gatewayErrorFromTransport(error, 30_000, 'generativelanguage.googleapis.com'));
  }

  const latencyMs = Date.now() - started;
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new GeminiClientError(`Gemini HTTP ${response.status}: ${detail.slice(0, 400)}`, 'upstream_error');
  }

  const raw = (await response.json()) as Record<string, unknown>;
  const text = extractGoogleText(raw);
  if (!text.trim()) {
    throw new GeminiClientError('Gemini returned an empty response.', 'invalid_response');
  }

  return {
    text,
    raw,
    model,
    latencyMs,
    usage: extractUsage(raw)
  };
}
