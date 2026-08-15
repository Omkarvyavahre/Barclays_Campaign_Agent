/**
 * Loads `.env` into process.env for server-side code.
 *
 * Vite only exposes VITE_-prefixed values to the client bundle and does not
 * populate process.env, so dev-server API routes need this explicitly.
 * Existing process.env values always win (shell overrides file).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadServerEnvFile(cwd = process.cwd()): void {
  let text = '';
  try {
    text = readFileSync(resolve(cwd, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** Booleans only — never returns key material. */
export function describeServerAiEnv(): Record<string, boolean | string | null> {
  return {
    aiMode: process.env.AI_MODE ?? 'mock',
    aiBackend: process.env.AI_BACKEND ?? 'internal_gateway',
    geminiLive: process.env.GEMINI_LIVE === '1' || process.env.AI_MODE === 'gemini',
    geminiGatewayConfigured: Boolean(process.env.AI_GATEWAY_BASE_URL && process.env.AI_GATEWAY_API_KEY),
    geminiModel: process.env.GEMINI_MODEL ?? null,
    gatewayProtocol: process.env.AI_GATEWAY_PROTOCOL ?? null,
    fireflyLive: process.env.FIREFLY_LIVE === '1',
    fireflyCredentialsConfigured: Boolean(
      process.env.ADOBE_FIREFLY_CLIENT_ID && process.env.ADOBE_FIREFLY_CLIENT_SECRET
    ),
    useSystemCa: (process.env.NODE_OPTIONS ?? '').includes('--use-system-ca')
  };
}
