/**
 * Builds a derived campaign asset record without mutating the source DAM asset.
 */

import { randomUUID } from 'node:crypto';
import type { CreativeSpecification } from '../creative/types';
import type { FireflyReferenceSource } from '../firefly/types';
import type { BrandGroundingMetadata } from '../../knowledge/creativeGrounding';
import type { LogoCompositionMetadata } from './compositeOwnedLogo';
import type { DerivedCampaignAsset, ModifyAssetRequest } from './types';

function resolveLineageIds(request: ModifyAssetRequest): {
  editSourceAssetId: string;
  rootSourceDamAssetId: string;
} {
  const editSourceAssetId =
    request.editSourceAssetId || request.sourceDamAsset?.id || request.asset.id;
  const rootSourceDamAssetId =
    request.rootSourceDamAssetId ||
    request.asset.sourceId ||
    (request.asset.id.startsWith('FF-') ? editSourceAssetId : request.asset.id);
  return { editSourceAssetId, rootSourceDamAssetId };
}

function isGeminiSource(generationSource: 'firefly' | 'gemini' | 'gemini-image'): boolean {
  return generationSource === 'gemini' || generationSource === 'gemini-image';
}

function buildLineageString(options: {
  rootSourceDamAssetId: string;
  editSourceAssetId: string;
  generationSource: 'firefly' | 'gemini' | 'gemini-image';
  formatAdaptation?: 'cover-crop' | 'none';
  targetDimensions?: string;
  sourceImageDimensions?: string;
  logoCompositionApplied?: boolean;
}): string {
  const {
    rootSourceDamAssetId,
    editSourceAssetId,
    generationSource,
    formatAdaptation,
    targetDimensions,
    sourceImageDimensions,
    logoCompositionApplied
  } = options;
  const parts = [`Adobe DAM · ${rootSourceDamAssetId}`];
  if (editSourceAssetId !== rootSourceDamAssetId) {
    parts.push(`Current derivative ${editSourceAssetId}`);
  }
  if (isGeminiSource(generationSource)) {
    parts.push(
      sourceImageDimensions
        ? `Gemini image edit (${sourceImageDimensions})`
        : 'Gemini image edit'
    );
  } else {
    parts.push('Adobe Firefly generation');
  }
  // Adapt before logo so the owned mark is composed onto the final channel canvas
  // and is not cropped away by cover-fit.
  if (formatAdaptation === 'cover-crop' && targetDimensions) {
    parts.push(`channel crop/format adaptation (${targetDimensions})`);
  }
  if (logoCompositionApplied) {
    parts.push('approved Barclays logo composition');
  }
  return parts.join(' → ');
}

export function buildDerivedAsset(options: {
  request: ModifyAssetRequest;
  specification: CreativeSpecification;
  referenceSource: FireflyReferenceSource | 'gemini-edit';
  imageUrl: string;
  jobId?: string;
  generationSource?: 'firefly' | 'gemini' | 'gemini-image';
  sourceImageDimensions?: string;
  sourceImageUrl?: string;
  sourceImageId?: string;
  targetDimensions?: string;
  finalImageDimensions?: string;
  formatAdaptation?: 'cover-crop' | 'none';
  /** Compact KG provenance — set when compatible brand guidance was applied. */
  brandGrounding?: BrandGroundingMetadata;
  /** Exact owned-logo composition applied after Firefly generation. */
  logoComposition?: LogoCompositionMetadata;
  /** Shared id for one Firefly generation distributed across channel slots. */
  generationFamilyId?: string;
  /** Raw / master Firefly artifact id that channel derivatives were adapted from. */
  masterGeneratedAssetId?: string;
  /** Same as masterGeneratedAssetId when this record is a channel derivative. */
  derivedFromMasterGeneratedAssetId?: string;
}): DerivedCampaignAsset {
  const { request, specification, referenceSource, imageUrl, jobId } = options;
  const generationSource = options.generationSource ?? 'firefly';
  const { editSourceAssetId, rootSourceDamAssetId } = resolveLineageIds(request);
  const prefix = isGeminiSource(generationSource) ? 'GM' : 'FF';
  const provider = isGeminiSource(generationSource) ? 'Gemini' : 'Firefly';
  const id = `${prefix}-DER-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
  const resolvedJobId = jobId ?? `${prefix}-ADAPT-${String(Date.now()).slice(-5)}`;
  const formatAdaptation = options.formatAdaptation ?? 'none';
  const brandGrounding = options.brandGrounding;
  const logoComposition = options.logoComposition;
  const approval = brandGrounding?.applied
    ? 'Brand guidance applied'
    : 'Campaign creative draft';

  return {
    id,
    // Parent-tab identity stays on the root DAM asset.
    sourceId: rootSourceDamAssetId,
    editSourceAssetId,
    derivedFromAssetId: editSourceAssetId,
    rootSourceDamAssetId,
    lineage: buildLineageString({
      rootSourceDamAssetId,
      editSourceAssetId,
      generationSource,
      formatAdaptation,
      targetDimensions: options.targetDimensions,
      sourceImageDimensions: options.sourceImageDimensions,
      logoCompositionApplied: logoComposition?.applied === true
    }),
    derived: true,
    generationSource,
    referenceSource,
    headline: specification.content.title,
    copy: specification.content.description,
    cta: specification.content.cta,
    channel: specification.channel,
    visualFamily: specification.visualFamily,
    imageUrl,
    creativeSpecification: specification,
    jobId: resolvedJobId,
    name: `${request.asset.headline || request.asset.id} · ${provider} derivative`,
    requirement: request.asset.format
      ? `${request.asset.channel || specification.channel} · AI-modified`
      : `AI-modified · ${specification.channel}`,
    format: request.asset.format,
    dimensions: request.asset.dimensions,
    sourceImageDimensions: options.sourceImageDimensions,
    sourceImageUrl: options.sourceImageUrl,
    sourceImageId: options.sourceImageId,
    targetDimensions: options.targetDimensions,
    finalImageDimensions: options.finalImageDimensions,
    formatAdaptation,
    previewType: 'generated',
    matchStatus: 'AI-modified',
    sourceType: isGeminiSource(generationSource) ? 'Gemini' : 'Adobe Firefly',
    found: true,
    generated: true,
    adapted: true,
    included: false,
    approval,
    confidence: 'Campaign-ready draft',
    matchReason:
      isGeminiSource(generationSource)
        ? 'Gemini edited the current asset while Title, Description and CTA remained authoritative.'
        : 'Adobe Firefly generated a new visual while Title, Description and CTA remained authoritative.',
    commentsKey: `dam-derived-${id.toLowerCase()}`,
    version: 1,
    brandGrounding,
    logoComposition,
    generationFamilyId: options.generationFamilyId,
    masterGeneratedAssetId: options.masterGeneratedAssetId,
    derivedFromMasterGeneratedAssetId: options.derivedFromMasterGeneratedAssetId
  };
}
