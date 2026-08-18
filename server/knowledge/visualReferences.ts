/**
 * Visual-reference catalogue helpers for later Firefly selection.
 * Deterministic only — no generation, no provider calls.
 */

import { VISUAL_ENTRIES } from './catalogue';
import { joinResourcePath } from './paths';
import { normalizeCampaignType, normalizeVisualFamily } from './visualFamily';
import type { VisualKnowledgeEntry, VisualReferenceQuery } from './types';

export function listLogoAssets(): VisualKnowledgeEntry[] {
  return VISUAL_ENTRIES.filter((v) => v.category === 'logo' || v.assetKind === 'logo');
}

export function listGenerativeVisualReferences(): VisualKnowledgeEntry[] {
  // Logos are owned brand marks — not generative reference imagery.
  return VISUAL_ENTRIES.filter((v) => v.category === 'visual-reference' && v.assetKind !== 'logo');
}

function campaignTypesMatch(entryCampaignType: string | undefined, requested?: string): boolean {
  if (!requested) return true;
  if (!entryCampaignType) return true; // unscoped entry remains eligible
  const a = normalizeCampaignType(entryCampaignType);
  const b = normalizeCampaignType(requested);
  return Boolean(a && b && a === b);
}

export function getVisualReferences(query: VisualReferenceQuery): VisualKnowledgeEntry[] {
  const { businessDomain, campaignType, channel, visualFamily } = query;
  const family = visualFamily ? normalizeVisualFamily(String(visualFamily)) : null;

  return listGenerativeVisualReferences()
    .filter((v) => {
      if (businessDomain === 'unknown') return v.businessDomain === 'unknown';
      // Never leak retail visuals into corporate campaigns.
      if (businessDomain === 'corporate') {
        return v.businessDomain === 'corporate' || v.businessDomain === 'cross-business';
      }
      if (businessDomain === 'retail') {
        return v.businessDomain === 'retail' || v.businessDomain === 'cross-business';
      }
      return v.businessDomain === 'cross-business';
    })
    .filter((v) => campaignTypesMatch(v.campaignType, campaignType))
    .filter((v) => (channel ? !v.channel || v.channel === channel || v.channel === 'digital' : true))
    .filter((v) => (family ? v.visualFamily === family : true))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Deterministic selection for a later Firefly step.
 * Prefers exact campaignType + visualFamily matches, then campaignType,
 * then the first remaining domain-safe visual. Logos are never selected.
 */
export function selectVisualReference(query: VisualReferenceQuery): VisualKnowledgeEntry | null {
  const candidates = getVisualReferences(query);
  if (candidates.length === 0) return null;

  const { campaignType, visualFamily, requestedChange } = query;
  const normalizedCampaign = normalizeCampaignType(campaignType);
  const family = visualFamily ? normalizeVisualFamily(String(visualFamily), { requestedChange }) : null;
  const change = (requestedChange ?? '').toLowerCase();

  const scored = candidates.map((v) => {
    let score = 0;
    if (normalizedCampaign && normalizeCampaignType(v.campaignType) === normalizedCampaign) score += 4;
    if (family && v.visualFamily === family) score += 3;
    if (change) {
      for (const tag of v.tags) {
        if (change.includes(tag)) score += 1;
      }
      if (v.campaignType && change.includes(v.campaignType)) score += 2;
      if (v.visualFamily && change.includes(v.visualFamily.replace(/-/g, ' '))) score += 2;
    }
    return { v, score };
  });

  scored.sort((a, b) => b.score - a.score || a.v.id.localeCompare(b.v.id));
  return scored[0]?.v ?? null;
}

/** Absolute filesystem path for server-side use only — never ship to the client. */
export function resolveVisualAbsolutePath(entry: VisualKnowledgeEntry): string {
  return joinResourcePath(entry.assetPath);
}
