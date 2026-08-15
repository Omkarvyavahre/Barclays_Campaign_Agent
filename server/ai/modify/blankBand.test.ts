/**
 * @vitest-environment node
 *
 * Deterministic blank-band detection. No provider calls, no AI validation.
 */
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { hasInteriorBlankBand, scanInteriorBlankBands } from './blankBand';

const PALE_BRAND_BACKGROUND = { r: 229, g: 244, b: 251 };
const DEEP_BLUE = { r: 10, g: 20, b: 90 };
const WHITE = { r: 255, g: 255, b: 255 };

function solid(width: number, height: number, background: Record<string, number>) {
  return sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();
}

/** Mirrors the two-panel composition Gemini returned: panels split by a white gutter. */
async function twoPanelWithWhiteGutter(width = 1360, height = 768, gutter = 62) {
  const panel = await solid(440, 300, DEEP_BLUE);
  const divider = await solid(gutter, height, WHITE);
  return sharp({ create: { width, height, channels: 3, background: PALE_BRAND_BACKGROUND } })
    .composite([
      { input: panel, left: 30, top: 60 },
      { input: panel, left: 760, top: 60 },
      { input: divider, left: 649, top: 0 }
    ])
    .png()
    .toBuffer();
}

describe('scanInteriorBlankBands', () => {
  it('finds the white gutter that splits a two-panel composition', async () => {
    const scan = await scanInteriorBlankBands(await twoPanelWithWhiteGutter());

    expect(scan.width).toBe(1360);
    expect(scan.height).toBe(768);
    expect(scan.bands).toHaveLength(1);
    expect(scan.bands[0]!.orientation).toBe('vertical');
    expect(scan.bands[0]!.start).toBe(649);
    expect(scan.bands[0]!.length).toBe(62);
  });

  it('finds a full-width horizontal gutter', async () => {
    const panel = await solid(600, 200, DEEP_BLUE);
    const divider = await solid(1080, 60, WHITE);
    const image = await sharp({
      create: { width: 1080, height: 1080, channels: 3, background: PALE_BRAND_BACKGROUND }
    })
      .composite([
        { input: panel, left: 100, top: 100 },
        { input: panel, left: 100, top: 700 },
        { input: divider, left: 0, top: 500 }
      ])
      .png()
      .toBuffer();

    const scan = await scanInteriorBlankBands(image);
    expect(scan.bands.map((band) => band.orientation)).toContain('horizontal');
  });

  it('finds a fully transparent band', async () => {
    const width = 1000;
    const height = 600;
    const data = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        const transparent = x >= 440 && x < 560;
        data[i] = DEEP_BLUE.r;
        data[i + 1] = DEEP_BLUE.g;
        data[i + 2] = DEEP_BLUE.b;
        data[i + 3] = transparent ? 0 : 255;
      }
    }
    const image = await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();

    expect(await hasInteriorBlankBand(image)).toBe(true);
  });

  it('treats a continuous creative as valid', async () => {
    expect(await hasInteriorBlankBand(await solid(1080, 1080, DEEP_BLUE))).toBe(false);
  });

  it('does not treat a pale brand background as blank', async () => {
    expect(await hasInteriorBlankBand(await solid(1080, 1080, PALE_BRAND_BACKGROUND))).toBe(false);
  });

  it('ignores blank margins at the edges', async () => {
    const subject = await solid(400, 400, DEEP_BLUE);
    const image = await sharp({ create: { width: 1080, height: 1080, channels: 3, background: WHITE } })
      .composite([{ input: subject, left: 340, top: 340 }])
      .png()
      .toBuffer();

    expect(await hasInteriorBlankBand(image)).toBe(false);
  });

  it('ignores a hairline band below the minimum thickness', async () => {
    const panel = await solid(500, 1080, DEEP_BLUE);
    const image = await sharp({ create: { width: 1080, height: 1080, channels: 3, background: WHITE } })
      .composite([
        { input: panel, left: 0, top: 0 },
        { input: await solid(500, 1080, DEEP_BLUE), left: 503, top: 0 }
      ])
      .png()
      .toBuffer();

    expect(await hasInteriorBlankBand(image)).toBe(false);
  });
});
