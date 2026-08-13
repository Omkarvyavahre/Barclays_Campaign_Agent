/**
 * Loads `.env` into `process.env` for server-side code.
 *
 * Vite only exposes `VITE_`-prefixed variables to the client and does not
 * populate `process.env`, which is exactly the behaviour we want: gateway
 * values must reach the Node process and nothing else. This module is the one
 * place that reads the file, and it is never imported from `src/`.
 *
 * Values are never logged. Only whether a file was found is reported.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

let attempted = false;
let loadedFrom: string | null = null;

export interface DotEnvStatus {
  found: boolean;
  loaded: boolean;
}

/**
 * Idempotent. Mirrors `node --env-file`: variables already present in the
 * environment win, so real deployment configuration is never overwritten by a
 * stray local file.
 */
export function loadDotEnv(file = '.env'): DotEnvStatus {
  if (attempted) return { found: loadedFrom !== null, loaded: loadedFrom !== null };
  attempted = true;

  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return { found: false, loaded: false };

  try {
    process.loadEnvFile(path);
    loadedFrom = path;
    return { found: true, loaded: true };
  } catch {
    // Never surface the file contents; a malformed line must not be echoed.
    console.error('[ai] .env was found but could not be parsed; falling back to the process environment.');
    return { found: true, loaded: false };
  }
}
