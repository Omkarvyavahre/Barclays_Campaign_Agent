import { describe, expect, it } from 'vitest';

import { buildCompositionIdentity, fingerprintContext } from './compositionIdentity';

const context = {
  objective: 'Deepen digital adoption.',
  audience: 'Corporate treasury teams.',
  businessNeed: 'Manual servicing load.',
  proposition: 'One connected front door.',
  creativeDirection: 'Premium, calm and confident.',
};

describe('composition identity', () => {
  it('is deterministic for the same run/channel/attempt/context', () => {
    const first = buildCompositionIdentity({
      runId: 3,
      channel: 'linkedin',
      attemptToken: 'manual-1',
      campaignContext: context,
    });
    const second = buildCompositionIdentity({
      runId: 3,
      channel: 'linkedin',
      attemptToken: 'manual-1',
      campaignContext: context,
    });
    expect(first).toBe(second);
    expect(first).toBe(`3:linkedin:manual-1:${fingerprintContext(context)}`);
  });

  it('changes when the manual attempt token changes', () => {
    const first = buildCompositionIdentity({
      runId: 3,
      channel: 'linkedin',
      attemptToken: 'manual-1',
      campaignContext: context,
    });
    const second = buildCompositionIdentity({
      runId: 3,
      channel: 'linkedin',
      attemptToken: 'manual-2',
      campaignContext: context,
    });
    expect(first).not.toBe(second);
  });
});
