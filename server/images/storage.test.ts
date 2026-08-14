/**
 * Generated output must stay out of source control and out of the static asset
 * tree, and an asset id must never be able to address anything else.
 *
 * Promotion is also covered here: since nothing in this codebase can judge a
 * generated image visually, a new generation must never displace the asset a
 * human approved.
 */

import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { APPROVED_ASSETS } from './approved.ts';
import { ImageServiceError } from './errors.ts';
import { loadReference, referenceDirectory } from './references.ts';
import {
  ASSET_ID_PATTERN,
  ASSET_URL_PREFIX,
  currentChannelAsset,
  detectImageFormat,
  generatedDirectory,
  latestGeneratedAsset,
  readGeneratedImage,
  readJpegSize,
  readPngSize,
  saveGeneratedImage,
} from './storage.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PNG = loadReference(2).bytes;
const REQUESTED = { width: 2688, height: 1536 };
const created: string[] = [];

/** A minimal JPEG: SOI, an APP0 segment, a start-of-frame and EOI. */
function jpegBytes(width: number, height: number): Buffer {
  const frame = Buffer.alloc(12);
  frame.writeUInt16BE(0xffc0, 0);
  frame.writeUInt16BE(10, 2);
  frame.writeUInt8(8, 4);
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  frame.writeUInt8(1, 9);
  frame.writeUInt8(1, 10);
  frame.writeUInt8(0x11, 11);

  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  return Buffer.concat([header, frame, Buffer.from([0xff, 0xd9])]);
}

afterEach(() => {
  for (const id of created.splice(0)) {
    for (const extension of ['png', 'jpg']) {
      const path = join(generatedDirectory(), `${id}.${extension}`);
      if (existsSync(path)) unlinkSync(path);
    }
  }
});

function save(bytes: Buffer = PNG) {
  const asset = saveGeneratedImage(bytes, { channel: 'email', requestedSize: REQUESTED });
  created.push(asset.id);
  return asset;
}

describe('generated output location', () => {
  it('writes to .generated/firefly, which git ignores', () => {
    const location = relative(ROOT, generatedDirectory()).replace(/\\/g, '/');
    expect(location).toBe('.generated/firefly');

    const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim());
    expect(gitignore).toContain('.generated/');
  });

  it('is separate from the approved reference inputs', () => {
    expect(generatedDirectory()).not.toBe(referenceDirectory());
    expect(generatedDirectory().includes('firefly-references')).toBe(false);
  });

  it('is not inside src, public, dist or server/assets', () => {
    const location = relative(ROOT, generatedDirectory()).replace(/\\/g, '/');
    for (const tracked of ['src/', 'public/', 'dist/', 'server/assets/']) {
      expect(location.startsWith(tracked)).toBe(false);
    }
  });
});

describe('saving and serving a generated image', () => {
  it('returns an app-relative URL with an opaque id, not a path', () => {
    const asset = save();
    expect(asset.url).toBe(`${ASSET_URL_PREFIX}${asset.id}`);
    expect(asset.url.startsWith('/api/images/asset/')).toBe(true);
    expect(asset.id).not.toContain('/');
    expect(asset.id).not.toContain('\\');
    expect(asset.url).not.toContain('.generated');
    expect(asset.url).not.toMatch(/^[a-z]:/i);
  });

  it('records the real PNG dimensions rather than the requested size', () => {
    const asset = save();
    const actual = readPngSize(PNG);
    expect(actual).toBeDefined();
    expect({ width: asset.width, height: asset.height }).toEqual(actual);
  });

  it('round-trips the bytes through the asset id', () => {
    const asset = save();
    const stored = readGeneratedImage(asset.id);
    expect(stored.contentType).toBe('image/png');
    expect(stored.bytes.equals(PNG)).toBe(true);
  });

  it('gives each save a distinct id', () => {
    expect(save().id).not.toBe(save().id);
  });
});

describe('the stored format follows the bytes that actually arrived', () => {
  it('recognises PNG and JPEG payloads', () => {
    expect(detectImageFormat(PNG)).toBe('png');
    expect(detectImageFormat(jpegBytes(64, 32))).toBe('jpeg');
    expect(detectImageFormat(Buffer.from('GIF89a'))).toBeUndefined();
  });

  it('reads JPEG dimensions from the start-of-frame segment', () => {
    expect(readJpegSize(jpegBytes(2688, 1536))).toEqual({ width: 2688, height: 1536 });
  });

  it('stores a JPEG under .jpg and serves it as image/jpeg', () => {
    const jpeg = jpegBytes(1200, 627);
    const asset = save(jpeg);

    expect(existsSync(join(generatedDirectory(), `${asset.id}.jpg`))).toBe(true);
    expect(existsSync(join(generatedDirectory(), `${asset.id}.png`))).toBe(false);
    expect(asset.url).toBe(`${ASSET_URL_PREFIX}${asset.id}`);

    const stored = readGeneratedImage(asset.id);
    expect(stored.contentType).toBe('image/jpeg');
    expect(stored.bytes.equals(jpeg)).toBe(true);
  });

  it('records measured JPEG dimensions rather than the requested size', () => {
    const asset = save(jpegBytes(1024, 512));
    expect({ width: asset.width, height: asset.height }).toEqual({ width: 1024, height: 512 });
    expect(asset.width).not.toBe(REQUESTED.width);
  });

  it('rejects a payload that is not an image at all', () => {
    try {
      saveGeneratedImage(Buffer.from('<html>error page</html>'), { channel: 'linkedin', requestedSize: REQUESTED });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ImageServiceError);
      expect((error as ImageServiceError).category).toBe('invalid_response');
    }
  });
});

describe('reading back the most recent generated asset', () => {
  it('returns the newest asset for the channel with measured dimensions', () => {
    const jpeg = jpegBytes(2688, 1536);
    const asset = save(jpeg);
    const latest = latestGeneratedAsset('email');

    expect(latest?.id).toBe(asset.id);
    expect(latest?.url).toBe(`${ASSET_URL_PREFIX}${asset.id}`);
    expect(latest).toEqual({ ...asset, width: 2688, height: 1536, bytes: jpeg.length });
  });

  it('never returns another channel’s asset', () => {
    const asset = save();
    expect(latestGeneratedAsset('linkedin')?.id).not.toBe(asset.id);
    expect(latestGeneratedAsset('linkedin')?.id ?? '').not.toContain('email-');
  });

  it('exposes no filesystem path', () => {
    save();
    const latest = latestGeneratedAsset('email');

    expect(latest?.url.startsWith(ASSET_URL_PREFIX)).toBe(true);
    expect(JSON.stringify(latest)).not.toContain('.generated');
    expect(JSON.stringify(latest)).not.toMatch(/[a-z]:\\/i);
  });
});

describe('the approved asset, not merely the newest one', () => {
  it('keeps serving the approved asset after a newer one is generated', () => {
    const approved = save();
    const newer = save(jpegBytes(2688, 1536));

    expect(latestGeneratedAsset('email')?.id).toBe(newer.id);
    expect(currentChannelAsset('email', approved.id)?.id).toBe(approved.id);
  });

  it('resolves to nothing when the approved asset is missing, rather than promoting the newest', () => {
    const newest = save();
    const missing = 'email-00000000-0000-4000-8000-000000000000';

    expect(latestGeneratedAsset('email')?.id).toBe(newest.id);
    expect(currentChannelAsset('email', missing)).toBeNull();
  });

  it('falls back to the newest asset only for a channel with nothing approved', () => {
    const newest = save();
    expect(currentChannelAsset('email', null)?.id).toBe(newest.id);
  });

  it('ignores an approved id belonging to another channel', () => {
    const asset = save();
    expect(currentChannelAsset('linkedin', asset.id)).toBeNull();
  });

  it('cannot be pointed outside the storage directory by a bad pin', () => {
    for (const pin of ['../../../etc/passwd', 'email-../../secret', 'not a valid id']) {
      expect(currentChannelAsset('email', pin)).toBeNull();
    }
  });

  it('pins a well-formed id for every channel it claims to have approved', () => {
    for (const [channel, id] of Object.entries(APPROVED_ASSETS)) {
      if (id === null) continue;
      expect(id).toMatch(ASSET_ID_PATTERN);
      expect(id.startsWith(`${channel}-`)).toBe(true);
    }
  });
});

describe('asset id validation', () => {
  it.each([
    '../../../etc/passwd',
    '..%2f..%2fpackage.json',
    'email-../../secret',
    'not a valid id',
    '',
    'email-short',
  ])('rejects %j', (id) => {
    try {
      readGeneratedImage(id);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ImageServiceError);
      expect((error as ImageServiceError).category).toBe('bad_request');
    }
  });

  it('reports a well-formed but unknown id as storage_error', () => {
    try {
      readGeneratedImage('email-00000000-0000-4000-8000-000000000000');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ImageServiceError).category).toBe('storage_error');
    }
  });
});
