/**
 * @vitest-environment node
 *
 * Channel-format adaptation. Pure image processing — no provider calls.
 */
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  adaptImageToChannelFormat,
  adaptImageToTarget,
  cropCandidates,
  formatDimensions,
  parseDimensions,
  resolveCropStrategy
} from './adaptImageToTarget';

const PALE_BRAND_BACKGROUND = { r: 229, g: 244, b: 251 };
const DEEP_BLUE = { r: 10, g: 20, b: 90 };
const WHITE = { r: 255, g: 255, b: 255 };

function solid(width: number, height: number, background: Record<string, number>) {
  return sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();
}

/** Left-to-right ramp: any tiling, mirroring or duplication breaks monotonicity. */
function horizontalRamp(width: number, height: number) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      const ramp = Math.round((x / (width - 1)) * 255);
      data[i] = ramp;
      data[i + 1] = 40;
      data[i + 2] = 255 - ramp;
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

async function twoPanelWithWhiteGutter(width = 1360, height = 768) {
  const panel = await solid(440, 300, DEEP_BLUE);
  const divider = await solid(62, height, WHITE);
  return sharp({ create: { width, height, channels: 3, background: PALE_BRAND_BACKGROUND } })
    .composite([
      { input: panel, left: 30, top: 60 },
      { input: panel, left: 760, top: 60 },
      { input: divider, left: 649, top: 0 }
    ])
    .png()
    .toBuffer();
}

async function middleRowReds(bytes: Buffer): Promise<number[]> {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const y = Math.floor(info.height / 2);
  const reds: number[] = [];
  for (let x = 0; x < info.width; x += 1) {
    reds.push(data[(y * info.width + x) * info.channels]!);
  }
  return reds;
}

describe('parseDimensions', () => {
  it('parses the campaign dimension formats', () => {
    expect(parseDimensions('1080 × 1080')).toEqual({ width: 1080, height: 1080 });
    expect(parseDimensions('1200x627')).toEqual({ width: 1200, height: 627 });
    expect(parseDimensions('square')).toBeNull();
    expect(parseDimensions(undefined)).toBeNull();
  });

  it('formats dimensions consistently', () => {
    expect(formatDimensions(1360, 768)).toBe('1360 × 768');
  });
});

describe('resolveCropStrategy', () => {
  it('defaults to a centre crop and never anchors on negative space', () => {
    const strategy = resolveCropStrategy({ negativeSpace: 'left' });

    expect(strategy.position).toBe('center');
    expect(strategy.source).toBe('center');
    // Kept for reporting only — the safe area is not the crop focal point.
    expect(strategy.negativeSpaceHint).toBe('left');
  });

  it('prefers explicit focal-point metadata', () => {
    const strategy = resolveCropStrategy({ focalPoint: 'right', negativeSpace: 'left' });

    expect(strategy.position).toBe('right');
    expect(strategy.source).toBe('focal-point');
  });

  it('ignores unusable focal points and unspecified negative space', () => {
    const strategy = resolveCropStrategy({ focalPoint: 'diagonal', negativeSpace: 'unspecified' });

    expect(strategy.position).toBe('center');
    expect(strategy.source).toBe('center');
    expect(strategy.negativeSpaceHint).toBeUndefined();
  });
});

describe('cropCandidates', () => {
  it('offers horizontal alternatives when only the width overflows', () => {
    const candidates = cropCandidates(
      resolveCropStrategy({}),
      { width: 1360, height: 768 },
      { width: 1080, height: 1080 }
    );

    expect(candidates).toEqual(['center', 'left', 'right']);
  });

  it('offers vertical alternatives when only the height overflows', () => {
    const candidates = cropCandidates(
      resolveCropStrategy({}),
      { width: 1080, height: 1920 },
      { width: 1080, height: 1080 }
    );

    expect(candidates).toEqual(['center', 'top', 'bottom']);
  });

  it('offers no alternatives when the aspect ratio already matches', () => {
    const candidates = cropCandidates(
      resolveCropStrategy({}),
      { width: 2048, height: 2048 },
      { width: 1080, height: 1080 }
    );

    expect(candidates).toEqual(['center']);
  });
});

describe('adaptImageToTarget', () => {
  it('cover-crops 1360×768 to exactly 1080×1080 without stretching or duplicating', async () => {
    const adapted = await adaptImageToTarget({
      bytes: await horizontalRamp(1360, 768),
      sourceMime: 'image/png',
      targetWidth: 1080,
      targetHeight: 1080
    });

    expect(adapted.sourceWidth).toBe(1360);
    expect(adapted.sourceHeight).toBe(768);
    expect(adapted.finalWidth).toBe(1080);
    expect(adapted.finalHeight).toBe(1080);
    expect(adapted.scaleMode).toBe('cover');
    expect(adapted.cropPosition).toBe('center');

    const reds = await middleRowReds(adapted.bytes);
    // Strictly increasing left to right: one continuous slice, no tile or mirror.
    for (let x = 1; x < reds.length; x += 1) {
      expect(reds[x]!).toBeGreaterThanOrEqual(reds[x - 1]!);
    }
    expect(reds[reds.length - 1]! - reds[0]!).toBeGreaterThan(50);
    // Centre crop trims both edges of the ramp.
    expect(reds[0]!).toBeGreaterThan(5);
    expect(reds[reds.length - 1]!).toBeLessThan(250);
  });

  it('rejects empty bytes and invalid targets', async () => {
    await expect(
      adaptImageToTarget({ bytes: Buffer.alloc(0), targetWidth: 1080, targetHeight: 1080 })
    ).rejects.toThrow(/empty image bytes/);
    await expect(
      adaptImageToTarget({ bytes: await solid(10, 10, DEEP_BLUE), targetWidth: 0, targetHeight: 1080 })
    ).rejects.toThrow(/invalid target dimensions/);
  });
});

describe('adaptImageToChannelFormat', () => {
  it('adapts a continuous creative using the centre anchor only', async () => {
    const outcome = await adaptImageToChannelFormat({
      bytes: await horizontalRamp(1360, 768),
      sourceMime: 'image/png',
      targetWidth: 1080,
      targetHeight: 1080,
      strategy: resolveCropStrategy({ negativeSpace: 'left' })
    });

    expect(outcome.status).toBe('adapted');
    if (outcome.status !== 'adapted') return;
    expect(outcome.result.cropPosition).toBe('center');
    expect(outcome.candidatesTried).toEqual(['center']);
    expect(outcome.strategy.source).toBe('center');
  });

  it('produces the same pixels as a plain centre cover crop when negative space is set', async () => {
    const bytes = await horizontalRamp(1360, 768);
    const outcome = await adaptImageToChannelFormat({
      bytes,
      sourceMime: 'image/png',
      targetWidth: 1080,
      targetHeight: 1080,
      strategy: resolveCropStrategy({ negativeSpace: 'left' })
    });
    const reference = await sharp(bytes)
      .resize(1080, 1080, { fit: 'cover', position: 'centre' })
      .raw()
      .toBuffer();

    expect(outcome.status).toBe('adapted');
    if (outcome.status !== 'adapted') return;
    const produced = await sharp(outcome.result.bytes).raw().toBuffer();
    expect(produced.equals(reference)).toBe(true);
  });

  it('refuses every anchor when a white gutter splits the source composition', async () => {
    const outcome = await adaptImageToChannelFormat({
      bytes: await twoPanelWithWhiteGutter(),
      sourceMime: 'image/png',
      targetWidth: 1080,
      targetHeight: 1080,
      strategy: resolveCropStrategy({ negativeSpace: 'left' })
    });

    expect(outcome.status).toBe('composition-lost');
    if (outcome.status !== 'composition-lost') return;
    expect(outcome.candidatesTried).toEqual(['center', 'left', 'right']);
    expect(outcome.bands.length).toBeGreaterThan(0);
    expect(outcome.reason).toMatch(/blank band/);
    expect(outcome.sourceWidth).toBe(1360);
    expect(outcome.sourceHeight).toBe(768);
  });
});
