/**
 * Strict provider ownership:
 *   Modify in GenStudio → Gemini image edit only (GEMINI_IMAGE_API_KEY)
 *   Regenerate creative → Adobe Firefly generation only
 *
 * Image edits use the dedicated image-edit client (/images/edits or Google
 * generateContent). They never fall back to Firefly and never use the
 * JSON-only text gateway for image output.
 */

import type { CreativeSpecification } from '../creative/types';
import { randomUUID } from 'node:crypto';
import type { GeminiJsonClient } from '../gemini/types';
import { createGeminiClient } from '../gemini/client';
import { withGeminiImageEdit, GeminiImageEditError } from '../gemini/imageEditClient';
import { describeGeminiImageConfig, isGeminiImageLive } from '../gemini/imageConfig';
import {
  buildFireflyPrompt,
  createFireflyClient,
  FireflyClientError,
  resolveFireflyContentClass,
  type FireflyClient
} from '../firefly';
import { persistGeneratedImageBytes } from '../firefly/storage';
import {
  adaptImageToChannelFormat,
  formatDimensions,
  parseDimensions,
  readImageDimensions,
  resolveCropStrategy,
  type ChannelAdaptationOutcome,
  type CropPosition
} from './adaptImageToTarget';
import { buildDerivedAsset } from './derivedAsset';
import {
  ReferenceResolutionError,
  resolveEditSourceImageBytes,
  resolveModifyVisualReference
} from './resolveReference';
import type { ModifyAssetRequest, ModifyAssetResult } from './types';

const GEMINI_EDIT_UNSUPPORTED_MESSAGE =
  'Gemini image editing is not configured. Set GEMINI_IMAGE_API_KEY and GEMINI_IMAGE_MODEL. The current asset was left unchanged.';

const CHANNEL_ADAPTATION_FAILED_MESSAGE =
  'Channel format adaptation could not preserve the creative composition. The current asset was left unchanged.';

export class ModifyAssetError extends Error {
  readonly statusCode: number;
  readonly details?: string[];
  readonly stage: 'routing' | 'interpreting' | 'generating';

  constructor(
    message: string,
    statusCode = 400,
    stage: 'routing' | 'interpreting' | 'generating' = 'interpreting',
    details?: string[]
  ) {
    super(message);
    this.name = 'ModifyAssetError';
    this.statusCode = statusCode;
    this.stage = stage;
    this.details = details;
  }
}

export type ModifyAssetOptions = {
  gemini?: GeminiJsonClient;
  firefly?: FireflyClient;
  /** Test-only generated-image destination; production uses `.generated/`. */
  generatedDir?: string;
  /**
   * Called after CreativeSpecification + Firefly prompt are ready,
   * immediately before the Firefly generate call (live observability).
   */
  onBeforeFireflyGeneration?: (meta: {
    specification: CreativeSpecification;
    fireflyPrompt: string;
    fireflyPromptLength: number;
    contentClass: ReturnType<typeof resolveFireflyContentClass>;
    referenceSource: NonNullable<ModifyAssetResult['referenceSource']>;
  }) => void;
};

function isValidSpecification(value: unknown): value is CreativeSpecification {
  if (!value || typeof value !== 'object') return false;
  const v = value as CreativeSpecification;
  return Boolean(
    v.content?.title &&
      v.content?.description &&
      v.content?.cta &&
      v.requestedChange &&
      v.visualFamily &&
      v.businessDomain
  );
}

function runCopyOnly(request: ModifyAssetRequest): ModifyAssetResult {
  const contentUpdate = {
    headline: request.modification.title,
    copy: request.modification.description,
    cta: request.modification.cta
  };

  return {
    stage: 'ready',
    intent: 'update_copy_only',
    instruction: '',
    contentUpdate,
    keepImage: true,
    referenceSource: 'copy-only',
    provenance: [
      `Edit source asset ${request.editSourceAssetId || request.sourceDamAsset.id}`,
      `Root DAM asset ${request.rootSourceDamAssetId || request.asset.sourceId || request.asset.id}`,
      'marketer modification',
      'Title/Description/CTA update (no image provider)'
    ]
  };
}

function specificationForRegeneration(request: ModifyAssetRequest): CreativeSpecification {
  if (isValidSpecification(request.existingSpecification)) {
    return {
      ...request.existingSpecification,
      requestedChange: request.generationPrompt!.trim(),
      content: {
        title: request.modification.title,
        description: request.modification.description,
        cta: request.modification.cta
      },
      sourceAsset: {
        id: request.asset.id,
        sourceId: request.asset.sourceId,
        lineage: request.asset.lineage
      }
    };
  }
  return {
    businessDomain: request.campaignContext.businessDomain,
    campaignType: request.campaignContext.campaignType || 'campaign',
    channel: request.campaignContext.channel || request.asset.channel || 'unknown',
    content: {
      title: request.modification.title,
      description: request.modification.description,
      cta: request.modification.cta
    },
    requestedChange: request.generationPrompt!.trim(),
    visualFamily: 'abstract-digital',
    composition: 'Channel-appropriate campaign composition with clear visual hierarchy.',
    negativeSpace: 'unspecified',
    tone: ['premium', 'confident', 'modern'],
    preserve: ['approved Barclays brand guardrails', 'channel and format requirements'],
    avoid: ['generated logos or simulated Barclays marks', 'text rendered into the image'],
    accessibility: ['maintain sufficient contrast and clear focal hierarchy'],
    sourceAsset: {
      id: request.asset.id,
      sourceId: request.asset.sourceId,
      lineage: request.asset.lineage
    }
  };
}

async function runFireflyRegeneration(
  request: ModifyAssetRequest,
  options: ModifyAssetOptions,
  firefly: FireflyClient
): Promise<ModifyAssetResult> {
  const generationPrompt = request.generationPrompt?.trim();
  if (!generationPrompt) {
    throw new ModifyAssetError('generationPrompt is required for Firefly regeneration', 400);
  }
  const specification = specificationForRegeneration(request);

  let resolved;
  try {
    resolved = resolveModifyVisualReference({
      mode: 'generate',
      specification,
      visualReference: request.existingVisualReference ?? null,
      sourceDamAsset: request.sourceDamAsset
    });
  } catch (error) {
    throw new ModifyAssetError(
      error instanceof Error ? error.message : 'Reference resolution failed',
      400,
      'interpreting'
    );
  }

  const fireflyPrompt = buildFireflyPrompt({
    specification,
    referenceSource: resolved.referenceSource
  });

  const contentClass = resolveFireflyContentClass(specification);
  options.onBeforeFireflyGeneration?.({
    specification,
    fireflyPrompt,
    fireflyPromptLength: fireflyPrompt.length,
    contentClass,
    referenceSource: resolved.referenceSource
  });

  let fireflyResult;
  try {
    fireflyResult = await firefly.generateImage({
      prompt: fireflyPrompt,
      contentClass,
      numVariations: 1,
      styleStrength: 20,
      referenceImage: resolved.referenceImage
        ? {
            ...resolved.referenceImage,
            referenceId: resolved.referenceId
          }
        : {
            referenceId: resolved.referenceId
          }
    });
  } catch (error) {
    if (error instanceof FireflyClientError || error instanceof ReferenceResolutionError) {
      throw new ModifyAssetError(
        'Creative generation failed',
        502,
        'generating',
        [error.message]
      );
    }
    throw new ModifyAssetError(
      'Creative generation failed',
      502,
      'generating',
      [error instanceof Error ? error.message : 'Unknown Firefly error']
    );
  }

  const image = fireflyResult.images[0];
  if (!image?.imageUrl) {
    throw new ModifyAssetError('Creative generation failed', 502, 'generating', [
      'Firefly returned no image'
    ]);
  }

  const derivedAsset = buildDerivedAsset({
    request,
    specification,
    referenceSource: resolved.referenceSource,
    imageUrl: image.imageUrl,
    jobId: fireflyResult.jobId
  });

  return {
    stage: 'ready',
    intent: 'regenerate_with_firefly',
    instruction: generationPrompt,
    referenceSource: resolved.referenceSource,
    derivedAsset,
    fireflyPrompt,
    fireflyJobTelemetry: fireflyResult.jobTelemetry
      ? {
          fireflyJobId: fireflyResult.jobTelemetry.fireflyJobId,
          initialResponseStatus: fireflyResult.jobTelemetry.initialResponseStatus,
          pollCount: fireflyResult.jobTelemetry.pollCount,
          statusTransitions: [...fireflyResult.jobTelemetry.statusTransitions],
          finalJobStatus: fireflyResult.jobTelemetry.finalJobStatus,
          generatedImageAvailable: fireflyResult.jobTelemetry.generatedImageAvailable
        }
      : undefined,
    provenance: [
      `Edit source asset ${request.editSourceAssetId || request.sourceDamAsset.id}`,
      `Root DAM asset ${request.rootSourceDamAssetId || request.asset.sourceId || request.asset.id}`,
      'Regenerate creative action',
      'authoritative Firefly generation prompt',
      resolved.referenceSource === 'knowledge-graph'
        ? `KG reference ${resolved.referenceId}`
        : `prompt-led generation (${resolved.referenceId})`,
      'Firefly generation',
      `derived campaign asset ${derivedAsset.id}`
    ]
  };
}

async function runGeminiModify(
  request: ModifyAssetRequest,
  gemini: GeminiJsonClient,
  generatedDir?: string
): Promise<ModifyAssetResult> {
  const instruction = request.modification.prompt.trim();
  if (!gemini.editImage) {
    const caps = describeGeminiImageConfig();
    const message = !caps.geminiImageConfigured
      ? GEMINI_EDIT_UNSUPPORTED_MESSAGE
      : !caps.geminiImageModelConfigured
        ? 'Gemini image editing is not fully configured (missing GEMINI_IMAGE_MODEL). The current asset was left unchanged.'
        : 'Gemini image editing is unavailable until live image mode is enabled. The current asset was left unchanged.';
    return {
      stage: 'unsupported',
      intent: 'modify_current_asset',
      instruction,
      message,
      provenance: ['Modify asset', 'Gemini image edit unavailable', 'no Firefly fallback']
    };
  }

  let source;
  try {
    source = await resolveEditSourceImageBytes(request.sourceDamAsset);
  } catch (error) {
    throw new ModifyAssetError(
      error instanceof Error ? error.message : 'Current asset image could not be resolved',
      400,
      'interpreting'
    );
  }

  if (!source?.bytes?.length || !source.mimeType) {
    return {
      stage: 'unsupported',
      intent: 'modify_current_asset',
      instruction,
      message:
        'The current asset image could not be supplied to Gemini for editing. The current asset was left unchanged.',
      provenance: ['Modify asset', 'current image unavailable', 'no Firefly fallback']
    };
  }

  let edited;
  try {
    edited = await gemini.editImage({
      instruction,
      image: {
        bytes: source.bytes,
        mimeType: source.mimeType,
        assetId: request.editSourceAssetId || request.asset.id
      },
      channel: request.asset.channel,
      format: request.asset.format,
      dimensions: request.asset.dimensions,
      guardrails: [
        'Do not generate or simulate Barclays logos.',
        'Do not render Title, Description or CTA into the image.',
        'Preserve the current asset identity unless the prompt explicitly requests a visual change.'
      ],
      authoritativeContent: {
        title: request.modification.title,
        description: request.modification.description,
        cta: request.modification.cta
      }
    });
  } catch (error) {
    if (error instanceof GeminiImageEditError) {
      const details = [
        error.message,
        error.httpStatus != null ? `providerHttpStatus=${error.httpStatus}` : 'providerHttpStatus=none',
        error.providerCode ? `providerCode=${error.providerCode}` : null,
        error.protocol ? `protocol=${error.protocol}` : null,
        error.model ? `model=${error.model}` : null,
        error.endpointPath ? `endpoint=${error.endpointPath}` : null,
        error.sourceMimeType ? `sourceMime=${error.sourceMimeType}` : null,
        error.sourceByteLength != null ? `sourceBytes=${error.sourceByteLength}` : null,
        error.timeoutMs != null ? `timeoutMs=${error.timeoutMs}` : null,
        error.elapsedMs != null ? `elapsedMs=${error.elapsedMs}` : null,
        error.aborted ? 'aborted=true' : null
      ].filter(Boolean) as string[];
      // Timeouts are their own failure class — the current asset stays unchanged either way.
      const isTimeout = error.category === 'timeout' || error.aborted === true;
      throw new ModifyAssetError(
        isTimeout ? 'Gemini image edit timed out' : 'Gemini image edit failed',
        isTimeout ? 504 : 502,
        'generating',
        details
      );
    }
    throw new ModifyAssetError('Gemini image edit failed', 502, 'generating', [
      error instanceof Error ? error.message : 'Unknown Gemini image edit error'
    ]);
  }

  if (!edited?.bytes?.length) {
    throw new ModifyAssetError('Gemini image edit failed', 502, 'generating', [
      'Provider returned empty image bytes'
    ]);
  }

  // Always keep the raw Gemini output on disk for audit; never overwrite it.
  let sourcePersisted;
  try {
    sourcePersisted = persistGeneratedImageBytes({
      bytes: edited.bytes,
      contentTypeHint: edited.mimeType,
      generatedDir,
      id: `gm-${randomUUID().replace(/-/g, '').slice(0, 16)}`
    });
  } catch (error) {
    throw new ModifyAssetError('Gemini image edit failed', 502, 'generating', [
      error instanceof Error ? error.message : 'Failed to persist edited image'
    ]);
  }

  const specification = specificationForRegeneration({
    ...request,
    generationPrompt: instruction
  });
  const target = parseDimensions(request.asset.dimensions);
  const cropStrategy = resolveCropStrategy({
    focalPoint: request.cropFocalPoint,
    negativeSpace: specification.negativeSpace
  });

  let slotPersisted = sourcePersisted;
  let formatAdaptation: 'cover-crop' | 'none' = 'none';
  let sourceImageDimensions: string | undefined;
  const targetDimensions = target ? formatDimensions(target.width, target.height) : undefined;
  let finalImageDimensions: string | undefined;
  let cropPositionUsed: CropPosition | undefined;

  // Raw provider dimensions are read from the Gemini bytes themselves, so SOURCE
  // IMAGE always reports the untouched output even when adaptation is skipped.
  try {
    const raw = await readImageDimensions(edited.bytes);
    sourceImageDimensions = formatDimensions(raw.width, raw.height);
  } catch {
    /* raw dimensions unavailable */
  }

  if (target) {
    let outcome: ChannelAdaptationOutcome | null = null;
    try {
      outcome = await adaptImageToChannelFormat({
        bytes: edited.bytes,
        sourceMime: edited.mimeType,
        targetWidth: target.width,
        targetHeight: target.height,
        strategy: cropStrategy
      });
    } catch {
      // Technical failure (unreadable/undecodable bytes): the Gemini edit itself is
      // still a complete image, so serve it rather than failing the slot.
      outcome = null;
    }

    if (outcome?.status === 'composition-lost') {
      // No crop anchor keeps the creative continuous — leave the slot untouched.
      return {
        stage: 'unsupported',
        intent: 'modify_current_asset',
        instruction,
        message: CHANNEL_ADAPTATION_FAILED_MESSAGE,
        provenance: [
          `Edit source asset ${request.editSourceAssetId || request.asset.id}`,
          'Modify asset',
          sourceImageDimensions
            ? `Gemini image edit (${sourceImageDimensions})`
            : 'Gemini image edit',
          `raw Gemini source ${sourcePersisted.id}`,
          `channel crop rejected for ${targetDimensions} — ${outcome.reason}`,
          `crop anchors tried: ${outcome.candidatesTried.join(', ')}`,
          'current asset left unchanged'
        ]
      };
    }

    if (outcome?.status === 'adapted') {
      const adapted = outcome.result;
      try {
        // Persist the channel-ready crop as a separate generated asset for the slot URL.
        slotPersisted = persistGeneratedImageBytes({
          bytes: adapted.bytes,
          contentTypeHint: adapted.mimeType,
          generatedDir,
          id: `gm-${randomUUID().replace(/-/g, '').slice(0, 16)}`
        });
        sourceImageDimensions = formatDimensions(adapted.sourceWidth, adapted.sourceHeight);
        finalImageDimensions = formatDimensions(adapted.finalWidth, adapted.finalHeight);
        cropPositionUsed = adapted.cropPosition;
        formatAdaptation = 'cover-crop';
      } catch {
        // Persisting the crop failed — keep the already persisted Gemini source.
        slotPersisted = sourcePersisted;
        formatAdaptation = 'none';
      }
    }
  }

  const derivedAsset = buildDerivedAsset({
    request,
    specification,
    referenceSource: 'gemini-edit',
    generationSource: 'gemini-image',
    imageUrl: slotPersisted.publicUrl,
    jobId: `GM-EDIT-${String(Date.now()).slice(-5)}`,
    sourceImageDimensions,
    sourceImageUrl: sourcePersisted.publicUrl,
    sourceImageId: sourcePersisted.id,
    targetDimensions,
    finalImageDimensions:
      formatAdaptation === 'cover-crop' ? finalImageDimensions : sourceImageDimensions,
    formatAdaptation
  });

  return {
    stage: 'ready',
    intent: 'modify_current_asset',
    instruction,
    referenceSource: 'gemini-edit',
    derivedAsset,
    provenance: [
      `Edit source asset ${request.editSourceAssetId || request.asset.id}`,
      `Root DAM asset ${request.rootSourceDamAssetId || request.asset.sourceId || request.asset.id}`,
      'Modify asset',
      sourceImageDimensions
        ? `Gemini image edit (${sourceImageDimensions})`
        : 'Gemini image edit',
      `raw Gemini source ${sourcePersisted.id}`,
      formatAdaptation === 'cover-crop' && targetDimensions
        ? `channel crop/format adaptation (${targetDimensions}, cover, ${cropPositionUsed} anchor via ${cropStrategy.source})`
        : 'channel crop skipped — using Gemini source',
      `derived campaign asset ${derivedAsset.id}`
    ]
  };
}

function defaultGeminiClient(): GeminiJsonClient {
  // JSON text gateway is not used for Modify image edits.
  const base = createGeminiClient({ live: false });
  return withGeminiImageEdit(base, { live: isGeminiImageLive() });
}

export async function modifyAsset(
  rawRequest: unknown,
  options: ModifyAssetOptions = {}
): Promise<ModifyAssetResult> {
  if (!rawRequest || typeof rawRequest !== 'object') {
    throw new ModifyAssetError('Invalid Modify request', 400, 'routing');
  }
  const request = rawRequest as ModifyAssetRequest;

  if (request.mode !== 'modify') {
    throw new ModifyAssetError('Only mode=modify is supported in this phase', 400, 'routing');
  }

  if (
    !request.modification?.title?.trim() ||
    !request.modification.description?.trim() ||
    !request.modification.cta?.trim()
  ) {
    throw new ModifyAssetError('Title, Description and CTA are required', 400);
  }

  if (!request.sourceDamAsset?.id) {
    throw new ModifyAssetError('sourceDamAsset.id is required for Modify', 400, 'routing');
  }

  const gemini = options.gemini ?? defaultGeminiClient();
  const firefly = options.firefly ?? createFireflyClient({ live: false });

  if (request.regenerate === true) {
    return runFireflyRegeneration(request, options, firefly);
  }

  if (!request.modification.prompt.trim()) {
    return runCopyOnly(request);
  }

  return runGeminiModify(request, gemini, options.generatedDir);
}

export function toPublicModifyAssetResult(result: ModifyAssetResult) {
  return {
    stage: result.stage === 'unsupported' ? 'unsupported' : 'ready',
    intent: result.intent,
    instruction: result.instruction,
    confidence: result.confidence,
    message: result.message,
    interpretation: result.interpretation,
    referenceSource: result.referenceSource,
    derivedAsset: result.derivedAsset,
    contentUpdate: result.contentUpdate,
    keepImage: result.keepImage
  };
}
