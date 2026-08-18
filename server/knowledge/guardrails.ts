/**
 * Guardrails derived only from explicit source statements.
 * No invented Barclays policy.
 */

import { TEXTUAL_ENTRIES } from './catalogue';
import type { KnowledgeDomain, TextualKnowledgeEntry } from './types';

export type BrandGuardrail = {
  id: string;
  title: string;
  rule: string;
  businessDomain: KnowledgeDomain;
  sourceFile: string;
  page?: number;
  section?: string;
  tags: string[];
};

function fromEntry(entry: TextualKnowledgeEntry, title: string, rule: string, tags: string[]): BrandGuardrail {
  return {
    id: `gr-${entry.id}-${tags[0] ?? 'rule'}`,
    title,
    rule,
    businessDomain: entry.businessDomain,
    sourceFile: entry.sourceFile,
    page: entry.page,
    section: entry.section,
    tags
  };
}

/**
 * Builds the guardrail set from catalogue entries that already carry
 * restriction / image / branding language. Cross-business logo ownership
 * is only stated where the resource pack supplies owned logo assets plus
 * the retail image guideline requiring approved logo placement.
 */
export function getBrandGuardrails(options: { businessDomain: KnowledgeDomain }): BrandGuardrail[] {
  const { businessDomain } = options;
  const results: BrandGuardrail[] = [];

  const editorial = TEXTUAL_ENTRIES.find((e) => e.id === 'txt-editorial-restrictions');
  if (editorial && (businessDomain === 'retail' || businessDomain === 'cross-business')) {
    results.push(
      fromEntry(editorial, 'No fear-based or pressuring urgency', 'Avoid fear-based messaging or urgency that pressures decision-making.', [
        'messaging',
        'urgency'
      ]),
      fromEntry(editorial, 'No slang, sarcasm or overly casual language', 'Do not use slang, sarcasm, or overly casual language.', [
        'tone',
        'language'
      ]),
      fromEntry(editorial, 'No unsubstantiated claims', 'Never make unsubstantiated claims or promises.', ['claims', 'compliance']),
      fromEntry(editorial, 'Readable sentence structure', 'Avoid complex sentence structures that hinder readability.', ['readability'])
    );
  }

  const images = TEXTUAL_ENTRIES.find((e) => e.id === 'txt-image-guidelines');
  if (images && (businessDomain === 'retail' || businessDomain === 'cross-business')) {
    results.push(
      fromEntry(images, 'Inclusive real-people imagery', 'Use clean, modern, inclusive imagery reflecting real people and everyday moments; avoid overly staged or corporate imagery.', [
        'imagery',
        'inclusivity'
      ]),
      fromEntry(images, 'Accessibility for imagery', 'Ensure high contrast, alt text, and mobile responsiveness.', [
        'accessibility',
        'imagery'
      ]),
      fromEntry(images, 'Approved branding and logo placement', "Use Barclays’ approved colour palette, typography, and logo placement.", [
        'logo',
        'branding'
      ])
    );
  }

  const meta = TEXTUAL_ENTRIES.find((e) => e.id === 'txt-meta-ads-guidelines');
  if (meta && (businessDomain === 'retail' || businessDomain === 'cross-business')) {
    results.push(
      fromEntry(meta, 'Meta image text limit', 'Keep text under 20% of image area; use brand fonts and colours; ensure mobile legibility.', [
        'meta',
        'imagery'
      ])
    );
  }

  // Owned logos exist as cross-business visual assets. The retail image guideline
  // requires approved logo placement — together these support a logo-ownership
  // guardrail for generative workflows without inventing extra policy.
  if (businessDomain === 'cross-business' || businessDomain === 'retail' || businessDomain === 'corporate') {
    results.push({
      id: 'gr-owned-logo-assets',
      title: 'Use owned Barclays logo assets',
      rule: 'Use only the owned Barclays logo assets supplied in the brand resource pack (SVG wordmark and PNG eagle logo). Do not invent or generate alternative Barclays logos.',
      businessDomain: 'cross-business',
      sourceFile: 'Barclays-Logo.wine.svg',
      section: 'Owned logo assets + Image Guidelines logo placement',
      tags: ['logo', 'owned-asset', 'generative']
    });
  }

  // Domain filter: corporate callers still receive cross-business logo rules,
  // but not retail-only editorial entries.
  return results.filter((g) => {
    switch (businessDomain) {
      case 'unknown':
        return false;
      case 'corporate':
        return g.businessDomain === 'cross-business';
      case 'retail':
        return g.businessDomain === 'retail' || g.businessDomain === 'cross-business';
      case 'cross-business':
        return g.businessDomain === 'cross-business';
      default:
        return false;
    }
  });
}
