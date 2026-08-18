/**
 * Formats selected knowledge into a compact Gemini grounding block.
 * Not wired into any Gemini call in this phase.
 */

import { getKnowledgeForCampaign } from './retrieval';
import { getBrandGuardrails } from './guardrails';
import type { GeminiGroundingBlock, GeminiGroundingQuery, KnowledgeCategory } from './types';

export function buildGeminiGrounding(query: GeminiGroundingQuery): GeminiGroundingBlock {
  const { businessDomain, campaignType, channel, categories } = query;
  const selected = getKnowledgeForCampaign({ businessDomain, campaignType, channel });
  const allowedCategories = categories?.length ? new Set<KnowledgeCategory>(categories) : null;

  const textual = selected.textual.filter((e) => (allowedCategories ? allowedCategories.has(e.category) : true));
  const guardrails = getBrandGuardrails({ businessDomain });

  const lines: string[] = [];
  lines.push(`Barclays knowledge grounding (domain=${businessDomain}${campaignType ? `; campaign=${campaignType}` : ''}${channel ? `; channel=${channel}` : ''}).`);
  lines.push('Use only the facts below. Do not invent products, personas or brand rules not listed.');

  if (textual.length === 0 && guardrails.length === 0) {
    lines.push('No domain-specific textual knowledge was available in the resource pack for this request.');
  }

  for (const entry of textual.slice(0, 10)) {
    const provenance = [entry.sourceFile, entry.page != null ? `p.${entry.page}` : null, entry.section]
      .filter(Boolean)
      .join(' · ');
    lines.push(`[${entry.category}] ${entry.title}: ${entry.content} (${provenance})`);
  }

  if (guardrails.length) {
    lines.push('Guardrails:');
    for (const g of guardrails.slice(0, 8)) {
      lines.push(`- ${g.title}: ${g.rule} (${g.sourceFile}${g.page != null ? ` · p.${g.page}` : ''})`);
    }
  }

  return {
    text: lines.join('\n'),
    provenance: [
      ...textual.map((e) => ({
        entryId: e.id,
        sourceFile: e.sourceFile,
        page: e.page,
        section: e.section
      })),
      ...guardrails.map((g) => ({
        entryId: g.id,
        sourceFile: g.sourceFile,
        page: g.page,
        section: g.section
      }))
    ]
  };
}
