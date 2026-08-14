/**
 * Pins the dev-server watcher exclusion for `.generated/`.
 *
 * A reload of an open client restarts the scripted campaign, and a restarted
 * campaign spends live Gemini and Firefly calls. Writing a generated asset, a
 * screenshot or a browser profile must therefore stay invisible to the watcher.
 *
 * The check goes through Vite's own config resolution rather than reading the
 * file, so it fails if the option is renamed, dropped or overridden by a plugin.
 */

import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveConfig } from 'vite';
import { describe, expect, it } from 'vitest';

import { WATCH_IGNORED } from '../vite.config.ts';
import { generatedDirectory } from './images/storage.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GENERATED_GLOB = '**/.generated/**';

function asList(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

describe('dev server watcher ignores generated artifacts', () => {
  it('carries the .generated exclusion through resolved serve config', async () => {
    const config = await resolveConfig({ configFile: 'vite.config.ts', root: ROOT }, 'serve');
    expect(asList(config.server.watch?.ignored)).toContain(GENERATED_GLOB);
  });

  it('leaves Vite to add its own default exclusions', async () => {
    const config = await resolveConfig({ configFile: 'vite.config.ts', root: ROOT }, 'serve');
    // Vite merges this list with node_modules, .git and the cache directory, so
    // the config neither restates those nor replaces them.
    expect(asList(config.server.watch?.ignored)).toEqual(WATCH_IGNORED);
  });

  it('covers the directory generated assets are actually written to', () => {
    const target = relative(ROOT, generatedDirectory()).replace(/\\/g, '/');
    expect(target.startsWith('.generated/')).toBe(true);
  });
});
