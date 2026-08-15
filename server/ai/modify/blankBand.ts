/**
 * Deterministic structural check for channel-adapted creatives — no AI involved.
 *
 * A creative that reads as one continuous visual never contains a full-height (or
 * full-width) near-white/transparent band with real content on both sides of it.
 * That pattern is the signature of a gutter between panels, so it is treated as a
 * composition failure rather than a valid crop.
 */

import sharp from 'sharp';

export type BlankBandOrientation = 'vertical' | 'horizontal';

export type BlankBand = {
  orientation: BlankBandOrientation;
  /** First blank column (vertical) or row (horizontal). */
  start: number;
  length: number;
  /** Band thickness as a fraction of the axis it cuts across. */
  fractionOfAxis: number;
};

export type BlankBandScan = {
  width: number;
  height: number;
  bands: BlankBand[];
};

/** Pale brand backgrounds (e.g. 229,244,251) must not count as blank. */
const BLANK_MIN_CHANNEL = 246;
const BLANK_MAX_CHANNEL_SPREAD = 6;
const BLANK_MAX_ALPHA = 8;
/** A line counts as blank only when almost every sampled pixel is blank. */
const LINE_BLANK_RATIO = 0.98;
const MIN_BAND_FRACTION = 0.02;
const MIN_BAND_PIXELS = 8;
/** Bounds cost on large images without resampling (which would blur band edges). */
const MAX_SAMPLES_PER_LINE = 256;

function isBlankPixel(
  data: Buffer,
  offset: number
): boolean {
  const alpha = data[offset + 3]!;
  if (alpha <= BLANK_MAX_ALPHA) return true;
  const r = data[offset]!;
  const g = data[offset + 1]!;
  const b = data[offset + 2]!;
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  return min >= BLANK_MIN_CHANNEL && max - min <= BLANK_MAX_CHANNEL_SPREAD;
}

function blankLineFlags(
  lineCount: number,
  spanLength: number,
  offsetAt: (line: number, span: number) => number,
  data: Buffer
): boolean[] {
  const stride = Math.max(1, Math.floor(spanLength / MAX_SAMPLES_PER_LINE));
  const flags: boolean[] = [];
  for (let line = 0; line < lineCount; line += 1) {
    let sampled = 0;
    let blank = 0;
    for (let span = 0; span < spanLength; span += stride) {
      sampled += 1;
      if (isBlankPixel(data, offsetAt(line, span))) blank += 1;
    }
    flags.push(sampled > 0 && blank / sampled >= LINE_BLANK_RATIO);
  }
  return flags;
}

function interiorBands(flags: boolean[], orientation: BlankBandOrientation): BlankBand[] {
  const axis = flags.length;
  const minLength = Math.max(MIN_BAND_PIXELS, Math.ceil(axis * MIN_BAND_FRACTION));
  const bands: BlankBand[] = [];
  let start = -1;

  for (let i = 0; i <= axis; i += 1) {
    const blank = i < axis && flags[i] === true;
    if (blank) {
      if (start < 0) start = i;
      continue;
    }
    if (start < 0) continue;

    const length = i - start;
    const contentBefore = flags.slice(0, start).some((flag) => !flag);
    const contentAfter = flags.slice(i).some((flag) => !flag);
    if (length >= minLength && contentBefore && contentAfter) {
      bands.push({ orientation, start, length, fractionOfAxis: length / axis });
    }
    start = -1;
  }

  return bands;
}

/** Finds blank bands that split the image, ignoring blank areas at the edges. */
export async function scanInteriorBlankBands(bytes: Buffer): Promise<BlankBandScan> {
  const { data, info } = await sharp(bytes, { failOn: 'none' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const columnFlags = blankLineFlags(
    width,
    height,
    (x, y) => (y * width + x) * channels,
    data
  );
  const rowFlags = blankLineFlags(
    height,
    width,
    (y, x) => (y * width + x) * channels,
    data
  );

  return {
    width,
    height,
    bands: [...interiorBands(columnFlags, 'vertical'), ...interiorBands(rowFlags, 'horizontal')]
  };
}

export async function hasInteriorBlankBand(bytes: Buffer): Promise<boolean> {
  const scan = await scanInteriorBlankBands(bytes);
  return scan.bands.length > 0;
}

export function describeBlankBands(bands: BlankBand[]): string {
  return bands
    .map(
      (band) =>
        `${band.orientation} band at ${band.start}px, ${band.length}px thick (${(
          band.fractionOfAxis * 100
        ).toFixed(1)}%)`
    )
    .join('; ');
}
