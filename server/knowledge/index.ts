/**
 * Server-side Barclays Knowledge Graph / Knowledge Base layer.
 *
 * Source of truth: sibling folder
 *   ../Barclays Brand Guidelines, Content & GS4PM Demo Support
 *
 * This module is intentionally NOT imported by the Vite client bundle.
 * It prepares retrieval and grounding for later Gemini / Firefly work
 * without calling those providers.
 */

export * from './types';
export { RESOURCE_FOLDER_NAME, resolveResourceRoot, resourceExists, joinResourcePath } from './paths';
export { inventoryResources, tryInventoryResources } from './inventory';
export {
  TEXTUAL_ENTRIES,
  VISUAL_ENTRIES,
  loadCatalogue,
  getTextualEntry,
  getVisualEntry
} from './catalogue';
export { buildKnowledgeGraph, getGraphSummary } from './graph';
export {
  getKnowledgeByDomain,
  getKnowledgeByCategory,
  getKnowledgeForCampaign,
  hasProvenance
} from './retrieval';
export {
  getVisualReferences,
  selectVisualReference,
  listLogoAssets,
  listGenerativeVisualReferences,
  resolveVisualAbsolutePath
} from './visualReferences';
export { getBrandGuardrails } from './guardrails';
export { buildGeminiGrounding } from './grounding';
export {
  getCreativeGrounding,
  toBrandGroundingMetadata
} from './creativeGrounding';
export type {
  BrandGroundingMetadata,
  CreativeGrounding,
  CreativeGroundingProvenance,
  CreativeGroundingQuery,
  PublicVisualReferenceLike
} from './creativeGrounding';
export {
  VISUAL_FAMILIES,
  isVisualFamily,
  normalizeVisualFamily,
  normalizeCampaignType
} from './visualFamily';
export type { VisualFamily } from './visualFamily';
