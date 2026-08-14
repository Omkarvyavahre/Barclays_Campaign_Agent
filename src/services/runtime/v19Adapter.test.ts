import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentOutcome,
  BarclaysServices,
  BriefRequestPayload,
  BriefResult,
  BridgeResponse,
  CoordinatorResult,
  DiscussionContext,
} from '../bridge/types';
import { collectBriefKeys, planBriefUpdate } from './briefMapping';
import {
  currentRunAsset,
  getCandidateTelemetry,
  resetCreativeCandidates,
  settleCreativeCandidates,
} from './creativeCandidates';
import type { V19BriefSection, V19RuntimeAccess } from './runtimeAccess';
import {
  BRIEF_STAGE_INDEX,
  collectDiscussionContext,
  getAdapterTelemetry,
  installV19Adapter,
  willOpenStudio,
  willStartTeamsCreation,
} from './v19Adapter';

const ORIGINAL_ORG = 'Original organisation value from the V19 fixture.';
const ORIGINAL_KPI = 'Original KPI value from the V19 fixture.';

const COORDINATOR: CoordinatorResult = {
  campaignOpportunity: true,
  challenge: 'A challenge statement.',
  opportunity: 'An opportunity statement.',
  audienceCohorts: [{ name: 'Digital Adoption', rationale: 'Dormant clients.' }],
  evidenceGaps: ['Baseline unconfirmed.'],
  recommendation: 'proceed',
  recommendationRationale: 'Evidence supports proceeding.',
};

/**
 * Mirrors the runtime's own field list. It carries the fields the creative
 * context reads as well as the two the assertions track, because a live brief is
 * only applied when its keys match the runtime's exactly.
 */
function makeSections(): V19BriefSection[] {
  return [
    {
      name: 'Business Need',
      fields: [
        ['orgGroup', 'Organisation / business group', ORIGINAL_ORG],
        ['qualObjectives', 'Business objectives (qualitative)', 'Fixture objective.'],
        ['audience', 'Target audience', 'Fixture audience.'],
        ['offering', 'Offering', 'Fixture offering.'],
      ],
    },
    {
      name: 'Campaign Detail & Tactics',
      fields: [
        ['kpis', 'KPIs', ORIGINAL_KPI],
        ['painPoints', 'Buyer challenges and pain points', 'Fixture pain points.'],
        ['audienceMessaging', 'Audience messaging', 'Fixture messaging.'],
        ['cta', 'Call to action', 'Fixture CTA'],
      ],
    },
  ];
}

interface Harness {
  access: V19RuntimeAccess;
  state: Record<string, unknown>;
  teamsState: Record<string, unknown>;
  sections: V19BriefSection[];
}

/** Mirrors the runtime state the adapter reads, including V19's own flags. */
function makeHarness(teamsOverrides: Record<string, unknown> = {}): Harness {
  const sections = makeSections();
  const state: Record<string, unknown> = {
    campaignName: 'iPortal Digital Engagement Campaign',
    connections: { teams: true, outlook: true, sharepoint: false },
    generatingStage: null,
    inlineOperationStage: null,
  };
  const teamsState: Record<string, unknown> = {
    runId: 1,
    authorised: true,
    generating: false,
    summaryReady: true,
    messages: [
      { initials: 'CL', name: 'Commercial Lead', role: 'UKC Commercial', text: 'We need to deepen relationships.' },
      { initials: 'SC', name: 'Sarah Chen', text: '   ' },
    ],
    ...teamsOverrides,
  };
  return {
    sections,
    state,
    teamsState,
    access: {
      getState: () => state as never,
      getBriefSections: () => sections,
      getTeamsState: () => teamsState as never,
    },
  };
}

type AnalyseFn = (discussion: DiscussionContext) => Promise<BridgeResponse<AgentOutcome<CoordinatorResult>>>;
type BriefFn = (request: BriefRequestPayload) => Promise<BridgeResponse<AgentOutcome<BriefResult>>>;

interface BridgeStub {
  bridge: BarclaysServices;
  analyse: ReturnType<typeof vi.fn>;
  brief: ReturnType<typeof vi.fn>;
  health: ReturnType<typeof vi.fn>;
  generateImage: ReturnType<typeof vi.fn>;
}

/** The 28 live values a full brief carries, enough to describe a background. */
const LIVE_BRIEF_FIELDS: Record<string, string> = {
  orgGroup: 'Live org value.',
  kpis: 'Live KPI value.',
  qualObjectives: 'Deepen everyday digital adoption.',
  audience: 'Corporate treasury decision makers.',
  painPoints: 'Manual servicing load.',
  offering: 'One connected digital front door.',
  audienceMessaging: 'From moving to iPortal, to doing more digitally.',
  cta: 'Explore iPortal',
};

function liveBrief(fields: Record<string, string> = LIVE_BRIEF_FIELDS): BriefResult {
  return { campaignName: 'Live campaign name', fields };
}

function generatedAsset(channel: 'linkedin' | 'email') {
  const id = `${channel}-f1bca403-4fd1-4246-8789-50bbd52f2bec`;
  return { id, url: `/api/images/asset/${id}`, channel, width: 2688, height: 1536, bytes: 1675743 };
}

function makeBridge(
  options: { mode?: 'mock' | 'gemini'; analyse?: AnalyseFn; brief?: BriefFn; images?: () => unknown } = {},
): BridgeStub {
  const mode = options.mode ?? 'gemini';

  const health = vi.fn(async () => ({
    ok: true as const,
    data: { mode, backend: 'internal_gateway', protocol: 'openai', gatewayConfigured: true, modelConfigured: true },
  }));

  const analyse = vi.fn<AnalyseFn>(
    options.analyse ??
      (async () => ({
        ok: true as const,
        data: mode === 'gemini' ? { source: 'live' as const, result: COORDINATOR } : { source: 'mock' as const, result: null },
      })),
  );

  const brief = vi.fn<BriefFn>(
    options.brief ??
      (async () => ({
        ok: true as const,
        data:
          mode === 'gemini'
            ? { source: 'live' as const, result: liveBrief() }
            : { source: 'mock' as const, result: null },
      })),
  );

  const generateImage = vi.fn(
    options.images ??
      (async (payload: { channel: 'linkedin' | 'email' }) => ({
        ok: true as const,
        data: { source: 'firefly' as const, asset: generatedAsset(payload.channel), referenceSlot: 1 as const },
      })),
  );

  return {
    analyse,
    brief,
    health,
    generateImage,
    bridge: {
      version: 'test',
      health,
      agents: { analyseDiscussion: analyse, generateBrief: brief },
      images: { generate: generateImage, latest: vi.fn(), health: vi.fn() },
    } as unknown as BarclaysServices,
  };
}

/** Lets every queued microtask/timer callback in the adapter chain settle. */
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

let originalCreation: ReturnType<typeof vi.fn>;
let originalOpen: ReturnType<typeof vi.fn>;
let renderAll: ReturnType<typeof vi.fn>;
let uninstall: (() => void) | undefined;

function fakeGlobal() {
  return globalThis as unknown as { window: Record<string, unknown> };
}

beforeEach(() => {
  originalCreation = vi.fn();
  originalOpen = vi.fn();
  renderAll = vi.fn();
  // The adapter only needs these globals; `document` stays undefined so the
  // injected accessor script path is skipped and the stub below is used.
  fakeGlobal().window = {
    startTeamsCreation: originalCreation,
    openCampaignStudioFromTeams: originalOpen,
    renderAll,
  };
});

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  resetCreativeCandidates();
  delete (fakeGlobal() as { window?: unknown }).window;
});

function install(bridge: BarclaysServices, access: V19RuntimeAccess) {
  fakeGlobal().window.__V19_RUNTIME_ACCESS__ = access;
  uninstall = installV19Adapter({ bridge });
  return fakeGlobal().window as Record<string, () => unknown>;
}

/* ------------------------------------------------------------------ */

describe('runtime preconditions mirrored from V19', () => {
  it('only starts creation once the human has authorised and nothing is running', () => {
    expect(willStartTeamsCreation({ authorised: true, generating: false, summaryReady: false })).toBe(true);
    expect(willStartTeamsCreation({ authorised: false })).toBe(false);
    expect(willStartTeamsCreation({ authorised: true, generating: true })).toBe(false);
    expect(willStartTeamsCreation({ authorised: true, summaryReady: true })).toBe(false);
    expect(willStartTeamsCreation(undefined)).toBe(false);
  });

  it('only opens the studio once the brief is ready', () => {
    expect(willOpenStudio({ summaryReady: true })).toBe(true);
    expect(willOpenStudio({ summaryReady: false })).toBe(false);
    expect(willOpenStudio(undefined)).toBe(false);
  });
});

describe('1. an early Studio click makes zero AI calls', () => {
  it('keeps V19 behaviour and spends nothing when summaryReady is false', async () => {
    const h = makeHarness({ summaryReady: false });
    const stub = makeBridge();
    const win = install(stub.bridge, h.access);

    win.openCampaignStudioFromTeams();
    await settle();

    // V19's own function still runs, so its toast/bail-out is untouched.
    expect(originalOpen).toHaveBeenCalledTimes(1);
    expect(stub.analyse).not.toHaveBeenCalled();
    expect(stub.brief).not.toHaveBeenCalled();
    expect(stub.health).not.toHaveBeenCalled();

    // Nothing about the campaign changed.
    expect(h.sections[0].fields[0][2]).toBe(ORIGINAL_ORG);
    expect(h.sections[1].fields[0][2]).toBe(ORIGINAL_KPI);
    expect(h.state.campaignName).toBe('iPortal Digital Engagement Campaign');
    expect(h.state.generatingStage).toBeNull();
    expect(renderAll).not.toHaveBeenCalled();
    expect(getAdapterTelemetry().brief).toBe('idle');
  });

  it('also spends nothing when creation is triggered without authorisation', async () => {
    const h = makeHarness({ authorised: false, summaryReady: false });
    const stub = makeBridge();
    const win = install(stub.bridge, h.access);

    win.startTeamsCreation();
    await settle();

    expect(originalCreation).toHaveBeenCalledTimes(1);
    expect(stub.analyse).not.toHaveBeenCalled();
    expect(stub.brief).not.toHaveBeenCalled();
  });
});

describe('2 & 3. the approved flow makes exactly one call to each agent', () => {
  it('runs the Coordinator once and the Brief agent once', async () => {
    const h = makeHarness({ authorised: true, generating: false, summaryReady: false });
    const stub = makeBridge();
    const win = install(stub.bridge, h.access);

    win.startTeamsCreation();
    await settle();

    expect(stub.analyse).toHaveBeenCalledTimes(1);
    expect(stub.brief).toHaveBeenCalledTimes(1);
    expect(originalCreation).toHaveBeenCalledTimes(1);
  });

  it('starts the Coordinator on approval, before Stage 2 is opened', async () => {
    const h = makeHarness({ summaryReady: false });
    const stub = makeBridge();
    const win = install(stub.bridge, h.access);

    win.startTeamsCreation();
    await settle();

    // Both agents have already run without the studio ever being opened.
    expect(stub.analyse).toHaveBeenCalledTimes(1);
    expect(stub.brief).toHaveBeenCalledTimes(1);
    expect(originalOpen).not.toHaveBeenCalled();
  });

  it('passes the validated Coordinator result into the brief request', async () => {
    const h = makeHarness({ summaryReady: false });
    const stub = makeBridge();
    const win = install(stub.bridge, h.access);

    win.startTeamsCreation();
    await settle();

    expect(stub.brief.mock.calls[0][0]).toMatchObject({ coordinator: COORDINATOR });
  });

  it('still runs the workflow if Stage 2 is opened without a prior approval hook', async () => {
    const h = makeHarness({ summaryReady: true });
    const stub = makeBridge();
    const win = install(stub.bridge, h.access);

    win.openCampaignStudioFromTeams();
    await settle();

    expect(stub.analyse).toHaveBeenCalledTimes(1);
    expect(stub.brief).toHaveBeenCalledTimes(1);
  });
});

describe('4. duplicate actions cannot duplicate calls', () => {
  it('collapses repeated approval and repeated open into one call each', async () => {
    const h = makeHarness({ summaryReady: false });
    const stub = makeBridge();
    const win = install(stub.bridge, h.access);

    win.startTeamsCreation();
    h.teamsState.generating = true;
    win.startTeamsCreation();
    await settle();

    h.teamsState.generating = false;
    h.teamsState.summaryReady = true;
    win.openCampaignStudioFromTeams();
    win.openCampaignStudioFromTeams();
    await settle();

    expect(stub.analyse).toHaveBeenCalledTimes(1);
    expect(stub.brief).toHaveBeenCalledTimes(1);
    expect(originalOpen).toHaveBeenCalledTimes(2);
  });
});

describe('5. a pending live brief is never presented as the final fixture', () => {
  it('holds Stage 2 in V19 generating state until the live result lands', async () => {
    const h = makeHarness({ summaryReady: false });
    let release: (value: BridgeResponse<AgentOutcome<BriefResult>>) => void = () => {};
    const gate = new Promise<BridgeResponse<AgentOutcome<BriefResult>>>((resolve) => {
      release = resolve;
    });
    const stub = makeBridge({ brief: () => gate });
    const win = install(stub.bridge, h.access);

    win.startTeamsCreation();
    await settle();

    // Still in flight: V19's own generating treatment is active for Stage 2,
    // so renderConversation shows renderGeneratingState instead of renderBrief.
    expect(h.state.generatingStage).toBe(BRIEF_STAGE_INDEX);
    expect(getAdapterTelemetry().pending).toBe(true);
    expect(h.sections[0].fields[0][2]).toBe(ORIGINAL_ORG);

    release({
      ok: true,
      data: { source: 'live', result: { campaignName: 'Live campaign name', fields: { orgGroup: 'Live org value.', kpis: 'Live KPI value.' } } },
    });
    await settle();

    expect(h.state.generatingStage).toBeNull();
    expect(getAdapterTelemetry().pending).toBe(false);
  });

  it('never marks pending in mock mode', async () => {
    const h = makeHarness({ summaryReady: false });
    const stub = makeBridge({ mode: 'mock' });
    const win = install(stub.bridge, h.access);

    win.startTeamsCreation();
    await settle();

    expect(h.state.generatingStage).toBeNull();
    expect(getAdapterTelemetry().pending).toBe(false);
  });

  it('does not disturb a generation V19 started itself', async () => {
    const h = makeHarness({ summaryReady: false });
    h.state.generatingStage = 5;
    const stub = makeBridge();
    const win = install(stub.bridge, h.access);

    win.startTeamsCreation();
    await settle();

    expect(h.state.generatingStage).toBe(5);
  });
});

describe('6. a successful live result replaces pending with the full field set', () => {
  it('writes every validated value and re-renders through V19', async () => {
    const h = makeHarness({ summaryReady: false });
    const stub = makeBridge();
    const win = install(stub.bridge, h.access);

    win.startTeamsCreation();
    await settle();

    expect(h.sections[0].fields[0][2]).toBe('Live org value.');
    expect(h.sections[1].fields[0][2]).toBe('Live KPI value.');
    expect(h.sections[0].fields[0][1]).toBe('Organisation / business group');
    expect(h.state.campaignName).toBe('Live campaign name');
    expect(h.state.generatingStage).toBeNull();
    expect(renderAll).toHaveBeenCalled();
    expect(getAdapterTelemetry().brief).toBe('applied');
  });
});

describe('7. failures fall back to the deterministic fixture', () => {
  it.each([
    ['an unknown field', { orgGroup: 'a', kpis: 'b', invented: 'c' }],
    ['a missing field', { orgGroup: 'a' }],
    ['an empty value', { orgGroup: '   ', kpis: 'b' }],
    ['an overlong value', { orgGroup: 'x'.repeat(2500), kpis: 'b' }],
  ])('rejects %s and keeps the fixture', async (_label, fields) => {
    const h = makeHarness({ summaryReady: false });
    const stub = makeBridge({
      brief: async () => ({
        ok: true as const,
        data: { source: 'live' as const, result: { campaignName: 'Live name', fields: fields as Record<string, string> } },
      }),
    });
    const win = install(stub.bridge, h.access);

    win.startTeamsCreation();
    await settle();

    expect(h.sections[0].fields[0][2]).toBe(ORIGINAL_ORG);
    expect(h.sections[1].fields[0][2]).toBe(ORIGINAL_KPI);
    expect(h.state.generatingStage).toBeNull();
    expect(getAdapterTelemetry().brief).toBe('rejected');
  });

  it('restores the fixture when the brief request errors', async () => {
    const h = makeHarness({ summaryReady: false });
    const stub = makeBridge({
      brief: async () => ({ ok: false as const, error: { category: 'auth_error' as const, message: 'rejected' } }),
    });
    const win = install(stub.bridge, h.access);

    win.startTeamsCreation();
    await settle();

    expect(h.sections[0].fields[0][2]).toBe(ORIGINAL_ORG);
    expect(h.state.generatingStage).toBeNull();
    expect(getAdapterTelemetry().brief).toBe('failed');
    expect(renderAll).toHaveBeenCalled();
  });

  it('skips the brief call entirely when the Coordinator fails', async () => {
    const h = makeHarness({ summaryReady: false });
    const stub = makeBridge({
      analyse: async () => ({ ok: false as const, error: { category: 'timeout' as const, message: 'slow' } }),
    });
    const win = install(stub.bridge, h.access);

    win.startTeamsCreation();
    await settle();

    expect(stub.analyse).toHaveBeenCalledTimes(1);
    expect(stub.brief).not.toHaveBeenCalled();
    expect(h.sections[0].fields[0][2]).toBe(ORIGINAL_ORG);
    expect(h.state.generatingStage).toBeNull();
    expect(getAdapterTelemetry().brief).toBe('failed');
  });
});

describe('8. replay invalidates in-flight results', () => {
  it('discards a brief that arrives after the run was reset', async () => {
    const h = makeHarness({ summaryReady: false });
    let release: (value: BridgeResponse<AgentOutcome<BriefResult>>) => void = () => {};
    const gate = new Promise<BridgeResponse<AgentOutcome<BriefResult>>>((resolve) => {
      release = resolve;
    });
    const stub = makeBridge({ brief: () => gate });
    const win = install(stub.bridge, h.access);

    win.startTeamsCreation();
    await settle();
    expect(h.state.generatingStage).toBe(BRIEF_STAGE_INDEX);

    // V19 replay: runId is incremented and the discussion is reset.
    h.teamsState.runId = 2;
    h.teamsState.summaryReady = false;
    h.teamsState.authorised = false;

    release({
      ok: true,
      data: { source: 'live', result: { campaignName: 'Stale name', fields: { orgGroup: 'Stale org.', kpis: 'Stale KPI.' } } },
    });
    await settle();

    expect(h.sections[0].fields[0][2]).toBe(ORIGINAL_ORG);
    expect(h.sections[1].fields[0][2]).toBe(ORIGINAL_KPI);
    expect(h.state.campaignName).toBe('iPortal Digital Engagement Campaign');
    expect(getAdapterTelemetry().lastRejection).toContain('stale');
  });

  it('clears a stale pending marker when a new run starts', async () => {
    const h = makeHarness({ summaryReady: false });
    const gate = new Promise<BridgeResponse<AgentOutcome<BriefResult>>>(() => {});
    const stub = makeBridge({ brief: () => gate });
    const win = install(stub.bridge, h.access);

    win.startTeamsCreation();
    await settle();
    expect(h.state.generatingStage).toBe(BRIEF_STAGE_INDEX);

    h.teamsState.runId = 3;
    win.startTeamsCreation();
    await settle();

    expect(getAdapterTelemetry().runId).toBe(3);
    // A second workflow was started for the new run rather than reusing state.
    expect(stub.analyse).toHaveBeenCalledTimes(2);
  });

  it('starts a fresh Coordinator call for a genuinely new run', async () => {
    const h = makeHarness({ summaryReady: false });
    const stub = makeBridge();
    const win = install(stub.bridge, h.access);

    win.startTeamsCreation();
    await settle();
    expect(stub.analyse).toHaveBeenCalledTimes(1);

    h.teamsState.runId = 2;
    h.teamsState.generating = false;
    h.teamsState.summaryReady = false;
    win.startTeamsCreation();
    await settle();

    expect(stub.analyse).toHaveBeenCalledTimes(2);
  });
});

describe('9. mock mode is identical to approved fixture behaviour', () => {
  it('changes nothing and re-renders nothing', async () => {
    const h = makeHarness({ summaryReady: false });
    const stub = makeBridge({ mode: 'mock' });
    const win = install(stub.bridge, h.access);

    win.startTeamsCreation();
    await settle();
    h.teamsState.summaryReady = true;
    win.openCampaignStudioFromTeams();
    await settle();

    expect(h.sections[0].fields[0][2]).toBe(ORIGINAL_ORG);
    expect(h.sections[1].fields[0][2]).toBe(ORIGINAL_KPI);
    expect(h.state.campaignName).toBe('iPortal Digital Engagement Campaign');
    expect(h.state.generatingStage).toBeNull();
    expect(renderAll).not.toHaveBeenCalled();
    expect(getAdapterTelemetry().brief).toBe('mock');
    expect(originalCreation).toHaveBeenCalledTimes(1);
    expect(originalOpen).toHaveBeenCalledTimes(1);
  });
});

describe('10. the applied live brief triggers one candidate per channel', () => {
  it('generates for both channels, after the brief and before Stage 7', async () => {
    const h = makeHarness({ summaryReady: false });
    const stub = makeBridge();
    const win = install(stub.bridge, h.access);

    win.startTeamsCreation();
    await settle();
    await settleCreativeCandidates();

    expect(stub.generateImage).toHaveBeenCalledTimes(2);
    expect(stub.generateImage.mock.calls.map(([payload]) => payload.channel)).toEqual(['linkedin', 'email']);
    expect(originalOpen).not.toHaveBeenCalled();
    expect(currentRunAsset('linkedin')?.channel).toBe('linkedin');
    expect(currentRunAsset('email')?.channel).toBe('email');
  });

  it('describes the background from the live brief values, not the fixture', async () => {
    const h = makeHarness({ summaryReady: false });
    const stub = makeBridge();
    const win = install(stub.bridge, h.access);

    win.startTeamsCreation();
    await settle();

    expect(stub.generateImage.mock.calls[0][0].campaignContext).toMatchObject({
      objective: LIVE_BRIEF_FIELDS.qualObjectives,
      creativeDirection: LIVE_BRIEF_FIELDS.audienceMessaging,
    });
  });

  it('generates nothing until the brief has actually been applied', async () => {
    const h = makeHarness({ summaryReady: false });
    let release: (value: BridgeResponse<AgentOutcome<BriefResult>>) => void = () => {};
    const gate = new Promise<BridgeResponse<AgentOutcome<BriefResult>>>((resolve) => {
      release = resolve;
    });
    const stub = makeBridge({ brief: () => gate });
    const win = install(stub.bridge, h.access);

    win.startTeamsCreation();
    await settle();

    // The Coordinator has run and Stage 2 is pending, but no image yet.
    expect(stub.analyse).toHaveBeenCalledTimes(1);
    expect(stub.generateImage).not.toHaveBeenCalled();

    release({ ok: true, data: { source: 'live', result: liveBrief() } });
    await settle();

    expect(stub.generateImage).toHaveBeenCalledTimes(2);
  });

  it('generates nothing when the live brief is rejected', async () => {
    const h = makeHarness({ summaryReady: false });
    const stub = makeBridge({
      brief: async () => ({
        ok: true as const,
        data: { source: 'live' as const, result: liveBrief({ orgGroup: 'only one field' }) },
      }),
    });
    const win = install(stub.bridge, h.access);

    win.startTeamsCreation();
    await settle();

    expect(getAdapterTelemetry().brief).toBe('rejected');
    expect(stub.generateImage).not.toHaveBeenCalled();
  });

  it('generates nothing in mock mode', async () => {
    const h = makeHarness({ summaryReady: false });
    const stub = makeBridge({ mode: 'mock' });
    const win = install(stub.bridge, h.access);

    win.startTeamsCreation();
    await settle();

    expect(stub.generateImage).not.toHaveBeenCalled();
    expect(currentRunAsset('linkedin')).toBeNull();
  });
});

describe('7 & 11. no later interaction can spend another generation', () => {
  it('collapses repeated approval, repeated open and Stage 7 navigation', async () => {
    const h = makeHarness({ summaryReady: false });
    const stub = makeBridge();
    const win = install(stub.bridge, h.access);

    win.startTeamsCreation();
    await settle();

    h.teamsState.generating = false;
    h.teamsState.summaryReady = true;
    win.openCampaignStudioFromTeams();
    win.openCampaignStudioFromTeams();
    win.startTeamsCreation();
    await settle();
    await settleCreativeCandidates();

    expect(stub.generateImage).toHaveBeenCalledTimes(2);
    expect(stub.brief).toHaveBeenCalledTimes(1);
  });

  it('makes no image call at all when V19 refuses to open Stage 7', async () => {
    const h = makeHarness({ summaryReady: false, authorised: false });
    const stub = makeBridge();
    const win = install(stub.bridge, h.access);

    win.openCampaignStudioFromTeams();
    await settle();

    expect(stub.generateImage).not.toHaveBeenCalled();
  });
});

describe('12 & 25. a replayed run generates again without disturbing Gemini', () => {
  it('allows one fresh candidate per channel for the new run', async () => {
    const h = makeHarness({ summaryReady: false });
    const stub = makeBridge();
    const win = install(stub.bridge, h.access);

    win.startTeamsCreation();
    await settle();
    await settleCreativeCandidates();
    expect(stub.generateImage).toHaveBeenCalledTimes(2);

    h.teamsState.runId = 2;
    h.teamsState.summaryReady = false;
    win.startTeamsCreation();
    await settle();
    await settleCreativeCandidates();

    expect(stub.generateImage).toHaveBeenCalledTimes(4);
    expect(getCandidateTelemetry().runId).toBe(2);
  });

  it('keeps the brief applied even when both generations fail', async () => {
    const h = makeHarness({ summaryReady: false });
    const stub = makeBridge({
      images: async () => ({ ok: false as const, error: { category: 'upstream_error' as const, message: 'no' } }),
    });
    const win = install(stub.bridge, h.access);

    win.startTeamsCreation();
    await settle();
    await settleCreativeCandidates();

    expect(getAdapterTelemetry().brief).toBe('applied');
    expect(h.sections[0].fields[0][2]).toBe('Live org value.');
    expect(h.state.generatingStage).toBeNull();
    expect(currentRunAsset('linkedin')).toBeNull();
  });
});

describe('adapter lifecycle', () => {
  it('restores the original functions on uninstall', () => {
    const h = makeHarness();
    const stub = makeBridge();
    const win = install(stub.bridge, h.access);
    expect(win.startTeamsCreation).not.toBe(originalCreation);

    uninstall?.();
    uninstall = undefined;
    expect(win.startTeamsCreation).toBe(originalCreation);
    expect(win.openCampaignStudioFromTeams).toBe(originalOpen);
  });

  it('clears a pending marker on uninstall so Stage 2 is never left generating', async () => {
    const h = makeHarness({ summaryReady: false });
    const gate = new Promise<BridgeResponse<AgentOutcome<BriefResult>>>(() => {});
    const stub = makeBridge({ brief: () => gate });
    const win = install(stub.bridge, h.access);

    win.startTeamsCreation();
    await settle();
    expect(h.state.generatingStage).toBe(BRIEF_STAGE_INDEX);

    uninstall?.();
    uninstall = undefined;
    expect(h.state.generatingStage).toBeNull();
  });
});

describe('discussion context collection', () => {
  it('maps runtime Teams messages and drops empty ones', () => {
    const { access } = makeHarness();
    const context = collectDiscussionContext(access);
    expect(context?.messages).toHaveLength(1);
    expect(context?.messages[0]).toEqual({
      author: 'Commercial Lead',
      role: 'UKC Commercial',
      text: 'We need to deepen relationships.',
    });
    expect(context?.connectedSources).toEqual(['teams', 'outlook']);
  });

  it('returns null when the runtime has no usable discussion', () => {
    const access: V19RuntimeAccess = {
      getState: () => undefined,
      getBriefSections: () => undefined,
      getTeamsState: () => ({ messages: [] }),
    };
    expect(collectDiscussionContext(access)).toBeNull();
  });
});

describe('brief mapping helpers', () => {
  it('reads field keys straight from the runtime sections', () => {
    expect(collectBriefKeys(makeSections())).toEqual([
      'orgGroup',
      'qualObjectives',
      'audience',
      'offering',
      'kpis',
      'painPoints',
      'audienceMessaging',
      'cta',
    ]);
  });

  it('reports the reason a brief was rejected', () => {
    const plan = planBriefUpdate({ campaignName: 'x', fields: { orgGroup: 'a' } }, makeSections());
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.reason).toBe('missing-fields');
      if (plan.reason === 'missing-fields') {
        expect(plan.keys).toEqual(['qualObjectives', 'audience', 'offering', 'kpis', 'painPoints', 'audienceMessaging', 'cta']);
      }
    }
  });

  it('rejects everything when the runtime exposes no sections', () => {
    const plan = planBriefUpdate({ campaignName: 'x', fields: { orgGroup: 'a' } }, undefined);
    expect(plan).toEqual({ ok: false, reason: 'no-sections' });
  });
});
