import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Sibling folder of the application — never moved into the app tree. */
export const RESOURCE_FOLDER_NAME = 'Barclays Brand Guidelines, Content & GS4PM Demo Support';

/**
 * Resolves the absolute path to the Barclays resource folder.
 * Expected layout:
 *   <workspace>/
 *     barclays-v19-react-exact/   ← application
 *     Barclays Brand Guidelines…/ ← resources
 */
export function resolveResourceRoot(override?: string): string {
  if (override) return resolve(override);

  const candidates = [
    // App cwd is barclays-v19-react-exact
    resolve(process.cwd(), '..', RESOURCE_FOLDER_NAME),
    // Module lives at server/knowledge → three levels up to workspace
    resolve(here, '..', '..', '..', RESOURCE_FOLDER_NAME),
    // Workspace opened at the Campaign Agent root
    resolve(process.cwd(), RESOURCE_FOLDER_NAME)
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  // Prefer the conventional sibling path even when missing so callers can
  // report a deterministic failure location.
  return candidates[0];
}

export function resourceExists(override?: string): boolean {
  return existsSync(resolveResourceRoot(override));
}

export function joinResourcePath(...parts: string[]): string {
  return join(resolveResourceRoot(), ...parts);
}
