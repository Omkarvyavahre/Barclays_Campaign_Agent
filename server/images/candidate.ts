/**
 * Objective validation of a freshly generated candidate.
 *
 * A candidate may only replace an approved background if every check here is
 * something the application can actually verify: the provider returned bytes,
 * those bytes decode, the format is supported, the MIME type and the extension
 * on disk both follow the decoded format, the measured dimensions are the ones
 * requested, the file is non-empty, and the safe asset endpoint can resolve it
 * again.
 *
 * Nothing here judges what the image looks like. Pseudo-text, logo-like shapes
 * and composition quality are not machine-checkable without a visual classifier,
 * and there is none in this codebase, which is exactly why a human-approved
 * asset stays pinned in `approved.ts` as the fallback.
 */

import { ImageServiceError } from './errors.ts';
import {
  ASSET_EXTENSIONS,
  ASSET_ID_PATTERN,
  ASSET_URL_PREFIX,
  CONTENT_TYPES,
  detectImageFormat,
  readGeneratedImage,
  readImageSize,
  storedAssetExtension,
} from './storage.ts';
import type { GeneratedImageAsset, ImageChannel, ImageSize } from './types.ts';

function reject(reason: string): never {
  throw new ImageServiceError('invalid_response', `generated candidate rejected: ${reason}`);
}

/**
 * Throws unless the stored candidate passes every objective check.
 *
 * Rejection leaves the caller's existing background in place; it never falls
 * back to a different generated image.
 */
export function assertPromotableCandidate(
  asset: GeneratedImageAsset,
  expected: ImageSize,
  channel: ImageChannel,
): void {
  if (asset.channel !== channel) reject('channel mismatch');
  if (!ASSET_ID_PATTERN.test(asset.id) || !asset.id.startsWith(`${channel}-`)) reject('malformed asset id');
  if (asset.url !== `${ASSET_URL_PREFIX}${asset.id}`) reject('asset url does not address the asset id');
  if (asset.bytes <= 0) reject('empty file');

  // Resolving through the same reader the asset endpoint uses proves the file is
  // both present and inside the generated directory.
  const stored = readGeneratedImage(asset.id);
  if (stored.bytes.length === 0) reject('empty file');
  if (stored.bytes.length !== asset.bytes) reject('stored size does not match the reported size');

  const format = detectImageFormat(stored.bytes);
  if (!format) reject('unsupported image format');
  if (stored.contentType !== CONTENT_TYPES[format]) reject('content type does not match the decoded format');
  if (storedAssetExtension(asset.id) !== ASSET_EXTENSIONS[format]) reject('extension does not match the decoded format');

  const size = readImageSize(stored.bytes, format);
  if (!size) reject('dimensions could not be read');
  if (size.width !== expected.width || size.height !== expected.height) reject('unexpected dimensions');
  if (asset.width !== size.width || asset.height !== size.height) reject('reported dimensions are not the measured ones');
}
