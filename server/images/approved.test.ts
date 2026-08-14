/**
 * Promotion to *approved* is a human act.
 *
 * These tests exist to make that structural rather than a convention: the two
 * signed-off ids are pinned literally here, so any change to the manifest — by a
 * person or by code — has to be deliberate enough to update this file too, and
 * nothing in the codebase is allowed to write the manifest at runtime.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { APPROVED_ASSETS } from './approved.ts';
import { ASSET_ID_PATTERN, currentChannelAsset, readGeneratedImage } from './storage.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The assets a human has looked at and signed off. */
const SIGNED_OFF = {
  linkedin: 'linkedin-f1bca403-4fd1-4246-8789-50bbd52f2bec',
  email: 'email-8781d5ae-a62f-43c7-b41b-e3524ff0f0b3',
} as const;

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('6. the pinned approved assets are preserved', () => {
  it('pins exactly the two signed-off ids', () => {
    expect(APPROVED_ASSETS).toEqual(SIGNED_OFF);
  });

  it('pins a well-formed id for the channel it names', () => {
    for (const [channel, id] of Object.entries(APPROVED_ASSETS)) {
      if (id === null) continue;
      expect(id).toMatch(ASSET_ID_PATTERN);
      expect(id.startsWith(`${channel}-`)).toBe(true);
    }
  });

  it('serves the pinned asset where the file is present', () => {
    for (const [channel, id] of Object.entries(SIGNED_OFF)) {
      const asset = currentChannelAsset(channel as 'linkedin' | 'email');
      // Generated output is gitignored, so a fresh checkout has no file to read.
      if (!asset) continue;

      expect(asset.id).toBe(id);
      expect(asset.width).toBe(2688);
      expect(asset.height).toBe(1536);
      expect(readGeneratedImage(id).bytes.length).toBe(asset.bytes);
    }
  });
});

describe('21. nothing can promote an asset automatically', () => {
  const sources = [...sourceFiles(join(ROOT, 'server')), ...sourceFiles(join(ROOT, 'src'))];

  it('finds the source files to scan', () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it('never writes the manifest from code', () => {
    // Any write whose target names the manifest, however it is spelled.
    const pattern = /(writeFileSync|appendFileSync|createWriteStream|rmSync|renameSync|writeFile)\s*\([^)]*approved/i;
    const writers = sources.filter((file) => pattern.test(readFileSync(file, 'utf8')));

    expect(writers).toEqual([]);
  });

  it('exports the manifest as data with no mutator alongside it', () => {
    const manifest = readFileSync(join(ROOT, 'server', 'images', 'approved.ts'), 'utf8');

    expect(manifest).toContain('export const APPROVED_ASSETS');
    expect(manifest).not.toMatch(/export function/);
    expect(manifest).not.toMatch(/writeFileSync|process\.env/);
  });
});
