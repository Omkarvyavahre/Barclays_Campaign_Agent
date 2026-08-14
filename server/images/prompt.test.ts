/**
 * The prompt is the safety boundary for what Firefly is allowed to draw, so it
 * is tested as carefully as the transport.
 *
 * Three properties matter most. It must describe a purely abstract visual, since
 * every depicted subject we have ever named came back with pseudo-text on it. It
 * must never ask for brand marks or campaign copy, which the V19 template owns.
 * And it must stay inside Firefly's 1024-character limit by dropping context,
 * never a safety instruction.
 */

import { describe, expect, it } from 'vitest';

import {
  ABSTRACT_FRAMING,
  ABSTRACT_RULE,
  ABSTRACT_VISUAL,
  AESTHETIC,
  CHANNEL_PLANS,
  CONTENT_CLASS,
  DESIGN_VOCABULARY,
  PROHIBITED_ELEMENTS,
  PROMPT_CHAR_LIMIT,
  REFERENCE_RULE,
  TONE_NOTE_CAP,
  WIDESCREEN,
  buildCreativePrompt,
  namesForbiddenSubject,
  sanitiseToneNote,
} from './prompt.ts';
import { referenceSlotForChannel } from './references.ts';
import type { ImageGenerationRequest } from './types.ts';

const HEADLINE = 'A step change in how you bank with Barclays';
const CTA = 'Discover iPortal';

function request(overrides: Partial<ImageGenerationRequest> = {}): ImageGenerationRequest {
  return {
    channel: 'linkedin',
    campaignContext: {
      objective: 'Grow iPortal adoption among SME business banking clients by 15% this half.',
      audience: 'Existing UKC clients in the Digital Adoption cohort',
      businessNeed: 'Relationship teams absorb manual payment-status and reporting requests.',
      proposition: 'One connected digital front door for payments, reporting and self-service.',
      creativeDirection: 'Premium understated corporate energy, calm and efficient, quiet visibility and control.',
      constraints: 'All claims must be substantiated. No comparative superiority without proof.',
    },
    outputContext: { headline: HEADLINE, cta: CTA, format: 'Sponsored content', dimensions: '1200 x 627' },
    ...overrides,
  };
}

function toneNote(prompt: string): string | undefined {
  return prompt.split('\n').find((line) => line.startsWith('Tone: '));
}

/** Everything except the two lines that necessarily name what to avoid. */
function scannable(prompt: string): string {
  return prompt
    .replace(/^No .* anywhere in the image\.$/m, '')
    .replace(REFERENCE_RULE, '')
    .toLowerCase();
}

describe('the prompt describes an abstract visual', () => {
  it('opens with the channel visual and carries the aesthetic direction', () => {
    const { prompt, size } = buildCreativePrompt(request(), 1);

    expect(prompt.startsWith(CHANNEL_PLANS.linkedin.visual)).toBe(true);
    expect(prompt).toContain(AESTHETIC);
    expect(prompt).toContain(CHANNEL_PLANS.linkedin.framing);
    expect(prompt).toContain(ABSTRACT_RULE);
    expect(size).toEqual(WIDESCREEN);
  });

  it('requests the documented art content class', () => {
    expect(CONTENT_CLASS).toBe('art');
    for (const channel of ['linkedin', 'email'] as const) {
      const plan = buildCreativePrompt(request({ channel }), referenceSlotForChannel(channel));
      expect(plan.contentClass).toBe('art');
    }
  });

  it('describes navy, cyan ribbons and negative space', () => {
    const { prompt } = buildCreativePrompt(request(), 1);
    expect(prompt).toMatch(/deep navy and rich Barclays-blue background/);
    expect(prompt).toMatch(/[Ll]uminous cyan and turquoise ribbons/);
    expect(prompt).toMatch(/negative space/);
  });

  it('names no depicted subject outside the exclusions', () => {
    for (const channel of ['linkedin', 'email'] as const) {
      const { prompt } = buildCreativePrompt(request({ channel }), referenceSlotForChannel(channel));
      for (const subject of ['people', 'person', 'office', 'screen', 'dashboard', 'chart', 'photograph']) {
        expect(scannable(prompt)).not.toMatch(new RegExp(`\\b${subject}`));
      }
    }
  });

  it('carries no campaign-design vocabulary at all', () => {
    for (const channel of ['linkedin', 'email'] as const) {
      const { prompt } = buildCreativePrompt(request({ channel }), referenceSlotForChannel(channel));
      for (const word of DESIGN_VOCABULARY) {
        expect(scannable(prompt)).not.toMatch(new RegExp(`\\b${word}\\b`));
      }
    }
  });

  it('keeps format and dimensions out of the natural language', () => {
    const { prompt } = buildCreativePrompt(request(), 1);
    expect(prompt).not.toContain('Sponsored content');
    expect(prompt).not.toContain('1200 x 627');
    expect(prompt).not.toMatch(/\d/);
  });

  it('never quotes the headline or the call to action', () => {
    const { prompt } = buildCreativePrompt(request(), 1);
    expect(prompt).not.toContain(HEADLINE);
    expect(prompt).not.toContain(CTA);
    expect(prompt).not.toContain('"');
  });

  it('asks the reference for identity but not for its layout or lettering', () => {
    const { prompt, styleStrength } = buildCreativePrompt(request(), 1);
    expect(prompt).toContain(REFERENCE_RULE);
    expect(prompt).toMatch(/cyan ribbon light and premium energy from the reference/);
    expect(prompt).toMatch(/do not reproduce its layout or lettering/);
    // Enough to carry the Barclays palette, short of copying the reference.
    expect(styleStrength).toBeGreaterThanOrEqual(25);
    expect(styleStrength).toBeLessThanOrEqual(30);
  });

  it('never frames either channel as a centre band with clear space to fill', () => {
    for (const channel of ['linkedin', 'email'] as const) {
      const { prompt } = buildCreativePrompt(request({ channel }), 1);
      expect(prompt).toContain('negative space');
      expect(prompt).not.toContain('middle band');
      expect(prompt).not.toContain('above and below');
    }
  });

  it('keeps the approved LinkedIn framing gathered to one side', () => {
    const { prompt } = buildCreativePrompt(request(), 1);
    expect(prompt).toContain('ribbons gathered to one side');
    expect(prompt).toContain('negative space beside them');
  });

  it('asks email for one calm diagonal ribbon with no convergence', () => {
    const { prompt } = buildCreativePrompt(request({ channel: 'email' }), 1);

    expect(prompt).toContain('One elegant luminous cyan and turquoise ribbon');
    expect(prompt).toContain('from lower left to upper right');
    expect(prompt).toContain('at most one faint secondary light trail');
    expect(prompt).toContain('no crossing or converging ribbons');
    expect(prompt).toContain('no bright focal knot');
    expect(prompt).toContain('negative space across the left');
    // The busy result came from asking for layered ribbons across the frame.
    expect(prompt).not.toContain('ribbons sweep across the composition');
    expect(prompt).not.toContain('layered curves');
  });

  it('24. freezes the approved recipe for both channels', () => {
    for (const channel of ['linkedin', 'email'] as const) {
      const plan = buildCreativePrompt(request({ channel }), referenceSlotForChannel(channel));

      expect(plan.contentClass).toBe('art');
      expect(plan.styleStrength).toBe(28);
      expect(plan.size).toEqual({ width: 2688, height: 1536 });
      expect(plan.referenceSlot).toBe(1);
      expect(plan.prompt.length).toBeLessThanOrEqual(PROMPT_CHAR_LIMIT);
    }
  });

  it('leaves the LinkedIn recipe unchanged by the email direction', () => {
    expect(CHANNEL_PLANS.linkedin.visual).toBe(ABSTRACT_VISUAL);
    expect(CHANNEL_PLANS.linkedin.framing).toBe(ABSTRACT_FRAMING);
    expect(CHANNEL_PLANS.email.visual).not.toBe(CHANNEL_PLANS.linkedin.visual);
  });

  it('is deterministic for the same context', () => {
    expect(buildCreativePrompt(request(), 1).prompt).toBe(buildCreativePrompt(request(), 1).prompt);
  });

  it('carries the reference slot the channel maps to', () => {
    for (const channel of ['linkedin', 'email'] as const) {
      const plan = buildCreativePrompt(request({ channel }), referenceSlotForChannel(channel));
      expect(plan.referenceSlot).toBe(referenceSlotForChannel(channel));
    }
    expect(buildCreativePrompt(request(), 2).referenceSlot).toBe(2);
  });
});

describe('accepted brief context reaches the prompt safely', () => {
  it('adds a tone note drawn from the accepted creative direction', () => {
    const note = toneNote(buildCreativePrompt(request(), 1).prompt);

    expect(note).toBeDefined();
    expect(note).toContain('Premium understated corporate energy');
  });

  it('strips digits, money marks and design vocabulary from the note', () => {
    expect(sanitiseToneNote('Grow iPortal adoption by 15% and £2m of campaign banner headline copy')).toBe(
      'Grow iPortal adoption by and m of',
    );
    expect(sanitiseToneNote('A calm, premium energy')).toBe('A calm, premium energy');
    expect(sanitiseToneNote(undefined)).toBe('');
  });

  it('recognises context that would put a subject back in the frame', () => {
    expect(namesForbiddenSubject('payment-status and reporting requests')).toBe(true);
    expect(namesForbiddenSubject('a premium office environment')).toBe(true);
    expect(namesForbiddenSubject('calm, confident, quietly premium')).toBe(false);
  });

  it('drops a whole extract that names a forbidden subject', () => {
    const { prompt } = buildCreativePrompt(
      request({
        campaignContext: {
          ...request().campaignContext,
          creativeDirection: 'Premium understated office with large screens and payment dashboards on show.',
        },
      }),
      1,
    );

    // Every remaining priority field names payments or reporting too.
    expect(toneNote(prompt)).toBeUndefined();
    expect(scannable(prompt)).not.toMatch(/office|screens|dashboards/);
  });

  it('falls back to the next priority field when the direction is unusable', () => {
    const { prompt } = buildCreativePrompt(
      request({
        campaignContext: {
          ...request().campaignContext,
          creativeDirection: 'campaign banner headline',
          businessNeed: 'Quietly confident, efficient and premium, with a sense of forward movement.',
        },
      }),
      1,
    );

    expect(toneNote(prompt)).toContain('Quietly confident, efficient and premium');
  });

  it('omits the note entirely rather than emit a fragment', () => {
    const { prompt } = buildCreativePrompt(
      request({
        campaignContext: {
          objective: '',
          audience: '',
          businessNeed: 'short',
          proposition: '',
          creativeDirection: '',
        },
      }),
      1,
    );

    expect(toneNote(prompt)).toBeUndefined();
    expect(prompt).toContain(ABSTRACT_RULE);
  });

  it('never emits a note longer than the cap', () => {
    const long = 'Sustained premium calm and quiet confidence across every moment, all day long. '.repeat(20);
    const { prompt } = buildCreativePrompt(
      request({ campaignContext: { ...request().campaignContext, creativeDirection: long } }),
      1,
    );

    const note = toneNote(prompt)!.replace(/^Tone: /, '').replace(/\.$/, '');
    expect(note.length).toBeLessThanOrEqual(TONE_NOTE_CAP);
  });
});

describe('the prompt respects the provider character limit', () => {
  const huge = 'x'.repeat(5000);
  const cases: [string, ImageGenerationRequest][] = [
    ['the accepted campaign context', request()],
    ['one overlong field', request({ campaignContext: { ...request().campaignContext, objective: huge } })],
    [
      'every field overlong',
      request({
        campaignContext: {
          objective: huge,
          audience: huge,
          businessNeed: huge,
          proposition: huge,
          creativeDirection: huge,
          constraints: huge,
        },
      }),
    ],
    ['overlong channel copy', request({ outputContext: { headline: huge, cta: huge, format: huge, dimensions: huge } })],
    ['missing optional copy', request({ outputContext: { headline: HEADLINE, cta: CTA } })],
    [
      'empty context',
      request({
        campaignContext: { objective: '', audience: '', businessNeed: '', proposition: '', creativeDirection: '' },
      }),
    ],
  ];

  it.each(cases)('stays within 1024 characters with %s', (_label, input) => {
    for (const channel of ['linkedin', 'email'] as const) {
      const { prompt } = buildCreativePrompt({ ...input, channel }, referenceSlotForChannel(channel));
      expect(prompt.length).toBeLessThanOrEqual(PROMPT_CHAR_LIMIT);
    }
  });

  it('drops context rather than any visual or safety instruction', () => {
    const { prompt } = buildCreativePrompt(
      request({
        campaignContext: {
          objective: huge,
          audience: huge,
          businessNeed: huge,
          proposition: huge,
          creativeDirection: huge,
          constraints: huge,
        },
      }),
      1,
    );

    expect(prompt).not.toContain(huge);
    // Every fixed line survives byte-for-byte.
    expect(prompt).toContain(CHANNEL_PLANS.linkedin.visual);
    expect(prompt).toContain(AESTHETIC);
    expect(prompt).toContain(CHANNEL_PLANS.linkedin.framing);
    expect(prompt).toContain(ABSTRACT_RULE);
    expect(prompt).toContain(REFERENCE_RULE);
    expect(prompt.endsWith(`No ${PROHIBITED_ELEMENTS.join(', ')} anywhere in the image.`)).toBe(true);
  });
});

describe('the prompt carries the safety constraints', () => {
  it('excludes every prohibited element explicitly', () => {
    const { prompt } = buildCreativePrompt(request(), 1);
    for (const element of PROHIBITED_ELEMENTS) expect(prompt).toContain(element);
  });

  it('forbids subjects, interface furniture, text, brand marks and watermarks', () => {
    const { prompt } = buildCreativePrompt(request(), 1);
    for (const forbidden of [
      'people',
      'faces',
      'office scenes',
      'screens',
      'dashboards',
      'charts',
      'text',
      'letters',
      'numbers',
      'logos',
      'brand marks',
      'emblems',
      'badges',
      'buttons',
      'interface elements',
      'financial figures',
      'watermarks',
    ]) {
      expect(prompt).toContain(forbidden);
    }
  });

  it('keeps every safety instruction whatever the channel or context size', () => {
    const inputs = [
      request(),
      request({ channel: 'email' }),
      request({ outputContext: { headline: 'x'.repeat(400), cta: 'y'.repeat(400) } }),
      request({ campaignContext: { ...request().campaignContext, creativeDirection: 'x'.repeat(4000) } }),
    ];

    for (const input of inputs) {
      const { prompt } = buildCreativePrompt(input, referenceSlotForChannel(input.channel));
      for (const element of PROHIBITED_ELEMENTS) expect(prompt).toContain(element);
      expect(prompt).toContain(ABSTRACT_RULE);
      expect(prompt).toContain(REFERENCE_RULE);
      expect(prompt).toContain('negative space');
    }
  });

  it('never instructs the model to draw or letter anything', () => {
    const { prompt } = buildCreativePrompt(request(), 1);
    expect(prompt).not.toMatch(/(add|include|render|write|overlay|display text|spell)\s/i);
  });
});
