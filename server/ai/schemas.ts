/**
 * Structured-output contracts for the two agents connected in phase 1.
 *
 * Each contract exists twice on purpose:
 *  - a JSON Schema sent to the gateway via `response_format: json_schema`
 *  - a runtime validator applied to whatever actually comes back
 *
 * The gateway schema is a request, not a guarantee. Only the validator is
 * trusted, and nothing reaches V19 runtime state until it passes.
 */

import {
  array,
  boolean,
  literalUnion,
  number,
  optional,
  parse,
  strictObject,
  strictRecord,
  string,
  type Infer,
  type ValidationResult,
} from './validate.ts';

/* ------------------------------------------------------------------ *
 * Campaign Coordinator
 * ------------------------------------------------------------------ */

export const RECOMMENDATIONS = ['proceed', 'proceed_with_conditions', 'do_not_proceed'] as const;

export const coordinatorValidator = strictObject({
  campaignOpportunity: boolean(),
  challenge: string({ min: 10, max: 1200 }),
  opportunity: string({ min: 10, max: 1200 }),
  audienceCohorts: array(
    strictObject({
      name: string({ min: 2, max: 120 }),
      rationale: string({ min: 10, max: 600 }),
    }),
    { min: 1, max: 8 },
  ),
  evidenceGaps: array(string({ min: 5, max: 400 }), { min: 1, max: 12 }),
  recommendation: literalUnion(RECOMMENDATIONS),
  recommendationRationale: string({ min: 10, max: 1200 }),
  confidence: optional(number({ min: 0, max: 1 })),
});

export type CoordinatorResult = Infer<typeof coordinatorValidator>;

export const COORDINATOR_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'campaignOpportunity',
    'challenge',
    'opportunity',
    'audienceCohorts',
    'evidenceGaps',
    'recommendation',
    'recommendationRationale',
  ],
  properties: {
    campaignOpportunity: { type: 'boolean' },
    challenge: { type: 'string' },
    opportunity: { type: 'string' },
    audienceCohorts: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'rationale'],
        properties: { name: { type: 'string' }, rationale: { type: 'string' } },
      },
    },
    evidenceGaps: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string' } },
    recommendation: { type: 'string', enum: [...RECOMMENDATIONS] },
    recommendationRationale: { type: 'string' },
    confidence: { type: 'number' },
  },
} as const;

export function validateCoordinatorResult(input: unknown): ValidationResult<CoordinatorResult> {
  return parse(coordinatorValidator, input);
}

/* ------------------------------------------------------------------ *
 * Marketing Strategy & Campaign Brief Agent
 * ------------------------------------------------------------------ */

/**
 * The 28 brief field keys owned by the frozen V19 Stage 2 data model.
 *
 * This list mirrors `briefSections` in the generated V19 runtime. It is
 * restated here by hand because the runtime file is a read-only generated
 * artifact. The renderer owns this contract; the model output is mapped onto
 * it, never the other way round.
 */
export const BRIEF_FIELD_KEYS = [
  // Business Need
  'orgGroup',
  'initiative',
  'qualObjectives',
  'quantObjectives',
  'offering',
  'markets',
  'audience',
  'icp',
  // Campaign Detail & Tactics
  'insight',
  'painPoints',
  'persona',
  'attributes',
  'priorInsights',
  'cta',
  'kpis',
  'measurement',
  'architecture',
  'tactics',
  'media',
  'channels',
  'promotions',
  'budget',
  'timings',
  // Creative
  'audienceMessaging',
  'assets',
  // Technical Support
  'development',
  'integration',
  'reporting',
] as const;

export type BriefFieldKey = (typeof BRIEF_FIELD_KEYS)[number];

export const briefValidator = strictObject({
  campaignName: string({ min: 3, max: 160 }),
  fields: strictRecord(BRIEF_FIELD_KEYS, string({ min: 3, max: 2000 })),
});

export type BriefResult = Infer<typeof briefValidator>;

export const BRIEF_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['campaignName', 'fields'],
  properties: {
    campaignName: { type: 'string' },
    fields: {
      type: 'object',
      additionalProperties: false,
      required: [...BRIEF_FIELD_KEYS],
      properties: Object.fromEntries(BRIEF_FIELD_KEYS.map((key) => [key, { type: 'string' }])),
    },
  },
} as const;

export function validateBriefResult(input: unknown): ValidationResult<BriefResult> {
  return parse(briefValidator, input);
}

/* ------------------------------------------------------------------ *
 * Inbound request contracts
 * ------------------------------------------------------------------ */

/**
 * Browser-supplied context is untrusted too, so it is bounded before it is
 * ever turned into a prompt.
 */
export const discussionContextValidator = strictObject({
  channel: string({ min: 1, max: 120 }),
  connectedSources: array(string({ min: 1, max: 60 }), { min: 0, max: 12 }),
  messages: array(
    strictObject({
      author: string({ min: 1, max: 120 }),
      role: optional(string({ min: 1, max: 160 })),
      text: string({ min: 1, max: 4000 }),
    }),
    { min: 1, max: 80 },
  ),
});

export type DiscussionContext = Infer<typeof discussionContextValidator>;

export const analyseRequestValidator = strictObject({
  discussion: discussionContextValidator,
});

export type AnalyseRequest = Infer<typeof analyseRequestValidator>;

export const briefRequestValidator = strictObject({
  discussion: discussionContextValidator,
  coordinator: optional(coordinatorValidator),
  campaignName: optional(string({ min: 3, max: 160 })),
});

export type BriefRequest = Infer<typeof briefRequestValidator>;

export function validateAnalyseRequest(input: unknown): ValidationResult<AnalyseRequest> {
  return parse(analyseRequestValidator, input);
}

export function validateBriefRequest(input: unknown): ValidationResult<BriefRequest> {
  return parse(briefRequestValidator, input);
}
