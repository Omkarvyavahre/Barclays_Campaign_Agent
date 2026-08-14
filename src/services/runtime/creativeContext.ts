/**
 * Builds the image request from the campaign context that exists the moment a
 * live brief has been applied.
 *
 * There is no second campaign-data model: every value is read from the validated
 * brief the adapter just wrote into V19, mapped onto the field names the
 * server's prompt builder already accepts. If the brief cannot supply a field,
 * no request is built and the approved background simply stays.
 *
 * Headline and CTA travel as tone context only. The server's prompt builder
 * never puts either into the prompt, and nothing readable is ever generated into
 * the image; campaign wording is composed as real HTML text in Stage 7.
 */

import type { BriefResult, CampaignImageContext, ImageChannel, ImageRequestPayload } from '../bridge/types';
import type { V19State } from './runtimeAccess';

/**
 * Which V19 brief field feeds each prompt input.
 *
 * `creativeDirection` earns prompt budget first, so it is mapped to audience
 * messaging: the campaign's own narrative is the closest thing the brief has to
 * a tone instruction. Anything naming a depicted subject is dropped server-side.
 */
export const CONTEXT_FIELD_MAP: Record<keyof CampaignImageContext, string> = {
  objective: 'qualObjectives',
  audience: 'audience',
  businessNeed: 'painPoints',
  proposition: 'offering',
  creativeDirection: 'audienceMessaging',
  constraints: 'attributes',
};

export const CONTEXT_FIELD_MAX = 2000;
export const HEADLINE_MAX = 400;
export const CTA_MAX = 200;

interface V19Output {
  headline?: unknown;
  cta?: unknown;
}

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Maps the applied brief onto one channel's image request, or null when the
 * brief does not carry enough to describe the campaign.
 */
export function buildImageRequest(
  brief: BriefResult,
  state: V19State | undefined,
  channel: ImageChannel,
): ImageRequestPayload | null {
  const fields = brief.fields ?? {};

  const objective = clean(fields[CONTEXT_FIELD_MAP.objective], CONTEXT_FIELD_MAX);
  const audience = clean(fields[CONTEXT_FIELD_MAP.audience], CONTEXT_FIELD_MAX);
  const businessNeed = clean(fields[CONTEXT_FIELD_MAP.businessNeed], CONTEXT_FIELD_MAX);
  const proposition = clean(fields[CONTEXT_FIELD_MAP.proposition], CONTEXT_FIELD_MAX);
  const creativeDirection = clean(fields[CONTEXT_FIELD_MAP.creativeDirection], CONTEXT_FIELD_MAX);
  const constraints = clean(fields[CONTEXT_FIELD_MAP.constraints], CONTEXT_FIELD_MAX);

  if (!objective || !audience || !businessNeed || !proposition || !creativeDirection) return null;

  const outputs = state?.outputs as Record<string, V19Output> | undefined;
  const campaignName = clean(brief.campaignName, HEADLINE_MAX);
  const headline = clean(outputs?.[channel]?.headline, HEADLINE_MAX) || campaignName;
  const cta = clean(outputs?.[channel]?.cta, CTA_MAX) || clean(fields.cta, CTA_MAX);

  if (!headline || !cta) return null;

  return {
    channel,
    campaignContext: {
      objective,
      audience,
      businessNeed,
      proposition,
      creativeDirection,
      ...(constraints ? { constraints } : {}),
    },
    outputContext: { headline, cta },
  };
}
