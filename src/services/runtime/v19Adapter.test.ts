import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BarclaysServices, BriefRequestPayload, BriefResult, CoordinatorResult } from '../bridge/types';
import { collectBriefKeys, planBriefUpdate } from './briefMapping';
import type { V19BriefSection, V19RuntimeAccess } from './runtimeAccess';
import { collectDiscussionContext, getAdapterTelemetry, installV19Adapter } from './v19Adapter';

const ORIGINAL_ORG = 'Original organisation value from the V19 fixture.';
const ORIGINAL_KPI = 'Original KPI value from the V19 fixture.';

function makeSections(): V19BriefSection[] {
  return [
    { name: 'Business Need', fields: [['orgGroup', 'Organisation / business group', ORIGINAL_ORG]] },
    { name: 'Campaign Detail & Tactics', fields: [['kpis', 'KPIs', ORIGINAL_KPI]] },
  ];
}

function makeAccess(sections: V19BriefSection[]): { access: V19RuntimeAccess; state: Record<string, unknown> } {
  const state: Record<string, unknown> = {
    campaignName: 'iPortal Digital Engagement Campaign',
    connections: { teams: true, outlook: true, sharepoint: false },
  };
  const teamsState = {
    messages: [
      { initials: 'CL', name: 'Commercial Lead', role: 'UKC Commercial', text: 'We need to deepen relationships.' },
      { initials: 'SC', name: 'Sarah Chen', text: '   ' },
    ],
  };
  return {
    state,
    access: {
      getState: () => state,
      getBriefSections: () => sections,
      getTeamsState: () => teamsState,
    },
  };
}

function makeBridge(overrides: Partial<BarclaysServices['agents']> = {}): BarclaysServices {
  return {
    version: 'test',
    health: vi.fn(async () => ({ ok: true as const, data: {} as never })),
    agents: {
      analyseDiscussion: vi.fn(async () => ({ ok: true as const, data: { source: 'mock' as const, result: null } })),
      generateBrief: vi.fn(async () => ({ ok: true as const, data: { source: 'mock' as const, result: null } })),
      ...overrides,
    },
  };
}

function liveBrief(fields: Record<string, string>): BriefResult {
  return { campaignName: 'Live campaign name', fields };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let originalCreation: ReturnType<typeof vi.fn>;
let originalOpen: ReturnType<typeof vi.fn>;
let renderAll: ReturnType<typeof vi.fn>;
let uninstall: (() => void) | undefined;

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
  delete (fakeGlobal() as { window?: unknown }).window;
});

function fakeGlobal() {
  return globalThis as unknown as { window: Record<string, unknown> };
}

function install(bridge: BarclaysServices, access: V19RuntimeAccess) {
  fakeGlobal().window.__V19_RUNTIME_ACCESS__ = access;
  uninstall = installV19Adapter({ bridge });
  return fakeGlobal().window as Record<string, () => unknown>;
}

describe('discussion context collection', () => {
  it('maps runtime Teams messages and drops empty ones', () => {
    const { access } = makeAccess(makeSections());
    const context = collectDiscussionContext(access);
    expect(context).not.toBeNull();
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

describe('adapter preserves V19 behaviour', () => {
  it('always calls the original runtime functions', async () => {
    const sections = makeSections();
    const { access } = makeAccess(sections);
    const win = install(makeBridge(), access);

    win.startTeamsCreation();
    win.openCampaignStudioFromTeams();
    await flush();

    expect(originalCreation).toHaveBeenCalledTimes(1);
    expect(originalOpen).toHaveBeenCalledTimes(1);
  });

  it('mock mode leaves the V19 fixture untouched and does not re-render', async () => {
    const sections = makeSections();
    const { access } = makeAccess(sections);
    const win = install(makeBridge(), access);

    win.startTeamsCreation();
    win.openCampaignStudioFromTeams();
    await flush();

    expect(sections[0].fields[0][2]).toBe(ORIGINAL_ORG);
    expect(sections[1].fields[0][2]).toBe(ORIGINAL_KPI);
    expect(renderAll).not.toHaveBeenCalled();
    expect(getAdapterTelemetry().brief).toBe('mock');
  });
});

describe('adapter applies valid live data', () => {
  it('writes validated values into the runtime and re-renders', async () => {
    const sections = makeSections();
    const { access, state } = makeAccess(sections);
    const bridge = makeBridge({
      generateBrief: vi.fn(async () => ({
        ok: true as const,
        data: {
          source: 'live' as const,
          result: liveBrief({ orgGroup: 'Live organisation value.', kpis: 'Live KPI value.' }),
        },
      })),
    });

    const win = install(bridge, access);
    win.openCampaignStudioFromTeams();
    await flush();

    expect(sections[0].fields[0][2]).toBe('Live organisation value.');
    expect(sections[1].fields[0][2]).toBe('Live KPI value.');
    expect(sections[0].fields[0][1]).toBe('Organisation / business group');
    expect(state.campaignName).toBe('Live campaign name');
    expect(renderAll).toHaveBeenCalledTimes(1);
    expect(getAdapterTelemetry().brief).toBe('applied');
  });

  it('passes a live coordinator result through as brief context', async () => {
    const sections = makeSections();
    const { access } = makeAccess(sections);
    const coordinator: CoordinatorResult = {
      campaignOpportunity: true,
      challenge: 'A challenge statement.',
      opportunity: 'An opportunity statement.',
      audienceCohorts: [{ name: 'Digital Adoption', rationale: 'Dormant clients.' }],
      evidenceGaps: ['Baseline unconfirmed.'],
      recommendation: 'proceed',
      recommendationRationale: 'Evidence supports proceeding.',
    };
    const generateBrief = vi.fn(async (_request: BriefRequestPayload) => ({
      ok: true as const,
      data: { source: 'mock' as const, result: null },
    }));
    const bridge = makeBridge({
      analyseDiscussion: vi.fn(async () => ({ ok: true as const, data: { source: 'live' as const, result: coordinator } })),
      generateBrief,
    });

    const win = install(bridge, access);
    win.startTeamsCreation();
    await flush();
    win.openCampaignStudioFromTeams();
    await flush();

    expect(generateBrief.mock.calls[0][0]).toMatchObject({ coordinator });
  });
});

describe('adapter rejects invalid live data and falls back to the fixture', () => {
  it.each([
    ['an unknown field', { orgGroup: 'a', kpis: 'b', invented: 'c' }],
    ['a missing field', { orgGroup: 'a' }],
    ['an empty value', { orgGroup: '   ', kpis: 'b' }],
    ['an overlong value', { orgGroup: 'x'.repeat(2500), kpis: 'b' }],
  ])('rejects %s', async (_label, fields) => {
    const sections = makeSections();
    const { access } = makeAccess(sections);
    const bridge = makeBridge({
      generateBrief: vi.fn(async () => ({
        ok: true as const,
        data: { source: 'live' as const, result: liveBrief(fields as Record<string, string>) },
      })),
    });

    const win = install(bridge, access);
    win.openCampaignStudioFromTeams();
    await flush();

    expect(sections[0].fields[0][2]).toBe(ORIGINAL_ORG);
    expect(sections[1].fields[0][2]).toBe(ORIGINAL_KPI);
    expect(renderAll).not.toHaveBeenCalled();
    expect(getAdapterTelemetry().brief).toBe('rejected');
  });

  it('keeps the fixture when the service returns an error', async () => {
    const sections = makeSections();
    const { access } = makeAccess(sections);
    const bridge = makeBridge({
      generateBrief: vi.fn(async () => ({
        ok: false as const,
        error: { category: 'auth_error' as const, message: 'rejected' },
      })),
    });

    const win = install(bridge, access);
    win.openCampaignStudioFromTeams();
    await flush();

    expect(sections[0].fields[0][2]).toBe(ORIGINAL_ORG);
    expect(renderAll).not.toHaveBeenCalled();
    expect(getAdapterTelemetry().brief).toBe('failed');
  });

  it('restores the original functions on uninstall', () => {
    const sections = makeSections();
    const { access } = makeAccess(sections);
    const win = install(makeBridge(), access);
    expect(win.startTeamsCreation).not.toBe(originalCreation);

    uninstall?.();
    uninstall = undefined;
    expect(win.startTeamsCreation).toBe(originalCreation);
    expect(win.openCampaignStudioFromTeams).toBe(originalOpen);
  });
});

describe('brief mapping helpers', () => {
  it('reads field keys straight from the runtime sections', () => {
    expect(collectBriefKeys(makeSections())).toEqual(['orgGroup', 'kpis']);
  });

  it('reports the reason a brief was rejected', () => {
    const plan = planBriefUpdate(liveBrief({ orgGroup: 'a' }), makeSections());
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.reason).toBe('missing-fields');
      if (plan.reason === 'missing-fields') expect(plan.keys).toEqual(['kpis']);
    }
  });

  it('rejects everything when the runtime exposes no sections', () => {
    const plan = planBriefUpdate(liveBrief({ orgGroup: 'a' }), undefined);
    expect(plan).toEqual({ ok: false, reason: 'no-sections' });
  });
});
