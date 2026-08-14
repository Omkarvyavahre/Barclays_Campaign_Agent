/**
 * The image request must describe the campaign that was actually approved, and
 * it must come from the brief the adapter just applied rather than from a second
 * data model or a fixture left over in state.
 */

import { describe, expect, it } from 'vitest';

import type { BriefResult } from '../bridge/types';
import { CONTEXT_FIELD_MAP, buildImageRequest } from './creativeContext';
import type { V19State } from './runtimeAccess';

const LIVE_FIELDS: Record<string, string> = {
  qualObjectives: 'Shift iPortal from a migration message to an outcome-led proposition.',
  audience: 'Corporate treasury and finance decision makers.',
  painPoints: 'Manual servicing load and limited visibility across entities.',
  offering: 'One connected digital front door for day-to-day banking.',
  audienceMessaging: 'From moving to iPortal, to doing more digitally with Barclays.',
  attributes: 'Approved capability and consent only.',
  cta: 'Explore iPortal',
};

function brief(overrides: Record<string, string> = {}): BriefResult {
  return { campaignName: 'iPortal Digital Engagement Campaign', fields: { ...LIVE_FIELDS, ...overrides } };
}

function state(): V19State {
  return {
    outputs: {
      linkedin: { headline: 'A step change in how you bank with Barclays', cta: 'Discover iPortal' },
      email: { headline: 'Discover what is possible with iPortal', cta: 'Explore iPortal' },
    },
  };
}

describe('the request is built from the applied brief', () => {
  it('maps each prompt input to its V19 brief field', () => {
    const request = buildImageRequest(brief(), state(), 'linkedin');

    expect(request?.campaignContext).toEqual({
      objective: LIVE_FIELDS.qualObjectives,
      audience: LIVE_FIELDS.audience,
      businessNeed: LIVE_FIELDS.painPoints,
      proposition: LIVE_FIELDS.offering,
      creativeDirection: LIVE_FIELDS.audienceMessaging,
      constraints: LIVE_FIELDS.attributes,
    });
  });

  it('names only fields the V19 brief actually defines', () => {
    for (const field of Object.values(CONTEXT_FIELD_MAP)) {
      expect(Object.keys(LIVE_FIELDS)).toContain(field);
    }
  });

  it('carries live values rather than anything hard-coded', () => {
    const request = buildImageRequest(brief({ audienceMessaging: 'A brand new narrative for this run.' }), state(), 'email');
    expect(request?.campaignContext.creativeDirection).toBe('A brand new narrative for this run.');
  });

  it('takes headline and CTA from the channel output as tone context', () => {
    expect(buildImageRequest(brief(), state(), 'linkedin')?.outputContext).toEqual({
      headline: 'A step change in how you bank with Barclays',
      cta: 'Discover iPortal',
    });
    expect(buildImageRequest(brief(), state(), 'email')?.outputContext.headline).toBe(
      'Discover what is possible with iPortal',
    );
  });

  it('falls back to the campaign name and the brief CTA before Stage 7 exists', () => {
    const request = buildImageRequest(brief(), {}, 'linkedin');
    expect(request?.outputContext).toEqual({
      headline: 'iPortal Digital Engagement Campaign',
      cta: 'Explore iPortal',
    });
  });

  it('sends no channel or format wording, which the API carries itself', () => {
    const request = buildImageRequest(brief(), state(), 'email');
    expect(request?.outputContext.format).toBeUndefined();
    expect(request?.outputContext.dimensions).toBeUndefined();
    expect(request?.channel).toBe('email');
  });

  it('omits optional constraints rather than sending an empty string', () => {
    const request = buildImageRequest(brief({ attributes: '   ' }), state(), 'linkedin');
    expect(request?.campaignContext.constraints).toBeUndefined();
  });
});

describe('an incomplete brief generates nothing', () => {
  it.each(['qualObjectives', 'audience', 'painPoints', 'offering', 'audienceMessaging'])(
    'declines when %s is missing',
    (field) => {
      expect(buildImageRequest(brief({ [field]: '  ' }), state(), 'linkedin')).toBeNull();
    },
  );

  it('declines when nothing can supply a headline or a call to action', () => {
    expect(buildImageRequest({ campaignName: '  ', fields: { ...LIVE_FIELDS, cta: '' } }, {}, 'linkedin')).toBeNull();
  });

  it('declines when the brief has no fields at all', () => {
    expect(buildImageRequest({ campaignName: 'x', fields: {} }, state(), 'linkedin')).toBeNull();
  });
});
