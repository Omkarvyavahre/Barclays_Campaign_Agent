/**
 * Local storage for generated images.
 *
 * Generated output is written to `.generated/firefly/`, which is gitignored and
 * sits outside tracked source. It is deliberately separate from the approved
 * reference inputs in `server/assets/firefly-references/`: inputs are read-only
 * and curated, outputs are disposable.
 *
 * The browser only ever receives an app-relative URL containing an opaque id.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { APPROVED_ASSETS } from './approved.ts';
import { ImageServiceError } from './errors.ts';
import type { GeneratedImageAsset, ImageChannel, ImageSize } from './types.ts';

const GENERATED_DIRECTORY = fileURLToPath(new URL('../../.generated/firefly/', import.meta.url));

export const ASSET_URL_PREFIX = '/api/images/asset/';
export const ASSET_ID_PATTERN = /^[a-z]+-[0-9a-f-]{36}$/;

/** Server-side only. Exposed for tests and never returned over HTTP. */
export function generatedDirectory(): string {
  return GENERATED_DIRECTORY;
}

/**
 * Firefly currently returns JPEG, but the contract only promises "an image", so
 * the format is detected from the payload rather than assumed. The stored
 * extension and the served content type both follow what actually arrived.
 */
export type ImageFormat = 'png' | 'jpeg';

export const CONTENT_TYPES: Record<ImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
};

export const ASSET_EXTENSIONS: Record<ImageFormat, string> = { png: 'png', jpeg: 'jpg' };

export function detectImageFormat(bytes: Buffer): ImageFormat | undefined {
  if (bytes.length > 8 && bytes.toString('hex', 0, 4) === '89504e47') return 'png';
  if (bytes.length > 3 && bytes.toString('hex', 0, 3) === 'ffd8ff') return 'jpeg';
  return undefined;
}

/** Reads the true dimensions from the PNG IHDR chunk. */
export function readPngSize(bytes: Buffer): ImageSize | undefined {
  if (bytes.length < 24 || bytes.toString('ascii', 12, 16) !== 'IHDR') return undefined;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height) return undefined;
  return { width, height };
}

/** Reads the true dimensions from the first JPEG start-of-frame segment. */
export function readJpegSize(bytes: Buffer): ImageSize | undefined {
  let offset = 2;

  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1];
    // Start-of-frame markers carry the frame dimensions; C4, C8 and CC do not.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = bytes.readUInt16BE(offset + 5);
      const width = bytes.readUInt16BE(offset + 7);
      return width && height ? { width, height } : undefined;
    }

    offset += 2 + bytes.readUInt16BE(offset + 2);
  }

  return undefined;
}

export function readImageSize(bytes: Buffer, format: ImageFormat): ImageSize | undefined {
  return format === 'png' ? readPngSize(bytes) : readJpegSize(bytes);
}

export interface SaveOptions {
  channel: ImageChannel;
  /** Requested size, used when the payload carries no readable dimensions. */
  requestedSize: ImageSize;
}

export function saveGeneratedImage(bytes: Buffer, options: SaveOptions): GeneratedImageAsset {
  const format = detectImageFormat(bytes);
  if (!format) throw new ImageServiceError('invalid_response', 'generated payload was not a PNG or JPEG image');

  const id = `${options.channel}-${randomUUID()}`;
  const size = readImageSize(bytes, format) ?? options.requestedSize;

  try {
    mkdirSync(GENERATED_DIRECTORY, { recursive: true });
    writeFileSync(join(GENERATED_DIRECTORY, `${id}.${ASSET_EXTENSIONS[format]}`), bytes);
  } catch (error) {
    throw new ImageServiceError('storage_error', error instanceof Error ? error.message : 'write failed');
  }

  return {
    id,
    url: `${ASSET_URL_PREFIX}${id}`,
    channel: options.channel,
    width: size.width,
    height: size.height,
    bytes: bytes.length,
  };
}

/**
 * Describes a stored asset from its bytes, or null when it cannot be read.
 *
 * Only the opaque id, the app-relative URL and the measured dimensions leave
 * here; the filename and directory stay server-side.
 */
function describeStoredAsset(channel: ImageChannel, id: string): GeneratedImageAsset | null {
  if (!ASSET_ID_PATTERN.test(id) || !id.startsWith(`${channel}-`) || basename(id) !== id) return null;

  try {
    const bytes = readGeneratedImage(id).bytes;
    const format = detectImageFormat(bytes);
    if (!format) return null;
    const size = readImageSize(bytes, format);
    if (!size) return null;

    return {
      id,
      url: `${ASSET_URL_PREFIX}${id}`,
      channel,
      width: size.width,
      height: size.height,
      bytes: bytes.length,
    };
  } catch {
    return null;
  }
}

/** The most recently stored image for a channel, or null when none exists. */
export function latestGeneratedAsset(channel: ImageChannel): GeneratedImageAsset | null {
  if (!existsSync(GENERATED_DIRECTORY)) return null;

  const suffixes = Object.values(ASSET_EXTENSIONS).map((extension) => `.${extension}`);
  let newest: { id: string; modified: number } | undefined;

  for (const entry of readdirSync(GENERATED_DIRECTORY)) {
    const suffix = suffixes.find((candidate) => entry.endsWith(candidate));
    if (!suffix) continue;

    const id = entry.slice(0, -suffix.length);
    if (!ASSET_ID_PATTERN.test(id) || !id.startsWith(`${channel}-`)) continue;

    const modified = statSync(join(GENERATED_DIRECTORY, entry)).mtimeMs;
    if (!newest || modified > newest.modified) newest = { id, modified };
  }

  return newest ? describeStoredAsset(channel, newest.id) : null;
}

/**
 * The background Stage 7 should compose against for a channel.
 *
 * The approved pin wins, so generating again never promotes an unreviewed asset
 * over a signed-off one. Only a channel with no pin at all falls back to the
 * most recent stored image. Either way this costs no generation call.
 */
export function currentChannelAsset(
  channel: ImageChannel,
  approved: string | null = APPROVED_ASSETS[channel],
): GeneratedImageAsset | null {
  return approved ? describeStoredAsset(channel, approved) : latestGeneratedAsset(channel);
}

/**
 * The extension the stored file actually carries, or null when there is none.
 *
 * Used to prove the extension on disk agrees with the decoded format. The path
 * itself never leaves this module.
 */
export function storedAssetExtension(id: string): string | null {
  if (!ASSET_ID_PATTERN.test(id) || basename(id) !== id) return null;

  for (const extension of Object.values(ASSET_EXTENSIONS)) {
    if (existsSync(join(GENERATED_DIRECTORY, `${id}.${extension}`))) return extension;
  }
  return null;
}

/**
 * Deletes a stored asset. Used to discard a candidate that failed validation,
 * so a rejected image cannot linger and be picked up later.
 */
export function removeGeneratedImage(id: string): void {
  if (!ASSET_ID_PATTERN.test(id) || basename(id) !== id) return;

  for (const extension of Object.values(ASSET_EXTENSIONS)) {
    const path = join(GENERATED_DIRECTORY, `${id}.${extension}`);
    try {
      if (existsSync(path)) rmSync(path);
    } catch {
      // A file we cannot remove is not worth failing a request over.
    }
  }
}

export interface StoredImage {
  bytes: Buffer;
  contentType: string;
}

/**
 * Resolves an id to stored bytes.
 *
 * The id is pattern-checked and then the resolved path is confirmed to still be
 * inside the generated directory, so no id can escape it however it is encoded.
 * The content type comes from the stored bytes, not from the extension.
 */
export function readGeneratedImage(id: string): StoredImage {
  if (!ASSET_ID_PATTERN.test(id) || basename(id) !== id) {
    throw new ImageServiceError('bad_request', 'invalid generated asset id');
  }

  const root = resolve(GENERATED_DIRECTORY);
  const candidates = Object.values(ASSET_EXTENSIONS).map((extension) => resolve(root, `${id}.${extension}`));
  if (candidates.some((path) => !path.startsWith(root))) {
    throw new ImageServiceError('bad_request', 'generated asset id escaped the storage directory');
  }

  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) throw new ImageServiceError('storage_error', 'generated asset not found');

  try {
    const bytes = readFileSync(path);
    const format = detectImageFormat(bytes);
    if (!format) throw new ImageServiceError('storage_error', 'stored asset was not a readable image');
    return { bytes, contentType: CONTENT_TYPES[format] };
  } catch (error) {
    if (error instanceof ImageServiceError) throw error;
    throw new ImageServiceError('storage_error', error instanceof Error ? error.message : 'read failed');
  }
}
