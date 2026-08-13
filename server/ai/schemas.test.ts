import { describe, expect, it } from 'vitest';

import {
  BRIEF_FIELD_KEYS,
  validateAnalyseRequest,
  validateBriefRequest,
  validateBriefResult,
  validateCoordinatorResult,
} from './schemas';

export function validCoordinator() {
  return {
    campaignOpportunity: true,
    challenge: 'Clients are not discovering existing self-service capabilities.',
    opportunity: 'Increase depth of iPortal usage across priority cohorts.',
    audienceCohorts: [{ name: 'Digital Adoption', rationale: 'Dormant clients with entitlement already in place.' }],
    evidenceGaps: ['Active-user baseline is unconfirmed.'],
    recommendation: 'proceed_with_conditions' as const,
    recommendationRationale: 'Proceed once the eligible population is validated.',
  };
}

export function validBriefFields(): Record<string, string> {
  return Object.fromEntries(BRIEF_FIELD_KEYS.map((key) => [key, `Value for ${key} field.`]));
}

export function validDiscussion() {
  return {
    channel: 'iPortal Adoption',
    connectedSources: ['teams', 'outlook'],
    messages: [{ author: 'Commercial Lead', role: 'UKC Commercial', text: 'We need to deepen client relationships.' }],
  };
}

describe('coordinator schema validation', () => {
  it('accepts a well-formed result', () => {
    const result = validateCoordinatorResult(validCoordinator());
    expect(result.ok).toBe(true);
  });

  it('accepts an optional confidence value', () => {
    const result = validateCoordinatorResult({ ...validCoordinator(), confidence: 0.8 });
    expect(result.ok).toBe(true);
  });

  it('rejects a missing required field', () => {
    const { challenge: _omitted, ...rest } = validCoordinator();
    const result = validateCoordinatorResult(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join()).toContain('challenge');
  });

  it('rejects an unknown property', () => {
    const result = validateCoordinatorResult({ ...validCoordinator(), injected: 'surprise' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join()).toContain('unexpected property');
  });

  it('rejects a wrong primitive type', () => {
    const result = validateCoordinatorResult({ ...validCoordinator(), campaignOpportunity: 'yes' });
    expect(result.ok).toBe(false);
  });

  it('rejects a recommendation outside the allowed set', () => {
    const result = validateCoordinatorResult({ ...validCoordinator(), recommendation: 'maybe' });
    expect(result.ok).toBe(false);
  });

  it('rejects an empty cohort list', () => {
    const result = validateCoordinatorResult({ ...validCoordinator(), audienceCohorts: [] });
    expect(result.ok).toBe(false);
  });

  it('rejects confidence outside 0..1', () => {
    expect(validateCoordinatorResult({ ...validCoordinator(), confidence: 4 }).ok).toBe(false);
  });
});

describe('brief schema validation', () => {
  it('accepts all 28 V19 fields', () => {
    expect(BRIEF_FIELD_KEYS).toHaveLength(28);
    const result = validateBriefResult({ campaignName: 'iPortal Digital Engagement Campaign', fields: validBriefFields() });
    expect(result.ok).toBe(true);
  });

  it('rejects a brief that is missing a single field', () => {
    const fields = validBriefFields();
    delete fields.kpis;
    const result = validateBriefResult({ campaignName: 'Campaign', fields });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join()).toContain('kpis');
  });

  it('rejects an extra field the renderer does not know about', () => {
    const result = validateBriefResult({
      campaignName: 'Campaign',
      fields: { ...validBriefFields(), inventedField: 'nope' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join()).toContain('unexpected property');
  });

  it('rejects an overlong field value', () => {
    const result = validateBriefResult({
      campaignName: 'Campaign',
      fields: { ...validBriefFields(), kpis: 'x'.repeat(2500) },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-string field value', () => {
    const result = validateBriefResult({ campaignName: 'Campaign', fields: { ...validBriefFields(), kpis: 42 } });
    expect(result.ok).toBe(false);
  });
});

describe('inbound request validation', () => {
  it('accepts a well-formed analyse request', () => {
    expect(validateAnalyseRequest({ discussion: validDiscussion() }).ok).toBe(true);
  });

  it('rejects an analyse request with no messages', () => {
    expect(validateAnalyseRequest({ discussion: { ...validDiscussion(), messages: [] } }).ok).toBe(false);
  });

  it('accepts a brief request carrying coordinator context', () => {
    const result = validateBriefRequest({ discussion: validDiscussion(), coordinator: validCoordinator() });
    expect(result.ok).toBe(true);
  });

  it('rejects a brief request with an invalid coordinator block', () => {
    const result = validateBriefRequest({
      discussion: validDiscussion(),
      coordinator: { ...validCoordinator(), recommendation: 'maybe' },
    });
    expect(result.ok).toBe(false);
  });
});
