/**
 * These are the only checks that may gate promotion, so each one is pinned.
 *
 * The point of the suite is that a candidate has to be genuinely well-formed —
 * decodable, correctly typed, correctly sized, retrievable — before anything is
 * allowed to display it in place of a human-approved background.
 */

import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { assertPromotableCandidate } from './candidate.ts';
import { ImageServiceError } from './errors.ts';
import { loadReference } from './references.ts';
import { generatedDirectory, readPngSize, saveGeneratedImage } from './storage.ts';
import type { GeneratedImageAsset } from './types.ts';

const WIDESCREEN = { width: 2688, height: 1536 };
const PNG = loadReference(1).bytes;
const created: string[] = [];

/** A minimal JPEG carrying real start-of-frame dimensions. */
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

function save(bytes: Buffer, channel: 'linkedin' | 'email' = 'linkedin'): GeneratedImageAsset {
  const asset = saveGeneratedImage(bytes, { channel, requestedSize: WIDESCREEN });
  created.push(asset.id);
  return asset;
}

/** The internal detail, which stays server-side and never reaches the browser. */
function reasonFor(run: () => void): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ImageServiceError);
    expect((error as ImageServiceError).category).toBe('invalid_response');
    expect((error as ImageServiceError).toSafePayload().error.message).not.toContain('rejected:');
    return (error as ImageServiceError).internalDetail ?? '';
  }
  return expect.unreachable('should have thrown');
}

afterEach(() => {
  for (const id of created.splice(0)) {
    for (const extension of ['png', 'jpg']) {
      const path = join(generatedDirectory(), `${id}.${extension}`);
      if (existsSync(path)) unlinkSync(path);
    }
  }
});

describe('a well-formed candidate passes', () => {
  it('accepts a stored JPEG at the requested size', () => {
    const asset = save(jpegBytes(2688, 1536));
    expect(() => assertPromotableCandidate(asset, WIDESCREEN, 'linkedin')).not.toThrow();
  });

  it('accepts a stored PNG at its own measured size', () => {
    const asset = save(PNG);
    const size = readPngSize(PNG);
    expect(size).toBeDefined();
    expect(() => assertPromotableCandidate(asset, size!, 'linkedin')).not.toThrow();
  });
});

describe('18. dimensions must be the ones requested', () => {
  it('rejects an image of the wrong size', () => {
    const asset = save(jpegBytes(1200, 627));
    expect(reasonFor(() => assertPromotableCandidate(asset, WIDESCREEN, 'linkedin'))).toContain('unexpected dimensions');
  });

  it('rejects a descriptor whose dimensions are not the measured ones', () => {
    const asset = save(jpegBytes(2688, 1536));
    const lying = { ...asset, width: 1200 };
    expect(reasonFor(() => assertPromotableCandidate(lying, WIDESCREEN, 'linkedin'))).toContain(
      'reported dimensions are not the measured ones',
    );
  });
});

describe('19. the format must be supported and consistent', () => {
  it('rejects a payload that is not an image at all before it is ever stored', () => {
    try {
      saveGeneratedImage(Buffer.from('<html>error</html>'), { channel: 'linkedin', requestedSize: WIDESCREEN });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ImageServiceError).category).toBe('invalid_response');
    }
  });

  it('stores the extension and content type the decoded bytes call for', () => {
    const asset = save(jpegBytes(2688, 1536));
    expect(existsSync(join(generatedDirectory(), `${asset.id}.jpg`))).toBe(true);
    expect(existsSync(join(generatedDirectory(), `${asset.id}.png`))).toBe(false);
    expect(() => assertPromotableCandidate(asset, WIDESCREEN, 'linkedin')).not.toThrow();
  });
});

describe('17. a candidate that cannot be resolved is rejected', () => {
  it('rejects an id with no stored file', () => {
    const asset: GeneratedImageAsset = {
      id: 'linkedin-00000000-0000-4000-8000-000000000000',
      url: '/api/images/asset/linkedin-00000000-0000-4000-8000-000000000000',
      channel: 'linkedin',
      width: 2688,
      height: 1536,
      bytes: 10,
    };

    try {
      assertPromotableCandidate(asset, WIDESCREEN, 'linkedin');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ImageServiceError).category).toBe('storage_error');
    }
  });

  it.each([
    ['channel mismatch', (asset: GeneratedImageAsset) => ({ ...asset, channel: 'email' as const })],
    ['malformed asset id', (asset: GeneratedImageAsset) => ({ ...asset, id: 'linkedin-nope' })],
    ['asset url does not address', (asset: GeneratedImageAsset) => ({ ...asset, url: '/api/images/asset/other' })],
    ['empty file', (asset: GeneratedImageAsset) => ({ ...asset, bytes: 0 })],
    ['stored size does not match', (asset: GeneratedImageAsset) => ({ ...asset, bytes: asset.bytes + 1 })],
  ])('rejects %s', (reason, tamper) => {
    const asset = save(jpegBytes(2688, 1536));
    expect(reasonFor(() => assertPromotableCandidate(tamper(asset), WIDESCREEN, 'linkedin'))).toContain(reason);
  });
});

describe('23. each candidate is addressed by its own id', () => {
  it('never reuses a stored file for a second candidate', () => {
    const first = save(jpegBytes(2688, 1536));
    const second = save(jpegBytes(2688, 1536));

    expect(first.id).not.toBe(second.id);
    expect(existsSync(join(generatedDirectory(), `${first.id}.jpg`))).toBe(true);
    expect(existsSync(join(generatedDirectory(), `${second.id}.jpg`))).toBe(true);
  });
});
