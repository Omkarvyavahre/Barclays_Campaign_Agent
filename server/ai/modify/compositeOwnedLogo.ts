/**
 * Deterministic post-generation composition of an owned Barclays logo.
 *
 * Firefly never receives logo bytes. This runs only after a clean base image exists.
 */

import { existsSync, readFileSync } from 'node:fs';
import sharp from 'sharp';
import { listLogoAssets, resolveVisualAbsolutePath } from '../../knowledge/visualReferences';

export const DEFAULT_OWNED_LOGO_ENTRY_ID = 'vis-logo-png';

/** Logo width as a fraction of final canvas width. */
export const LOGO_MAX_WIDTH_FRACTION = 0.22;

/** Margin from edges as a fraction of the shorter canvas side. */
export const LOGO_MARGIN_FRACTION = 0.04;

/** Canvases smaller than this are too tight for a safe margin + mark. */
export const MIN_COMPOSITION_CANVAS_PX = 64;

export type LogoCompositionPlacement = 'top-left';

export type LogoCompositionMetadata = {
  applied: boolean;
  entryId?: string;
  sourceFile?: string;
  placement?: LogoCompositionPlacement;
  /** Present when composition was skipped or failed. */
  reason?: string;
};

export type CompositeOwnedLogoInput = {
  imageBytes: Buffer;
  imageMimeType?: string;
  logoEntryId?: string;
  placement?: LogoCompositionPlacement;
};

export type CompositeOwnedLogoResult = {
  bytes: Buffer;
  mimeType: string;
  metadata: LogoCompositionMetadata;
  canvasWidth: number;
  canvasHeight: number;
  logoWidth?: number;
  logoHeight?: number;
  left?: number;
  top?: number;
};

function notApplied(
  imageBytes: Buffer,
  imageMimeType: string | undefined,
  reason: string,
  canvasWidth = 0,
  canvasHeight = 0
): CompositeOwnedLogoResult {
  return {
    bytes: imageBytes,
    mimeType: imageMimeType || 'application/octet-stream',
    metadata: { applied: false, reason },
    canvasWidth,
    canvasHeight
  };
}

/**
 * Resolve an owned logo catalogue entry to absolute path + bytes via KG helpers.
 * Never invents a path outside the resource pack.
 */
export function resolveOwnedLogoBytes(logoEntryId: string = DEFAULT_OWNED_LOGO_ENTRY_ID): {
  entryId: string;
  sourceFile: string;
  mimeType: string;
  absolutePath: string;
  bytes: Buffer;
} | null {
  const entry = listLogoAssets().find((l) => l.id === logoEntryId);
  if (!entry) return null;
  const absolutePath = resolveVisualAbsolutePath(entry);
  if (!existsSync(absolutePath)) return null;
  return {
    entryId: entry.id,
    sourceFile: entry.sourceFile,
    mimeType: entry.mimeType,
    absolutePath,
    bytes: readFileSync(absolutePath)
  };
}

/**
 * Composite the exact owned KG logo onto a generated base image.
 * On any failure returns the original bytes with `metadata.applied = false`.
 */
export async function compositeOwnedLogo(
  input: CompositeOwnedLogoInput
): Promise<CompositeOwnedLogoResult> {
  const placement: LogoCompositionPlacement = input.placement ?? 'top-left';
  const logoEntryId = input.logoEntryId ?? DEFAULT_OWNED_LOGO_ENTRY_ID;
  const imageMimeType = input.imageMimeType;

  let canvasWidth = 0;
  let canvasHeight = 0;
  try {
    const baseMeta = await sharp(input.imageBytes, { failOn: 'none' }).metadata();
    canvasWidth = baseMeta.width ?? 0;
    canvasHeight = baseMeta.height ?? 0;
  } catch {
    return notApplied(input.imageBytes, imageMimeType, 'base-image-unreadable');
  }

  if (
    canvasWidth < MIN_COMPOSITION_CANVAS_PX ||
    canvasHeight < MIN_COMPOSITION_CANVAS_PX
  ) {
    return notApplied(
      input.imageBytes,
      imageMimeType,
      'canvas-too-small',
      canvasWidth,
      canvasHeight
    );
  }

  const logo = resolveOwnedLogoBytes(logoEntryId);
  if (!logo) {
    return notApplied(
      input.imageBytes,
      imageMimeType,
      'logo-unresolved',
      canvasWidth,
      canvasHeight
    );
  }

  try {
    const shorter = Math.min(canvasWidth, canvasHeight);
    const margin = Math.max(1, Math.round(shorter * LOGO_MARGIN_FRACTION));
    const maxLogoWidth = Math.max(1, Math.round(canvasWidth * LOGO_MAX_WIDTH_FRACTION));
    const maxLogoHeight = Math.max(1, canvasHeight - margin * 2);

    const resized = await sharp(logo.bytes, { failOn: 'none' })
      .resize({
        width: maxLogoWidth,
        height: maxLogoHeight,
        fit: 'inside',
        withoutEnlargement: false
      })
      .ensureAlpha()
      .png()
      .toBuffer({ resolveWithObject: true });

    const logoWidth = resized.info.width;
    const logoHeight = resized.info.height;

    if (logoWidth + margin * 2 > canvasWidth || logoHeight + margin * 2 > canvasHeight) {
      return notApplied(
        input.imageBytes,
        imageMimeType,
        'logo-does-not-fit',
        canvasWidth,
        canvasHeight
      );
    }

    const left = margin;
    const top = margin;

    const composed = await sharp(input.imageBytes, { failOn: 'none' })
      .composite([{ input: resized.data, left, top }])
      .png()
      .toBuffer();

    return {
      bytes: composed,
      mimeType: 'image/png',
      metadata: {
        applied: true,
        entryId: logo.entryId,
        sourceFile: logo.sourceFile,
        placement
      },
      canvasWidth,
      canvasHeight,
      logoWidth,
      logoHeight,
      left,
      top
    };
  } catch {
    return notApplied(
      input.imageBytes,
      imageMimeType,
      'composition-failed',
      canvasWidth,
      canvasHeight
    );
  }
}
