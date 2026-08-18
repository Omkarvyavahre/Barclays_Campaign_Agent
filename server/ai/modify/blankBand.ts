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
/**
 * A blank band is excused as stacked-layout whitespace (not a panel-splitting gutter)
 * only when BOTH of these hold:
 *   - it is thin: an email preheader/footer margin is a narrow gap, whereas a comparison
 *     or duplicate gutter is a wide channel;
 *   - the content on its minority side is a thin strip, not a second panel.
 * Both are required because the channel-format adapter also tries left/right/top/bottom
 * anchors, which can push a genuine central gutter near an edge and leave a thin sliver
 * on one side. Measured on real outputs: a reproduced preheader margin is a ~2.3% band
 * with ~3% content on the minority side, while genuine gutters are ~8–19% thick with
 * ~40–46% content on each side. The cuts sit safely between the two populations.
 */
const MIN_SPLIT_SIDE_FRACTION = 0.12;
const MARGIN_BAND_MAX_FRACTION = 0.05;
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

/** Published so failure diagnostics can report measured value against threshold. */
export const BLANK_BAND_THRESHOLDS = {
  blankMinChannel: BLANK_MIN_CHANNEL,
  blankMaxChannelSpread: BLANK_MAX_CHANNEL_SPREAD,
  blankMaxAlpha: BLANK_MAX_ALPHA,
  lineBlankRatio: LINE_BLANK_RATIO,
  minBandFraction: MIN_BAND_FRACTION,
  minBandPixels: MIN_BAND_PIXELS,
  minSplitSideFraction: MIN_SPLIT_SIDE_FRACTION,
  marginBandMaxFraction: MARGIN_BAND_MAX_FRACTION
} as const;

/** Smallest band thickness that counts as a split on an axis of `axis` pixels. */
export function minBandLengthForAxis(axis: number): number {
  return Math.max(MIN_BAND_PIXELS, Math.ceil(axis * MIN_BAND_FRACTION));
}

function countContentLines(flags: boolean[], from: number, to: number): number {
  let count = 0;
  for (let i = from; i < to; i += 1) if (flags[i] === false) count += 1;
  return count;
}

function interiorBands(flags: boolean[], orientation: BlankBandOrientation): BlankBand[] {
  const axis = flags.length;
  const minLength = minBandLengthForAxis(axis);
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
    const contentLinesBefore = countContentLines(flags, 0, start);
    const contentLinesAfter = countContentLines(flags, i, axis);
    const minSideFraction = Math.min(contentLinesBefore, contentLinesAfter) / axis;
    const bandFraction = length / axis;
    // A thin band next to a thin content strip is a stacked-layout margin (e.g. the gap
    // under an email preheader), not a gutter between panels. Anything thicker, or with a
    // substantial content region on both sides, is treated as a real split.
    const isThinEdgeMargin =
      bandFraction <= MARGIN_BAND_MAX_FRACTION && minSideFraction < MIN_SPLIT_SIDE_FRACTION;
    if (
      length >= minLength &&
      contentLinesBefore > 0 &&
      contentLinesAfter > 0 &&
      !isThinEdgeMargin
    ) {
      bands.push({ orientation, start, length, fractionOfAxis: bandFraction });
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
