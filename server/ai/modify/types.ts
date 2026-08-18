/**
 * Provider-split contracts:
 * GenStudio Modify → Gemini image edit; Regenerate creative → Firefly.
 */

import type {
  AcceptedCampaignBrief,
  CreativeAssetContext,
  CreativeCampaignContext,
  CreativeInterpretationResult,
  CreativeModification,
  CreativeSpecification,
  PublicVisualReference
} from '../creative/types';
import type { FireflyReferenceSource } from '../firefly/types';
export type ModifyMode = 'modify';

export type SourceDamAssetReference = {
  id: string;
  /** Optional public or data URL for the selected DAM creative. */
  imageUrl?: string;
  /** Optional base64 image bytes (without data: prefix). */
  imageBase64?: string;
  mimeType?: string;
};

/** One Stage 6 channel slot that should receive a derivative of a single Firefly generation. */
export type ChannelGenerationTarget = {
  rootSourceDamAssetId: string;
  channel: string;
  format?: string;
  dimensions?: string;
  headline?: string;
  copy?: string;
  cta?: string;
};

export type ModifyAssetRequest = {
  mode: ModifyMode;
  campaignBrief: AcceptedCampaignBrief;
  asset: CreativeAssetContext;
  modification: CreativeModification;
  campaignContext: CreativeCampaignContext;
  /**
   * Visual source for this edit — the active candidate currently being modified
   * (original DAM asset or an existing Firefly derivative).
   */
  sourceDamAsset: SourceDamAssetReference;
  /** Exact asset id being edited now (same as sourceDamAsset.id). */
  editSourceAssetId?: string;
  /** Original DAM asset at the root of the lineage chain. */
  rootSourceDamAssetId?: string;
  /**
   * When true and existingSpecification is provided, skip Gemini unless
   * the caller also indicates marketer inputs changed (inputsChanged).
   */
  regenerate?: boolean;
  existingSpecification?: CreativeSpecification;
  /** If true on regenerate, Creative Interpreter runs again. */
  inputsChanged?: boolean;
  /** Prior interpretation visual reference (regeneration path). */
  existingVisualReference?: PublicVisualReference | null;
  /** Firefly-only prompt submitted from the Regenerate creative modal. */
  generationPrompt?: string;
  /**
   * Cross-channel Add new creative: one Firefly generation, then local adaptation
   * into each listed Stage 6 slot. Omit for single-slot / Modify paths.
   */
  channelTargets?: ChannelGenerationTarget[];
  /**
   * Explicit crop anchor for channel-format adaptation. Takes priority over the
   * centre default. `negativeSpace` is never used as an anchor — it describes the
   * copy safe area, not the focal point.
   */
  cropFocalPoint?: 'center' | 'left' | 'right' | 'top' | 'bottom';
};

export type ResolvedFireflyReference = {
  referenceSource: FireflyReferenceSource;
  visualReference: PublicVisualReference | null;
  /** Safe public metadata — never filesystem paths. */
  referenceId: string;
  referenceImage: {
    url?: string;
    bytes?: Buffer;
    mimeType?: string;
    uploadId?: string;
  } | null;
};

export type DerivedCampaignAsset = {
  id: string;
  /** Root DAM asset id — parent tab / lineage root. */
  sourceId: string;
  /** Exact asset that was edited to produce this derivative. */
  editSourceAssetId: string;
  /** Immediate predecessor in the edit chain (same as editSourceAssetId). */
  derivedFromAssetId: string;
  /** Original DAM asset at the beginning of lineage. */
  rootSourceDamAssetId: string;
  lineage: string;
  derived: true;
  generationSource: 'firefly' | 'gemini' | 'gemini-image';
  referenceSource: FireflyReferenceSource | 'gemini-edit';
  headline: string;
  copy: string;
  cta: string;
  channel: string;
  visualFamily: string;
  imageUrl: string;
  creativeSpecification?: CreativeSpecification;
  jobId: string;
  name: string;
  requirement?: string;
  format?: string;
  dimensions?: string;
  /** Raw Gemini (or provider) output before channel crop, e.g. "1360 × 768". */
  sourceImageDimensions?: string;
  /** Persisted URL for the raw provider output (audit trail). */
  sourceImageUrl?: string;
  /** Generated-image id for the raw provider output. */
  sourceImageId?: string;
  /** Channel target, e.g. "1080 × 1080". */
  targetDimensions?: string;
  /** Final persisted slot image, e.g. "1080 × 1080". */
  finalImageDimensions?: string;
  /** How the final image was produced from the provider output. */
  formatAdaptation?: 'cover-crop' | 'none';
  previewType: 'generated';
  matchStatus: 'AI-modified';
  sourceType: 'Adobe Firefly' | 'Gemini' | 'Campaign content';
  found: true;
  generated: true;
  adapted: true;
  included: false;
  approval: string;
  confidence: string;
  matchReason: string;
  commentsKey: string;
  version: number;
  /** Compact KG provenance when compatible brand guidance was applied. */
  brandGrounding?: {
    applied: boolean;
    entryIds: string[];
    sources: string[];
    ruleCount: number;
  };
  /**
   * Exact owned-logo composition after Firefly generation.
   * Distinct from brandGrounding (textual KG rules).
   */
  logoComposition?: {
    applied: boolean;
    entryId?: string;
    sourceFile?: string;
    placement?: 'top-left';
    reason?: string;
  };
  /** Shared id for one Firefly generation distributed across channel slots. */
  generationFamilyId?: string;
  /** Raw / master Firefly artifact id that channel derivatives were adapted from. */
  masterGeneratedAssetId?: string;
  /** Same as masterGeneratedAssetId when this record is a channel derivative. */
  derivedFromMasterGeneratedAssetId?: string;
};

export type ChannelDerivativeFailure = {
  rootSourceDamAssetId: string;
  channel: string;
  dimensions?: string;
  generationFamilyId: string;
  masterGeneratedAssetId: string;
  reason: string;
};

export type ModifyContentUpdate = {
  headline: string;
  copy: string;
  cta: string;
};

export type ModifyAssetResult = {
  stage: 'unsupported' | 'interpreting' | 'generating' | 'ready';
  intent: 'modify_current_asset' | 'update_copy_only' | 'regenerate_with_firefly';
  instruction: string;
  confidence?: number;
  message?: string;
  interpretation?: CreativeInterpretationResult;
  referenceSource?: FireflyReferenceSource | 'gemini-edit' | 'copy-only';
  derivedAsset?: DerivedCampaignAsset;
  /**
   * Cross-channel Add new creative: one Firefly call → one derivative per successful
   * channel adaptation. `derivedAsset` remains the active-slot member for compat.
   */
  channelDerivatives?: DerivedCampaignAsset[];
  channelDerivativeFailures?: ChannelDerivativeFailure[];
  generationFamilyId?: string;
  masterGeneratedAssetId?: string;
  /** Copy-only path updates Title/Description/CTA without changing the image. */
  contentUpdate?: ModifyContentUpdate;
  keepImage?: boolean;
  fireflyPrompt?: string;
  /** Internal provenance for logs/tests — not for UI filesystem exposure. */
  provenance: string[];
  /** Safe Firefly async job telemetry for local validation reports. */
  fireflyJobTelemetry?: {
    fireflyJobId?: string;
    initialResponseStatus: number;
    pollCount: number;
    statusTransitions: string[];
    finalJobStatus?: string;
    generatedImageAvailable: boolean;
  };
};

export type ModifyAssetPublicResult = {
  stage: 'unsupported' | 'ready';
  intent: 'modify_current_asset' | 'update_copy_only' | 'regenerate_with_firefly';
  instruction: string;
  confidence?: number;
  message?: string;
  interpretation?: CreativeInterpretationResult;
  referenceSource?: FireflyReferenceSource | 'gemini-edit' | 'copy-only';
  derivedAsset?: DerivedCampaignAsset;
  channelDerivatives?: DerivedCampaignAsset[];
  channelDerivativeFailures?: ChannelDerivativeFailure[];
  generationFamilyId?: string;
  masterGeneratedAssetId?: string;
  contentUpdate?: ModifyContentUpdate;
  keepImage?: boolean;
};
