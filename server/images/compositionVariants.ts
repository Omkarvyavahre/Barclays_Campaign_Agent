/**
 * Approved composition variants for Firefly background generation.
 *
 * Each channel keeps a small closed catalogue of abstract ribbon arrangements.
 * Automatic generation always uses variant 0 (the signed-off recipe). Explicit
 * manual regeneration may select a different variant via a deterministic hash of
 * a composition identity — never via Math.random().
 *
 * Variants change framing and ribbon geometry only. They never ask Firefly to
 * draw logos, headlines, CTAs or readable copy.
 */

import type { ImageChannel } from './types.ts';

export interface CompositionVariant {
  id: string;
  visual: string;
  framing: string;
}

/** FNV-1a 32-bit. Same identity always maps to the same unsigned integer. */
export function hashCompositionIdentity(identity: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < identity.length; index++) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * LinkedIn catalogue. Index 0 is the frozen approved recipe used by automatic
 * generation; later entries are deliberate geometric alternatives.
 */
export const LINKEDIN_COMPOSITION_VARIANTS: readonly CompositionVariant[] = [
  {
    id: 'linkedin-ribbons-side',
    visual:
      'Premium abstract digital banking artwork on a deep navy and rich Barclays-blue background. Luminous cyan and turquoise ribbons sweep across the composition in elegant layered curves, with fine light trails and subtle depth.',
    framing: 'Wide composition, ribbons gathered to one side, generous clean negative space beside them.',
  },
  {
    id: 'linkedin-ribbons-left',
    visual:
      'Premium abstract digital banking artwork on a deep navy and rich Barclays-blue background. Soft cyan and turquoise ribbons arc from the lower left in layered curves, with delicate light trails and quiet depth.',
    framing: 'Wide composition, ribbons concentrated on the left third, open dark navy field across the right.',
  },
  {
    id: 'linkedin-ribbons-upper',
    visual:
      'Premium abstract digital banking artwork on a deep navy and rich Barclays-blue background. Elegant cyan ribbons drift through the upper half in smooth layered sweeps, with sparse light trails and restrained luminosity.',
    framing: 'Wide composition, ribbons held high, generous calm negative space across the lower field.',
  },
];

/**
 * Email catalogue. Index 0 is the quieter approved crop-safe recipe; later
 * entries keep the single-ribbon constraint while changing the diagonal.
 */
export const EMAIL_COMPOSITION_VARIANTS: readonly CompositionVariant[] = [
  {
    id: 'email-diagonal-up',
    visual:
      'Premium abstract artwork on a deep navy and rich Barclays-blue background. One elegant luminous cyan and turquoise ribbon sweeps smoothly from lower left to upper right, with at most one faint secondary light trail.',
    framing:
      'Single continuous diagonal flow, no crossing or converging ribbons and no bright focal knot; narrow highlights, calm dark navy negative space across the left, clean balance to the right.',
  },
  {
    id: 'email-diagonal-down',
    visual:
      'Premium abstract artwork on a deep navy and rich Barclays-blue background. One elegant luminous cyan and turquoise ribbon sweeps smoothly from upper left to lower right, with at most one faint secondary light trail.',
    framing:
      'Single continuous descending diagonal, no crossing ribbons and no bright focal knot; narrow highlights, calm dark navy negative space across the right, clean balance to the left.',
  },
  {
    id: 'email-quiet-centre',
    visual:
      'Premium abstract artwork on a deep navy and rich Barclays-blue background. One soft cyan ribbon drifts gently across the frame with minimal secondary glow and restrained highlights.',
    framing:
      'Quiet single-ribbon flow, no intersections and no bright knot; wide calm navy negative space on both sides for a narrow crop.',
  },
];

export const COMPOSITION_VARIANTS: Record<ImageChannel, readonly CompositionVariant[]> = {
  linkedin: LINKEDIN_COMPOSITION_VARIANTS,
  email: EMAIL_COMPOSITION_VARIANTS,
};

/**
 * Picks an approved variant for a channel.
 *
 * No identity → always variant 0 (automatic / default path).
 * With identity → deterministic index into the channel catalogue.
 */
export function selectCompositionVariant(
  channel: ImageChannel,
  compositionIdentity?: string,
): CompositionVariant {
  const variants = COMPOSITION_VARIANTS[channel];
  if (!compositionIdentity) return variants[0];
  return variants[hashCompositionIdentity(compositionIdentity) % variants.length];
}

/** Exported for tests: how many approved alternatives a channel may choose from. */
export function compositionVariantCount(channel: ImageChannel): number {
  return COMPOSITION_VARIANTS[channel].length;
}
