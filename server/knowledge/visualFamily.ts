/**
 * Controlled visual-family vocabulary shared by the knowledge catalogue
 * and the Creative Interpreter. Keeps Firefly reference matching deterministic.
 */

export const VISUAL_FAMILIES = [
  'abstract-digital',
  'photographic',
  'lifestyle',
  'product-led',
  'interface-led',
  'illustration',
  'other'
] as const;

export type VisualFamily = (typeof VISUAL_FAMILIES)[number];

const LEGACY_VISUAL_FAMILY_MAP: Record<string, VisualFamily> = {
  'abstract-digital': 'abstract-digital',
  photographic: 'photographic',
  lifestyle: 'lifestyle',
  'lifestyle-home': 'lifestyle',
  'product-led': 'product-led',
  'mortgage-product': 'product-led',
  'interface-led': 'interface-led',
  illustration: 'illustration',
  other: 'other'
};

export function isVisualFamily(value: string): value is VisualFamily {
  return (VISUAL_FAMILIES as readonly string[]).includes(value);
}

/**
 * Maps Gemini / legacy free-text visualFamily values onto the controlled enum.
 * Returns null when mapping is not obvious — callers must fail validation.
 *
 * Context (requestedChange / composition) may only reinforce an already-plausible
 * raw family (e.g. "Barclays Corporate iPortal"). Arbitrary free text is rejected
 * even if the prompt mentions cyan ribbons.
 */
export function normalizeVisualFamily(
  raw: string,
  context?: { requestedChange?: string; composition?: string }
): VisualFamily | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const key = trimmed.toLowerCase().replace(/_/g, '-').replace(/\s+/g, ' ').trim();

  if (LEGACY_VISUAL_FAMILY_MAP[key]) return LEGACY_VISUAL_FAMILY_MAP[key];
  if (isVisualFamily(key)) return key;

  const hint = `${trimmed} ${context?.requestedChange ?? ''} ${context?.composition ?? ''}`.toLowerCase();
  const rawLooksCorporateAbstract =
    /barclays\s+corporate\s+iportal|corporate\s+iportal|\biportal\b|abstract(?:\s|-)?digital|flowing(?:\s|-)?light|cyan\s+ribbons?/.test(
      key
    );

  // Obvious Corporate iPortal / abstract creative wording — only when the raw
  // family itself signals that direction (not merely the surrounding prompt).
  if (rawLooksCorporateAbstract) {
    if (
      /cyan|ribbon|abstract|flowing|dark(?:er)?\s+background|negative\s+space|iportal|corporate/.test(hint) ||
      rawLooksCorporateAbstract
    ) {
      return 'abstract-digital';
    }
  }

  if (/^abstract(?:\s|-)?digital$/.test(key)) return 'abstract-digital';
  if (/^photographic$|^\bphoto\b$|^photography$/.test(key)) return 'photographic';
  if (/^lifestyle$|^lifestyle-home$/.test(key)) return 'lifestyle';
  if (/^product-led$|^mortgage-product$|^product$/.test(key)) return 'product-led';
  if (/^interface-led$|^interface$/.test(key)) return 'interface-led';
  if (/^illustration$|^illustrated$/.test(key)) return 'illustration';
  if (/^other$/.test(key)) return 'other';

  return null;
}

/** Campaign-type aliases used for deterministic visual-reference matching. */
export function normalizeCampaignType(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined;
  const key = raw.trim().toLowerCase();
  if (key === 'iportal' || key === 'iportal-digital-adoption' || key.includes('iportal')) {
    return 'iportal-digital-adoption';
  }
  if (key.includes('mortgage')) return 'mortgage';
  return raw.trim();
}
