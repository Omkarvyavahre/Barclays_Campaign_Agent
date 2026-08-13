/**
 * Transport for the internal gateway.
 *
 * The gateway speaks the OpenAI-compatible chat-completions protocol, so this
 * module owns the wire format and nothing else: no prompts, no domain rules,
 * no V19 knowledge. Everything it returns is normalised into `NormalizedAiResult`
 * so that agent code never sees a provider-shaped payload.
 */

import type { AiConfig } from './config.ts';
import { assertLiveConfig } from './config.ts';
import { AiServiceError, classifyHttpStatus, classifyTransportError } from './errors.ts';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface StructuredRequest {
  messages: ChatMessage[];
  schemaName: string;
  schema: unknown;
  temperature?: number;
}

export interface AiUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Present only when the gateway reports reasoning tokens. */
  reasoningTokens?: number;
}

/** The single internal representation every agent consumes. */
export interface NormalizedAiResult {
  model: string;
  content: string;
  data: unknown;
  usage: AiUsage;
  finishReason: string;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface GatewayDeps {
  fetch?: FetchLike;
}

function readNumber(source: Record<string, unknown> | undefined, ...keys: string[]): number | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

/**
 * Maps a provider payload onto `NormalizedAiResult`.
 *
 * Exported so the normalisation rules can be tested without a transport.
 */
export function normalizeChatCompletion(payload: unknown, fallbackModel: string): NormalizedAiResult {
  if (typeof payload !== 'object' || payload === null) {
    throw new AiServiceError('invalid_response', 'gateway payload was not an object');
  }
  const body = payload as Record<string, unknown>;
  const choices = body.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new AiServiceError('invalid_response', 'gateway payload contained no choices');
  }

  const choice = choices[0] as Record<string, unknown>;
  const message = choice.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new AiServiceError('invalid_response', 'gateway choice contained no textual content');
  }

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    throw new AiServiceError('invalid_response', 'gateway content was not valid JSON');
  }

  const usageSource = body.usage as Record<string, unknown> | undefined;
  const details = usageSource?.completion_tokens_details as Record<string, unknown> | undefined;
  const reasoningTokens = readNumber(details, 'reasoning_tokens') ?? readNumber(usageSource, 'reasoning_tokens');

  const usage: AiUsage = {
    promptTokens: readNumber(usageSource, 'prompt_tokens', 'input_tokens') ?? 0,
    completionTokens: readNumber(usageSource, 'completion_tokens', 'output_tokens') ?? 0,
    totalTokens: readNumber(usageSource, 'total_tokens') ?? 0,
  };
  if (reasoningTokens !== undefined) usage.reasoningTokens = reasoningTokens;

  return {
    model: typeof body.model === 'string' && body.model ? body.model : fallbackModel,
    content,
    data,
    usage,
    finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : 'unknown',
  };
}

export async function requestStructuredCompletion(
  config: AiConfig,
  request: StructuredRequest,
  deps: GatewayDeps = {},
): Promise<NormalizedAiResult> {
  assertLiveConfig(config);

  const doFetch = deps.fetch ?? (globalThis.fetch as FetchLike | undefined);
  if (!doFetch) throw new AiServiceError('configuration_error', 'no fetch implementation available');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  let response: Response;
  try {
    response = await doFetch(`${config.gatewayBaseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.gatewayApiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: request.temperature ?? 0.2,
        messages: request.messages,
        response_format: {
          type: 'json_schema',
          json_schema: { name: request.schemaName, strict: true, schema: request.schema },
        },
      }),
    });
  } catch (error) {
    throw new AiServiceError(classifyTransportError(error), error instanceof Error ? error.message : 'transport failure');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // The upstream body may echo headers or internal hostnames, so it is kept
    // for server logs only and never surfaced.
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 500);
    } catch {
      detail = '<unreadable body>';
    }
    throw new AiServiceError(classifyHttpStatus(response.status), `gateway responded ${response.status}: ${detail}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AiServiceError('invalid_response', 'gateway response was not valid JSON');
  }

  return normalizeChatCompletion(payload, config.model);
}
