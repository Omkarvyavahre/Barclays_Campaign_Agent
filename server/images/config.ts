/**
 * Server-only image provider configuration.
 *
 * Reads process.env and must never be imported from anything reachable by the
 * browser bundle. `toPublicImageConfig` is the only value here that is safe to
 * serialise to a client: it reports whether things are configured, never what
 * they are.
 */

import { ImageServiceError } from './errors.ts';
import type { ImageProvider } from './types.ts';

/** Documented Firefly Services defaults. Non-secret, overridable per environment. */
export const DEFAULT_FIREFLY_API_BASE_URL = 'https://firefly-api.adobe.io';
export const DEFAULT_ADOBE_IMS_BASE_URL = 'https://ims-na1.adobelogin.com';
export const DEFAULT_FIREFLY_SCOPE = 'openid,AdobeID,session,additional_info,read_organizations,firefly_api,ff_apis';
export const DEFAULT_IMAGE_TIMEOUT_MS = 60_000;

export interface ImageConfig {
  provider: ImageProvider;
  /** Secret. Server-side only. Also sent as the Firefly `x-api-key`. */
  clientId: string;
  /** Secret. Server-side only. */
  clientSecret: string;
  apiBaseUrl: string;
  imsBaseUrl: string;
  scope: string;
  timeoutMs: number;
}

/** The only shape permitted to cross the network boundary to the browser. */
export interface PublicImageConfig {
  provider: ImageProvider;
  credentialsConfigured: boolean;
  referencesAvailable: boolean;
}

type Env = Record<string, string | undefined>;

function readProvider(value: string | undefined): ImageProvider {
  const provider = (value ?? 'mock').trim().toLowerCase();
  if (provider === 'mock' || provider === 'firefly') return provider;
  throw new ImageServiceError('configuration_error', `Unsupported IMAGE_GENERATION_PROVIDER: ${provider}`);
}

function readTimeout(value: string | undefined): number {
  if (!value || !value.trim()) return DEFAULT_IMAGE_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ImageServiceError('configuration_error', 'IMAGE_GENERATION_TIMEOUT_MS must be a positive number');
  }
  return Math.floor(parsed);
}

function readBaseUrl(value: string | undefined, fallback: string, name: string): string {
  const raw = (value ?? '').trim().replace(/\/+$/, '');
  if (!raw) return fallback;
  if (!/^https:\/\//i.test(raw)) {
    throw new ImageServiceError('configuration_error', `${name} must be an https URL`);
  }
  return raw;
}

export function loadImageConfig(env: Env = process.env): ImageConfig {
  return {
    provider: readProvider(env.IMAGE_GENERATION_PROVIDER),
    clientId: (env.ADOBE_FIREFLY_CLIENT_ID ?? '').trim(),
    clientSecret: (env.ADOBE_FIREFLY_CLIENT_SECRET ?? '').trim(),
    apiBaseUrl: readBaseUrl(env.ADOBE_FIREFLY_API_BASE_URL, DEFAULT_FIREFLY_API_BASE_URL, 'ADOBE_FIREFLY_API_BASE_URL'),
    imsBaseUrl: readBaseUrl(env.ADOBE_IMS_BASE_URL, DEFAULT_ADOBE_IMS_BASE_URL, 'ADOBE_IMS_BASE_URL'),
    scope: (env.ADOBE_FIREFLY_SCOPE ?? '').trim() || DEFAULT_FIREFLY_SCOPE,
    timeoutMs: readTimeout(env.IMAGE_GENERATION_TIMEOUT_MS),
  };
}

export function toPublicImageConfig(config: ImageConfig, referencesAvailable: boolean): PublicImageConfig {
  return {
    provider: config.provider,
    credentialsConfigured: config.clientId.length > 0 && config.clientSecret.length > 0,
    referencesAvailable,
  };
}

/** Throws unless the configuration is complete enough to make a live call. */
export function assertLiveImageConfig(config: ImageConfig): void {
  if (config.provider !== 'firefly') {
    throw new ImageServiceError('configuration_error', 'assertLiveImageConfig called outside firefly mode');
  }
  if (!config.clientId) throw new ImageServiceError('configuration_error', 'ADOBE_FIREFLY_CLIENT_ID is not set');
  if (!config.clientSecret) throw new ImageServiceError('configuration_error', 'ADOBE_FIREFLY_CLIENT_SECRET is not set');
}
