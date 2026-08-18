/**
 * Builds Firefly prompts from a validated CreativeSpecification.
 *
 * Firefly generates the visual/background only.
 * Hard limit: Adobe rejects prompts over 1024 characters.
 *
 * Title / Description / CTA / DAM lineage / provenance stay out of the prompt.
 *
 * Construction priority (highest → lowest):
 * 1. user's requestedChange
 * 2. composition / negativeSpace requested by the user
 * 3. user-requested visual attributes (visualFamily, tone)
 * 4. approved brand / safety guardrails
 * 5. reference-image style guidance
 *
 * Compaction drops lower-priority sections first and protects requestedChange budget.
 */

import type { CreativeSpecification } from '../creative/types';
import type { FireflyContentClass, FireflyPromptInput, FireflyReferenceSource } from './types';

/** Adobe Firefly generate-async hard ceiling. */
export const FIREFLY_PROMPT_MAX_CHARS = 1024;

/** Preferred budget with margin under the provider ceiling. */
export const FIREFLY_PROMPT_TARGET_CHARS = 980;

const CRITICAL_NO_TEXT =
  'No readable text, pseudo-text, dashboards, UI screens, headlines, CTAs or labels.';
const CRITICAL_NO_LOGO = 'No generated logos or simulated Barclays marks.';

/**
 * Firefly v3 generate-async accepts `photo` or `art`; omitting it lets Firefly
 * infer from the prompt. An unclassified request must not inherit `art`.
 */
export function resolveFireflyContentClass(
  specification: CreativeSpecification
): FireflyContentClass | undefined {
  switch (specification.visualFamily) {
    case 'abstract-digital':
    case 'illustration':
    case 'interface-led':
      return 'art';
    case 'photographic':
    case 'lifestyle':
    case 'product-led':
      return 'photo';
    default:
      return undefined;
  }
}

function uniqueTrimmed(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function endsCleanly(prompt: string): boolean {
  return /[.!?]$/.test(prompt.trim());
}

function joinSentences(parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (/[.!?]$/.test(p) ? p : `${p}.`))
    .join(' ');
}

function pickPreserve(items: string[], limit: number): string[] {
  const ranked = uniqueTrimmed(items).map((item) => {
    let score = 0;
    if (/visual identity|brand|identity/i.test(item)) score += 5;
    if (/text[- ]?safe|negative space|safe area/i.test(item)) score += 4;
    if (/source|creative direction|composition/i.test(item)) score += 3;
    if (/lineage|dam|asset id|provenance/i.test(item)) score -= 10; // never for Firefly wording
    return { item, score };
  });
  return ranked
    .filter((r) => r.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.item);
}

function pickAvoid(items: string[], limit: number): string[] {
  const criticalPatterns = [
    /logo|barclays mark/i,
    /readable text|pseudo[- ]?text|marketing text/i,
    /dashboard|ui|interface/i,
    /people|person|human/i
  ];
  const unique = uniqueTrimmed(items);
  const selected: string[] = [];
  for (const pattern of criticalPatterns) {
    const hit = unique.find((u) => pattern.test(u) && !selected.includes(u));
    if (hit) selected.push(hit);
    if (selected.length >= limit) break;
  }
  for (const u of unique) {
    if (selected.length >= limit) break;
    if (!selected.includes(u)) selected.push(u);
  }
  return selected.slice(0, limit);
}

function pickAccessibility(items: string[], limit: number): string[] {
  return uniqueTrimmed(items)
    .filter((i) => /contrast|text[- ]?safe|safe area|legib|negative space/i.test(i))
    .slice(0, limit);
}

function shortenPhrase(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  // Prefer cutting at sentence / clause boundary.
  const cut = t.slice(0, max);
  const boundary = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '), cut.lastIndexOf(', '));
  if (boundary >= Math.floor(max * 0.5)) {
    return cut.slice(0, boundary).trim();
  }
  const word = cut.lastIndexOf(' ');
  return (word > 40 ? cut.slice(0, word) : cut).trim();
}

function referenceStyleGuidance(referenceSource: FireflyReferenceSource): string {
  if (referenceSource === 'knowledge-graph') {
    return 'Use the compatible approved visual reference as optional style support only; never override the user creative direction';
  }
  if (referenceSource === 'source-dam-asset') {
    return 'Use the currently selected asset as the edit source; preserve its overall identity while applying the requested visual change; do not override the requested visual change';
  }
  return '';
}

type PromptBudget = {
  /** Priority 1 — protected; shrink last. */
  requestedChangeMax: number;
  /** Priority 2 */
  compositionMax: number;
  includeNegativeSpace: boolean;
  /** Priority 3 */
  includeVisualFamily: boolean;
  toneLimit: number;
  includeChannel: boolean;
  /** Priority 4 — brand guardrails beyond critical invariants */
  preserveLimit: number;
  avoidLimit: number;
  accessibilityLimit: number;
  /** Priority 5 — drop first when over budget */
  includeReference: boolean;
};

function composeFromBudget(
  specification: CreativeSpecification,
  referenceSource: FireflyReferenceSource,
  budget: PromptBudget
): string {
  const parts: string[] = [];

  // 1. User requested change (highest priority)
  const change = shortenPhrase(specification.requestedChange, budget.requestedChangeMax);
  parts.push(change);

  // 2. Composition / negative space
  const composition = shortenPhrase(specification.composition, budget.compositionMax);
  if (composition) {
    parts.push(composition);
  }
  if (
    budget.includeNegativeSpace &&
    specification.negativeSpace &&
    specification.negativeSpace !== 'unspecified'
  ) {
    parts.push(`Keep clear negative space on the ${specification.negativeSpace}`);
  }

  // 3. User-requested visual attributes
  if (budget.includeVisualFamily) {
    const family = specification.visualFamily.replace(/-/g, ' ');
    parts.push(`Visual family: ${family}`);
  }
  if (budget.includeChannel && specification.channel && specification.channel !== 'unspecified') {
    parts.push(`Channel layout: ${specification.channel}`);
  }
  const tones = uniqueTrimmed(specification.tone).slice(0, budget.toneLimit);
  if (tones.length) {
    parts.push(`Tone: ${tones.join(', ')}`);
  }

  // 4. Approved brand / safety guardrails
  const preserve = pickPreserve(specification.preserve, budget.preserveLimit).map((p) =>
    shortenPhrase(p, 80)
  );
  if (preserve.length) {
    parts.push(`Preserve ${preserve.join('; ')}`);
  }
  // Critical avoid rules always present (compact).
  parts.push(CRITICAL_NO_TEXT);
  parts.push(CRITICAL_NO_LOGO);
  const brandRules = uniqueTrimmed(specification.brandGuardrails || []).slice(0, 4);
  if (brandRules.length) {
    parts.push(
      `Brand guidance: ${brandRules.map((r) => shortenPhrase(r, 90)).join('; ')}`
    );
  }
  const avoidExtra = pickAvoid(specification.avoid, budget.avoidLimit)
    .filter((a) => !/logo|barclays mark|readable text|pseudo/i.test(a))
    .map((a) => shortenPhrase(a, 70));
  if (avoidExtra.length) {
    parts.push(`Also avoid: ${avoidExtra.join('; ')}`);
  }
  const access = pickAccessibility(specification.accessibility, budget.accessibilityLimit).map((a) =>
    shortenPhrase(a, 70)
  );
  if (access.length) {
    parts.push(access.join('; '));
  }

  // 5. Reference-image style guidance (lowest priority; omitted first when compacting)
  if (budget.includeReference) {
    const reference = referenceStyleGuidance(referenceSource);
    if (reference) parts.push(reference);
  }

  return joinSentences(parts);
}

/**
 * Measure the previous verbose builder length for the same specification
 * (diagnostic / report only — not used for generation).
 */
export function measureLegacyFireflyPromptLength(input: FireflyPromptInput): number {
  const { specification, referenceSource } = input;
  const parts: string[] = [];
  parts.push(`Requested visual change: ${specification.requestedChange}`);
  parts.push(`Visual family: ${specification.visualFamily}`);
  parts.push(`Composition: ${specification.composition}`);
  parts.push(`Negative space preference: ${specification.negativeSpace}`);
  parts.push(`Channel context (layout only, not on-image text): ${specification.channel}`);
  if (specification.tone.length) parts.push(`Tone: ${specification.tone.join(', ')}`);
  if (specification.preserve.length) parts.push(`Preserve: ${specification.preserve.join('; ')}`);
  if (specification.avoid.length) parts.push(`Avoid: ${specification.avoid.join('; ')}`);
  if (specification.accessibility.length) {
    parts.push(`Accessibility: ${specification.accessibility.join('; ')}`);
  }
  const reference = referenceStyleGuidance(referenceSource);
  if (reference) parts.push(reference);
  parts.push(
    'Do not render any readable marketing text, headlines, CTAs, UI labels, dashboard text, or logos. Leave clean negative space for owned brand and content composition outside generation.'
  );
  parts.push('Do not generate, imitate, or approximate the Barclays logo or any simulated Barclays marks.');
  return parts.join('\n').length;
}

/**
 * Assembles a Firefly prompt from the validated specification.
 * Guarantees length <= FIREFLY_PROMPT_MAX_CHARS via priority-aware compaction.
 */
export function buildFireflyPrompt(input: FireflyPromptInput): string {
  const { specification, referenceSource } = input;

  // Compaction order: drop priority-5 → shrink brand extras → shrink attributes →
  // then composition → only then shorten requestedChange.
  const budgets: PromptBudget[] = [
    {
      requestedChangeMax: 360,
      compositionMax: 180,
      includeNegativeSpace: true,
      includeVisualFamily: true,
      toneLimit: 4,
      includeChannel: true,
      preserveLimit: 3,
      avoidLimit: 3,
      accessibilityLimit: 2,
      includeReference: true
    },
    {
      requestedChangeMax: 340,
      compositionMax: 160,
      includeNegativeSpace: true,
      includeVisualFamily: true,
      toneLimit: 3,
      includeChannel: true,
      preserveLimit: 2,
      avoidLimit: 2,
      accessibilityLimit: 1,
      includeReference: false
    },
    {
      requestedChangeMax: 320,
      compositionMax: 140,
      includeNegativeSpace: true,
      includeVisualFamily: true,
      toneLimit: 2,
      includeChannel: false,
      preserveLimit: 1,
      avoidLimit: 1,
      accessibilityLimit: 0,
      includeReference: false
    },
    {
      requestedChangeMax: 300,
      compositionMax: 120,
      includeNegativeSpace: true,
      includeVisualFamily: true,
      toneLimit: 2,
      includeChannel: false,
      preserveLimit: 1,
      avoidLimit: 0,
      accessibilityLimit: 0,
      includeReference: false
    },
    {
      requestedChangeMax: 280,
      compositionMax: 100,
      includeNegativeSpace: true,
      includeVisualFamily: true,
      toneLimit: 0,
      includeChannel: false,
      preserveLimit: 0,
      avoidLimit: 0,
      accessibilityLimit: 0,
      includeReference: false
    }
  ];

  let prompt = '';
  for (const budget of budgets) {
    prompt = composeFromBudget(specification, referenceSource, budget);
    if (prompt.length <= FIREFLY_PROMPT_TARGET_CHARS && endsCleanly(prompt)) {
      break;
    }
  }

  // Last resort: keep requestedChange + negative space + critical guardrails.
  if (prompt.length > FIREFLY_PROMPT_MAX_CHARS || !endsCleanly(prompt)) {
    prompt = composeFromBudget(specification, referenceSource, {
      requestedChangeMax: 240,
      compositionMax: 80,
      includeNegativeSpace: true,
      includeVisualFamily: true,
      toneLimit: 0,
      includeChannel: false,
      preserveLimit: 0,
      avoidLimit: 0,
      accessibilityLimit: 0,
      includeReference: false
    });
  }

  if (prompt.length > FIREFLY_PROMPT_MAX_CHARS) {
    const change = shortenPhrase(specification.requestedChange, 200);
    const ns =
      specification.negativeSpace && specification.negativeSpace !== 'unspecified'
        ? ` Keep clear negative space on the ${specification.negativeSpace}.`
        : '';
    prompt = joinSentences([
      change,
      `Visual family: ${specification.visualFamily.replace(/-/g, ' ')}`,
      ns.trim(),
      CRITICAL_NO_TEXT,
      CRITICAL_NO_LOGO
    ]);
  }

  if (prompt.length > FIREFLY_PROMPT_MAX_CHARS) {
    throw new Error(
      `Firefly prompt compaction failed to stay under ${FIREFLY_PROMPT_MAX_CHARS} characters (got ${prompt.length})`
    );
  }

  return prompt;
}

/** Guard: marketer free-text prompt must never be the Firefly prompt body. */
export function assertPromptNotRawMarketerText(
  fireflyPrompt: string,
  marketerPrompt: string | undefined
): void {
  if (!marketerPrompt?.trim()) return;
  const raw = marketerPrompt.trim();
  if (fireflyPrompt.trim() === raw) {
    throw new Error('Firefly prompt must not equal the raw marketer prompt');
  }
}

export function promptContainsBannedContentInstructions(prompt: string): boolean {
  return /render (the )?(title|description|cta|logo)|bake (in )?(title|cta|logo)/i.test(prompt);
}

export function promptExcludesNonVisualMetadata(
  prompt: string,
  specification: CreativeSpecification
): boolean {
  const lower = prompt.toLowerCase();
  if (specification.content.title && lower.includes(specification.content.title.toLowerCase())) {
    // Allow title only if it accidentally overlaps short shared words — require full phrase.
    if (prompt.includes(specification.content.title)) return false;
  }
  if (prompt.includes(specification.content.description)) return false;
  if (prompt.includes(specification.content.cta) && specification.content.cta.length > 3) return false;
  if (/adobe dam|lineage|provenance|gemini|genstudio/i.test(prompt)) return false;
  if (specification.sourceAsset.id && prompt.includes(specification.sourceAsset.id)) return false;
  return true;
}

/**
 * Significant visual-intent tokens from a marketer prompt (for tests / intent checks).
 * Filters out stopwords so materially different prompts yield different token sets.
 */
export function significantVisualIntentTokens(text: string): string[] {
  const stop = new Set([
    'the',
    'a',
    'an',
    'and',
    'or',
    'to',
    'of',
    'in',
    'on',
    'for',
    'with',
    'more',
    'make',
    'leave',
    'keep',
    'please',
    'just',
    'very',
    'into',
    'from'
  ]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4 && !stop.has(t));
}

export type { CreativeSpecification, FireflyReferenceSource };
