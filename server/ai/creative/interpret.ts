/**
 * Gemini Creative Interpreter orchestration.
 *
 * Flow:
 *   validate input → KG grounding → Gemini JSON → validate →
 *   enforce authoritative content → selectVisualReference → result
 *
 * Does NOT call Firefly. Does NOT change Stage 6/7 or UI.
 */

import { buildGeminiGrounding } from '../../knowledge/grounding';
import { listLogoAssets, selectVisualReference } from '../../knowledge/visualReferences';
import { normalizeCampaignType } from '../../knowledge/visualFamily';
import type { VisualFamily } from '../../knowledge/types';
import type { GeminiJsonClient } from '../gemini/types';
import { createGeminiClient } from '../gemini/client';
import {
  buildCreativeInterpreterSystemPrompt,
  buildCreativeInterpreterUserPrompt
} from './prompt';
import { parseGeminiJson, validateCreativeInterpreterInput, validateCreativeSpecificationPartial } from './schema';
import type {
  CreativeInterpretationInternal,
  CreativeInterpretationResult,
  CreativeInterpreterInput,
  CreativeSpecification,
  PublicVisualReference,
  VisualReferenceStatus
} from './types';

export class CreativeInterpreterError extends Error {
  readonly statusCode: number;
  readonly details?: string[];

  constructor(message: string, statusCode = 400, details?: string[]) {
    super(message);
    this.name = 'CreativeInterpreterError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export type InterpretCreativeOptions = {
  /** Injected Gemini client. Defaults to a non-live shared gateway (no network). */
  gemini?: GeminiJsonClient;
};

const LOGO_AVOID = 'generated logos or simulated Barclays marks';

function ensureLogoAvoid(avoid: string[]): string[] {
  const has = avoid.some((a) => /logo|barclays mark/i.test(a));
  return has ? avoid : [...avoid, LOGO_AVOID];
}

function referenceStatusFor(
  domain: CreativeInterpreterInput['campaignContext']['businessDomain'],
  selected: PublicVisualReference | null
): VisualReferenceStatus {
  if (selected) return 'selected';
  if (domain === 'corporate') return 'no-approved-corporate-reference';
  if (domain === 'retail') return 'no-approved-retail-reference';
  return 'no-approved-reference';
}

function toPublicVisualReference(
  entry: NonNullable<ReturnType<typeof selectVisualReference>>
): PublicVisualReference {
  return {
    id: entry.id,
    title: entry.title,
    category: 'visual-reference',
    businessDomain: entry.businessDomain,
    mimeType: entry.mimeType,
    tags: [...entry.tags],
    campaignType: entry.campaignType,
    channel: entry.channel,
    visualFamily: entry.visualFamily
  };
}

/**
 * Builds the final CreativeSpecification by merging Gemini interpretation
 * with authoritative marketer content and asset/context fields.
 *
 * modification.prompt is the highest-priority creative instruction.
 * Gemini may normalize requestedChange, but distinctive user visual intent
 * must not be dropped when assembling the specification for Firefly.
 */
export function assembleCreativeSpecification(
  input: CreativeInterpreterInput,
  partial: {
    requestedChange: string;
    visualFamily: VisualFamily;
    composition: string;
    negativeSpace: CreativeSpecification['negativeSpace'];
    tone: string[];
    preserve: string[];
    avoid: string[];
    accessibility: string[];
  }
): CreativeSpecification {
  const { campaignContext, asset, modification } = input;
  const rawCampaignType =
    campaignContext.campaignType?.trim() ||
    (typeof input.campaignBrief.product === 'string' && input.campaignBrief.product) ||
    'unspecified';
  const campaignType = normalizeCampaignType(rawCampaignType) ?? rawCampaignType;
  const channel = (campaignContext.channel ?? asset.channel ?? 'unspecified').trim() || 'unspecified';

  return {
    businessDomain: campaignContext.businessDomain,
    campaignType,
    channel,
    content: {
      title: modification.title,
      description: modification.description,
      cta: modification.cta
    },
    requestedChange: preserveUserRequestedChange(modification.prompt, partial.requestedChange),
    visualFamily: partial.visualFamily,
    composition: partial.composition,
    negativeSpace: partial.negativeSpace,
    tone: partial.tone,
    preserve: partial.preserve,
    avoid: ensureLogoAvoid(partial.avoid),
    accessibility: partial.accessibility,
    sourceAsset: {
      id: asset.id,
      sourceId: asset.sourceId,
      lineage: asset.lineage
    }
  };
}

/**
 * Ensure Gemini's requestedChange still reflects modification.prompt intent.
 * Allows clearer/safer wording; if distinctive user tokens were dropped, lead with the user request.
 */
export function preserveUserRequestedChange(
  marketerPrompt: string | undefined,
  geminiRequestedChange: string
): string {
  const user = (marketerPrompt ?? '').trim();
  const gemini = geminiRequestedChange.trim();
  if (!user) return gemini;
  if (!gemini) return user;

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
    'from',
    'that',
    'this',
    'then',
    'space',
    'visual',
    'elements'
  ]);

  const normalizeToken = (raw: string): string => {
    let t = raw.toLowerCase();
    if (t === 'darker' || t === 'darken' || t === 'darkened' || t === 'darkening') return 'dark';
    if (t === 'simpler' || t === 'simplify' || t === 'simplified' || t === 'simplifying') {
      return 'simplif';
    }
    if (t.endsWith('ies') && t.length > 4) t = `${t.slice(0, -3)}y`;
    else if (t.endsWith('s') && t.length > 4) t = t.slice(0, -1);
    return t;
  };

  const tokens = [
    ...new Set(
      user
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 4 && !stop.has(t))
        .map(normalizeToken)
        .filter((t) => t.length >= 4 && !stop.has(t))
    )
  ];

  if (tokens.length === 0) return gemini;

  const geminiNorm = normalizeToken(
    gemini
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
  );
  // Also expand gemini into token set for includes checks on stems.
  const geminiBlob = ` ${gemini
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map(normalizeToken)
    .join(' ')} `;

  const retained = tokens.filter(
    (t) => geminiBlob.includes(` ${t} `) || geminiNorm.includes(t) || gemini.toLowerCase().includes(t)
  );
  const retention = retained.length / tokens.length;
  if (retention >= 0.4) return gemini;

  const lead = /[.!?]$/.test(user) ? user : `${user}.`;
  if (gemini.toLowerCase().startsWith(user.toLowerCase().slice(0, Math.min(24, user.length)))) {
    return gemini;
  }
  return `${lead} ${gemini}`.trim();
}

export async function interpretCreativeRequest(
  rawInput: unknown,
  options: InterpretCreativeOptions = {}
): Promise<CreativeInterpretationInternal> {
  const inputResult = validateCreativeInterpreterInput(rawInput);
  if (!inputResult.ok) {
    throw new CreativeInterpreterError('Invalid Creative Interpreter input', 400, inputResult.errors);
  }
  const input = inputResult.value;

  // Domain-scoped grounding: brand / tone / genstudio / guardrail only.
  // Corporate callers never receive Retail personas/products via buildGeminiGrounding.
  const grounding = buildGeminiGrounding({
    businessDomain: input.campaignContext.businessDomain,
    campaignType: input.campaignContext.campaignType,
    channel: input.campaignContext.channel ?? input.asset.channel,
    categories: ['brand', 'tone-of-voice', 'proposition', 'genstudio', 'guardrail', 'audience']
  });

  // Owned logos are composition/guardrail context — not generative references.
  const logos = listLogoAssets();
  const logoNote =
    logos.length > 0
      ? `\nOwned Barclays logo assets available as composition marks (not generative references): ${logos
          .map((l) => l.title)
          .join('; ')}. Never generate or simulate these marks.`
      : '';

  const gemini = options.gemini ?? createGeminiClient({ live: false });
  const geminiResponse = await gemini.generateJson({
    system: buildCreativeInterpreterSystemPrompt(),
    user: buildCreativeInterpreterUserPrompt(input, grounding.text + logoNote),
    responseMimeType: 'application/json'
  });

  const parsed = parseGeminiJson(geminiResponse.text);
  if (!parsed.ok) {
    throw new CreativeInterpreterError('Gemini returned invalid JSON', 502, parsed.errors);
  }

  const partial = validateCreativeSpecificationPartial(parsed.value);
  if (!partial.ok) {
    throw new CreativeInterpreterError('CreativeSpecification validation failed', 502, partial.errors);
  }

  // Authoritative content: marketer form wins even if Gemini echoed different values.
  const specification = assembleCreativeSpecification(input, partial.value);

  if (
    specification.content.title !== input.modification.title ||
    specification.content.description !== input.modification.description ||
    specification.content.cta !== input.modification.cta
  ) {
    throw new CreativeInterpreterError('Authoritative content fields were altered', 500);
  }

  // Deterministic KG selection AFTER validation. Gemini never chooses filenames.
  const selected = selectVisualReference({
    businessDomain: specification.businessDomain,
    campaignType: specification.campaignType,
    channel: specification.channel,
    visualFamily: specification.visualFamily,
    requestedChange: specification.requestedChange
  });

  // Never treat logos as generative visual references (selector already excludes them).
  if (selected && (selected.category === 'logo' || selected.assetKind === 'logo')) {
    throw new CreativeInterpreterError('Logo assets cannot be used as generative visual references', 500);
  }

  const visualReference = selected ? toPublicVisualReference(selected) : null;

  return {
    specification,
    visualReference,
    referenceStatus: referenceStatusFor(specification.businessDomain, visualReference),
    groundingProvenance: grounding.provenance,
    groundingText: grounding.text,
    providerMeta: {
      model: geminiResponse.model,
      latencyMs: geminiResponse.latencyMs,
      usage: geminiResponse.usage
    }
  };
}

/** HTTP-safe payload — strips grounding text/provenance and filesystem paths. */
export function toPublicCreativeInterpretationResult(
  internal: CreativeInterpretationInternal
): CreativeInterpretationResult {
  return {
    specification: internal.specification,
    visualReference: internal.visualReference,
    referenceStatus: internal.referenceStatus
  };
}
