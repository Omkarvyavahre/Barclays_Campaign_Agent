/**
 * @vitest-environment node
 *
 * Strict provider ownership tests. All provider clients are mocked.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { GeminiJsonClient } from '../gemini/types';
import { GeminiImageEditError } from '../gemini/imageEditClient';
import type { FireflyClient } from '../firefly/types';
import {
  clearGeneratedImageRegistry,
  FireflyClientError,
  getRegisteredGeneratedImage,
  persistGeneratedImageBytes
} from '../firefly';
import {
  inferRegenerationVisualFamily,
  modifyAsset,
  ModifyAssetError,
  toPublicModifyAssetResult,
  type ModifyAssetOptions,
  type ModifyAssetRequest
} from '../modify';

// Valid 1×1 PNG (sharp-readable). Used by default Gemini mocks.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const TEST_DIR = mkdtempSync(join(tmpdir(), 'provider-split-'));

/** Left-to-right ramp: tiling, mirroring or duplication would break monotonicity. */
function horizontalRamp(width: number, height: number): Promise<Buffer> {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      const ramp = Math.round((x / (width - 1)) * 255);
      data[i] = ramp;
      data[i + 1] = 40;
      data[i + 2] = 255 - ramp;
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

/** Mirrors the two-panel composition Gemini returned: panels split by a white gutter. */
async function twoPanelWithWhiteGutter(width: number, height: number): Promise<Buffer> {
  const panel = await sharp({
    create: { width: 440, height: 300, channels: 3, background: { r: 10, g: 20, b: 90 } }
  })
    .png()
    .toBuffer();
  const divider = await sharp({
    create: { width: 62, height, channels: 3, background: { r: 255, g: 255, b: 255 } }
  })
    .png()
    .toBuffer();
  return sharp({
    create: { width, height, channels: 3, background: { r: 229, g: 244, b: 251 } }
  })
    .composite([
      { input: panel, left: 30, top: 60 },
      { input: panel, left: 760, top: 60 },
      { input: divider, left: 649, top: 0 }
    ])
    .png()
    .toBuffer();
}

async function middleRowReds(imagePath: string): Promise<number[]> {
  const { data, info } = await sharp(imagePath).raw().toBuffer({ resolveWithObject: true });
  const y = Math.floor(info.height / 2);
  const reds: number[] = [];
  for (let x = 0; x < info.width; x += 1) {
    reds.push(data[(y * info.width + x) * info.channels]!);
  }
  return reds;
}

const SPEC = {
  businessDomain: 'corporate' as const,
  campaignType: 'iPortal',
  channel: 'LinkedIn',
  content: {
    title: 'Discover iPortal',
    description: 'A simpler way to manage digital banking.',
    cta: 'Learn more'
  },
  requestedChange: 'Create a premium corporate banking visual.',
  visualFamily: 'abstract-digital' as const,
  composition: 'Clear premium composition.',
  negativeSpace: 'left' as const,
  tone: ['premium'],
  preserve: ['brand identity'],
  avoid: ['generated logos', 'rendered text'],
  accessibility: ['sufficient contrast'],
  sourceAsset: {
    id: 'DAM-0188',
    sourceId: 'DAM-0188',
    lineage: 'Adobe DAM · DAM-0188'
  }
};

const BASE_REQUEST: ModifyAssetRequest = {
  mode: 'modify',
  campaignBrief: {
    campaignName: 'iPortal Digital Adoption',
    product: 'iPortal'
  },
  asset: {
    id: 'DAM-0188',
    sourceId: 'DAM-0188',
    lineage: 'Adobe DAM · DAM-0188',
    channel: 'LinkedIn',
    format: 'Sponsored content · mobile crop',
    dimensions: '1080 × 1080',
    headline: 'Original title',
    copy: 'Original description',
    cta: 'Original CTA'
  },
  modification: {
    title: 'Discover iPortal',
    description: 'A simpler way to manage digital banking.',
    cta: 'Learn more',
    prompt: 'Remove all text and keep the same composition.'
  },
  campaignContext: {
    businessDomain: 'corporate',
    campaignType: 'iPortal',
    channel: 'LinkedIn'
  },
  sourceDamAsset: {
    id: 'DAM-0188',
    imageUrl: `data:image/png;base64,${PNG.toString('base64')}`,
    mimeType: 'image/png'
  },
  editSourceAssetId: 'DAM-0188',
  rootSourceDamAssetId: 'DAM-0188'
};

function geminiEditor(): GeminiJsonClient & { editImage: ReturnType<typeof vi.fn> } {
  return {
    generateJson: vi.fn(),
    editImage: vi.fn(async () => ({
      bytes: PNG,
      mimeType: 'image/png',
      model: 'mock-gemini-image-edit'
    }))
  };
}

function jsonOnlyGemini(): GeminiJsonClient {
  return { generateJson: vi.fn() };
}

function firefly(): FireflyClient & { generateImage: ReturnType<typeof vi.fn> } {
  return {
    generateImage: vi.fn(async () => {
      const saved = persistGeneratedImageBytes({
        bytes: PNG,
        generatedDir: TEST_DIR
      });
      return {
        images: [{ id: saved.id, imageUrl: saved.publicUrl }],
        jobId: 'FF-TEST'
      };
    })
  };
}

function regenerateRequest(prompt = 'Create a new premium corporate banking visual.'): ModifyAssetRequest {
  return {
    ...BASE_REQUEST,
    regenerate: true,
    inputsChanged: false,
    generationPrompt: prompt,
    existingSpecification: SPEC,
    modification: {
      ...BASE_REQUEST.modification,
      // Proves stale Modify Prompt is not the Firefly generation instruction.
      prompt: 'STALE MODIFY PROMPT — DO NOT REUSE'
    }
  };
}

beforeEach(() => {
  clearGeneratedImageRegistry();
});

describe('Modify in GenStudio — Gemini only', () => {
  it('sends the user modification instruction unchanged as the primary edit command', async () => {
    const gemini = geminiEditor();
    const instruction =
      'Remove all visible text and logos while preserving the existing background, colors, people and composition.';
    await modifyAsset(
      {
        ...BASE_REQUEST,
        modification: { ...BASE_REQUEST.modification, prompt: instruction }
      },
      { gemini, firefly: firefly(), generatedDir: TEST_DIR }
    );
    expect(gemini.editImage.mock.calls[0]![0].instruction).toBe(instruction);
  });

  it('never calls Firefly', async () => {
    const gemini = geminiEditor();
    const adobe = firefly();

    await modifyAsset(BASE_REQUEST, {
      gemini,
      firefly: adobe,
      generatedDir: TEST_DIR
    });

    expect(gemini.editImage).toHaveBeenCalledTimes(1);
    expect(adobe.generateImage).not.toHaveBeenCalled();
  });

  it('passes the current active asset bytes and metadata to Gemini', async () => {
    const gemini = geminiEditor();
    await modifyAsset(BASE_REQUEST, { gemini, firefly: firefly(), generatedDir: TEST_DIR });

    const request = gemini.editImage.mock.calls[0]![0];
    expect(request.image.assetId).toBe('DAM-0188');
    expect(request.image.bytes.equals(PNG)).toBe(true);
    expect(request.instruction).toBe(BASE_REQUEST.modification.prompt);
    expect(request.authoritativeContent).toEqual({
      title: BASE_REQUEST.modification.title,
      description: BASE_REQUEST.modification.description,
      cta: BASE_REQUEST.modification.cta
    });
  });

  it('uses a generated derivative as the next edit source, not root DAM', async () => {
    const current = persistGeneratedImageBytes({
      bytes: PNG,
      generatedDir: TEST_DIR,
      id: 'ff-current'
    });
    const gemini = geminiEditor();
    const result = await modifyAsset(
      {
        ...BASE_REQUEST,
        asset: {
          ...BASE_REQUEST.asset,
          id: 'FF-DER-CURRENT',
          sourceId: 'DAM-0188'
        },
        sourceDamAsset: {
          id: 'FF-DER-CURRENT',
          imageUrl: current.publicUrl,
          mimeType: 'image/png'
        },
        editSourceAssetId: 'FF-DER-CURRENT'
      },
      { gemini, firefly: firefly(), generatedDir: TEST_DIR }
    );

    expect(gemini.editImage.mock.calls[0]![0].image.assetId).toBe('FF-DER-CURRENT');
    expect(result.derivedAsset!.editSourceAssetId).toBe('FF-DER-CURRENT');
    expect(result.derivedAsset!.derivedFromAssetId).toBe('FF-DER-CURRENT');
    expect(result.derivedAsset!.rootSourceDamAssetId).toBe('DAM-0188');
  });

  it('persists a successful Gemini edit and returns a replacement asset', async () => {
    const result = await modifyAsset(BASE_REQUEST, {
      gemini: geminiEditor(),
      firefly: firefly(),
      generatedDir: TEST_DIR
    });

    expect(result.stage).toBe('ready');
    expect(result.intent).toBe('modify_current_asset');
    expect(result.derivedAsset!.id).toMatch(/^GM-DER-/);
    expect(result.derivedAsset!.imageUrl).toMatch(/^\/api\/ai\/generated\/gm-/);
    expect(result.derivedAsset!.generationSource).toBe('gemini-image');
    expect(result.derivedAsset!.headline).toBe(BASE_REQUEST.modification.title);
    expect(result.derivedAsset!.copy).toBe(BASE_REQUEST.modification.description);
    expect(result.derivedAsset!.cta).toBe(BASE_REQUEST.modification.cta);
    expect(result.derivedAsset!.formatAdaptation).toBe('cover-crop');
    expect(result.derivedAsset!.targetDimensions).toBe('1080 × 1080');
    expect(result.derivedAsset!.finalImageDimensions).toBe('1080 × 1080');
    expect(result.derivedAsset!.sourceImageUrl).toMatch(/^\/api\/ai\/generated\/gm-/);
    expect(result.derivedAsset!.sourceImageId).toBeTruthy();
    expect(result.derivedAsset!.imageUrl).not.toBe(result.derivedAsset!.sourceImageUrl);
    expect(result.derivedAsset!.lineage).toMatch(/Gemini image edit/);
    expect(result.derivedAsset!.lineage).toMatch(/channel crop\/format adaptation \(1080 × 1080\)/);
  });

  it('adapts a wide Gemini edit to 1080×1080 while preserving the raw source', async () => {
    const gemini = geminiEditor();
    const adobe = firefly();
    const wide = await horizontalRamp(1360, 768);
    gemini.editImage = vi.fn(async () => ({
      bytes: wide,
      mimeType: 'image/png',
      model: 'mock-gemini-image-edit'
    }));

    const result = await modifyAsset(
      {
        ...BASE_REQUEST,
        existingSpecification: SPEC
      },
      { gemini, firefly: adobe, generatedDir: TEST_DIR }
    );

    expect(gemini.editImage).toHaveBeenCalledTimes(1);
    expect(adobe.generateImage).not.toHaveBeenCalled();
    // SOURCE IMAGE stays the raw provider output; FINAL ASSET is the channel crop.
    expect(result.derivedAsset!.sourceImageDimensions).toBe('1360 × 768');
    expect(result.derivedAsset!.targetDimensions).toBe('1080 × 1080');
    expect(result.derivedAsset!.finalImageDimensions).toBe('1080 × 1080');
    expect(result.derivedAsset!.formatAdaptation).toBe('cover-crop');
    expect(result.derivedAsset!.dimensions).toBe('1080 × 1080');
    expect(result.derivedAsset!.sourceImageId).toBeTruthy();
    expect(result.derivedAsset!.imageUrl).not.toBe(result.derivedAsset!.sourceImageUrl);

    const sourceRecord = getRegisteredGeneratedImage(result.derivedAsset!.sourceImageId!);
    expect(sourceRecord).toBeTruthy();
    const sourceMeta = await sharp(sourceRecord!.absolutePath).metadata();
    expect(sourceMeta.width).toBe(1360);
    expect(sourceMeta.height).toBe(768);

    const finalId = result.derivedAsset!.imageUrl.replace('/api/ai/generated/', '');
    const finalRecord = getRegisteredGeneratedImage(finalId);
    expect(finalRecord).toBeTruthy();
    const finalMeta = await sharp(finalRecord!.absolutePath).metadata();
    expect(finalMeta.width).toBe(1080);
    expect(finalMeta.height).toBe(1080);

    expect(result.provenance.join(' ')).toMatch(/raw Gemini source/);
    expect(result.provenance.join(' ')).toMatch(/channel crop\/format adaptation/);
  });

  it('centre-crops the channel format even when negativeSpace is left', async () => {
    const gemini = geminiEditor();
    const wide = await horizontalRamp(1360, 768);
    gemini.editImage = vi.fn(async () => ({
      bytes: wide,
      mimeType: 'image/png',
      model: 'mock-gemini-image-edit'
    }));

    const result = await modifyAsset(
      { ...BASE_REQUEST, existingSpecification: SPEC },
      { gemini, firefly: firefly(), generatedDir: TEST_DIR }
    );

    expect(SPEC.negativeSpace).toBe('left');
    expect(result.provenance.join(' ')).toMatch(/center anchor via center/);

    const finalId = result.derivedAsset!.imageUrl.replace('/api/ai/generated/', '');
    const finalRecord = getRegisteredGeneratedImage(finalId)!;
    const produced = await sharp(finalRecord.absolutePath).raw().toBuffer();
    const centreReference = await sharp(wide)
      .resize(1080, 1080, { fit: 'cover', position: 'centre' })
      .raw()
      .toBuffer();
    expect(produced.equals(centreReference)).toBe(true);

    // One continuous slice of the ramp — nothing tiled, mirrored or concatenated.
    const reds = await middleRowReds(finalRecord.absolutePath);
    for (let x = 1; x < reds.length; x += 1) {
      expect(reds[x]!).toBeGreaterThanOrEqual(reds[x - 1]!);
    }
  });

  it('leaves the current asset unchanged when the crop cannot preserve the composition', async () => {
    const gemini = geminiEditor();
    const adobe = firefly();
    gemini.editImage = vi.fn(async () => ({
      bytes: await twoPanelWithWhiteGutter(1360, 768),
      mimeType: 'image/png',
      model: 'mock-gemini-image-edit'
    }));

    const result = await modifyAsset(
      { ...BASE_REQUEST, existingSpecification: SPEC },
      { gemini, firefly: adobe, generatedDir: TEST_DIR }
    );

    expect(result.stage).toBe('unsupported');
    expect(result.message).toMatch(
      /Channel format adaptation could not preserve the creative composition/
    );
    expect(result.derivedAsset).toBeUndefined();
    expect(result.provenance.join(' ')).toMatch(/channel crop rejected for 1080 × 1080/);
    expect(result.provenance.join(' ')).toMatch(/crop anchors tried: center, left, right/);
    expect(result.provenance.join(' ')).toMatch(/current asset left unchanged/);
    expect(gemini.editImage).toHaveBeenCalledTimes(1);
    expect(adobe.generateImage).not.toHaveBeenCalled();
    expect(toPublicModifyAssetResult(result).derivedAsset).toBeUndefined();
  });

  it('reports the measured band, threshold and crop strategy behind the concise UI message', async () => {
    const gemini = geminiEditor();
    gemini.editImage = vi.fn(async () => ({
      bytes: await twoPanelWithWhiteGutter(1360, 768),
      mimeType: 'image/png',
      model: 'mock-gemini-image-edit'
    }));
    let rejection: Parameters<
      NonNullable<ModifyAssetOptions['onChannelAdaptationRejected']>
    >[0] | null = null;

    const result = await modifyAsset(
      {
        ...BASE_REQUEST,
        asset: {
          ...BASE_REQUEST.asset,
          id: 'DAM-0231',
          channel: 'Email',
          format: 'HTML email hero',
          dimensions: '1200 × 480'
        }
      },
      {
        gemini,
        firefly: firefly(),
        generatedDir: TEST_DIR,
        onChannelAdaptationRejected: (meta) => {
          rejection = meta;
        }
      }
    );

    expect(result.stage).toBe('unsupported');
    expect(rejection).not.toBeNull();
    expect(rejection!.assetId).toBe('DAM-0231');
    expect(rejection!.channel).toBe('Email');
    expect(rejection!.sourceDimensions).toBe('1360 × 768');
    expect(rejection!.targetDimensions).toBe('1200 × 480');
    expect(rejection!.cropStrategy).toBe('center');
    expect(rejection!.validator).toBe('interior-blank-band');
    expect(rejection!.thresholdBandPixels).toBe(24);
    expect(rejection!.measuredBandPixels).toBeGreaterThan(24);
    // The provider returned the split image; the crop did not create it.
    expect(rejection!.bandPresentInSource).toBe(true);
    expect(result.provenance.join(' ')).toMatch(/already present in the provider output/);
  });

  it('returns an explicit unsupported state when image edit is not available', async () => {
    const adobe = firefly();
    const result = await modifyAsset(BASE_REQUEST, {
      gemini: jsonOnlyGemini(),
      firefly: adobe,
      generatedDir: TEST_DIR
    });

    expect(result.stage).toBe('unsupported');
    expect(result.message).toMatch(/not configured|unavailable|missing GEMINI_IMAGE_MODEL/i);
    expect(result.derivedAsset).toBeUndefined();
    expect(adobe.generateImage).not.toHaveBeenCalled();
  });

  it('classifies an image-edit timeout separately and leaves the current asset unchanged', async () => {
    const gemini = geminiEditor();
    const adobe = firefly();
    gemini.editImage = vi.fn(async () => {
      throw new GeminiImageEditError('Gemini image edit timed out after 120000ms (no HTTP response)', {
        category: 'timeout',
        aborted: true,
        timeoutMs: 120_000,
        elapsedMs: 120_004,
        protocol: 'openai_images_edits',
        model: 'vertex_ai.gemini-2.5-flash-image',
        endpointPath: '/v1/images/edits',
        sourceMimeType: 'image/png',
        sourceByteLength: PNG.length
      });
    });

    const error = (await modifyAsset(BASE_REQUEST, {
      gemini,
      firefly: adobe,
      generatedDir: TEST_DIR
    }).catch((thrown) => thrown)) as ModifyAssetError;

    expect(error).toBeInstanceOf(ModifyAssetError);
    expect(error.message).toBe('Gemini image edit timed out');
    expect(error.statusCode).toBe(504);
    expect(error.stage).toBe('generating');
    expect(error.details?.join(' ')).toMatch(/timeoutMs=120000/);
    expect(error.details?.join(' ')).toMatch(/aborted=true/);
    // Nothing was persisted, so the current asset in the slot stays as-is.
    expect(adobe.generateImage).not.toHaveBeenCalled();
  });

  it('keeps provider failure atomic', async () => {
    const gemini = geminiEditor();
    gemini.editImage = vi.fn(async () => {
      throw new Error('gateway image edit failed');
    });

    await expect(
      modifyAsset(BASE_REQUEST, {
        gemini,
        firefly: firefly(),
        generatedDir: TEST_DIR
      })
    ).rejects.toMatchObject({
      message: 'Gemini image edit failed',
      stage: 'generating'
    });
  });

  it('updates copy only when Prompt is empty and calls neither image provider', async () => {
    const gemini = geminiEditor();
    const adobe = firefly();
    const result = await modifyAsset(
      {
        ...BASE_REQUEST,
        modification: {
          ...BASE_REQUEST.modification,
          prompt: '',
          cta: 'Discover iPortal'
        }
      },
      { gemini, firefly: adobe, generatedDir: TEST_DIR }
    );

    expect(result.intent).toBe('update_copy_only');
    expect(result.keepImage).toBe(true);
    expect(result.contentUpdate!.cta).toBe('Discover iPortal');
    expect(gemini.editImage).not.toHaveBeenCalled();
    expect(adobe.generateImage).not.toHaveBeenCalled();
  });

  it('treats create-new wording in Modify as a Gemini edit, never Firefly permission', async () => {
    const gemini = geminiEditor();
    const adobe = firefly();
    const result = await modifyAsset(
      {
        ...BASE_REQUEST,
        modification: {
          ...BASE_REQUEST.modification,
          prompt: 'Create a completely different campaign image.'
        }
      },
      { gemini, firefly: adobe, generatedDir: TEST_DIR }
    );

    expect(result.intent).toBe('modify_current_asset');
    expect(gemini.editImage).toHaveBeenCalledTimes(1);
    expect(adobe.generateImage).not.toHaveBeenCalled();
  });

  it('forwards compatible corporate KG brand guardrails into Gemini image edit', async () => {
    const gemini = geminiEditor();
    const result = await modifyAsset(BASE_REQUEST, {
      gemini,
      firefly: firefly(),
      generatedDir: TEST_DIR
    });

    const request = gemini.editImage.mock.calls[0]![0];
    expect(request.instruction).toBe(BASE_REQUEST.modification.prompt);
    expect(request.guardrails).toEqual([
      'Do not render Title, Description or CTA into the image.',
      'Preserve the current asset identity unless the prompt explicitly requests a visual change.'
    ]);
    expect(request.brandGuardrails?.length).toBeGreaterThan(0);
    const brandBlob = (request.brandGuardrails || []).join('\n');
    expect(brandBlob).not.toMatch(/mortgage|credit.?card|personal.?loan|fresco/i);
    expect(brandBlob).toMatch(/logo|GenStudio|GS4PM|owned/i);

    expect(result.derivedAsset?.brandGrounding?.applied).toBe(true);
    expect(result.derivedAsset?.brandGrounding?.ruleCount).toBeGreaterThan(0);
    expect(result.derivedAsset?.approval).toBe('Brand guidance applied');
    expect(result.provenance.some((p) => /KG brand guidance/i.test(p))).toBe(true);
  });
});

describe('Regenerate creative — Firefly only', () => {
  it('derives photographic direction from the user prompt and rejects an abstract inherited reference', async () => {
    const adobe = firefly();
    const generationPrompt =
      'Create a premium campaign image showing realistic business professionals in a modern office with warm natural light and neutral interiors.';
    let observed: Parameters<NonNullable<ModifyAssetOptions['onBeforeFireflyGeneration']>>[0] | null =
      null;

    const result = await modifyAsset(
      {
        ...regenerateRequest(generationPrompt),
        existingVisualReference: {
          id: 'kg-abstract-iportal',
          title: 'Abstract iPortal visual',
          category: 'visual-reference',
          businessDomain: 'corporate',
          mimeType: 'image/png',
          tags: ['abstract', 'cyan', 'ribbons'],
          visualFamily: 'abstract-digital'
        }
      },
      {
        gemini: geminiEditor(),
        firefly: adobe,
        generatedDir: TEST_DIR,
        onBeforeFireflyGeneration: (meta) => {
          observed = meta;
        }
      }
    );

    const providerRequest = adobe.generateImage.mock.calls[0]![0];
    const prompt = providerRequest.prompt.toLowerCase();
    expect(inferRegenerationVisualFamily(generationPrompt)).toBe('photographic');
    expect(observed!.specification.visualFamily).toBe('photographic');
    expect(observed!.contentClass).toBe('photo');
    expect(observed!.referenceSource).toBe('none');
    expect(result.referenceSource).toBe('none');
    expect(providerRequest.referenceImage).toBeNull();
    expect(prompt).toContain('visual family: photographic');
    expect(prompt).toMatch(/realistic business professionals/);
    expect(prompt).toMatch(/modern office/);
    expect(prompt).toMatch(/warm natural light/);
    expect(prompt).not.toMatch(/cyan ribbons?|flight[- ]?path|preserve.*abstract|visual family: abstract/);
  });

  it('reads "no illustration" as a rejection rather than a request for illustration', async () => {
    const adobe = firefly();
    const generationPrompt =
      'Photorealistic senior business professionals in a modern office, natural skin texture, natural office lighting. No illustration, no digital artwork, no 3D render, no concept art.';
    let observed: Parameters<NonNullable<ModifyAssetOptions['onBeforeFireflyGeneration']>>[0] | null =
      null;

    await modifyAsset(regenerateRequest(generationPrompt), {
      gemini: geminiEditor(),
      firefly: adobe,
      generatedDir: TEST_DIR,
      onBeforeFireflyGeneration: (meta) => {
        observed = meta;
      }
    });

    const providerRequest = adobe.generateImage.mock.calls[0]![0];
    const prompt = providerRequest.prompt.toLowerCase();
    expect(inferRegenerationVisualFamily(generationPrompt)).toBe('photographic');
    expect(observed!.specification.visualFamily).toBe('photographic');
    expect(providerRequest.contentClass).toBe('photo');
    expect(providerRequest.referenceImage).toBeNull();
    expect(prompt).toContain('visual family: photographic');
    expect(prompt).toContain('photorealistic');
    // The only occurrences of art-family words must be the marketer's own negations.
    expect(prompt).not.toMatch(/visual family: (illustration|abstract digital)/);
    expect(prompt.replace(/no illustration, no digital artwork, no 3d render, no concept art\./, ''))
      .not.toMatch(/illustration|digital artwork|3d render|concept art|stylized/);
  });

  it('classifies subtractive-only art rejections as photographic', () => {
    expect(inferRegenerationVisualFamily('No illustration, no 3D render, no concept art.')).toBe(
      'photographic'
    );
    expect(inferRegenerationVisualFamily('Avoid abstract digital treatments.')).toBe('photographic');
  });

  it('injects compatible corporate KG textual guardrails and never substitutes retail visuals', async () => {
    const adobe = firefly();
    const generationPrompt =
      'Create a premium campaign image showing realistic business professionals in a modern office.';
    let observed: Parameters<NonNullable<ModifyAssetOptions['onBeforeFireflyGeneration']>>[0] | null =
      null;

    const result = await modifyAsset(regenerateRequest(generationPrompt), {
      gemini: geminiEditor(),
      firefly: adobe,
      generatedDir: TEST_DIR,
      onBeforeFireflyGeneration: (meta) => {
        observed = meta;
      }
    });

    expect(observed!.specification.brandGuardrails?.length).toBeGreaterThan(0);
    const brandBlob = (observed!.specification.brandGuardrails || []).join('\n');
    expect(brandBlob).not.toMatch(/mortgage|credit.?card|personal.?loan|fresco/i);
    expect(observed!.fireflyPrompt.toLowerCase()).toContain(
      generationPrompt.toLowerCase().slice(0, 40)
    );
    expect(observed!.referenceSource).toBe('none');
    expect(adobe.generateImage.mock.calls[0]![0].referenceImage).toBeNull();
    expect(result.derivedAsset?.brandGrounding?.applied).toBe(true);
    expect(result.derivedAsset?.approval).toBe('Brand guidance applied');
    expect(result.provenance.some((p) => /KG brand guidance/i.test(p))).toBe(true);
  });

  it('composites the owned KG logo after Firefly and keeps the raw artifact', async () => {
    const canvas = await sharp({
      create: { width: 800, height: 800, channels: 3, background: { r: 12, g: 30, b: 70 } }
    })
      .jpeg()
      .toBuffer();

    const adobe = {
      generateImage: vi.fn(async (request: { prompt: string; referenceImage?: unknown }) => {
        // Prove Firefly never receives logo bytes in this path.
        expect(request.referenceImage).toBeNull();
        expect(JSON.stringify(request)).not.toMatch(/vis-logo|Barclays Logo\.png|logoBytes/i);
        const saved = persistGeneratedImageBytes({
          bytes: canvas,
          generatedDir: TEST_DIR,
          id: 'ff-raw-logo-test'
        });
        return {
          images: [{ id: saved.id, imageUrl: saved.publicUrl }],
          jobId: 'FF-LOGO-TEST'
        };
      })
    };

    const result = await modifyAsset(
      regenerateRequest(
        'Create a premium photographic corporate banking hero. Include the Barclays logo.'
      ),
      {
        gemini: geminiEditor(),
        firefly: adobe as unknown as FireflyClient & { generateImage: ReturnType<typeof vi.fn> },
        generatedDir: TEST_DIR
      }
    );

    const derived = result.derivedAsset!;
    expect(adobe.generateImage).toHaveBeenCalledTimes(1);
    expect(adobe.generateImage.mock.calls[0]![0].referenceImage).toBeNull();
    expect(derived.brandGrounding?.applied).toBe(true);
    expect(derived.logoComposition?.applied).toBe(true);
    expect(derived.logoComposition?.entryId).toBe('vis-logo-png');
    expect(derived.logoComposition?.placement).toBe('top-left');
    expect(derived.sourceImageId).toBe('ff-raw-logo-test');
    expect(derived.sourceImageUrl).toBe('/api/ai/generated/ff-raw-logo-test');
    // Final candidate points at a distinct branded asset.
    expect(derived.imageUrl).toMatch(/^\/api\/ai\/generated\//);
    expect(derived.imageUrl).not.toBe(derived.sourceImageUrl);
    expect(getRegisteredGeneratedImage('ff-raw-logo-test')).toBeTruthy();
    expect(derived.lineage).toMatch(/approved Barclays logo composition/i);
    expect(result.provenance.some((p) => /approved Barclays logo composition/i.test(p))).toBe(true);

    // Firefly prompt still forbids invented marks and asks for logo-safe space.
    const prompt = adobe.generateImage.mock.calls[0]![0].prompt.toLowerCase();
    expect(prompt).toMatch(/no generated logos|simulated barclays marks/);
    expect(prompt).toMatch(/logo-safe|separately composited approved barclays logo/);
  });

  it('generates once then distributes adapted + logo-composited candidates to all channel targets', async () => {
    const canvas = await sharp({
      create: { width: 1000, height: 1000, channels: 3, background: { r: 18, g: 42, b: 88 } }
    })
      .jpeg()
      .toBuffer();

    const adobe = {
      generateImage: vi.fn(async () => {
        const saved = persistGeneratedImageBytes({
          bytes: canvas,
          generatedDir: TEST_DIR,
          id: 'ff-master-cross'
        });
        return {
          images: [{ id: saved.id, imageUrl: saved.publicUrl }],
          jobId: 'FF-CROSS'
        };
      })
    };

    const request = {
      ...regenerateRequest('Create a premium photographic corporate banking hero.'),
      channelTargets: [
        {
          rootSourceDamAssetId: 'DAM-0188',
          channel: 'LinkedIn',
          format: 'Sponsored content · mobile crop',
          dimensions: '1080 × 1080'
        },
        {
          rootSourceDamAssetId: 'REQ-LI-WEB',
          channel: 'LinkedIn',
          format: 'Sponsored content · web',
          dimensions: '1200 × 627'
        },
        {
          rootSourceDamAssetId: 'DAM-0231',
          channel: 'Email',
          format: 'HTML email hero',
          dimensions: '1200 × 480'
        }
      ]
    };

    const result = await modifyAsset(request, {
      gemini: geminiEditor(),
      firefly: adobe as unknown as FireflyClient & { generateImage: ReturnType<typeof vi.fn> },
      generatedDir: TEST_DIR
    });

    expect(adobe.generateImage).toHaveBeenCalledTimes(1);
    expect(result.channelDerivatives).toHaveLength(3);
    expect(result.channelDerivativeFailures || []).toHaveLength(0);
    expect(result.generationFamilyId).toMatch(/^GEN-FAM-/);
    expect(result.masterGeneratedAssetId).toBe('ff-master-cross');

    const byRoot = Object.fromEntries(
      (result.channelDerivatives || []).map((d) => [d.rootSourceDamAssetId, d])
    );
    expect(byRoot['DAM-0188']?.dimensions).toBe('1080 × 1080');
    expect(byRoot['DAM-0188']?.finalImageDimensions).toBe('1080 × 1080');
    expect(byRoot['REQ-LI-WEB']?.dimensions).toBe('1200 × 627');
    expect(byRoot['DAM-0231']?.dimensions).toBe('1200 × 480');

    for (const derived of result.channelDerivatives || []) {
      expect(derived.generationFamilyId).toBe(result.generationFamilyId);
      expect(derived.masterGeneratedAssetId).toBe('ff-master-cross');
      expect(derived.derivedFromMasterGeneratedAssetId).toBe('ff-master-cross');
      expect(derived.brandGrounding?.applied).toBe(true);
      expect(derived.logoComposition?.applied).toBe(true);
      expect(derived.formatAdaptation).toBe('cover-crop');
      expect(derived.imageUrl).toMatch(/^\/api\/ai\/generated\//);
      expect(derived.imageUrl).not.toBe('/api/ai/generated/ff-master-cross');
      expect(derived.included).toBe(false);
      expect(derived.lineage).toMatch(/channel crop\/format adaptation/i);
      expect(derived.lineage).toMatch(/approved Barclays logo composition/i);
    }

    // Active slot derivedAsset points at the requesting root.
    expect(result.derivedAsset?.rootSourceDamAssetId).toBe('DAM-0188');
  });

  it('falls back to the raw Firefly image when logo composition cannot run', async () => {
    // 1×1 canvas is below MIN_COMPOSITION_CANVAS_PX — composition must not wipe generation.
    const adobe = firefly();
    const result = await modifyAsset(regenerateRequest('Create a premium corporate banking visual.'), {
      gemini: geminiEditor(),
      firefly: adobe,
      generatedDir: TEST_DIR
    });

    expect(result.derivedAsset?.imageUrl).toBeTruthy();
    expect(result.derivedAsset?.logoComposition?.applied).toBe(false);
    expect(result.derivedAsset?.logoComposition?.reason).toBe('canvas-too-small');
    expect(result.derivedAsset?.brandGrounding?.applied).toBe(true);
    expect(result.provenance.some((p) => /logo composition not applied/i.test(p))).toBe(true);
  });

  it('does not composite logos on the Gemini Modify path', async () => {
    const result = await modifyAsset(BASE_REQUEST, {
      gemini: geminiEditor(),
      firefly: firefly(),
      generatedDir: TEST_DIR
    });
    expect(result.intent).toBe('modify_current_asset');
    expect(result.derivedAsset?.logoComposition).toBeUndefined();
    expect(result.derivedAsset?.lineage || '').not.toMatch(/logo composition/i);
  });

  it('still classifies an explicit illustration request as illustration', async () => {
    const adobe = firefly();
    const generationPrompt = 'Create a flat vector illustration of a city skyline.';
    let observed: Parameters<NonNullable<ModifyAssetOptions['onBeforeFireflyGeneration']>>[0] | null =
      null;

    await modifyAsset(regenerateRequest(generationPrompt), {
      gemini: geminiEditor(),
      firefly: adobe,
      generatedDir: TEST_DIR,
      onBeforeFireflyGeneration: (meta) => {
        observed = meta;
      }
    });

    expect(inferRegenerationVisualFamily(generationPrompt)).toBe('illustration');
    expect(observed!.specification.visualFamily).toBe('illustration');
    expect(adobe.generateImage.mock.calls[0]![0].contentClass).toBe('art');
  });

  it('derives abstract direction only when the marketer explicitly requests it', async () => {
    const adobe = firefly();
    const generationPrompt =
      'Create an abstract digital banking visual with flowing cyan ribbons on a deep navy background.';
    let observed: Parameters<NonNullable<ModifyAssetOptions['onBeforeFireflyGeneration']>>[0] | null =
      null;

    await modifyAsset(regenerateRequest(generationPrompt), {
      gemini: geminiEditor(),
      firefly: adobe,
      generatedDir: TEST_DIR,
      onBeforeFireflyGeneration: (meta) => {
        observed = meta;
      }
    });

    const providerRequest = adobe.generateImage.mock.calls[0]![0];
    const prompt = providerRequest.prompt.toLowerCase();
    expect(inferRegenerationVisualFamily(generationPrompt)).toBe('abstract-digital');
    expect(observed!.specification.visualFamily).toBe('abstract-digital');
    expect(observed!.contentClass).toBe('art');
    expect(prompt).toContain('visual family: abstract digital');
    expect(prompt).toContain('flowing cyan ribbons');
    expect(prompt).toContain('deep navy background');
  });

  it('does not send the current DAM image as a regeneration style reference', async () => {
    const adobe = firefly();
    await modifyAsset(
      {
        ...regenerateRequest('Create a realistic photograph of two executives in an office.'),
        sourceDamAsset: {
          ...BASE_REQUEST.sourceDamAsset,
          imageUrl: `data:image/png;base64,${PNG.toString('base64')}`
        }
      },
      { gemini: geminiEditor(), firefly: adobe, generatedDir: TEST_DIR }
    );

    expect(adobe.generateImage.mock.calls[0]![0].referenceImage).toBeNull();
  });

  it('calls Firefly and never Gemini', async () => {
    const gemini = geminiEditor();
    const adobe = firefly();
    const result = await modifyAsset(regenerateRequest(), {
      gemini,
      firefly: adobe,
      generatedDir: TEST_DIR
    });

    expect(result.intent).toBe('regenerate_with_firefly');
    expect(adobe.generateImage).toHaveBeenCalledTimes(1);
    expect(gemini.editImage).not.toHaveBeenCalled();
    expect(gemini.generateJson).not.toHaveBeenCalled();
  });

  it('uses the Firefly generation prompt and does not reuse Modify Prompt', async () => {
    const adobe = firefly();
    const generationPrompt =
      'Create a new premium corporate visual with two professionals and clean space on the left.';
    const result = await modifyAsset(regenerateRequest(generationPrompt), {
      gemini: geminiEditor(),
      firefly: adobe,
      generatedDir: TEST_DIR
    });

    const request = adobe.generateImage.mock.calls[0]![0];
    expect(result.instruction).toBe(generationPrompt);
    expect(request.prompt).toContain('Create a new premium corporate visual');
    expect(request.prompt).not.toContain('STALE MODIFY PROMPT');
  });

  it('preserves authoritative copy on the Firefly derivative', async () => {
    const result = await modifyAsset(regenerateRequest(), {
      gemini: geminiEditor(),
      firefly: firefly(),
      generatedDir: TEST_DIR
    });
    expect(result.derivedAsset!.headline).toBe(BASE_REQUEST.modification.title);
    expect(result.derivedAsset!.copy).toBe(BASE_REQUEST.modification.description);
    expect(result.derivedAsset!.cta).toBe(BASE_REQUEST.modification.cta);
    expect(result.derivedAsset!.generationSource).toBe('firefly');
  });

  it('requires a fresh generation prompt', async () => {
    await expect(
      modifyAsset(regenerateRequest('  '), {
        gemini: geminiEditor(),
        firefly: firefly(),
        generatedDir: TEST_DIR
      })
    ).rejects.toMatchObject({
      message: 'generationPrompt is required for Firefly regeneration'
    });
  });

  it('loads the single-panel public asset for Gemini edit when imageUrl is /assets/...', async () => {
    const { resolveEditSourceImageBytes } = await import('./resolveReference');
    const resolved = await resolveEditSourceImageBytes({
      id: 'DAM-0188',
      imageUrl: '/assets/iportal-creative-single.png',
      mimeType: 'image/png'
    });
    expect(resolved).not.toBeNull();
    expect(resolved!.mimeType).toBe('image/png');
    expect(resolved!.bytes.length).toBeGreaterThan(1000);
    expect(resolved!.bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      true
    );
    const meta = await sharp(resolved!.bytes).metadata();
    expect(meta.width).toBe(559);
    expect(meta.height).toBe(706);
  });

  it('keeps provider failure atomic', async () => {
    const adobe: FireflyClient = {
      generateImage: vi.fn(async () => {
        throw new FireflyClientError('Firefly failed');
      })
    };
    await expect(
      modifyAsset(regenerateRequest(), {
        gemini: geminiEditor(),
        firefly: adobe,
        generatedDir: TEST_DIR
      })
    ).rejects.toMatchObject({
      message: 'Creative generation failed',
      stage: 'generating'
    });
  });
});

describe('public contract', () => {
  it('strips internal prompts and provenance', async () => {
    const result = await modifyAsset(regenerateRequest(), {
      gemini: geminiEditor(),
      firefly: firefly(),
      generatedDir: TEST_DIR
    });
    const publicResult = toPublicModifyAssetResult(result);
    expect(publicResult).not.toHaveProperty('fireflyPrompt');
    expect(publicResult).not.toHaveProperty('provenance');
    expect(publicResult.stage).toBe('ready');
  });

  it('rejects requests without authoritative content', async () => {
    await expect(
      modifyAsset(
        {
          ...BASE_REQUEST,
          modification: { ...BASE_REQUEST.modification, title: '' }
        },
        { gemini: geminiEditor(), firefly: firefly(), generatedDir: TEST_DIR }
      )
    ).rejects.toBeInstanceOf(ModifyAssetError);
  });
});
