/**
 * Freezes the V19 Stage 7 renderer.
 *
 * Phase 1 only *identifies* the creative seam; it does not use it. This test
 * pins the seam so the integration cannot quietly start editing generated V19
 * files, and fails if Stage 7 gains any knowledge of Firefly.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RUNTIME = join(ROOT, 'public', 'runtime');

const finalOutputRenderer = readFileSync(join(RUNTIME, 'v19-3.js'), 'utf8');
const creativeDefinition = readFileSync(join(RUNTIME, 'v19-1.js'), 'utf8');
const css = readFileSync(join(ROOT, 'src', 'styles', 'v19.css'), 'utf8');

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

describe('the Stage 7 creative seam is intact', () => {
  it('still resolves the creative from the runtime global at render time', () => {
    expect(finalOutputRenderer).toContain('renderOutputPreview=function(o){');
    expect(finalOutputRenderer).toContain("const creative=window.IPORTAL_CREATIVE||'';");
    expect(creativeDefinition).toContain("window.IPORTAL_CREATIVE = 'data:image/png;base64,");
  });

  it('still binds that creative into the Email and LinkedIn slots unchanged', () => {
    expect(finalOutputRenderer).toContain(
      'class="v17-email-creative" style="background-image:url(\'${creative}\')"',
    );
    expect(finalOutputRenderer).toContain('class="v17-li-creative" style="background-image:url(\'${creative}\')"');
  });

  it('still renders one channel preview at a time from the output tabs', () => {
    expect(finalOutputRenderer).toContain('window.setOutputTab=function(key){state.outputTab=key;renderAll();};');
    expect(finalOutputRenderer).toContain('renderOutputPreview(o)');
  });

  it('keeps the Stage 7 creative CSS untouched', () => {
    expect(css).toContain('.v17-email-creative{height:190px;background-size:cover');
    expect(css).toContain('.v17-li-creative');
  });
});

describe('the frozen V19 layer knows nothing about image generation', () => {
  const frozen = [
    ...walk(RUNTIME),
    join(ROOT, 'src', 'runtime', 'v19Markup.ts'),
    join(ROOT, 'src', 'styles', 'v19.css'),
    join(ROOT, 'reference', 'V19-authoritative.html'),
  ].filter((file) => existsSync(file));

  it('finds the frozen files to scan', () => {
    expect(frozen.length).toBeGreaterThan(5);
  });

  // '.generated/firefly' rather than '.generated', which V19's own
  // `state.generatedAssets` would match.
  it.each(['firefly', '/api/images', '.generated/firefly', 'ADOBE_', 'IMAGE_GENERATION_PROVIDER'])(
    'contains no reference to %s',
    (token) => {
      const offenders = frozen
        .filter((file) => readFileSync(file, 'utf8').toLowerCase().includes(token.toLowerCase()))
        .map((file) => relative(ROOT, file));
      expect(offenders).toEqual([]);
    },
  );
});
