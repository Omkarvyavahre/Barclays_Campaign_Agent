/**
 * Candidate generation is expensive and irreversible from the demo's point of
 * view, so the properties pinned here are about restraint.
 *
 * One generation per channel per run, never before the trigger, never twice for
 * the same run, never promoted unless it passes the objective checks, and never
 * able to land on a run that has already been replaced. A candidate that fails
 * any of that leaves the approved background exactly where it was.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BarclaysServices, GeneratedImageAsset, ImageChannel, ImageOutcome } from '../bridge/types';
import {
  CANDIDATE_CHANNELS,
  EXPECTED_ASSET_SIZE,
  beginCreativeRun,
  currentRunAsset,
  getCandidateTelemetry,
  isPromotableAsset,
  resetCreativeCandidates,
  settleCreativeCandidates,
  startCreativeCandidates,
  subscribeToCreativeCandidates,
} from './creativeCandidates';

const IDS: Record<ImageChannel, string> = {
  linkedin: 'linkedin-f1bca403-4fd1-4246-8789-50bbd52f2bec',
  email: 'email-8781d5ae-a62f-43c7-b41b-e3524ff0f0b3',
};

function asset(channel: ImageChannel, overrides: Partial<GeneratedImageAsset> = {}): GeneratedImageAsset {
  return {
    id: IDS[channel],
    url: `/api/images/asset/${IDS[channel]}`,
    channel,
    width: EXPECTED_ASSET_SIZE.width,
    height: EXPECTED_ASSET_SIZE.height,
    bytes: 1675743,
    ...overrides,
  };
}

function request(channel: ImageChannel) {
  return {
    channel,
    campaignContext: {
      objective: 'Deepen digital adoption.',
      audience: 'Corporate treasury teams.',
      businessNeed: 'Manual servicing load.',
      proposition: 'One connected front door.',
      creativeDirection: 'Premium, calm and confident.',
    },
    outputContext: { headline: 'Discover what is possible', cta: 'Explore iPortal' },
  };
}

type GenerateResult = { ok: true; data: ImageOutcome } | { ok: false; error: { category: string; message: string } };

interface Stub {
  bridge: BarclaysServices;
  generate: ReturnType<typeof vi.fn>;
  callsFor(channel: ImageChannel): number;
}

function makeBridge(reply: (channel: ImageChannel) => GenerateResult | Promise<GenerateResult>): Stub {
  const generate = vi.fn(async (payload: { channel: ImageChannel }) => reply(payload.channel));
  const bridge = { images: { generate } } as unknown as BarclaysServices;

  return {
    bridge,
    generate,
    callsFor: (channel) => generate.mock.calls.filter(([payload]) => payload.channel === channel).length,
  };
}

function live(channel: ImageChannel, overrides: Partial<GeneratedImageAsset> = {}): GenerateResult {
  return { ok: true, data: { source: 'firefly', asset: asset(channel, overrides), referenceSlot: 1 } };
}

function start(stub: Stub, runId = 1) {
  startCreativeCandidates({ bridge: stub.bridge, runId, request });
  return settleCreativeCandidates();
}

beforeEach(() => resetCreativeCandidates());
afterEach(() => resetCreativeCandidates());

/* ------------------------------------------------------------------ */

describe('1 & 2. the trigger starts one candidate per channel', () => {
  it('generates for LinkedIn and for email', async () => {
    const stub = makeBridge((channel) => live(channel));
    await start(stub);

    expect(stub.callsFor('linkedin')).toBe(1);
    expect(stub.callsFor('email')).toBe(1);
    expect(stub.generate).toHaveBeenCalledTimes(2);
    expect(CANDIDATE_CHANNELS).toEqual(['linkedin', 'email']);
  });

  it('promotes each validated candidate to the current run', async () => {
    const stub = makeBridge((channel) => live(channel));
    await start(stub);

    expect(currentRunAsset('linkedin')?.id).toBe(IDS.linkedin);
    expect(currentRunAsset('email')?.id).toBe(IDS.email);
    expect(getCandidateTelemetry()).toMatchObject({ runId: 1, linkedin: 'ready', email: 'ready' });
  });
});

describe('3. nothing is generated before the trigger', () => {
  it('has no run and no asset until the workflow starts one', () => {
    expect(getCandidateTelemetry()).toMatchObject({ runId: null, linkedin: 'idle', email: 'idle' });
    expect(currentRunAsset('linkedin')).toBeNull();
    expect(currentRunAsset('email')).toBeNull();
  });

  it('opening a run alone generates nothing', () => {
    const stub = makeBridge((channel) => live(channel));
    beginCreativeRun(1);

    expect(stub.generate).not.toHaveBeenCalled();
    expect(currentRunAsset('linkedin')).toBeNull();
  });
});

describe('4, 5 & 6. exactly one call per channel per run', () => {
  it('deduplicates repeated triggers for the same run', async () => {
    const stub = makeBridge((channel) => live(channel));

    await start(stub, 1);
    await start(stub, 1);
    await start(stub, 1);

    expect(stub.callsFor('linkedin')).toBe(1);
    expect(stub.callsFor('email')).toBe(1);
  });

  it('deduplicates a trigger fired again while the first is still in flight', async () => {
    let release: (value: GenerateResult) => void = () => {};
    const gate = new Promise<GenerateResult>((resolve) => {
      release = resolve;
    });
    const stub = makeBridge(() => gate);

    startCreativeCandidates({ bridge: stub.bridge, runId: 1, request });
    startCreativeCandidates({ bridge: stub.bridge, runId: 1, request });
    expect(stub.generate).toHaveBeenCalledTimes(2);

    release(live('linkedin'));
    await settleCreativeCandidates();
    expect(stub.generate).toHaveBeenCalledTimes(2);
  });
});

describe('12 & 13. runs are isolated from each other', () => {
  it('allows one fresh candidate per channel for a new run', async () => {
    const stub = makeBridge((channel) => live(channel));

    await start(stub, 1);
    await start(stub, 2);

    expect(stub.callsFor('linkedin')).toBe(2);
    expect(stub.callsFor('email')).toBe(2);
    expect(getCandidateTelemetry().runId).toBe(2);
  });

  it('drops a candidate that arrives after its run was replaced', async () => {
    let release: (value: GenerateResult) => void = () => {};
    const gate = new Promise<GenerateResult>((resolve) => {
      release = resolve;
    });
    const stub = makeBridge(() => gate);

    startCreativeCandidates({ bridge: stub.bridge, runId: 1, request });
    beginCreativeRun(2);
    release(live('linkedin'));
    // The retired run is no longer tracked, so its continuations are awaited
    // by turning the microtask queue rather than through the active run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(currentRunAsset('linkedin')).toBeNull();
    expect(getCandidateTelemetry()).toMatchObject({ runId: 2, linkedin: 'idle' });
    expect(getCandidateTelemetry().lastRejection).toContain('previous run');
  });

  it('retires the previous run assets as soon as a new run opens', async () => {
    const stub = makeBridge((channel) => live(channel));
    await start(stub, 1);
    expect(currentRunAsset('linkedin')?.id).toBe(IDS.linkedin);

    beginCreativeRun(2);

    expect(currentRunAsset('linkedin')).toBeNull();
    expect(currentRunAsset('email')).toBeNull();
  });
});

describe('16 to 20. only an objectively valid candidate is promoted', () => {
  it('keeps nothing when the provider fails', async () => {
    const stub = makeBridge(() => ({ ok: false, error: { category: 'upstream_error', message: 'no' } }));
    await start(stub);

    expect(currentRunAsset('linkedin')).toBeNull();
    expect(getCandidateTelemetry().linkedin).toBe('failed');
    expect(getCandidateTelemetry().lastRejection).toContain('upstream_error');
  });

  it('keeps nothing when the request throws', async () => {
    const onError = vi.fn();
    const generate = vi.fn(async () => {
      throw new Error('network down');
    });
    const bridge = { images: { generate } } as unknown as BarclaysServices;

    startCreativeCandidates({ bridge, runId: 1, request, onError });
    await settleCreativeCandidates();

    expect(currentRunAsset('linkedin')).toBeNull();
    expect(getCandidateTelemetry().linkedin).toBe('failed');
    expect(onError).toHaveBeenCalled();
  });

  it.each([
    ['wrong dimensions', { width: 1200, height: 627 }],
    ['a zero-byte file', { bytes: 0 }],
    ['a malformed id', { id: 'linkedin-not-a-uuid' }],
    ['a url that does not address the id', { url: '/api/images/asset/linkedin-other' }],
    ['another channel', { channel: 'email' as ImageChannel }],
  ])('rejects %s and keeps the approved fallback', async (_label, overrides) => {
    const stub = makeBridge((channel) => live(channel, overrides));
    await start(stub);

    expect(currentRunAsset('linkedin')).toBeNull();
    expect(getCandidateTelemetry().linkedin).toBe('rejected');
    expect(getCandidateTelemetry().lastRejection).toContain('objective validation');
  });

  it('accepts only a descriptor that passes every check', () => {
    expect(isPromotableAsset(asset('linkedin'), 'linkedin')).toBe(true);
    expect(isPromotableAsset(null, 'linkedin')).toBe(false);
    expect(isPromotableAsset(asset('email'), 'linkedin')).toBe(false);
    expect(isPromotableAsset(asset('linkedin', { height: 1535 }), 'linkedin')).toBe(false);
  });

  it('generates nothing when the campaign context is insufficient', async () => {
    const stub = makeBridge((channel) => live(channel));
    startCreativeCandidates({ bridge: stub.bridge, runId: 1, request: () => null });
    await settleCreativeCandidates();

    expect(stub.generate).not.toHaveBeenCalled();
    expect(getCandidateTelemetry().linkedin).toBe('rejected');
  });

  it('keeps the channels independent when only one fails', async () => {
    const stub = makeBridge((channel) =>
      channel === 'linkedin' ? live('linkedin') : { ok: false, error: { category: 'timeout', message: 'slow' } },
    );
    await start(stub);

    expect(currentRunAsset('linkedin')?.id).toBe(IDS.linkedin);
    expect(currentRunAsset('email')).toBeNull();
    expect(getCandidateTelemetry()).toMatchObject({ linkedin: 'ready', email: 'failed' });
  });
});

describe('mock mode keeps the existing background', () => {
  it('promotes nothing when the provider is mocked', async () => {
    const stub = makeBridge(() => ({ ok: true, data: { source: 'mock', asset: null, referenceSlot: 1 } }));
    await start(stub);

    expect(currentRunAsset('linkedin')).toBeNull();
    expect(currentRunAsset('email')).toBeNull();
    expect(getCandidateTelemetry()).toMatchObject({ linkedin: 'mock', email: 'mock' });
  });
});

describe('23. every candidate is addressed by its own id', () => {
  it('promotes distinct ids for the two channels', async () => {
    const stub = makeBridge((channel) => live(channel));
    await start(stub);

    const linkedin = currentRunAsset('linkedin');
    const email = currentRunAsset('email');
    expect(linkedin?.id).not.toBe(email?.id);
    expect(linkedin?.url).toBe(`/api/images/asset/${linkedin?.id}`);
  });
});

describe('subscribers are told only when something is promoted', () => {
  it('notifies on promotion and on a new run, not on every call', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToCreativeCandidates(listener);
    const stub = makeBridge(() => ({ ok: false, error: { category: 'timeout', message: 'slow' } }));

    await start(stub, 1);
    // Only the run opening notified; two failures notified nothing.
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await start(makeBridge((channel) => live(channel)), 2);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
