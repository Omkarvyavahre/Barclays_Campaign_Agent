/**
 * Builds the creative prompt for the approved Barclays/iPortal abstract visual.
 *
 * Four rules shape everything in this file:
 *
 *  1. Firefly draws whatever the prompt gives it a noun for. Naming the artefact
 *     produced advertisement furniture; naming a wall display produced a
 *     dashboard of pseudo-text. The approved direction is therefore a pure
 *     abstract visual — navy field, cyan ribbons, negative space — with no
 *     depicted subject at all.
 *  2. Brand identity comes from two non-generative places: the approved
 *     reference image lends palette and ribbon language, and the real Barclays
 *     logo already present in the V19 template is overlaid afterwards. Firefly
 *     is never asked to spell a brand name or render campaign copy.
 *  3. Channel and format stay out of the natural language. Output dimensions
 *     travel in the API's own `size` field and the artwork type in
 *     `contentClass`.
 *  4. Firefly rejects any prompt longer than PROMPT_CHAR_LIMIT. The limit is met
 *     by construction rather than by truncating the finished string: the visual
 *     and safety lines are emitted whole and accepted brief context is fitted
 *     into whatever budget remains, so trimming can only ever cost context.
 *
 * The finished prompt stays server-side; the browser never receives it.
 */

import { ImageServiceError } from './errors.ts';
import type {
  CampaignImageContext,
  ImageChannel,
  ImageContentClass,
  ImageGenerationRequest,
  ImageSize,
  ReferenceSlot,
} from './types.ts';

/**
 * Firefly's documented widescreen output. Both V19 creative slots are wide
 * bands (`.v17-li-creative` and `.v17-email-creative` are cropped with
 * `background-size:cover`), so the widest documented ratio is the best fit.
 */
export const WIDESCREEN: ImageSize = { width: 2688, height: 1536 };

/**
 * Adobe documents `photo` and `art` for /v3/images/generate. The approved
 * direction is abstract artwork, so `art` is the class requested at API level;
 * prompt wording alone is not a reliable way to choose between the two.
 */
export const CONTENT_CLASS: ImageContentClass = 'art';

/**
 * Moderate, because the reference is now wanted for its Barclays identity —
 * palette, cyan ribbon light and premium energy. The band matters: at 45 the
 * reference reproduced its slide layout and lettering wholesale, while at 11 it
 * contributed almost no palette at all.
 */
export const DEFAULT_STYLE_STRENGTH = 28;

/** Firefly's documented maximum prompt length. Enforced, never exceeded. */
export const PROMPT_CHAR_LIMIT = 1024;

/** Longest accepted-brief extract, and the shortest worth sending. */
export const TONE_NOTE_CAP = 90;
export const TONE_NOTE_MIN = 36;

export interface ChannelPlan {
  size: ImageSize;
  /** The abstract visual itself. */
  visual: string;
  /** How the frame is arranged, so surrounding V19 copy stays legible. */
  framing: string;
}

/** The approved LinkedIn recipe. Frozen: this is what produced the signed-off asset. */
export const ABSTRACT_VISUAL =
  'Premium abstract digital banking artwork on a deep navy and rich Barclays-blue background. Luminous cyan and turquoise ribbons sweep across the composition in elegant layered curves, with fine light trails and subtle depth.';

/**
 * Neither channel may ask for a centre band with clear space above and below:
 * that reads to the model as a slide with a title area, and it filled those
 * bands with pseudo-text.
 */
export const ABSTRACT_FRAMING =
  'Wide composition, ribbons gathered to one side, generous clean negative space beside them.';

/**
 * The email hero is a 190px band, so the full frame is cropped hard. Several
 * ribbons converging read as an unstructured knot at that crop and compete with
 * the overlaid lockup and headline, so the email direction is deliberately
 * quieter: one ribbon, one optional trail, a single diagonal, no intersections.
 */
export const EMAIL_VISUAL =
  'Premium abstract artwork on a deep navy and rich Barclays-blue background. One elegant luminous cyan and turquoise ribbon sweeps smoothly from lower left to upper right, with at most one faint secondary light trail.';

export const EMAIL_FRAMING =
  'Single continuous diagonal flow, no crossing or converging ribbons and no bright focal knot; narrow highlights, calm dark navy negative space across the left, clean balance to the right.';

export const CHANNEL_PLANS: Record<ImageChannel, ChannelPlan> = {
  linkedin: { size: WIDESCREEN, visual: ABSTRACT_VISUAL, framing: ABSTRACT_FRAMING },
  email: { size: WIDESCREEN, visual: EMAIL_VISUAL, framing: EMAIL_FRAMING },
};

export const AESTHETIC =
  'Sophisticated corporate technology aesthetic, clean polished finish, strong sense of digital transformation, simplicity and forward movement.';

/** Abstract means abstract: no depicted subject creeps back in as "detail". */
export const ABSTRACT_RULE =
  'Pure abstract artwork only: smooth gradients, glossy highlights, flowing light, nothing depicted or represented.';

export const REFERENCE_RULE =
  'Take the palette, cyan ribbon light and premium energy from the reference; do not reproduce its layout or lettering.';

/** Never render these. Emitted verbatim on every prompt, whatever the budget. */
export const PROHIBITED_ELEMENTS: readonly string[] = [
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
];

/**
 * Campaign-design vocabulary is stripped from any accepted-brief extract before
 * it reaches Firefly, because naming the artefact is what produced advertisement
 * layouts in the first place.
 */
export const DESIGN_VOCABULARY: readonly string[] = [
  'advertisement',
  'advertising',
  'advert',
  'ads',
  'ad',
  'campaign',
  'creative',
  'linkedin',
  'banner',
  'headline',
  'subject line',
  'call to action',
  'cta',
  'copy',
  'marketing',
  'layout',
  'template',
  'logo',
  'brand',
  'channel',
  'format',
];

/**
 * Subject vocabulary the abstract direction rules out. A brief extract naming
 * any of these is dropped rather than edited: half-stripped sentences read as
 * nonsense, and one stray noun is enough to put a screen or a person back in
 * the frame.
 */
export const FORBIDDEN_SUBJECTS: readonly string[] = [
  'people',
  'person',
  'professional',
  'professionals',
  'team',
  'teams',
  'client',
  'clients',
  'customer',
  'customers',
  'office',
  'desk',
  'screen',
  'screens',
  'display',
  'dashboard',
  'chart',
  'charts',
  'graph',
  'report',
  'reports',
  'reporting',
  'payment',
  'payments',
  'invoice',
  'invoices',
  'invoicing',
  'phone',
  'laptop',
  'photo',
  'photograph',
  'photographic',
];

/** Accepted brief context in the order it earns prompt budget. */
export const CONTEXT_PRIORITY: readonly (keyof CampaignImageContext)[] = [
  'creativeDirection',
  'businessNeed',
  'proposition',
];

export interface PromptPlan {
  prompt: string;
  size: ImageSize;
  styleStrength: number;
  contentClass: ImageContentClass;
  referenceSlot: ReferenceSlot;
}

const DESIGN_VOCABULARY_PATTERN = new RegExp(`\\b(?:${DESIGN_VOCABULARY.join('|')})\\b`, 'gi');
const FORBIDDEN_SUBJECT_PATTERN = new RegExp(`\\b(?:${FORBIDDEN_SUBJECTS.join('|')})\\b`, 'i');

/**
 * Reduces an accepted-brief field to tone a colourist could act on: no digits,
 * no money or percentage marks, no campaign-design vocabulary.
 */
export function sanitiseToneNote(value: string | undefined): string {
  return (value ?? '')
    .replace(DESIGN_VOCABULARY_PATTERN, ' ')
    .replace(/[0-9%$£€"']/g, ' ')
    .replace(/\s*([,;:])\s*/g, '$1 ')
    .replace(/([,;:])\s*(?=[,;:])/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:.\-—]+/, '')
    .replace(/[\s,;:.\-—]+$/u, '')
    .trim();
}

/** True when the extract would put a forbidden subject back into the frame. */
export function namesForbiddenSubject(text: string): boolean {
  return FORBIDDEN_SUBJECT_PATTERN.test(text);
}

/** Clips to a whole word where possible, leaving no dangling punctuation. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const boundary = cut.lastIndexOf(' ');
  const kept = boundary > max / 2 ? cut.slice(0, boundary) : cut;
  return kept.replace(/[\s,;:.\-—]+$/u, '');
}

function joinedLength(lines: readonly string[]): number {
  return lines.reduce((total, line) => total + line.length, 0) + Math.max(lines.length - 1, 0);
}

/** Spends what is left of the budget on the highest-priority usable context. */
function fitToneNote(campaign: CampaignImageContext, budget: number): string {
  if (budget < TONE_NOTE_MIN) return '';

  for (const key of CONTEXT_PRIORITY) {
    const text = sanitiseToneNote(campaign[key]);
    if (text.length < TONE_NOTE_MIN || namesForbiddenSubject(text)) continue;
    return clip(text, Math.min(TONE_NOTE_CAP, budget));
  }

  return '';
}

/**
 * Assembles the prompt deterministically: the same context always produces the
 * same prompt, which is what makes it testable without a provider call.
 */
export function buildCreativePrompt(request: ImageGenerationRequest, referenceSlot: ReferenceSlot): PromptPlan {
  const plan = CHANNEL_PLANS[request.channel];

  // Visual and safety lines: emitted in full, always, and never trimmed.
  const exclusions = `No ${PROHIBITED_ELEMENTS.join(', ')} anywhere in the image.`;
  const fixed = [plan.visual, AESTHETIC, plan.framing, ABSTRACT_RULE, REFERENCE_RULE, exclusions];

  const shell = 'Tone: .';
  const note = fitToneNote(request.campaignContext, PROMPT_CHAR_LIMIT - joinedLength(fixed) - 1 - shell.length);

  // The exclusions stay last, closest to what the model generates.
  const lines = [...fixed.slice(0, -1), ...(note ? [`Tone: ${note}.`] : []), exclusions];
  const prompt = lines.join('\n');

  // Unreachable by construction; a loud stop is better than a provider reject.
  if (prompt.length > PROMPT_CHAR_LIMIT) {
    throw new ImageServiceError('configuration_error', 'The creative prompt exceeds the provider limit.');
  }

  return {
    prompt,
    size: plan.size,
    styleStrength: DEFAULT_STYLE_STRENGTH,
    contentClass: CONTENT_CLASS,
    referenceSlot,
  };
}
