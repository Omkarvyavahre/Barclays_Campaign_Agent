/**
 * Session-scoped generated image registry.
 *
 * Files may be written under `.generated/` for persistence during a run,
 * but historical files are NEVER auto-loaded into the Asset Library.
 * Only ids registered in this process can be served.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { randomUUID } from 'node:crypto';

export type GeneratedImageFileExtension = '.jpg' | '.png' | '.webp' | '.gif';

export type DetectedImageFormat = {
  mimeType: string;
  fileExtension: GeneratedImageFileExtension;
};

export type GeneratedImageRecord = {
  id: string;
  absolutePath: string;
  /** Absolute disk path — same as absolutePath (alias for callers expecting filePath). */
  filePath: string;
  mimeType: string;
  fileExtension: GeneratedImageFileExtension;
  createdAt: number;
};

const registry = new Map<string, GeneratedImageRecord>();

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function getDefaultGeneratedDir(): string {
  return resolve(process.cwd(), '.generated');
}

/**
 * Detect image format from magic bytes (authoritative when recognizable).
 */
export function detectImageFormatFromBytes(bytes: Buffer): DetectedImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: 'image/jpeg', fileExtension: '.jpg' };
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_MAGIC)) {
    return { mimeType: 'image/png', fileExtension: '.png' };
  }
  // Optional Firefly-safe formats already used elsewhere — preserve support.
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mimeType: 'image/webp', fileExtension: '.webp' };
  }
  if (bytes.length >= 6) {
    const head = bytes.subarray(0, 6).toString('ascii');
    if (head === 'GIF87a' || head === 'GIF89a') {
      return { mimeType: 'image/gif', fileExtension: '.gif' };
    }
  }
  return null;
}

/**
 * Normalize a Content-Type header into a known image MIME when trustworthy.
 */
export function parseTrustworthyImageContentType(
  contentType: string | null | undefined
): DetectedImageFormat | null {
  if (!contentType) return null;
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (mime === 'image/jpeg' || mime === 'image/jpg') {
    return { mimeType: 'image/jpeg', fileExtension: '.jpg' };
  }
  if (mime === 'image/png') {
    return { mimeType: 'image/png', fileExtension: '.png' };
  }
  if (mime === 'image/webp') {
    return { mimeType: 'image/webp', fileExtension: '.webp' };
  }
  if (mime === 'image/gif') {
    return { mimeType: 'image/gif', fileExtension: '.gif' };
  }
  return null;
}

/**
 * Resolve format: magic bytes win when present; otherwise use trustworthy Content-Type.
 */
export function resolveImageFormat(options: {
  bytes: Buffer;
  contentTypeHint?: string | null;
}): DetectedImageFormat {
  const fromBytes = detectImageFormatFromBytes(options.bytes);
  if (fromBytes) return fromBytes;

  const fromHeader = parseTrustworthyImageContentType(options.contentTypeHint);
  if (fromHeader) return fromHeader;

  throw new Error(
    'Unable to determine generated image MIME type from magic bytes or Content-Type'
  );
}

export function registerGeneratedImage(
  id: string,
  absolutePath: string,
  mimeType: string,
  fileExtension?: GeneratedImageFileExtension
): GeneratedImageRecord {
  const fromPath = extname(absolutePath).toLowerCase();
  const ext = (fileExtension ??
    (fromPath === '.jpg' || fromPath === '.jpeg' || fromPath === '.png' || fromPath === '.webp' || fromPath === '.gif'
      ? fromPath === '.jpeg'
        ? '.jpg'
        : fromPath
      : '.png')) as GeneratedImageFileExtension;
  const record: GeneratedImageRecord = {
    id,
    absolutePath,
    filePath: absolutePath,
    mimeType,
    fileExtension: ext,
    createdAt: Date.now()
  };
  registry.set(id, record);
  return record;
}

export function getRegisteredGeneratedImage(id: string): GeneratedImageRecord | undefined {
  return registry.get(id);
}

export function listRegisteredGeneratedIds(): string[] {
  return [...registry.keys()];
}

/** Test helper — clears in-memory registry only (does not delete disk files). */
export function clearGeneratedImageRegistry(): void {
  registry.clear();
}

export function persistGeneratedImageBytes(options: {
  bytes: Buffer;
  /** Optional HTTP Content-Type hint — ignored when magic bytes identify the format. */
  contentTypeHint?: string | null;
  /**
   * @deprecated Prefer contentTypeHint + magic-byte detection.
   * Explicit mimeType is only used when bytes cannot be detected and hint is absent.
   */
  mimeType?: string;
  generatedDir?: string;
  id?: string;
}): GeneratedImageRecord & { publicUrl: string } {
  const id = options.id ?? `ff-${randomUUID().replace(/-/g, '').slice(0, 16)}`;

  let format: DetectedImageFormat;
  try {
    format = resolveImageFormat({
      bytes: options.bytes,
      contentTypeHint: options.contentTypeHint ?? options.mimeType
    });
  } catch {
    // Last-resort for callers that still pass an explicit mime without recognizable bytes
    // (e.g. non-image fixtures). Prefer never guessing PNG for Firefly downloads.
    const fallback = parseTrustworthyImageContentType(options.mimeType);
    if (!fallback) {
      throw new Error(
        'Unable to determine generated image MIME type from magic bytes or Content-Type'
      );
    }
    format = fallback;
  }

  const dir = options.generatedDir ?? getDefaultGeneratedDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const absolutePath = join(dir, `${id}${format.fileExtension}`);
  writeFileSync(absolutePath, options.bytes);
  const record = registerGeneratedImage(id, absolutePath, format.mimeType, format.fileExtension);
  return {
    ...record,
    publicUrl: `/api/ai/generated/${id}`
  };
}

export function readRegisteredGeneratedBytes(id: string): { bytes: Buffer; mimeType: string } | null {
  const record = registry.get(id);
  if (!record || !existsSync(record.absolutePath)) return null;
  return {
    bytes: readFileSync(record.absolutePath),
    mimeType: record.mimeType
  };
}

/**
 * Intentionally does NOT scan `.generated/` for orphan files.
 * Historical development images must not enter the Asset Library automatically.
 */
export function loadHistoricalGeneratedImages(): never {
  throw new Error('Historical .generated images must not be auto-loaded');
}
