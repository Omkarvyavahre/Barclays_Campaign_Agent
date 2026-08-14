/**
 * Guards the approved reference inputs: they must exist, be real PNGs, stay
 * server-side, and map to channels deterministically.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CHANNEL_REFERENCE_SLOT,
  PNG_SIGNATURE,
  REFERENCE_FILENAMES,
  allReferencesAvailable,
  loadReference,
  referenceDirectory,
  referencePath,
  referenceSlotForChannel,
} from './references.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe('approved reference images', () => {
  it('reference image 1 exists and is a PNG', () => {
    expect(existsSync(referencePath(1))).toBe(true);
    const loaded = loadReference(1);
    expect(loaded.contentType).toBe('image/png');
    expect(loaded.bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    expect(loaded.bytes.length).toBeGreaterThan(1024);
  });

  it('reference image 2 exists and is a PNG', () => {
    expect(existsSync(referencePath(2))).toBe(true);
    const loaded = loadReference(2);
    expect(loaded.contentType).toBe('image/png');
    expect(loaded.bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    expect(loaded.bytes.length).toBeGreaterThan(1024);
  });

  it('reports both references as available', () => {
    expect(allReferencesAvailable()).toBe(true);
  });

  it('reads them from server/assets/firefly-references only', () => {
    expect(relative(ROOT, referenceDirectory()).replace(/\\/g, '/')).toBe('server/assets/firefly-references');
  });
});

describe('reference images remain server-side', () => {
  it.each(['public', 'src', 'dist'])('does not appear anywhere under %s/', (dir) => {
    const offenders = walk(join(ROOT, dir)).filter((file) => /firefly[_-]reference/i.test(file));
    expect(offenders).toEqual([]);
  });

  it('is never named or pathed from client source', () => {
    // Production client source only; tests are allowed to assert on the name.
    const clientSources = walk(join(ROOT, 'src')).filter(
      (file) => ['.ts', '.tsx'].includes(extname(file)) && !file.includes('.test.'),
    );
    const offenders = clientSources.filter((file) => {
      const contents = readFileSync(file, 'utf8');
      return contents.includes('firefly-references') || /firefly_reference/i.test(contents);
    });
    expect(offenders.map((file) => relative(ROOT, file))).toEqual([]);
  });

  it('is not exposed by the generated V19 runtime either', () => {
    const runtime = walk(join(ROOT, 'public', 'runtime'));
    for (const file of runtime) {
      const contents = readFileSync(file, 'utf8');
      expect(contents).not.toMatch(/firefly/i);
    }
  });
});

describe('deterministic channel to reference mapping', () => {
  it('maps both channels to reference 1, the treatment proven not to reproduce lettering', () => {
    expect(CHANNEL_REFERENCE_SLOT).toEqual({ linkedin: 1, email: 1 });
    expect(referenceSlotForChannel('linkedin')).toBe(1);
    expect(referenceSlotForChannel('email')).toBe(1);
  });

  it('is stable across repeated calls rather than random', () => {
    const slots = new Set(Array.from({ length: 25 }, () => referenceSlotForChannel('linkedin')));
    expect([...slots]).toEqual([1]);
  });

  it('keeps the two slots addressable as distinct files', () => {
    expect(REFERENCE_FILENAMES[1]).not.toBe(REFERENCE_FILENAMES[2]);
    expect(referencePath(1)).not.toBe(referencePath(2));
  });
});
