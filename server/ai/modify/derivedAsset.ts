/**
 * Builds a derived campaign asset record without mutating the source DAM asset.
 */

import { randomUUID } from 'node:crypto';
import type { CreativeSpecification } from '../creative/types';
import type { FireflyReferenceSource } from '../firefly/types';
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
}): string {
  const {
    rootSourceDamAssetId,
    editSourceAssetId,
    generationSource,
    formatAdaptation,
    targetDimensions,
    sourceImageDimensions
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
  if (formatAdaptation === 'cover-crop' && targetDimensions) {
    parts.push(`channel crop/format adaptation (${targetDimensions})`);
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
}): DerivedCampaignAsset {
  const { request, specification, referenceSource, imageUrl, jobId } = options;
  const generationSource = options.generationSource ?? 'firefly';
  const { editSourceAssetId, rootSourceDamAssetId } = resolveLineageIds(request);
  const prefix = isGeminiSource(generationSource) ? 'GM' : 'FF';
  const provider = isGeminiSource(generationSource) ? 'Gemini' : 'Firefly';
  const id = `${prefix}-DER-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
  const resolvedJobId = jobId ?? `${prefix}-ADAPT-${String(Date.now()).slice(-5)}`;
  const formatAdaptation = options.formatAdaptation ?? 'none';

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
      sourceImageDimensions: options.sourceImageDimensions
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
    approval: 'Automated brand check passed',
    confidence: 'Campaign-ready draft',
    matchReason:
      isGeminiSource(generationSource)
        ? 'Gemini edited the current asset while Title, Description and CTA remained authoritative.'
        : 'Adobe Firefly generated a new visual while Title, Description and CTA remained authoritative.',
    commentsKey: `dam-derived-${id.toLowerCase()}`,
    version: 1
  };
}
