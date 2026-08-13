/**
 * Integration seam between the frozen V19 runtime and the service bridge.
 *
 * Design rules this file exists to enforce:
 *  - the generated runtime is never edited; two global functions are wrapped
 *  - V19 renderers are never replaced, only re-invoked
 *  - the original behaviour always runs first, so the deterministic fixture is
 *    on screen before any live result is considered
 *  - a live result is applied only after it passes validation against the
 *    runtime's own field list; otherwise the fixture simply stays
 *
 * In mock mode the bridge returns `result: null`, so this adapter performs no
 * mutation at all and V19 behaves exactly as it did before integration.
 */

import type { BarclaysServices, CoordinatorResult, DiscussionContext } from '../bridge/types';
import { applyBriefUpdate, planBriefUpdate } from './briefMapping';
import { getRuntimeAccess, installRuntimeAccess, type V19RuntimeAccess } from './runtimeAccess';

type TeamsCreationFn = () => unknown;
type OpenStudioFn = () => unknown;

declare global {
  interface Window {
    startTeamsCreation?: TeamsCreationFn;
    openCampaignStudioFromTeams?: OpenStudioFn;
    renderAll?: (options?: unknown) => void;
    __V19_ADAPTER_INSTALLED__?: boolean;
  }
}

export interface AdapterTelemetry {
  coordinator: 'idle' | 'pending' | 'mock' | 'applied' | 'failed';
  brief: 'idle' | 'pending' | 'mock' | 'applied' | 'rejected' | 'failed';
  lastRejection?: string;
}

const telemetry: AdapterTelemetry = { coordinator: 'idle', brief: 'idle' };

let coordinatorPromise: Promise<CoordinatorResult | null> | null = null;
let coordinatorResult: CoordinatorResult | null = null;

export function getAdapterTelemetry(): AdapterTelemetry {
  return { ...telemetry };
}

/** Builds Coordinator input from the Teams discussion already in runtime state. */
export function collectDiscussionContext(access: V19RuntimeAccess | undefined): DiscussionContext | null {
  const teamsState = access?.getTeamsState();
  const state = access?.getState();
  const rawMessages = teamsState?.messages ?? [];

  const messages = rawMessages
    .filter((message) => typeof message?.text === 'string' && message.text.trim().length > 0)
    .map((message) => ({
      author: (message.name ?? message.initials ?? 'Unknown').toString().slice(0, 120),
      role: message.role ? message.role.toString().slice(0, 160) : undefined,
      text: (message.text as string).trim().slice(0, 4000),
    }));

  if (!messages.length) return null;

  const connections = state?.connections ?? {};
  const connectedSources = Object.keys(connections).filter((key) => connections[key]);

  return { channel: 'iPortal Adoption', connectedSources, messages: messages.slice(0, 80) };
}

async function runCoordinator(bridge: BarclaysServices, access: V19RuntimeAccess | undefined): Promise<CoordinatorResult | null> {
  const discussion = collectDiscussionContext(access);
  if (!discussion) {
    telemetry.coordinator = 'failed';
    telemetry.lastRejection = 'no discussion context available';
    return null;
  }

  telemetry.coordinator = 'pending';
  const response = await bridge.agents.analyseDiscussion(discussion);

  if (!response.ok) {
    telemetry.coordinator = 'failed';
    telemetry.lastRejection = `coordinator ${response.error.category}`;
    return null;
  }
  if (response.data.source === 'mock' || response.data.result === null) {
    telemetry.coordinator = 'mock';
    return null;
  }

  telemetry.coordinator = 'applied';
  return response.data.result;
}

async function enhanceBrief(bridge: BarclaysServices, access: V19RuntimeAccess | undefined): Promise<void> {
  const discussion = collectDiscussionContext(access);
  if (!discussion) {
    telemetry.brief = 'failed';
    telemetry.lastRejection = 'no discussion context available';
    return;
  }

  // The Coordinator call was started earlier during the Teams "preparing"
  // animation; wait for whatever it produced without blocking the UI further.
  if (coordinatorPromise) {
    try {
      coordinatorResult = await coordinatorPromise;
    } catch {
      coordinatorResult = null;
    }
  }

  const state = access?.getState();
  const campaignName = typeof state?.campaignName === 'string' ? state.campaignName : undefined;

  telemetry.brief = 'pending';
  const response = await bridge.agents.generateBrief({
    discussion,
    ...(coordinatorResult ? { coordinator: coordinatorResult } : {}),
    ...(campaignName ? { campaignName } : {}),
  });

  if (!response.ok) {
    telemetry.brief = 'failed';
    telemetry.lastRejection = `brief ${response.error.category}`;
    return;
  }
  if (response.data.source === 'mock' || response.data.result === null) {
    telemetry.brief = 'mock';
    return;
  }

  const sections = access?.getBriefSections();
  const plan = planBriefUpdate(response.data.result, sections);
  if (!plan.ok) {
    telemetry.brief = 'rejected';
    telemetry.lastRejection = `brief mapping ${plan.reason}`;
    return;
  }

  applyBriefUpdate(sections as NonNullable<typeof sections>, plan.updates);

  const liveName = response.data.result.campaignName;
  if (state && typeof liveName === 'string' && liveName.trim()) state.campaignName = liveName.trim();

  telemetry.brief = 'applied';
  window.renderAll?.();
}

export interface AdapterOptions {
  bridge: BarclaysServices;
  onError?: (scope: 'coordinator' | 'brief', error: unknown) => void;
}

/**
 * Wraps the two V19 entry points. Returns an uninstall function so tests (and
 * any future React replacement of these stages) can detach cleanly.
 */
export function installV19Adapter({ bridge, onError }: AdapterOptions): () => void {
  const access = installRuntimeAccess() ?? getRuntimeAccess();

  const originalCreation = window.startTeamsCreation;
  const originalOpen = window.openCampaignStudioFromTeams;

  if (typeof originalCreation === 'function') {
    window.startTeamsCreation = function patchedStartTeamsCreation(this: unknown, ...args: unknown[]) {
      // Kick the Coordinator off alongside the existing "preparing brief"
      // animation so live latency overlaps work V19 was already doing.
      coordinatorPromise = runCoordinator(bridge, access).catch((error) => {
        onError?.('coordinator', error);
        telemetry.coordinator = 'failed';
        return null;
      });
      return (originalCreation as (...a: unknown[]) => unknown).apply(this, args);
    };
  }

  if (typeof originalOpen === 'function') {
    window.openCampaignStudioFromTeams = function patchedOpenStudio(this: unknown, ...args: unknown[]) {
      // The original runs first and unchanged: Stage 2 always appears with the
      // deterministic V19 brief before any live data is considered.
      const returned = (originalOpen as (...a: unknown[]) => unknown).apply(this, args);
      void enhanceBrief(bridge, access).catch((error) => {
        onError?.('brief', error);
        telemetry.brief = 'failed';
      });
      return returned;
    };
  }

  window.__V19_ADAPTER_INSTALLED__ = true;

  return function uninstall() {
    if (originalCreation) window.startTeamsCreation = originalCreation;
    if (originalOpen) window.openCampaignStudioFromTeams = originalOpen;
    window.__V19_ADAPTER_INSTALLED__ = false;
    coordinatorPromise = null;
    coordinatorResult = null;
    telemetry.coordinator = 'idle';
    telemetry.brief = 'idle';
    delete telemetry.lastRejection;
  };
}
