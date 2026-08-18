/**
 * Compact creative grounding for live Modify / Regenerate.
 *
 * Reuses retrieval, guardrails and visual-reference selection — does not
 * duplicate domain filtering. Never invents rules when none are compatible.
 */

import { getBrandGuardrails } from './guardrails';
import { getKnowledgeForCampaign } from './retrieval';
import { selectVisualReference } from './visualReferences';
import type { KnowledgeCategory, KnowledgeDomain, VisualFamily } from './types';
import { normalizeVisualFamily } from './visualFamily';

/** Friendly provenance for UI/metadata — never filesystem paths. */
export type CreativeGroundingProvenance = {
  entryId: string;
  title: string;
  sourceFile: string;
  category: KnowledgeCategory | 'guardrail';
};

export type CreativeGroundingQuery = {
  businessDomain: KnowledgeDomain;
  campaignType?: string;
  channel?: string;
  product?: string;
  visualFamily?: VisualFamily | string;
  requestedChange?: string;
};

/** Public visual-reference shape without absolute paths (mirrors creative types). */
export type PublicVisualReferenceLike = {
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

export type CreativeGrounding = {
  /** Compact rules safe to append to image-edit / generation prompts. */
  guardrails: string[];
  provenance: CreativeGroundingProvenance[];
  /** Domain-safe KG visual reference, or null when none is compatible. */
  visualReference: PublicVisualReferenceLike | null;
  /** True only when at least one compatible rule or visual was retrieved. */
  grounded: boolean;
};

/** Categories that are safe to surface as creative brand guidance (never product dumps). */
const GUIDANCE_CATEGORIES = new Set<KnowledgeCategory>([
  'brand',
  'tone-of-voice',
  'genstudio',
  'guardrail',
  'proposition',
  'audience'
]);

/** Hard exclusions so retail product/persona noise never reaches corporate prompts. */
const RETAIL_LEAK_PATTERN =
  /\b(mortgage|credit.?card|barclaycard|personal.?loan|first.?time.?buyer|rising.?metropolitans|asset.?rich.?greys|starting.?out|fresco)\b/i;

const MAX_GUARDRAILS = 6;
const MAX_RULE_CHARS = 160;

function compactRule(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= MAX_RULE_CHARS) return cleaned;
  const cut = cleaned.slice(0, MAX_RULE_CHARS - 1);
  const word = cut.lastIndexOf(' ');
  return `${(word > 40 ? cut.slice(0, word) : cut).trim()}…`;
}

function isCompatibleTextual(
  businessDomain: KnowledgeDomain,
  category: KnowledgeCategory,
  title: string,
  content: string
): boolean {
  if (!GUIDANCE_CATEGORIES.has(category)) return false;
  // Domain filter already applied by getKnowledgeForCampaign; this is defence in depth
  // against accidental retail product/persona leakage into corporate prompts.
  if (businessDomain === 'corporate' && RETAIL_LEAK_PATTERN.test(`${title} ${content}`)) {
    return false;
  }
  return true;
}

function toPublicVisualReference(
  entry: NonNullable<ReturnType<typeof selectVisualReference>>
): PublicVisualReferenceLike {
  return {
    id: entry.id,
    title: entry.title,
    category: 'visual-reference',
    businessDomain: entry.businessDomain,
    mimeType: entry.mimeType,
    tags: [...entry.tags],
    campaignType: entry.campaignType,
    channel: entry.channel,
    visualFamily: entry.visualFamily
  };
}

/**
 * Retrieves compact, domain-safe brand guidance for creative Modify / Regenerate.
 * Does not invent rules. Corporate/iPortal never receives retail product or persona content.
 */
export function getCreativeGrounding(query: CreativeGroundingQuery): CreativeGrounding {
  const {
    businessDomain,
    campaignType,
    channel,
    product,
    visualFamily,
    requestedChange
  } = query;

  const campaignHint = [campaignType, product].filter(Boolean).join(' ').trim() || undefined;
  const family = visualFamily
    ? normalizeVisualFamily(String(visualFamily), { requestedChange })
    : undefined;

  const campaign = getKnowledgeForCampaign({
    businessDomain,
    campaignType: campaignHint,
    channel
  });
  const brandGuardrails = getBrandGuardrails({ businessDomain });

  const provenance: CreativeGroundingProvenance[] = [];
  const guardrails: string[] = [];
  const seen = new Set<string>();

  const pushRule = (
    entryId: string,
    title: string,
    sourceFile: string,
    category: KnowledgeCategory | 'guardrail',
    rule: string
  ) => {
    const compact = compactRule(rule);
    if (!compact || seen.has(compact.toLowerCase())) return;
    if (guardrails.length >= MAX_GUARDRAILS) return;
    seen.add(compact.toLowerCase());
    guardrails.push(compact);
    provenance.push({ entryId, title, sourceFile, category });
  };

  // Prefer explicit guardrail objects (already domain-filtered).
  for (const g of brandGuardrails) {
    if (businessDomain === 'corporate' && RETAIL_LEAK_PATTERN.test(`${g.title} ${g.rule}`)) {
      continue;
    }
    pushRule(g.id, g.title, g.sourceFile, 'guardrail', `${g.title}: ${g.rule}`);
  }

  // Supplement with compact campaign textual guidance (GS4PM, brand, tone, etc.).
  for (const entry of campaign.textual) {
    if (!isCompatibleTextual(businessDomain, entry.category, entry.title, entry.content)) {
      continue;
    }
    // Skip entries already represented via getBrandGuardrails derivation.
    if (provenance.some((p) => p.entryId === entry.id || p.entryId.startsWith(`gr-${entry.id}-`))) {
      continue;
    }
    pushRule(
      entry.id,
      entry.title,
      entry.sourceFile,
      entry.category,
      `${entry.title}: ${entry.content}`
    );
  }

  const selected = selectVisualReference({
    businessDomain,
    campaignType: campaignHint,
    channel,
    visualFamily: family ?? undefined,
    requestedChange
  });

  // Logos are never generative references (selector already excludes them).
  const visualReference =
    selected && selected.category !== 'logo' && selected.assetKind !== 'logo'
      ? toPublicVisualReference(selected)
      : null;

  if (visualReference) {
    provenance.push({
      entryId: visualReference.id,
      title: visualReference.title,
      sourceFile: selected!.sourceFile,
      category: 'visual-reference'
    });
  }

  return {
    guardrails,
    provenance,
    visualReference,
    grounded: guardrails.length > 0 || visualReference != null
  };
}

/** Compact metadata safe to attach to derived assets / UI — no document text. */
export type BrandGroundingMetadata = {
  applied: boolean;
  entryIds: string[];
  sources: string[];
  ruleCount: number;
};

export function toBrandGroundingMetadata(grounding: CreativeGrounding): BrandGroundingMetadata {
  const sources = [...new Set(grounding.provenance.map((p) => p.sourceFile))];
  return {
    applied: grounding.grounded,
    entryIds: grounding.provenance.map((p) => p.entryId),
    sources,
    ruleCount: grounding.guardrails.length
  };
}
