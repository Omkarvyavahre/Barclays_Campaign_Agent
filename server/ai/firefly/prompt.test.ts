/**
 * @vitest-environment node
 *
 * Firefly prompt budget / compaction tests.
 * No provider calls.
 */
import { describe, expect, it } from 'vitest';
import { assembleCreativeSpecification } from '../creative';
import type { CreativeInterpreterInput } from '../creative/types';
import {
  buildFireflyPrompt,
  FIREFLY_PROMPT_MAX_CHARS,
  FIREFLY_PROMPT_TARGET_CHARS,
  measureLegacyFireflyPromptLength,
  promptExcludesNonVisualMetadata,
  resolveFireflyContentClass,
  significantVisualIntentTokens
} from './prompt';

const BASE_INPUT: CreativeInterpreterInput = {
  campaignBrief: {
    campaignName: 'iPortal Digital Adoption',
    product: 'iPortal'
  },
  asset: {
    id: 'DAM-IPORTAL-LN-001',
    sourceId: 'DAM-IPORTAL-LN-001',
    lineage: 'Adobe DAM · DAM-IPORTAL-LN-001',
    channel: 'LinkedIn'
  },
  modification: {
    title: 'Discover what is possible with iPortal',
    description: 'Discover a simpler way to manage your digital banking with iPortal.',
    cta: 'Discover iPortal',
    prompt: 'Make the background darker, simplify the cyan ribbons and leave more negative space on the left.'
  },
  campaignContext: {
    businessDomain: 'corporate',
    campaignType: 'iPortal',
    channel: 'LinkedIn'
  }
};

const TYPICAL_PARTIAL = {
  requestedChange:
    'Darken the background and simplify the flowing cyan visual elements / ribbons while keeping a premium corporate feel.',
  visualFamily: 'abstract-digital' as const,
  composition:
    'Simplified flowing-light composition with reduced visual density and clearer structure.',
  negativeSpace: 'left' as const,
  tone: ['premium', 'confident', 'modern', 'corporate'],
  preserve: [
    'approved iPortal visual identity',
    'source asset lineage Adobe DAM · DAM-IPORTAL-LN-001',
    'owned Barclays logo as composition mark',
    'clear text-safe area on the left'
  ],
  avoid: [
    'generated logos or simulated Barclays marks',
    'crowded ribbon density',
    'readable marketing text and pseudo-text',
    'dashboard UI screens'
  ],
  accessibility: [
    'maintain sufficient contrast after darkening',
    'keep clear separation for text safe area',
    'ensure decorative elements do not reduce legibility of overlaid owned content'
  ]
};

function verboseSpecification() {
  return assembleCreativeSpecification(BASE_INPUT, {
    requestedChange:
      'Make the background substantially darker with deep navy tones, simplify and reduce the number of cyan turquoise flowing ribbon forms, remove visual clutter, keep the premium corporate abstract digital look, and leave generous usable negative space on the left for owned content composition. '.repeat(
        4
      ),
    visualFamily: 'abstract-digital',
    composition:
      'A highly detailed description of layered light ribbons, depth gradients, soft bloom, restrained density, and asymmetric balance designed for LinkedIn sponsored placements with room for deterministic branding. '.repeat(
        3
      ),
    negativeSpace: 'left',
    tone: [
      'premium',
      'confident',
      'modern',
      'corporate',
      'assured',
      'innovative',
      'trustworthy',
      'calm'
    ],
    preserve: [
      'approved iPortal visual identity language and abstract device',
      'source asset creative direction without copying retail imagery',
      'Adobe DAM lineage DAM-IPORTAL-LN-001 must remain in metadata only',
      'owned Barclays logo as composition mark outside generation',
      'clear text-safe area for Title Description CTA overlay',
      'channel crop integrity for LinkedIn'
    ],
    avoid: [
      'generated logos or simulated Barclays marks',
      'readable marketing text headlines CTAs or UI labels',
      'pseudo-text glyphs and fake dashboard lettering',
      'people portraits or lifestyle photography',
      'mortgage retail product imagery',
      'great escape unknown photographic references'
    ],
    accessibility: [
      'maintain sufficient contrast after darkening for overlaid owned text',
      'keep clear separation for text safe area on the left',
      'avoid low-contrast cyan on dark navy that collapses detail',
      'ensure decorative ribbons do not create flicker-like density'
    ]
  });
}

describe('Firefly prompt budget', () => {
  it('reports previous verbose builder length for the representative case', () => {
    const specification = assembleCreativeSpecification(BASE_INPUT, TYPICAL_PARTIAL);
    const legacy = measureLegacyFireflyPromptLength({
      specification,
      referenceSource: 'source-dam-asset'
    });
    expect(legacy).toBeGreaterThan(FIREFLY_PROMPT_MAX_CHARS);
  });

  it('typical CreativeSpecification produces prompt under target budget', () => {
    const specification = assembleCreativeSpecification(BASE_INPUT, TYPICAL_PARTIAL);
    const prompt = buildFireflyPrompt({
      specification,
      referenceSource: 'source-dam-asset'
    });
    expect(prompt.length).toBeLessThanOrEqual(FIREFLY_PROMPT_TARGET_CHARS);
    expect(prompt.length).toBeLessThanOrEqual(FIREFLY_PROMPT_MAX_CHARS);
    expect(prompt.trim()).toMatch(/[.!?]$/);
  });

  it('extremely verbose specification still stays <= 1024 chars', () => {
    const specification = verboseSpecification();
    const prompt = buildFireflyPrompt({
      specification,
      referenceSource: 'source-dam-asset'
    });
    expect(prompt.length).toBeLessThanOrEqual(FIREFLY_PROMPT_MAX_CHARS);
    expect(prompt.trim()).toMatch(/[.!?]$/);
  });

  it('preserves requested change, negative space, visual family, and safety rules', () => {
    const specification = assembleCreativeSpecification(BASE_INPUT, TYPICAL_PARTIAL);
    const prompt = buildFireflyPrompt({
      specification,
      referenceSource: 'source-dam-asset'
    });
    expect(prompt.toLowerCase()).toMatch(/dark/);
    expect(prompt.toLowerCase()).toMatch(/cyan|ribbon/);
    expect(prompt.toLowerCase()).toMatch(/left/);
    expect(prompt.toLowerCase()).toMatch(/abstract digital/);
    expect(prompt).toMatch(/No readable text|pseudo-text/i);
    expect(prompt).toMatch(/No generated logos|simulated Barclays marks/i);
  });

  it('excludes Title, Description, CTA, DAM lineage and provenance wording', () => {
    const specification = assembleCreativeSpecification(BASE_INPUT, TYPICAL_PARTIAL);
    const prompt = buildFireflyPrompt({
      specification,
      referenceSource: 'source-dam-asset'
    });
    expect(prompt).not.toContain(BASE_INPUT.modification.title);
    expect(prompt).not.toContain(BASE_INPUT.modification.description);
    expect(prompt).not.toContain(BASE_INPUT.modification.cta);
    expect(prompt).not.toMatch(/Adobe DAM|lineage|provenance|Gemini|GenStudio/i);
    expect(prompt).not.toContain('DAM-IPORTAL-LN-001');
    expect(promptExcludesNonVisualMetadata(prompt, specification)).toBe(true);
  });

  it('keeps contentClass art for abstract-digital', () => {
    const specification = assembleCreativeSpecification(BASE_INPUT, TYPICAL_PARTIAL);
    expect(resolveFireflyContentClass(specification)).toBe('art');
  });

  it('places requestedChange ahead of brand guardrails and reference guidance', () => {
    const specification = assembleCreativeSpecification(BASE_INPUT, TYPICAL_PARTIAL);
    const prompt = buildFireflyPrompt({
      specification,
      referenceSource: 'source-dam-asset'
    });
    const changeIdx = prompt.toLowerCase().indexOf('darken');
    const brandIdx = prompt.indexOf('No generated logos');
    const refIdx = prompt.toLowerCase().indexOf('style guidance');
    expect(changeIdx).toBeGreaterThanOrEqual(0);
    expect(brandIdx).toBeGreaterThan(changeIdx);
    if (refIdx >= 0) {
      expect(refIdx).toBeGreaterThan(brandIdx);
    }
  });

  it('produces materially different Firefly prompts for materially different user requests', () => {
    const darker = assembleCreativeSpecification(
      {
        ...BASE_INPUT,
        modification: {
          ...BASE_INPUT.modification,
          prompt:
            'Make the background darker, simplify the cyan ribbons and leave more negative space on the left.'
        }
      },
      {
        ...TYPICAL_PARTIAL,
        requestedChange:
          'Darken the background, simplify cyan ribbons, and expand negative space on the left.',
        composition:
          'Dark abstract digital backdrop with simplified cyan ribbons on the right and clear left negative space.',
        negativeSpace: 'left'
      }
    );
    const warmer = assembleCreativeSpecification(
      {
        ...BASE_INPUT,
        modification: {
          ...BASE_INPUT.modification,
          prompt:
            'Warm the palette toward amber highlights, add soft golden light streaks, and open negative space on the right.'
        }
      },
      {
        ...TYPICAL_PARTIAL,
        requestedChange:
          'Warm the palette toward amber highlights, add soft golden light streaks, and open negative space on the right.',
        composition:
          'Warm amber abstract digital composition with golden light streaks and open right-side negative space.',
        negativeSpace: 'right',
        tone: ['warm', 'premium', 'modern']
      }
    );

    const promptA = buildFireflyPrompt({
      specification: darker,
      referenceSource: 'source-dam-asset'
    });
    const promptB = buildFireflyPrompt({
      specification: warmer,
      referenceSource: 'source-dam-asset'
    });

    expect(promptA).not.toEqual(promptB);
    expect(promptA.toLowerCase()).toMatch(/dark|cyan|ribbon|left/);
    expect(promptB.toLowerCase()).toMatch(/amber|golden|warm|right/);
    expect(promptA.toLowerCase()).not.toMatch(/amber|golden/);
    expect(promptB.toLowerCase()).not.toMatch(/cyan ribbon|darken the background/);

    const tokensA = new Set(significantVisualIntentTokens(promptA));
    const tokensB = new Set(significantVisualIntentTokens(promptB));
    const shared = [...tokensA].filter((t) => tokensB.has(t));
    // Shared brand/safety tokens are fine; distinctive intent must diverge.
    const distinctiveA = [...tokensA].filter((t) => !tokensB.has(t));
    const distinctiveB = [...tokensB].filter((t) => !tokensA.has(t));
    expect(distinctiveA.length).toBeGreaterThanOrEqual(2);
    expect(distinctiveB.length).toBeGreaterThanOrEqual(2);
    expect(shared.length).toBeLessThan(tokensA.size);
  });

  it('does not let reference guidance override distinctive requestedChange wording', () => {
    const specification = assembleCreativeSpecification(BASE_INPUT, {
      ...TYPICAL_PARTIAL,
      requestedChange:
        'Add sharp magenta diagonal beams across a charcoal field while keeping left negative space.'
    });
    const withDam = buildFireflyPrompt({
      specification,
      referenceSource: 'source-dam-asset'
    });
    const withKg = buildFireflyPrompt({
      specification,
      referenceSource: 'knowledge-graph'
    });
    expect(withDam.toLowerCase()).toMatch(/magenta/);
    expect(withKg.toLowerCase()).toMatch(/magenta/);
    // Reference line may differ, but the user change must remain and lead.
    expect(withDam.toLowerCase().indexOf('magenta')).toBeLessThan(
      withDam.toLowerCase().indexOf('style guidance') >= 0
        ? withDam.toLowerCase().indexOf('style guidance')
        : withDam.length
    );
  });

  it('does not end mid-sentence after compaction', () => {
    const specification = verboseSpecification();
    const prompt = buildFireflyPrompt({
      specification,
      referenceSource: 'source-dam-asset'
    });
    expect(prompt.trim()).toMatch(/[.!?]$/);
    expect(prompt).not.toMatch(/\s$/);
  });
});
