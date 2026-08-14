/**
 * Client-side composition identity for manual Firefly regeneration.
 *
 * The identity is a short deterministic string the server hashes into an
 * approved composition variant. It never carries prompt text, credentials or
 * filesystem paths — only run/channel/attempt scope plus a compact context
 * fingerprint so two explicit regenerations can land on different variants.
 */

import type { CampaignImageContext, ImageChannel } from '../bridge/types';

export const COMPOSITION_IDENTITY_MAX = 200;

/** FNV-1a 32-bit, mirrored from the server hash so tests can reason about both. */
export function fingerprintContext(campaignContext: CampaignImageContext): string {
  const material = [
    campaignContext.objective,
    campaignContext.audience,
    campaignContext.businessNeed,
    campaignContext.proposition,
    campaignContext.creativeDirection,
    campaignContext.constraints ?? '',
  ].join('\u001f');

  let hash = 0x811c9dc5;
  for (let index = 0; index < material.length; index++) {
    hash ^= material.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export interface CompositionIdentityParts {
  runId: number;
  channel: ImageChannel;
  /** Manual regeneration counter/token. Distinct clicks must use distinct tokens. */
  attemptToken: string;
  campaignContext: CampaignImageContext;
}

/**
 * Builds a composition identity scoped to run + channel + attempt + campaign.
 * Truncated to the wire maximum so validation never rejects a well-formed call.
 */
export function buildCompositionIdentity(parts: CompositionIdentityParts): string {
  const identity = [
    String(parts.runId),
    parts.channel,
    parts.attemptToken,
    fingerprintContext(parts.campaignContext),
  ].join(':');

  return identity.slice(0, COMPOSITION_IDENTITY_MAX);
}
