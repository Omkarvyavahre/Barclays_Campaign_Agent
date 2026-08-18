/**
 * Creative Interpreter contracts.
 * Built on the Phase 1 knowledge layer + shared Gemini gateway.
 */

import type { KnowledgeDomain, VisualFamily } from '../../knowledge/types';

export type AcceptedCampaignBrief = {
  campaignName?: string;
  objective?: string;
  audience?: string;
  proposition?: string;
  product?: string;
  channels?: string[];
  notes?: string;
  [key: string]: unknown;
};

export type CreativeAssetContext = {
  id: string;
  sourceId?: string;
  lineage?: string;
  channel?: string;
  format?: string;
  dimensions?: string;
  headline?: string;
  copy?: string;
  cta?: string;
};

export type CreativeModification = {
  title: string;
  description: string;
  cta: string;
  prompt: string;
};

export type CreativeCampaignContext = {
  businessDomain: KnowledgeDomain;
  campaignType?: string;
  channel?: string;
};

export type CreativeInterpreterInput = {
  campaignBrief: AcceptedCampaignBrief;
  asset: CreativeAssetContext;
  modification: CreativeModification;
  campaignContext: CreativeCampaignContext;
};

export type NegativeSpace =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'balanced'
  | 'unspecified';

/**
 * Strict creative intent contract produced by Gemini and validated server-side.
 * Content fields are authoritative from the marketer form, not Gemini.
 */
export type CreativeSpecification = {
  businessDomain: KnowledgeDomain;
  campaignType: string;
  channel: string;
  content: {
    title: string;
    description: string;
    cta: string;
  };
  requestedChange: string;
  visualFamily: VisualFamily;
  composition: string;
  negativeSpace: NegativeSpace;
  tone: string[];
  preserve: string[];
  avoid: string[];
  accessibility: string[];
  /** Compact compatible KG brand rules (optional; never invents policy). */
  brandGuardrails?: string[];
  sourceAsset: {
    id: string;
    sourceId?: string;
    lineage?: string;
  };
};

/**
 * Safe visual-reference metadata for HTTP responses.
 * Never includes filesystem paths or resource-folder absolutes.
 */
export type PublicVisualReference = {
  id: string;
  title: string;
  category: 'visual-reference';
  businessDomain: KnowledgeDomain;
  mimeType: string;
  tags: string[];
  campaignType?: string;
  channel?: string;
  visualFamily?: VisualFamily;
};

export type VisualReferenceStatus =
  | 'selected'
  | 'no-approved-corporate-reference'
  | 'no-approved-retail-reference'
  | 'no-approved-reference';

export type CreativeInterpretationResult = {
  specification: CreativeSpecification;
  visualReference: PublicVisualReference | null;
  referenceStatus: VisualReferenceStatus;
};

/** Internal-only result used before stripping provenance for HTTP. */
export type CreativeInterpretationInternal = CreativeInterpretationResult & {
  groundingProvenance: Array<{
    entryId: string;
    sourceFile: string;
    page?: number;
    section?: string;
  }>;
  groundingText: string;
  providerMeta?: {
    model?: string;
    latencyMs?: number;
    usage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
  };
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };
