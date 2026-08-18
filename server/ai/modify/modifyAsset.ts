/**
 * Strict provider ownership:
 *   Modify in GenStudio → Gemini image edit only (GEMINI_IMAGE_API_KEY)
 *   Regenerate creative → Adobe Firefly generation only
 *
 * Image edits use the dedicated image-edit client (/images/edits or Google
 * generateContent). They never fall back to Firefly and never use the
 * JSON-only text gateway for image output.
 */

import type { CreativeSpecification, PublicVisualReference } from '../creative/types';
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
import { persistGeneratedImageBytes, readRegisteredGeneratedBytes } from '../firefly/storage';
import {
  adaptImageToChannelFormat,
  formatDimensions,
  parseDimensions,
  readImageDimensions,
  resolveCropStrategy,
  type ChannelAdaptationOutcome,
  type CropPosition,
  type CropStrategySource
} from './adaptImageToTarget';
import {
  compositeOwnedLogo,
  DEFAULT_OWNED_LOGO_ENTRY_ID,
  type LogoCompositionMetadata
} from './compositeOwnedLogo';
import { buildDerivedAsset } from './derivedAsset';
import { distributeCrossChannelCreatives } from './distributeCrossChannelCreatives';
import {
  ReferenceResolutionError,
  resolveEditSourceImageBytes,
  resolveModifyVisualReference
} from './resolveReference';
import type { ModifyAssetRequest, ModifyAssetResult } from './types';
import type { VisualFamily } from '../../knowledge/visualFamily';
import {
  getCreativeGrounding,
  toBrandGroundingMetadata
} from '../../knowledge/creativeGrounding';

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
  /**
   * Called when channel adaptation is rejected and the slot is left unchanged.
   * Carries the measurement behind the concise UI message.
   */
  onChannelAdaptationRejected?: (meta: {
    assetId: string;
    channel?: string;
    sourceDimensions?: string;
    targetDimensions?: string;
    cropStrategy: CropStrategySource;
    cropAnchorsTried: CropPosition[];
    negativeSpaceHint?: string;
    validator: 'interior-blank-band';
    measuredBandPixels: number;
    measuredBandFraction: number;
    thresholdBandPixels: number;
    bandPresentInSource: boolean;
    rawImageId: string;
  }) => void;
};

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

/**
 * Campaign content for the regenerated creative. The prompt-only modal supplies no content, so it
 * falls back to the current asset and finally to channel-safe defaults.
 */
function regenerationContent(request: ModifyAssetRequest): {
  title: string;
  description: string;
  cta: string;
} {
  const modification = request.modification ?? ({} as ModifyAssetRequest['modification']);
  const asset = request.asset ?? ({} as ModifyAssetRequest['asset']);
  return {
    title: modification.title?.trim() || asset.headline?.trim() || 'Campaign creative',
    description:
      modification.description?.trim() ||
      asset.copy?.trim() ||
      request.generationPrompt!.trim(),
    cta: modification.cta?.trim() || asset.cta?.trim() || 'Learn more'
  };
}

/**
 * A negated clause runs from the negation word to the next clause boundary, so
 * "no illustration, no 3D render" yields two excluded fragments rather than
 * counting as a request for illustration.
 */
const NEGATION_CLAUSE = /\b(?:no|not|never|avoid|avoiding|without|exclude|excluding|don't|dont)\b[^.;,]*/gi;

const FAMILY_PATTERNS: ReadonlyArray<{ family: VisualFamily; pattern: RegExp }> = [
  {
    family: 'photographic',
    pattern:
      /\b(photorealistic|photo-realistic|photorealism|commercial photography|corporate photography|documentary photography|real photograph|photograph)\b/
  },
  {
    family: 'abstract-digital',
    pattern:
      /\b(abstract|digital ribbons?|light ribbons?|flowing ribbons?|cyan ribbons?|navy background|digital banking visual)\b/
  },
  {
    family: 'interface-led',
    pattern: /\b(product screenshot|product screen|app screenshot|interface|dashboard|user interface|ui)\b/
  },
  { family: 'product-led', pattern: /\b(product shot|device mockup|packshot)\b/ },
  {
    family: 'illustration',
    pattern: /\b(illustration|illustrated|illustrative|vector art|cartoon|drawn|concept art|3d render|digital artwork)\b/
  },
  {
    family: 'photographic',
    pattern:
      /\b(realistic|photographic|photography|photo|real people|business professionals?|people|persons?|executives?|office|natural light(?:ing)?|corporate portrait|skin texture)\b/
  }
];

/**
 * Deterministic user-intent classification for Regenerate creative.
 * Campaign type is deliberately absent: an iPortal campaign can be photographic.
 */
export function inferRegenerationVisualFamily(generationPrompt: string): VisualFamily {
  const prompt = generationPrompt.toLowerCase();
  const negatedText = prompt.match(NEGATION_CLAUSE)?.join(' ') ?? '';
  const requestedText = prompt.replace(NEGATION_CLAUSE, ' ');

  for (const { family, pattern } of FAMILY_PATTERNS) {
    if (pattern.test(requestedText)) return family;
  }

  // Purely subtractive direction ("no illustration, no 3D render") still rules
  // out the art families, which leaves photography as the requested intent.
  const rejectsArtFamilies = FAMILY_PATTERNS.some(
    ({ family, pattern }) =>
      (family === 'illustration' || family === 'abstract-digital') && pattern.test(negatedText)
  );
  if (rejectsArtFamilies) return 'photographic';

  return 'other';
}

function specificationForRegeneration(
  request: ModifyAssetRequest,
  brandGuardrails: string[] = []
): CreativeSpecification {
  const content = regenerationContent(request);
  const requestedChange = request.generationPrompt!.trim();
  const visualFamily = inferRegenerationVisualFamily(requestedChange);
  const format = [request.asset.format, request.asset.dimensions].filter(Boolean).join(', ');
  // Regenerate always composites the owned logo locally afterward — Firefly must leave
  // logo-safe space and must never invent Barclays marks.
  const photographic = visualFamily === 'photographic';
  return {
    businessDomain: request.campaignContext.businessDomain,
    campaignType: request.campaignContext.campaignType || 'campaign',
    channel: request.campaignContext.channel || request.asset.channel || 'unknown',
    content,
    requestedChange,
    visualFamily,
    composition: [
      `Create one campaign-ready visual${format ? ` for ${format}` : ''} with a clear focal hierarchy`,
      'Reserve clean logo-safe space for a separately composited approved Barclays logo'
    ].join('. '),
    negativeSpace: 'unspecified',
    tone: photographic
      ? ['professional', 'natural', 'authentic', 'premium']
      : ['professional', 'campaign-appropriate'],
    preserve: [
      'the marketer generation prompt as the primary creative direction',
      'channel and format requirements',
      'logo-safe area for approved owned logo compositing'
    ],
    avoid: [
      'generated logos or simulated Barclays marks',
      'readable text or pseudo-text rendered into the image',
      'collage, split-screen or multiple variants',
      ...(photographic ? ['distorted, duplicated or anatomically incorrect people'] : [])
    ],
    accessibility: ['maintain sufficient contrast and a clear accessible focal hierarchy'],
    brandGuardrails,
    sourceAsset: {
      id: request.asset.id,
      sourceId: request.asset.sourceId,
      lineage: request.asset.lineage
    }
  };
}

function creativeGroundingForRequest(
  request: ModifyAssetRequest,
  options: { requestedChange: string; visualFamily?: VisualFamily }
) {
  return getCreativeGrounding({
    businessDomain: request.campaignContext.businessDomain,
    campaignType: request.campaignContext.campaignType,
    channel: request.campaignContext.channel || request.asset.channel,
    product:
      typeof request.campaignBrief?.product === 'string'
        ? request.campaignBrief.product
        : undefined,
    visualFamily: options.visualFamily,
    requestedChange: options.requestedChange
  });
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
  const visualFamily = inferRegenerationVisualFamily(generationPrompt);
  const grounding = creativeGroundingForRequest(request, {
    requestedChange: generationPrompt,
    visualFamily
  });
  const specification = specificationForRegeneration(request, grounding.guardrails);
  const brandGrounding = toBrandGroundingMetadata(grounding);

  // Prefer an already-compatible caller-supplied reference; otherwise use KG when family matches.
  const kgVisual =
    grounding.visualReference &&
    grounding.visualReference.visualFamily === specification.visualFamily
      ? (grounding.visualReference as PublicVisualReference)
      : null;
  const visualReference = request.existingVisualReference ?? kgVisual;

  let resolved;
  try {
    resolved = resolveModifyVisualReference({
      mode: 'generate',
      specification,
      visualReference: visualReference ?? null,
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
        : null
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

  // Raw Firefly artifact stays registered; composition / channel adaptation write separate finals.
  const rawImageId = image.id;
  const rawImageUrl = image.imageUrl;

  const rawBytes =
    (rawImageId ? readRegisteredGeneratedBytes(rawImageId) : null) ??
    (() => {
      const match = /^\/api\/ai\/generated\/([^/?#]+)/i.exec(rawImageUrl);
      return match?.[1] ? readRegisteredGeneratedBytes(match[1]) : null;
    })();

  const channelTargets = Array.isArray(request.channelTargets)
    ? request.channelTargets.filter(
        (t) => t && typeof t.rootSourceDamAssetId === 'string' && t.rootSourceDamAssetId.trim()
      )
    : [];

  // Cross-channel Add new creative: one Firefly call → adapt → logo per Stage 6 slot.
  if (channelTargets.length > 0 && rawBytes) {
    const distributed = await distributeCrossChannelCreatives({
      request,
      targets: channelTargets,
      masterBytes: rawBytes.bytes,
      masterMimeType: rawBytes.mimeType,
      masterImageId: rawImageId || `ff-master-${Date.now()}`,
      masterImageUrl: rawImageUrl,
      specification,
      referenceSource: resolved.referenceSource,
      brandGrounding,
      jobId: fireflyResult.jobId,
      generatedDir: options.generatedDir,
      cropFocalPoint: request.cropFocalPoint
    });

    if (!distributed.channelDerivatives.length) {
      throw new ModifyAssetError('Creative generation failed', 502, 'generating', [
        'Channel adaptation failed for all targets',
        ...distributed.channelDerivativeFailures.map((f) => `${f.channel}: ${f.reason}`)
      ]);
    }

    const activeRoot =
      request.rootSourceDamAssetId || request.asset.sourceId || request.asset.id;
    const derivedAsset =
      distributed.channelDerivatives.find((d) => d.rootSourceDamAssetId === activeRoot) ||
      distributed.channelDerivatives[0]!;

    return {
      stage: 'ready',
      intent: 'regenerate_with_firefly',
      instruction: generationPrompt,
      referenceSource: resolved.referenceSource,
      derivedAsset,
      channelDerivatives: distributed.channelDerivatives,
      channelDerivativeFailures: distributed.channelDerivativeFailures,
      generationFamilyId: distributed.generationFamilyId,
      masterGeneratedAssetId: distributed.masterGeneratedAssetId,
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
        'Add new creative (cross-channel)',
        'authoritative Firefly generation prompt',
        brandGrounding.applied
          ? `KG brand guidance (${brandGrounding.ruleCount} rules)`
          : 'no compatible KG brand guidance',
        'Firefly generation (single provider call)',
        `generation family ${distributed.generationFamilyId}`,
        `master artifact ${distributed.masterGeneratedAssetId}`,
        `channel derivatives ${distributed.channelDerivatives.length}`,
        distributed.channelDerivativeFailures.length
          ? `channel adaptation failures ${distributed.channelDerivativeFailures.length}`
          : 'all channel adaptations succeeded',
        'channel crop then approved logo composition per slot'
      ]
    };
  }

  // Single-slot / legacy regenerate: compose logo on the raw Firefly canvas only.
  let finalImageUrl = rawImageUrl;
  let logoComposition: LogoCompositionMetadata = {
    applied: false,
    reason: 'raw-unavailable'
  };

  if (rawBytes) {
    const composed = await compositeOwnedLogo({
      imageBytes: rawBytes.bytes,
      imageMimeType: rawBytes.mimeType,
      logoEntryId: DEFAULT_OWNED_LOGO_ENTRY_ID,
      placement: 'top-left'
    });
    logoComposition = composed.metadata;
    if (composed.metadata.applied) {
      const branded = persistGeneratedImageBytes({
        bytes: composed.bytes,
        mimeType: composed.mimeType,
        generatedDir: options.generatedDir
      });
      finalImageUrl = branded.publicUrl;
    }
  }

  const derivedAsset = buildDerivedAsset({
    request,
    specification,
    referenceSource: resolved.referenceSource,
    imageUrl: finalImageUrl,
    jobId: fireflyResult.jobId,
    sourceImageUrl: rawImageUrl,
    sourceImageId: rawImageId,
    brandGrounding,
    logoComposition
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
      brandGrounding.applied
        ? `KG brand guidance (${brandGrounding.ruleCount} rules)`
        : 'no compatible KG brand guidance',
      resolved.referenceSource === 'knowledge-graph'
        ? `KG reference ${resolved.referenceId}`
        : `prompt-led generation (${resolved.referenceId})`,
      'Firefly generation',
      logoComposition.applied
        ? `approved Barclays logo composition (${logoComposition.entryId})`
        : `logo composition not applied (${logoComposition.reason || 'unknown'})`,
      `derived campaign asset ${derivedAsset.id}`
    ]
  };
}

async function runGeminiModify(
  request: ModifyAssetRequest,
  gemini: GeminiJsonClient,
  options: ModifyAssetOptions
): Promise<ModifyAssetResult> {
  const generatedDir = options.generatedDir;
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
  const grounding = creativeGroundingForRequest(request, { requestedChange: instruction });
  const brandGrounding = toBrandGroundingMetadata(grounding);
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
      // Universal technical constraints — not catalogue brand rules.
      guardrails: [
        'Do not render Title, Description or CTA into the image.',
        'Preserve the current asset identity unless the prompt explicitly requests a visual change.'
      ],
      // Compatible KG brand rules (corporate/iPortal → GS4PM + logo ownership only).
      brandGuardrails:
        grounding.guardrails.length > 0
          ? grounding.guardrails
          : ['Do not generate or simulate Barclays logos.'],
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

  const specification = specificationForRegeneration(
    {
      ...request,
      generationPrompt: instruction
    },
    grounding.guardrails
  );
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
      options.onChannelAdaptationRejected?.({
        assetId: request.asset.id,
        channel: request.asset.channel,
        sourceDimensions: sourceImageDimensions,
        targetDimensions,
        cropStrategy: cropStrategy.source,
        cropAnchorsTried: outcome.candidatesTried,
        negativeSpaceHint: cropStrategy.negativeSpaceHint,
        validator: outcome.validator,
        measuredBandPixels: outcome.measuredBandPixels,
        measuredBandFraction: outcome.measuredBandFraction,
        thresholdBandPixels: outcome.thresholdBandPixels,
        bandPresentInSource: outcome.bandPresentInSource,
        rawImageId: sourcePersisted.id
      });
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
          outcome.bandPresentInSource
            ? 'blank band already present in the provider output, not introduced by the crop'
            : 'blank band introduced by the crop',
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
    formatAdaptation,
    brandGrounding
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
      brandGrounding.applied
        ? `KG brand guidance (${brandGrounding.ruleCount} rules)`
        : 'no compatible KG brand guidance',
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

  // Regeneration is prompt-led: campaign content is descriptive metadata that the caller resolves
  // from application state, so it is not a required input on that path.
  if (
    request.regenerate !== true &&
    (!request.modification?.title?.trim() ||
      !request.modification.description?.trim() ||
      !request.modification.cta?.trim())
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

  return runGeminiModify(request, gemini, options);
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
    channelDerivatives: result.channelDerivatives,
    channelDerivativeFailures: result.channelDerivativeFailures,
    generationFamilyId: result.generationFamilyId,
    masterGeneratedAssetId: result.masterGeneratedAssetId,
    contentUpdate: result.contentUpdate,
    keepImage: result.keepImage
  };
}
