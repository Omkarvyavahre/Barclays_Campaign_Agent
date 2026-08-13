/**
 * Campaign Coordinator reasoning.
 *
 * Domain logic only: it builds the prompt, calls the transport and validates
 * the answer. It knows nothing about HTTP, credentials or the V19 DOM.
 */

import type { AiConfig } from './config.ts';
import { AiServiceError } from './errors.ts';
import { requestStructuredCompletion, type AiUsage, type GatewayDeps } from './gateway.ts';
import {
  COORDINATOR_JSON_SCHEMA,
  validateCoordinatorResult,
  type CoordinatorResult,
  type DiscussionContext,
} from './schemas.ts';

export interface AgentOutcome<T> {
  /**
   * `mock` means no provider call was made and `result` is null, which tells
   * the caller to keep the deterministic V19 fixture untouched.
   */
  source: 'mock' | 'live';
  result: T | null;
  model?: string;
  usage?: AiUsage;
}

const SYSTEM_PROMPT = [
  'You are the Campaign Coordinator for a corporate banking marketing team.',
  'You read an internal team discussion and decide whether it contains a campaign opportunity.',
  'Be conservative: only claim an opportunity when the discussion supports it.',
  'List concrete evidence gaps rather than inventing figures.',
  'Respond only with JSON matching the supplied schema.',
].join(' ');

export function buildDiscussionTranscript(discussion: DiscussionContext): string {
  const sources = discussion.connectedSources.length
    ? discussion.connectedSources.join(', ')
    : 'none declared';
  const lines = discussion.messages.map((message) => {
    const role = message.role ? ` (${message.role})` : '';
    return `${message.author}${role}: ${message.text}`;
  });
  return [`Channel: ${discussion.channel}`, `Connected sources: ${sources}`, '', 'Discussion:', ...lines].join('\n');
}

export async function analyseDiscussion(
  config: AiConfig,
  discussion: DiscussionContext,
  deps: GatewayDeps = {},
): Promise<AgentOutcome<CoordinatorResult>> {
  if (config.mode === 'mock') return { source: 'mock', result: null };

  const completion = await requestStructuredCompletion(
    config,
    {
      schemaName: 'campaign_coordinator_analysis',
      schema: COORDINATOR_JSON_SCHEMA,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildDiscussionTranscript(discussion) },
      ],
    },
    deps,
  );

  const validated = validateCoordinatorResult(completion.data);
  if (!validated.ok) {
    throw new AiServiceError('invalid_response', `coordinator validation failed: ${validated.issues.join('; ')}`);
  }

  return { source: 'live', result: validated.value, model: completion.model, usage: completion.usage };
}
