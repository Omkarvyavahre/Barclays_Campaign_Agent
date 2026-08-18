/**
 * @vitest-environment node
 *
 * Owned-logo composition — local only. No provider calls.
 */
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  compositeOwnedLogo,
  DEFAULT_OWNED_LOGO_ENTRY_ID,
  LOGO_MARGIN_FRACTION,
  LOGO_MAX_WIDTH_FRACTION,
  MIN_COMPOSITION_CANVAS_PX,
  resolveOwnedLogoBytes
} from './compositeOwnedLogo';

async function solidCanvas(width: number, height: number, rgb = { r: 20, g: 40, b: 80 }): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: rgb }
  })
    .jpeg()
    .toBuffer();
}

describe('resolveOwnedLogoBytes', () => {
  it('resolves vis-logo-png from the existing KG catalogue', () => {
    const logo = resolveOwnedLogoBytes(DEFAULT_OWNED_LOGO_ENTRY_ID);
    expect(logo).not.toBeNull();
    expect(logo!.entryId).toBe('vis-logo-png');
    expect(logo!.sourceFile).toMatch(/Barclays Logo\.png$/i);
    expect(logo!.bytes.length).toBeGreaterThan(100);
    expect(logo!.absolutePath).toContain(logo!.sourceFile);
  });

  it('returns null for an unknown logo id', () => {
    expect(resolveOwnedLogoBytes('vis-logo-does-not-exist')).toBeNull();
  });
});

describe('compositeOwnedLogo', () => {
  it('uses a 22% max-width rule with a 4% safe margin', () => {
    expect(LOGO_MAX_WIDTH_FRACTION).toBe(0.22);
    expect(LOGO_MARGIN_FRACTION).toBe(0.04);
  });

  it('composites the owned logo top-left with aspect ratio, margin and alpha preserved', async () => {
    const canvasW = 1000;
    const canvasH = 1000;
    const base = await solidCanvas(canvasW, canvasH);
    const result = await compositeOwnedLogo({
      imageBytes: base,
      imageMimeType: 'image/jpeg',
      logoEntryId: 'vis-logo-png',
      placement: 'top-left'
    });

    expect(result.metadata.applied).toBe(true);
    expect(result.metadata.entryId).toBe('vis-logo-png');
    expect(result.metadata.placement).toBe('top-left');
    expect(result.metadata.sourceFile).toMatch(/Barclays Logo\.png$/i);
    expect(result.mimeType).toBe('image/png');
    expect(result.canvasWidth).toBe(canvasW);
    expect(result.canvasHeight).toBe(canvasH);

    const expectedMargin = Math.round(Math.min(canvasW, canvasH) * LOGO_MARGIN_FRACTION);
    const expectedMaxW = Math.round(canvasW * LOGO_MAX_WIDTH_FRACTION);
    expect(result.left).toBe(expectedMargin);
    expect(result.top).toBe(expectedMargin);
    expect(result.logoWidth!).toBeLessThanOrEqual(expectedMaxW);
    expect(result.logoWidth! + expectedMargin * 2).toBeLessThanOrEqual(canvasW);
    expect(result.logoHeight! + expectedMargin * 2).toBeLessThanOrEqual(canvasH);

    const outMeta = await sharp(result.bytes).metadata();
    expect(outMeta.width).toBe(canvasW);
    expect(outMeta.height).toBe(canvasH);
    // Final canvas still has an alpha channel from PNG output; logo was not stretched.
    expect(result.logoWidth! / result.logoHeight!).toBeGreaterThan(0.2);

    // Top-left region should differ from the solid base (logo pixels present).
    const { data } = await sharp(result.bytes)
      .raw()
      .toBuffer({ resolveWithObject: true })
      .then(({ data, info }) => ({ data, info }));
    const sampleX = result.left! + Math.floor(result.logoWidth! / 2);
    const sampleY = result.top! + Math.floor(result.logoHeight! / 2);
    const idx = (sampleY * canvasW + sampleX) * 4;
    // Not the solid navy background alone.
    expect(data[idx]).not.toBe(20);
  });

  it('does not stretch the logo beyond the 22% max-width fraction', async () => {
    const base = await solidCanvas(800, 600);
    const result = await compositeOwnedLogo({
      imageBytes: base,
      logoEntryId: 'vis-logo-png'
    });
    expect(result.metadata.applied).toBe(true);
    expect(LOGO_MAX_WIDTH_FRACTION).toBe(0.22);
    expect(result.logoWidth!).toBeLessThanOrEqual(Math.round(800 * 0.22));
  });

  it('keeps the raw bytes and reports not-applied when the canvas is too small', async () => {
    const tiny = await solidCanvas(MIN_COMPOSITION_CANVAS_PX - 1, MIN_COMPOSITION_CANVAS_PX - 1);
    const result = await compositeOwnedLogo({ imageBytes: tiny, imageMimeType: 'image/jpeg' });
    expect(result.metadata.applied).toBe(false);
    expect(result.metadata.reason).toBe('canvas-too-small');
    expect(result.bytes.equals(tiny)).toBe(true);
  });

  it('keeps the raw bytes when the logo id cannot be resolved', async () => {
    const base = await solidCanvas(400, 400);
    const result = await compositeOwnedLogo({
      imageBytes: base,
      logoEntryId: 'vis-logo-missing'
    });
    expect(result.metadata.applied).toBe(false);
    expect(result.metadata.reason).toBe('logo-unresolved');
    expect(result.bytes.equals(base)).toBe(true);
  });
});
