/**
 * Deterministic knowledge retrieval — no embeddings, no Gemini ranking.
 */

import { TEXTUAL_ENTRIES, VISUAL_ENTRIES, loadCatalogue } from './catalogue';
import { getBrandGuardrails } from './guardrails';
import { getVisualReferences, selectVisualReference } from './visualReferences';
import type {
  CampaignRetrievalQuery,
  KnowledgeCategory,
  KnowledgeDomain,
  TextualKnowledgeEntry,
  VisualKnowledgeEntry
} from './types';

const CHANNEL_TAGS: Record<string, string[]> = {
  email: ['email'],
  meta: ['meta', 'paid-media'],
  linkedin: ['linkedin', 'paid-media'],
  display: ['display', 'paid-media'],
  web: ['web', 'digital']
};

function domainAllows(entryDomain: KnowledgeDomain, requested: KnowledgeDomain): boolean {
  if (requested === 'unknown') return entryDomain === 'unknown';
  if (requested === 'corporate') {
    // Critical: never return retail personas/products for corporate campaigns.
    return entryDomain === 'corporate' || entryDomain === 'cross-business';
  }
  if (requested === 'retail') {
    return entryDomain === 'retail' || entryDomain === 'cross-business';
  }
  return entryDomain === 'cross-business';
}

export function getKnowledgeByDomain(domain: KnowledgeDomain): TextualKnowledgeEntry[] {
  return TEXTUAL_ENTRIES.filter((e) => e.businessDomain === domain).sort((a, b) => a.id.localeCompare(b.id));
}

export function getKnowledgeByCategory(category: KnowledgeCategory): TextualKnowledgeEntry[] {
  return TEXTUAL_ENTRIES.filter((e) => e.category === category).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Small, relevant set for a campaign context.
 * Caps results so callers never receive the entire library.
 */
export function getKnowledgeForCampaign(query: CampaignRetrievalQuery): {
  textual: TextualKnowledgeEntry[];
  visual: VisualKnowledgeEntry[];
  guardrails: ReturnType<typeof getBrandGuardrails>;
} {
  const { businessDomain, campaignType, channel } = query;
  const channelKey = (channel ?? '').toLowerCase();
  const channelTags = CHANNEL_TAGS[channelKey] ?? (channelKey ? [channelKey] : []);
  const campaign = (campaignType ?? '').toLowerCase();

  const scored = TEXTUAL_ENTRIES.filter((e) => domainAllows(e.businessDomain, businessDomain)).map((e) => {
    let score = 1;
    if (campaign) {
      if (e.tags.some((t) => t.includes(campaign) || campaign.includes(t))) score += 3;
      if (e.content.toLowerCase().includes(campaign)) score += 2;
      if (e.title.toLowerCase().includes(campaign)) score += 2;
    }
    if (channelTags.length) {
      if (e.tags.some((t) => channelTags.includes(t))) score += 3;
      if (channelTags.some((t) => e.content.toLowerCase().includes(t))) score += 1;
    }
    // Prefer brand / tone / product / proposition / persona / genstudio over noise.
    if (['brand', 'tone-of-voice', 'product', 'proposition', 'persona', 'genstudio', 'guardrail'].includes(e.category)) {
      score += 1;
    }
    return { e, score };
  });

  scored.sort((a, b) => b.score - a.score || a.e.id.localeCompare(b.e.id));

  const textual = scored.slice(0, 12).map((s) => s.e);
  const visual = getVisualReferences({
    businessDomain,
    campaignType,
    channel
  }).slice(0, 6);

  return {
    textual,
    visual,
    guardrails: getBrandGuardrails({ businessDomain })
  };
}

export function hasProvenance(entry: TextualKnowledgeEntry | VisualKnowledgeEntry): boolean {
  return Boolean(entry.sourceFile);
}

export {
  loadCatalogue,
  getBrandGuardrails,
  getVisualReferences,
  selectVisualReference,
  TEXTUAL_ENTRIES,
  VISUAL_ENTRIES
};
