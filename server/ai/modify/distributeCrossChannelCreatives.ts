/**
 * One Firefly master → local channel adaptations (no extra provider calls).
 *
 * Pipeline per channel: master bytes → cover-crop adapt → owned logo compose → persist.
 * Logo is applied after adaptation so cover-crop cannot clip the mark.
 */

import { randomUUID } from 'node:crypto';
import type { CreativeSpecification } from '../creative/types';
import type { FireflyReferenceSource } from '../firefly/types';
import { persistGeneratedImageBytes } from '../firefly/storage';
import type { BrandGroundingMetadata } from '../../knowledge/creativeGrounding';
import {
  adaptImageToChannelFormat,
  formatDimensions,
  parseDimensions,
  readImageDimensions,
  resolveCropStrategy
} from './adaptImageToTarget';
import {
  compositeOwnedLogo,
  DEFAULT_OWNED_LOGO_ENTRY_ID,
  type LogoCompositionMetadata
} from './compositeOwnedLogo';
import { buildDerivedAsset } from './derivedAsset';
import type {
  ChannelDerivativeFailure,
  ChannelGenerationTarget,
  DerivedCampaignAsset,
  ModifyAssetRequest
} from './types';

export type DistributeCrossChannelInput = {
  request: ModifyAssetRequest;
  targets: ChannelGenerationTarget[];
  masterBytes: Buffer;
  masterMimeType: string;
  masterImageId: string;
  masterImageUrl: string;
  specification: CreativeSpecification;
  referenceSource: FireflyReferenceSource;
  brandGrounding?: BrandGroundingMetadata;
  jobId?: string;
  generatedDir?: string;
  cropFocalPoint?: 'center' | 'left' | 'right' | 'top' | 'bottom';
};

export type DistributeCrossChannelResult = {
  generationFamilyId: string;
  masterGeneratedAssetId: string;
  channelDerivatives: DerivedCampaignAsset[];
  channelDerivativeFailures: ChannelDerivativeFailure[];
};

function channelSuffix(channel: string, dimensions?: string): string {
  const c = String(channel || '').toLowerCase();
  const d = String(dimensions || '').toLowerCase();
  if (c.includes('email')) return 'EMAIL';
  if (c.includes('linkedin') && (d.includes('1080') || d.includes('mobile'))) return 'LI-MOB';
  if (c.includes('linkedin')) return 'LI-WEB';
  return 'CH';
}

function requestForTarget(
  base: ModifyAssetRequest,
  target: ChannelGenerationTarget
): ModifyAssetRequest {
  return {
    ...base,
    asset: {
      ...base.asset,
      id: target.rootSourceDamAssetId,
      sourceId: target.rootSourceDamAssetId,
      channel: target.channel,
      format: target.format || base.asset.format,
      dimensions: target.dimensions || base.asset.dimensions,
      headline: target.headline || base.asset.headline,
      copy: target.copy || base.asset.copy,
      cta: target.cta || base.asset.cta
    },
    campaignContext: {
      ...base.campaignContext,
      channel: target.channel
    },
    rootSourceDamAssetId: target.rootSourceDamAssetId,
    editSourceAssetId: target.rootSourceDamAssetId
  };
}

function specificationForTarget(
  specification: CreativeSpecification,
  target: ChannelGenerationTarget
): CreativeSpecification {
  return {
    ...specification,
    channel: target.channel || specification.channel
  };
}

/**
 * Adapt the Firefly master into each Stage 6 channel slot. Never calls Firefly/Gemini.
 */
export async function distributeCrossChannelCreatives(
  input: DistributeCrossChannelInput
): Promise<DistributeCrossChannelResult> {
  const generationFamilyId = `GEN-FAM-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  const masterGeneratedAssetId = input.masterImageId;
  const sourceMeta = await readImageDimensions(input.masterBytes);
  const sourceImageDimensions = formatDimensions(sourceMeta.width, sourceMeta.height);
  const cropStrategy = resolveCropStrategy({
    focalPoint: input.cropFocalPoint,
    negativeSpace: input.specification.negativeSpace
  });

  const channelDerivatives: DerivedCampaignAsset[] = [];
  const channelDerivativeFailures: ChannelDerivativeFailure[] = [];

  for (const target of input.targets) {
    const dims = parseDimensions(target.dimensions);
    if (!dims) {
      channelDerivativeFailures.push({
        rootSourceDamAssetId: target.rootSourceDamAssetId,
        channel: target.channel,
        dimensions: target.dimensions,
        generationFamilyId,
        masterGeneratedAssetId,
        reason: 'invalid-target-dimensions'
      });
      continue;
    }

    try {
      const adapted = await adaptImageToChannelFormat({
        bytes: input.masterBytes,
        sourceMime: input.masterMimeType,
        targetWidth: dims.width,
        targetHeight: dims.height,
        strategy: cropStrategy
      });

      if (adapted.status !== 'adapted') {
        channelDerivativeFailures.push({
          rootSourceDamAssetId: target.rootSourceDamAssetId,
          channel: target.channel,
          dimensions: target.dimensions,
          generationFamilyId,
          masterGeneratedAssetId,
          reason: adapted.reason || 'composition-lost'
        });
        continue;
      }

      let finalBytes = adapted.result.bytes;
      let finalMime = adapted.result.mimeType;
      let logoComposition: LogoCompositionMetadata = {
        applied: false,
        reason: 'composition-skipped'
      };

      const composed = await compositeOwnedLogo({
        imageBytes: finalBytes,
        imageMimeType: finalMime,
        logoEntryId: DEFAULT_OWNED_LOGO_ENTRY_ID,
        placement: 'top-left'
      });
      logoComposition = composed.metadata;
      if (composed.metadata.applied) {
        finalBytes = composed.bytes;
        finalMime = composed.mimeType;
      }

      const persisted = persistGeneratedImageBytes({
        bytes: finalBytes,
        mimeType: finalMime,
        generatedDir: input.generatedDir
      });

      const targetDimensions = formatDimensions(dims.width, dims.height);
      const channelRequest = requestForTarget(input.request, target);
      const channelSpec = specificationForTarget(input.specification, target);
      const derived = buildDerivedAsset({
        request: channelRequest,
        specification: channelSpec,
        referenceSource: input.referenceSource,
        imageUrl: persisted.publicUrl,
        jobId: input.jobId,
        generationSource: 'firefly',
        sourceImageDimensions,
        sourceImageUrl: input.masterImageUrl,
        sourceImageId: masterGeneratedAssetId,
        targetDimensions,
        finalImageDimensions: targetDimensions,
        formatAdaptation: 'cover-crop',
        brandGrounding: input.brandGrounding,
        logoComposition,
        generationFamilyId,
        masterGeneratedAssetId,
        derivedFromMasterGeneratedAssetId: masterGeneratedAssetId
      });

      // Stable family-scoped id hint in commentsKey only; primary id stays UUID-based.
      derived.commentsKey = `dam-derived-${generationFamilyId.toLowerCase()}-${channelSuffix(
        target.channel,
        target.dimensions
      ).toLowerCase()}`;

      channelDerivatives.push(derived);
    } catch (error) {
      channelDerivativeFailures.push({
        rootSourceDamAssetId: target.rootSourceDamAssetId,
        channel: target.channel,
        dimensions: target.dimensions,
        generationFamilyId,
        masterGeneratedAssetId,
        reason: error instanceof Error ? error.message : 'channel-adaptation-failed'
      });
    }
  }

  return {
    generationFamilyId,
    masterGeneratedAssetId,
    channelDerivatives,
    channelDerivativeFailures
  };
}
