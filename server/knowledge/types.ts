/**
 * Barclays knowledge-layer types.
 *
 * Derived only from files under
 * `../Barclays Brand Guidelines, Content & GS4PM Demo Support`.
 * Domains and categories are assigned from source evidence only —
 * uncertain material is `unknown`, never guessed as corporate.
 */

import type { VisualFamily } from './visualFamily';

export type { VisualFamily } from './visualFamily';
export { VISUAL_FAMILIES, isVisualFamily, normalizeVisualFamily, normalizeCampaignType } from './visualFamily';

export type KnowledgeDomain = 'corporate' | 'retail' | 'cross-business' | 'unknown';

export type KnowledgeCategory =
  | 'brand'
  | 'tone-of-voice'
  | 'product'
  | 'proposition'
  | 'persona'
  | 'audience'
  | 'campaign-example'
  | 'visual-reference'
  | 'logo'
  | 'genstudio'
  | 'firefly'
  | 'guardrail'
  | 'other';

export type ContentKind = 'text' | 'visual' | 'both';

export type VisualAssetKind =
  | 'logo'
  | 'campaign-creative'
  | 'visual-reference'
  | 'product-visual'
  | 'other';

export type SourceInventoryItem = {
  id: string;
  filename: string;
  relativePath: string;
  fileType: string;
  category: KnowledgeCategory;
  businessDomain: KnowledgeDomain;
  description: string;
  contentKind: ContentKind;
  bytes: number;
};

export type TextualKnowledgeEntry = {
  id: string;
  title: string;
  category: KnowledgeCategory;
  businessDomain: KnowledgeDomain;
  content: string;
  tags: string[];
  sourceFile: string;
  page?: number;
  section?: string;
};

export type VisualKnowledgeEntry = {
  id: string;
  title: string;
  category: 'visual-reference' | 'logo';
  businessDomain: KnowledgeDomain;
  assetPath: string;
  mimeType: string;
  tags: string[];
  sourceFile: string;
  assetKind: VisualAssetKind;
  campaignType?: string;
  /** Single primary channel, or omit when the asset is channel-agnostic. */
  channel?: string;
  /** Controlled generative visual family — omit for owned logos. */
  visualFamily?: VisualFamily;
};

export type KnowledgeRelationType =
  | 'appliesTo'
  | 'belongsTo'
  | 'defines'
  | 'hasProposition'
  | 'relevantTo'
  | 'hasNeed'
  | 'visualFamily'
  | 'usableFor'
  | 'derivedFrom'
  | 'constrains';

export type KnowledgeEntityType =
  | 'Source'
  | 'Domain'
  | 'BrandGuideline'
  | 'ToneOfVoice'
  | 'Product'
  | 'Proposition'
  | 'Persona'
  | 'Audience'
  | 'VisualReference'
  | 'Logo'
  | 'GenStudioGuidance'
  | 'Guardrail'
  | 'Channel'
  | 'VisualFamily';

export type KnowledgeNode = {
  id: string;
  type: KnowledgeEntityType;
  label: string;
  domain?: KnowledgeDomain;
  refId?: string;
};

export type KnowledgeEdge = {
  id: string;
  type: KnowledgeRelationType;
  from: string;
  to: string;
  evidenceSourceFile: string;
};

export type KnowledgeGraph = {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
};

export type CampaignRetrievalQuery = {
  businessDomain: KnowledgeDomain;
  campaignType?: string;
  channel?: string;
};

export type VisualReferenceQuery = {
  businessDomain: KnowledgeDomain;
  campaignType?: string;
  channel?: string;
  visualFamily?: VisualFamily | string;
  requestedChange?: string;
};

export type GeminiGroundingQuery = {
  businessDomain: KnowledgeDomain;
  campaignType?: string;
  channel?: string;
  categories?: KnowledgeCategory[];
};

export type GeminiGroundingBlock = {
  text: string;
  provenance: Array<{
    entryId: string;
    sourceFile: string;
    page?: number;
    section?: string;
  }>;
};
