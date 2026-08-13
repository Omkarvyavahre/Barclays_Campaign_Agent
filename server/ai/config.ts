/**
 * Server-only AI configuration.
 *
 * This module reads process.env and must never be imported from anything that
 * can reach the browser bundle. `toPublicAiConfig` is the only value in this
 * file that is safe to serialise to a client.
 */

import { AiServiceError } from './errors.ts';

export type AiMode = 'mock' | 'gemini';
export type AiBackend = 'internal_gateway';
export type GatewayProtocol = 'openai';

export const DEFAULT_TIMEOUT_MS = 30_000;

export interface AiConfig {
  mode: AiMode;
  backend: AiBackend;
  protocol: GatewayProtocol;
  /** Secret. Server-side only. */
  gatewayBaseUrl: string;
  /** Secret. Server-side only. */
  gatewayApiKey: string;
  model: string;
  timeoutMs: number;
}

/** The only shape permitted to cross the network boundary to the browser. */
export interface PublicAiConfig {
  mode: AiMode;
  backend: AiBackend;
  protocol: GatewayProtocol;
  gatewayConfigured: boolean;
  modelConfigured: boolean;
}

type Env = Record<string, string | undefined>;

function readMode(value: string | undefined): AiMode {
  const mode = (value ?? 'mock').trim().toLowerCase();
  if (mode === 'mock' || mode === 'gemini') return mode;
  throw new AiServiceError('configuration_error', `Unsupported AI_MODE: ${mode}`);
}

function readBackend(value: string | undefined): AiBackend {
  const backend = (value ?? 'internal_gateway').trim().toLowerCase();
  if (backend === 'internal_gateway') return backend;
  throw new AiServiceError('configuration_error', `Unsupported AI_BACKEND: ${backend}`);
}

function readProtocol(value: string | undefined): GatewayProtocol {
  const protocol = (value ?? 'openai').trim().toLowerCase();
  if (protocol === 'openai') return protocol;
  throw new AiServiceError('configuration_error', `Unsupported AI_GATEWAY_PROTOCOL: ${protocol}`);
}

function readTimeout(value: string | undefined): number {
  if (!value || !value.trim()) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new AiServiceError('configuration_error', 'AI_GATEWAY_TIMEOUT_MS must be a positive number');
  }
  return Math.floor(parsed);
}

export function loadAiConfig(env: Env = process.env): AiConfig {
  return {
    mode: readMode(env.AI_MODE),
    backend: readBackend(env.AI_BACKEND),
    protocol: readProtocol(env.AI_GATEWAY_PROTOCOL),
    gatewayBaseUrl: (env.AI_GATEWAY_BASE_URL ?? '').trim().replace(/\/+$/, ''),
    gatewayApiKey: (env.AI_GATEWAY_API_KEY ?? '').trim(),
    model: (env.GEMINI_MODEL ?? '').trim(),
    timeoutMs: readTimeout(env.AI_GATEWAY_TIMEOUT_MS),
  };
}

export function toPublicAiConfig(config: AiConfig): PublicAiConfig {
  return {
    mode: config.mode,
    backend: config.backend,
    protocol: config.protocol,
    gatewayConfigured: config.gatewayBaseUrl.length > 0 && config.gatewayApiKey.length > 0,
    modelConfigured: config.model.length > 0,
  };
}

/** Throws unless the configuration is complete enough to make a live call. */
export function assertLiveConfig(config: AiConfig): void {
  if (config.mode !== 'gemini') {
    throw new AiServiceError('configuration_error', 'assertLiveConfig called outside gemini mode');
  }
  if (!config.gatewayBaseUrl) throw new AiServiceError('configuration_error', 'AI_GATEWAY_BASE_URL is not set');
  if (!config.gatewayApiKey) throw new AiServiceError('configuration_error', 'AI_GATEWAY_API_KEY is not set');
  if (!config.model) throw new AiServiceError('configuration_error', 'GEMINI_MODEL is not set');
}
