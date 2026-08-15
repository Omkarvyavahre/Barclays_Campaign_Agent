/**
 * @vitest-environment node
 *
 * Generated-image MIME / extension persistence — mocked only.
 * No live Gemini or Firefly generation calls.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  clearGeneratedImageRegistry,
  detectImageFormatFromBytes,
  getRegisteredGeneratedImage,
  listRegisteredGeneratedIds,
  persistGeneratedImageBytes,
  resolveImageFormat
} from './storage';
import { handleGeneratedImageRequest } from '../http/generatedImageRoute';
import { modifyAsset } from '../modify/modifyAsset';
import type { GeminiJsonClient } from '../gemini/types';
import type { FireflyClient } from './types';

const TINY_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
]);

/** Minimal JPEG (1x1) — starts with FF D8 FF */
const TINY_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
  0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
  0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
  0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0xff, 0xc4, 0x00, 0x14,
  0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x7f, 0xff, 0xd9
]);

describe('detectImageFormatFromBytes', () => {
  it('detects JPEG bytes as image/jpeg with .jpg', () => {
    expect(detectImageFormatFromBytes(TINY_JPEG)).toEqual({
      mimeType: 'image/jpeg',
      fileExtension: '.jpg'
    });
  });

  it('detects PNG bytes as image/png with .png', () => {
    expect(detectImageFormatFromBytes(TINY_PNG)).toEqual({
      mimeType: 'image/png',
      fileExtension: '.png'
    });
  });

  it('prefers magic bytes over a conflicting Content-Type hint', () => {
    expect(
      resolveImageFormat({ bytes: TINY_JPEG, contentTypeHint: 'image/png' })
    ).toEqual({ mimeType: 'image/jpeg', fileExtension: '.jpg' });
    expect(
      resolveImageFormat({ bytes: TINY_PNG, contentTypeHint: 'image/jpeg' })
    ).toEqual({ mimeType: 'image/png', fileExtension: '.png' });
  });
});

describe('persistGeneratedImageBytes MIME / extension', () => {
  let tempDir: string;

  afterEach(() => {
    clearGeneratedImageRegistry();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists JPEG bytes as .jpg with image/jpeg registry metadata', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ff-mime-jpg-'));
    const persisted = persistGeneratedImageBytes({
      bytes: TINY_JPEG,
      contentTypeHint: 'image/jpeg',
      generatedDir: tempDir,
      id: 'ff-jpeg-test'
    });

    expect(persisted.mimeType).toBe('image/jpeg');
    expect(persisted.fileExtension).toBe('.jpg');
    expect(persisted.absolutePath.replace(/\\/g, '/')).toMatch(/ff-jpeg-test\.jpg$/);
    expect(persisted.filePath).toBe(persisted.absolutePath);
    expect(existsSync(join(tempDir, 'ff-jpeg-test.jpg'))).toBe(true);
    expect(existsSync(join(tempDir, 'ff-jpeg-test.png'))).toBe(false);
    expect(readFileSync(join(tempDir, 'ff-jpeg-test.jpg')).subarray(0, 3)).toEqual(
      Buffer.from([0xff, 0xd8, 0xff])
    );

    const record = getRegisteredGeneratedImage('ff-jpeg-test');
    expect(record?.mimeType).toBe('image/jpeg');
    expect(record?.fileExtension).toBe('.jpg');
  });

  it('persists PNG bytes as .png with image/png registry metadata', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ff-mime-png-'));
    const persisted = persistGeneratedImageBytes({
      bytes: TINY_PNG,
      generatedDir: tempDir,
      id: 'ff-png-test'
    });

    expect(persisted.mimeType).toBe('image/png');
    expect(persisted.fileExtension).toBe('.png');
    expect(existsSync(join(tempDir, 'ff-png-test.png'))).toBe(true);
    expect(existsSync(join(tempDir, 'ff-png-test.jpg'))).toBe(false);
  });

  it('never persists JPEG under .png even if caller passes mimeType image/png', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ff-mime-conflict-'));
    const persisted = persistGeneratedImageBytes({
      bytes: TINY_JPEG,
      mimeType: 'image/png',
      generatedDir: tempDir,
      id: 'ff-conflict'
    });
    expect(persisted.fileExtension).toBe('.jpg');
    expect(persisted.mimeType).toBe('image/jpeg');
    expect(existsSync(join(tempDir, 'ff-conflict.png'))).toBe(false);
    expect(existsSync(join(tempDir, 'ff-conflict.jpg'))).toBe(true);
  });

  it('never persists PNG under .jpg even if caller passes mimeType image/jpeg', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ff-mime-png-conflict-'));
    const persisted = persistGeneratedImageBytes({
      bytes: TINY_PNG,
      mimeType: 'image/jpeg',
      generatedDir: tempDir,
      id: 'ff-png-conflict'
    });
    expect(persisted.fileExtension).toBe('.png');
    expect(persisted.mimeType).toBe('image/png');
    expect(existsSync(join(tempDir, 'ff-png-conflict.jpg'))).toBe(false);
  });
});

describe('GET /api/ai/generated/:id Content-Type', () => {
  let tempDir: string;

  afterEach(() => {
    clearGeneratedImageRegistry();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  function mockReqRes(url: string, method = 'GET') {
    const headers: Record<string, string | number | string[]> = {};
    let body: Buffer | string = '';
    const req = {
      method,
      url
    } as IncomingMessage;
    const res = {
      statusCode: 0,
      setHeader(name: string, value: string | number | readonly string[]) {
        headers[name.toLowerCase()] = value as string;
      },
      end(chunk?: unknown) {
        if (chunk != null) body = chunk as Buffer | string;
      }
    } as unknown as ServerResponse;
    return { req, res, headers, getBody: () => body };
  }

  it('returns Content-Type image/jpeg for JPEG registry entries', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ff-serve-jpg-'));
    persistGeneratedImageBytes({
      bytes: TINY_JPEG,
      generatedDir: tempDir,
      id: 'ff-serve-jpg'
    });
    const { req, res, headers } = mockReqRes('/api/ai/generated/ff-serve-jpg');
    await handleGeneratedImageRequest(req, res);
    expect(res.statusCode).toBe(200);
    expect(headers['content-type']).toBe('image/jpeg');
  });

  it('returns Content-Type image/png for PNG registry entries', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ff-serve-png-'));
    persistGeneratedImageBytes({
      bytes: TINY_PNG,
      generatedDir: tempDir,
      id: 'ff-serve-png'
    });
    const { req, res, headers } = mockReqRes('/api/ai/generated/ff-serve-png');
    await handleGeneratedImageRequest(req, res);
    expect(res.statusCode).toBe(200);
    expect(headers['content-type']).toBe('image/png');
  });
});

describe('derivative imageUrl still works with correct MIME persistence', () => {
  let tempDir: string;

  afterEach(() => {
    clearGeneratedImageRegistry();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('derived asset imageUrl points at session id and Asset Library / Channel Outputs stay stable', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ff-der-mime-'));
    const gemini: GeminiJsonClient = {
      generateJson: async () => ({
        text: JSON.stringify({
          requestedChange: 'Darken the background and simplify cyan ribbons.',
          visualFamily: 'abstract-digital',
          composition: 'Simplified flowing composition.',
          negativeSpace: 'left',
          tone: ['premium'],
          preserve: ['approved visual identity'],
          avoid: ['generated logos or simulated Barclays marks'],
          accessibility: ['maintain contrast']
        })
      })
    };
    const firefly: FireflyClient = {
      generateImage: async () => {
        const persisted = persistGeneratedImageBytes({
          bytes: TINY_JPEG,
          generatedDir: tempDir,
          id: 'ff-der-jpeg'
        });
        return {
          images: [{ id: persisted.id, imageUrl: persisted.publicUrl }],
          jobTelemetry: {
            initialResponseStatus: 202,
            statusUrlUsed: true,
            pollCount: 1,
            statusTransitions: ['succeeded'],
            finalJobStatus: 'succeeded',
            generatedImageAvailable: true
          }
        };
      }
    };

    const result = await modifyAsset(
      {
        mode: 'modify',
        campaignBrief: { product: 'iPortal' },
        asset: {
          id: 'DAM-IPORTAL-LN-001',
          lineage: 'Adobe DAM · DAM-IPORTAL-LN-001',
          channel: 'LinkedIn'
        },
        modification: {
          title: 'Discover what is possible with iPortal',
          description: 'Discover a simpler way to manage your digital banking with iPortal.',
          cta: 'Discover iPortal',
          prompt: 'Make the background darker.'
        },
        campaignContext: {
          businessDomain: 'corporate',
          campaignType: 'iPortal',
          channel: 'LinkedIn'
        },
        sourceDamAsset: {
          id: 'DAM-IPORTAL-LN-001',
          mimeType: 'image/png',
          imageBase64:
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
        },
        regenerate: true,
        generationPrompt: 'Create a new premium corporate visual.',
        existingSpecification: {
          businessDomain: 'corporate',
          campaignType: 'iPortal',
          channel: 'LinkedIn',
          content: {
            title: 'Discover what is possible with iPortal',
            description: 'Discover a simpler way to manage your digital banking with iPortal.',
            cta: 'Discover iPortal'
          },
          requestedChange: 'Create a new premium corporate visual.',
          visualFamily: 'abstract-digital',
          composition: 'Simplified flowing composition.',
          negativeSpace: 'left',
          tone: ['premium'],
          preserve: ['approved visual identity'],
          avoid: ['generated logos'],
          accessibility: ['maintain contrast'],
          sourceAsset: { id: 'DAM-IPORTAL-LN-001' }
        }
      },
      { gemini, firefly }
    );

    expect(result.derivedAsset!.imageUrl).toBe('/api/ai/generated/ff-der-jpeg');
    expect(getRegisteredGeneratedImage('ff-der-jpeg')?.mimeType).toBe('image/jpeg');
    expect(getRegisteredGeneratedImage('ff-der-jpeg')?.fileExtension).toBe('.jpg');
    expect(listRegisteredGeneratedIds()).toEqual(['ff-der-jpeg']);
    // Asset Library / Channel Outputs unchanged: still one derivative URL, no historical scan.
    expect(result.derivedAsset!.sourceId).toBe('DAM-IPORTAL-LN-001');
  });
});