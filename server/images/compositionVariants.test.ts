/**
 * Composition variants: deterministic selection without Math.random.
 */

import { describe, expect, it } from 'vitest';

import {
  COMPOSITION_VARIANTS,
  compositionVariantCount,
  hashCompositionIdentity,
  selectCompositionVariant,
} from './compositionVariants.ts';
import { ABSTRACT_FRAMING, ABSTRACT_VISUAL, EMAIL_FRAMING, EMAIL_VISUAL, buildCreativePrompt } from './prompt.ts';
import type { ImageGenerationRequest } from './types.ts';

function request(overrides: Partial<ImageGenerationRequest> = {}): ImageGenerationRequest {
  return {
    channel: 'linkedin',
    campaignContext: {
      objective: 'Deepen digital adoption across corporate clients.',
      audience: 'Corporate treasury and payments teams.',
      businessNeed: 'Manual servicing creates friction and delay.',
      proposition: 'One connected digital front door for servicing.',
      creativeDirection: 'Premium, calm and confident digital transformation.',
    },
    outputContext: { headline: 'Discover what is possible', cta: 'Explore iPortal' },
    ...overrides,
  };
}

describe('composition variant catalogue', () => {
  it('keeps variant 0 identical to the signed-off channel recipes', () => {
    expect(COMPOSITION_VARIANTS.linkedin[0].visual).toBe(ABSTRACT_VISUAL);
    expect(COMPOSITION_VARIANTS.linkedin[0].framing).toBe(ABSTRACT_FRAMING);
    expect(COMPOSITION_VARIANTS.email[0].visual).toBe(EMAIL_VISUAL);
    expect(COMPOSITION_VARIANTS.email[0].framing).toBe(EMAIL_FRAMING);
  });

  it('offers more than one approved variant per channel', () => {
    expect(compositionVariantCount('linkedin')).toBeGreaterThan(1);
    expect(compositionVariantCount('email')).toBeGreaterThan(1);
  });

  it('defaults to variant 0 when no identity is supplied', () => {
    expect(selectCompositionVariant('linkedin').id).toBe(COMPOSITION_VARIANTS.linkedin[0].id);
    expect(selectCompositionVariant('email').id).toBe(COMPOSITION_VARIANTS.email[0].id);
  });

  it('selects deterministically for the same identity', () => {
    const first = selectCompositionVariant('linkedin', '1:linkedin:manual-1:abcd');
    const second = selectCompositionVariant('linkedin', '1:linkedin:manual-1:abcd');
    expect(first).toEqual(second);
    expect(hashCompositionIdentity('1:linkedin:manual-1:abcd')).toBe(hashCompositionIdentity('1:linkedin:manual-1:abcd'));
  });

  it('can select a different variant for a different manual attempt token', () => {
    const ids = new Set(
      Array.from({ length: 12 }, (_, index) =>
        selectCompositionVariant('linkedin', `1:linkedin:manual-${index + 1}:ctx`).id,
      ),
    );
    expect(ids.size).toBeGreaterThan(1);
  });

  it('changes the Firefly prompt when a non-default identity is selected', () => {
    const baseline = buildCreativePrompt(request(), 1).prompt;
    const variants = COMPOSITION_VARIANTS.linkedin;
    const alt = variants.find((variant) => variant.id !== variants[0].id);
    expect(alt).toBeTruthy();

    // Find an identity that maps to a non-zero variant.
    let identity = 'regen-probe';
    for (let index = 0; index < 50; index++) {
      const candidate = `1:linkedin:manual-${index}:probe`;
      if (selectCompositionVariant('linkedin', candidate).id === alt!.id) {
        identity = candidate;
        break;
      }
    }

    const regenerated = buildCreativePrompt(request({ compositionIdentity: identity }), 1).prompt;
    expect(regenerated).not.toBe(baseline);
    expect(regenerated).toContain(alt!.visual.slice(0, 40));
    expect(regenerated).not.toMatch(/Barclays logo|headline|call to action|CTA/i);
  });
});
