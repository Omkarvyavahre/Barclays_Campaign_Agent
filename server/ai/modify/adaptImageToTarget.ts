/**
 * Channel-format adaptation: aspect-preserving cover crop (CSS object-fit: cover).
 *
 * Exactly one source image goes through exactly one resize/crop operation. Nothing
 * here tiles, mirrors, duplicates, concatenates or pads the source.
 */

import sharp from 'sharp';
import {
  describeBlankBands,
  scanInteriorBlankBands,
  type BlankBand
} from './blankBand';

export type CropPosition = 'center' | 'left' | 'right' | 'top' | 'bottom';

/**
 * How the crop anchor was decided.
 *  - focal-point: explicit focal/crop metadata on the request
 *  - center: default, and the only safe choice without focal metadata
 */
export type CropStrategySource = 'focal-point' | 'center';

export type CropStrategy = {
  position: CropPosition;
  source: CropStrategySource;
  /**
   * Recorded for observability only. `negativeSpace` states where campaign copy
   * needs open space — a composition safe area, not a crop focal point. The two
   * can point in opposite directions, so it never anchors the crop on its own.
   */
  negativeSpaceHint?: string;
};

export type AdaptImageToTargetInput = {
  bytes: Buffer;
  sourceMime?: string;
  targetWidth: number;
  targetHeight: number;
  cropPosition?: CropPosition;
};

export type AdaptImageToTargetResult = {
  bytes: Buffer;
  mimeType: string;
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  finalWidth: number;
  finalHeight: number;
  cropPosition: CropPosition;
  /** Confirms uniform scale was used (cover), never independent X/Y stretch. */
  scaleMode: 'cover';
};

export type ParsedDimensions = {
  width: number;
  height: number;
};

/** Parses values like "1080 × 1080", "1080x1080", "1200 × 627". */
export function parseDimensions(value: string | undefined | null): ParsedDimensions | null {
  if (!value) return null;
  const match = String(value)
    .trim()
    .match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  if (!match) return null;
  const width = Number.parseInt(match[1]!, 10);
  const height = Number.parseInt(match[2]!, 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

export function formatDimensions(width: number, height: number): string {
  return `${width} × ${height}`;
}

const CROP_POSITIONS: CropPosition[] = ['center', 'left', 'right', 'top', 'bottom'];

function asCropPosition(value: string | undefined | null): CropPosition | null {
  const normalised = String(value || '')
    .trim()
    .toLowerCase()
    .replace('centre', 'center');
  return CROP_POSITIONS.includes(normalised as CropPosition)
    ? (normalised as CropPosition)
    : null;
}

/**
 * Crop anchor priority: explicit focal point, then centre. Negative space is kept
 * as a hint for reporting only — see CropStrategy.negativeSpaceHint.
 */
export function resolveCropStrategy(input: {
  focalPoint?: string | null;
  negativeSpace?: string | null;
}): CropStrategy {
  const hint = String(input.negativeSpace || '').trim().toLowerCase();
  const negativeSpaceHint = hint && hint !== 'unspecified' ? hint : undefined;
  const focal = asCropPosition(input.focalPoint);
  if (focal) {
    return { position: focal, source: 'focal-point', negativeSpaceHint };
  }
  return { position: 'center', source: 'center', negativeSpaceHint };
}

/**
 * Alternative anchors along whichever axis actually overflows the target, so a
 * failed centre crop can be retried deterministically instead of guessed at.
 */
export function cropCandidates(
  strategy: CropStrategy,
  source: ParsedDimensions,
  target: ParsedDimensions
): CropPosition[] {
  const scale = Math.max(target.width / source.width, target.height / source.height);
  const scaledWidth = source.width * scale;
  const scaledHeight = source.height * scale;
  const candidates: CropPosition[] = [strategy.position];

  if (scaledWidth - target.width > 1) candidates.push('left', 'right');
  if (scaledHeight - target.height > 1) candidates.push('top', 'bottom');

  return candidates.filter((position, index) => candidates.indexOf(position) === index);
}

function sharpPosition(crop: CropPosition): string {
  if (crop === 'center') return 'centre';
  return crop;
}

function outputMime(sourceMime: string | undefined, format: string | undefined): string {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  if (format === 'gif') return 'image/gif';
  if (sourceMime?.startsWith('image/')) return sourceMime;
  return 'image/png';
}

export async function readImageDimensions(
  bytes: Buffer
): Promise<{ width: number; height: number }> {
  const meta = await sharp(bytes, { failOn: 'none' }).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('readImageDimensions: unable to read source dimensions');
  }
  return { width: meta.width, height: meta.height };
}

/**
 * Resize so the source fully covers the target canvas, then crop overflow.
 * Equivalent to CSS object-fit: cover. Never stretches, never pads.
 */
export async function adaptImageToTarget(
  input: AdaptImageToTargetInput
): Promise<AdaptImageToTargetResult> {
  const { bytes, targetWidth, targetHeight } = input;
  const cropPosition = input.cropPosition ?? 'center';

  if (!bytes?.length) {
    throw new Error('adaptImageToTarget: empty image bytes');
  }
  if (!Number.isFinite(targetWidth) || !Number.isFinite(targetHeight) || targetWidth <= 0 || targetHeight <= 0) {
    throw new Error('adaptImageToTarget: invalid target dimensions');
  }

  const { width: sourceWidth, height: sourceHeight } = await readImageDimensions(bytes);

  // sharp cover uses a single uniform scale factor, then crops — no independent
  // stretch, no `contain`/`extend`/`extract`, and no background fill.
  const resized = await sharp(bytes, { failOn: 'none' })
    .resize(targetWidth, targetHeight, {
      fit: 'cover',
      position: sharpPosition(cropPosition),
      withoutEnlargement: false
    })
    .toBuffer({ resolveWithObject: true });

  const finalWidth = resized.info.width;
  const finalHeight = resized.info.height;
  if (finalWidth !== targetWidth || finalHeight !== targetHeight) {
    throw new Error(
      `adaptImageToTarget: expected ${targetWidth}×${targetHeight}, got ${finalWidth}×${finalHeight}`
    );
  }

  return {
    bytes: resized.data,
    mimeType: outputMime(input.sourceMime, resized.info.format),
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
    finalWidth,
    finalHeight,
    cropPosition,
    scaleMode: 'cover'
  };
}

export type ChannelAdaptationOutcome =
  | {
      status: 'adapted';
      result: AdaptImageToTargetResult;
      strategy: CropStrategy;
      candidatesTried: CropPosition[];
    }
  | {
      status: 'composition-lost';
      strategy: CropStrategy;
      candidatesTried: CropPosition[];
      bands: BlankBand[];
      reason: string;
      sourceWidth: number;
      sourceHeight: number;
    };

/**
 * Cover-crops to the channel target and structurally validates the result.
 * Returns `composition-lost` when no candidate anchor yields a continuous
 * creative, so the caller can leave the current asset in place.
 */
export async function adaptImageToChannelFormat(input: {
  bytes: Buffer;
  sourceMime?: string;
  targetWidth: number;
  targetHeight: number;
  strategy: CropStrategy;
}): Promise<ChannelAdaptationOutcome> {
  const { bytes, sourceMime, targetWidth, targetHeight, strategy } = input;
  const source = await readImageDimensions(bytes);
  const candidates = cropCandidates(strategy, source, {
    width: targetWidth,
    height: targetHeight
  });

  const tried: CropPosition[] = [];
  let firstBands: BlankBand[] = [];

  for (const cropPosition of candidates) {
    tried.push(cropPosition);
    const result = await adaptImageToTarget({
      bytes,
      sourceMime,
      targetWidth,
      targetHeight,
      cropPosition
    });
    if (!result.bytes?.length) {
      throw new Error('adaptImageToChannelFormat: adaptation produced empty image bytes');
    }

    const scan = await scanInteriorBlankBands(result.bytes);
    if (scan.bands.length === 0) {
      return { status: 'adapted', result, strategy, candidatesTried: tried };
    }
    if (!firstBands.length) firstBands = scan.bands;
  }

  return {
    status: 'composition-lost',
    strategy,
    candidatesTried: tried,
    bands: firstBands,
    reason: `blank band splits the adapted creative (${describeBlankBands(firstBands)})`,
    sourceWidth: source.width,
    sourceHeight: source.height
  };
}
