/**
 * Marketing Strategy & Campaign Brief Agent.
 *
 * Produces the 28-field brief that the frozen V19 Stage 2 renderer already
 * knows how to display. The field list is dictated by the renderer, so the
 * prompt enumerates it explicitly rather than letting the model choose a shape.
 */

import type { AiConfig } from './config.ts';
import { AiServiceError } from './errors.ts';
import { requestStructuredCompletion, type GatewayDeps } from './gateway.ts';
import { buildDiscussionTranscript, type AgentOutcome } from './coordinator.ts';
import {
  BRIEF_FIELD_KEYS,
  BRIEF_JSON_SCHEMA,
  validateBriefResult,
  type BriefRequest,
  type BriefResult,
} from './schemas.ts';

const SYSTEM_PROMPT = [
  'You are the Marketing Strategy & Campaign Brief Agent for a corporate banking marketing team.',
  'You turn an approved campaign discussion into a structured campaign brief.',
  `You must return exactly these ${BRIEF_FIELD_KEYS.length} brief fields: ${BRIEF_FIELD_KEYS.join(', ')}.`,
  'Every field must be a concise prose value suitable for a formal campaign brief.',
  'Do not invent quantified claims that the supplied context cannot support.',
  'Respond only with JSON matching the supplied schema.',
].join(' ');

function buildUserPrompt(request: BriefRequest): string {
  const sections = [buildDiscussionTranscript(request.discussion)];

  if (request.campaignName) sections.push(`\nWorking campaign name: ${request.campaignName}`);

  if (request.coordinator) {
    const coordinator = request.coordinator;
    sections.push(
      [
        '',
        'Approved Campaign Coordinator analysis:',
        `Challenge: ${coordinator.challenge}`,
        `Opportunity: ${coordinator.opportunity}`,
        `Recommendation: ${coordinator.recommendation} — ${coordinator.recommendationRationale}`,
        `Audience cohorts: ${coordinator.audienceCohorts.map((c) => `${c.name} (${c.rationale})`).join('; ')}`,
        `Open evidence gaps: ${coordinator.evidenceGaps.join('; ')}`,
      ].join('\n'),
    );
  }

  return sections.join('\n');
}

export async function generateBrief(
  config: AiConfig,
  request: BriefRequest,
  deps: GatewayDeps = {},
): Promise<AgentOutcome<BriefResult>> {
  if (config.mode === 'mock') return { source: 'mock', result: null };

  const completion = await requestStructuredCompletion(
    config,
    {
      schemaName: 'campaign_brief',
      schema: BRIEF_JSON_SCHEMA,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(request) },
      ],
    },
    deps,
  );

  const validated = validateBriefResult(completion.data);
  if (!validated.ok) {
    throw new AiServiceError('invalid_response', `brief validation failed: ${validated.issues.join('; ')}`);
  }

  return { source: 'live', result: validated.value, model: completion.model, usage: completion.usage };
}
