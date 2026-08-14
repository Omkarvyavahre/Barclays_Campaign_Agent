/**
 * Bundle-safety guard.
 *
 * Fails if anything server-only becomes reachable from the browser, either by
 * an import in `src/` or by appearing in a built asset in `dist/`.
 *
 * The static half always runs. The built-output half runs whenever `dist/`
 * exists, so `npm run build && npm test` gives full coverage.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');

/** Strings that must never be reachable from the browser. */
const FORBIDDEN_TOKENS = [
  'AI_GATEWAY_API_KEY',
  'AI_GATEWAY_BASE_URL',
  'AI_GATEWAY_PROTOCOL',
  'GEMINI_MODEL',
  'gateway.internal.example',
  '/chat/completions',
  'loadAiConfig',
  'requestStructuredCompletion',
  'assertLiveConfig',
  // Adobe Firefly: credentials, endpoints, and server-only implementation.
  'ADOBE_FIREFLY_CLIENT_ID',
  'ADOBE_FIREFLY_CLIENT_SECRET',
  'ADOBE_FIREFLY_API_BASE_URL',
  'ADOBE_IMS_BASE_URL',
  'ADOBE_FIREFLY_SCOPE',
  'IMAGE_GENERATION_PROVIDER',
  'firefly-api.adobe.io',
  'ims-na1.adobelogin.com',
  '/v2/storage/image',
  '/v3/images/generate',
  'client_credentials',
  'firefly-references',
  'loadImageConfig',
  'requestAccessToken',
  'uploadReferenceImage',
  'buildCreativePrompt',
  'saveGeneratedImage',
  '.generated/firefly',
];

const CLIENT_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

function walk(dir: string, filter: (file: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out;
}

const clientSources = walk(
  SRC,
  (file) => CLIENT_SOURCE_EXTENSIONS.has(extname(file)) && !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'),
);

describe('client source never reaches server-only code', () => {
  it('finds client sources to scan', () => {
    expect(clientSources.length).toBeGreaterThan(0);
  });

  it('contains no import of anything under server/', () => {
    const offenders: string[] = [];
    for (const file of clientSources) {
      const contents = readFileSync(file, 'utf8');
      const imports = contents.match(/(?:import|export)[^;]*?from\s+['"]([^'"]+)['"]/g) ?? [];
      for (const statement of imports) {
        const target = /from\s+['"]([^'"]+)['"]/.exec(statement)?.[1] ?? '';
        if (target.includes('server/') || target.includes('/server') || target.startsWith('server')) {
          offenders.push(`${relative(ROOT, file)} -> ${target}`);
        }
      }
      if (/import\(\s*['"][^'"]*server\//.test(contents)) offenders.push(`${relative(ROOT, file)} -> dynamic server import`);
    }
    expect(offenders).toEqual([]);
  });

  it('contains no gateway credential or transport identifiers', () => {
    const offenders: string[] = [];
    for (const file of clientSources) {
      const contents = readFileSync(file, 'utf8');
      for (const token of FORBIDDEN_TOKENS) {
        if (contents.includes(token)) offenders.push(`${relative(ROOT, file)} contains ${token}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never reads process.env from client source', () => {
    const offenders = clientSources
      .filter((file) => /process\s*\.\s*env/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});

describe('built client bundle contains no server-only material', () => {
  const builtAssets = walk(DIST, (file) => ['.js', '.css', '.html'].includes(extname(file)));

  it.runIf(builtAssets.length > 0)('emits no forbidden token into dist/', () => {
    const offenders: string[] = [];
    for (const file of builtAssets) {
      const contents = readFileSync(file, 'utf8');
      for (const token of FORBIDDEN_TOKENS) {
        if (contents.includes(token)) offenders.push(`${relative(ROOT, file)} contains ${token}`);
      }
      if (/Bearer\s+[A-Za-z0-9._-]{8,}/.test(contents)) offenders.push(`${relative(ROOT, file)} contains a bearer credential`);
    }
    expect(offenders).toEqual([]);
  });

  // Guards against the inverse failure: a bundle that passes the checks above
  // simply because the bridge was tree-shaken out. The base path survives
  // minification as a variable, so the endpoint suffixes are checked separately.
  it.runIf(builtAssets.length > 0)('still contains the same-origin API paths and nothing absolute', () => {
    const js = builtAssets.filter((file) => extname(file) === '.js').map((file) => readFileSync(file, 'utf8'));
    expect(js.some((contents) => contents.includes('/api/ai'))).toBe(true);
    expect(js.some((contents) => contents.includes('/coordinator/analyse'))).toBe(true);
    expect(js.some((contents) => contents.includes('/brief/generate'))).toBe(true);
    expect(js.some((contents) => contents.includes('/api/images'))).toBe(true);
    expect(js.some((contents) => /https?:\/\/[^"'`\s]*gateway/i.test(contents))).toBe(false);
    expect(js.some((contents) => /https?:\/\/[^"'`\s]*adobe/i.test(contents))).toBe(false);
  });

  it.runIf(builtAssets.length > 0)('emits no Adobe or gateway hostname into any built asset', () => {
    const offenders = builtAssets.filter((file) => /adobelogin|adobe\.io|firefly-api/i.test(readFileSync(file, 'utf8')));
    expect(offenders.map((file) => relative(ROOT, file))).toEqual([]);
  });
});
