/**
 * Integration seam between the frozen V19 runtime and the service bridge.
 *
 * Design rules this file exists to enforce:
 *  - the generated runtime is never edited; two global functions are wrapped
 *  - V19 renderers are never replaced, only re-invoked
 *  - a wrapper never does work the original function would have refused to do,
 *    so an action V19 rejects costs nothing
 *  - a live result is applied only after it passes validation against the
 *    runtime's own field list; otherwise the fixture simply stays
 *  - while a live brief is genuinely pending, Stage 2 shows V19's own
 *    generating treatment rather than presenting the fixture as final
 *
 * In mock mode the bridge returns `result: null`, so this adapter performs no
 * mutation and marks nothing as pending: V19 behaves exactly as it did before
 * integration.
 */

import type { BarclaysServices, BriefResult, CoordinatorResult, DiscussionContext } from '../bridge/types';
import { applyBriefUpdate, planBriefUpdate } from './briefMapping';
import {
  beginCreativeRun,
  resetCreativeCandidates,
  startCreativeCandidates,
  type StartCandidatesOptions,
} from './creativeCandidates';
import { buildImageRequest } from './creativeContext';
import { getRuntimeAccess, installRuntimeAccess, type V19RuntimeAccess, type V19TeamsState } from './runtimeAccess';

/** Stage 2 (campaign brief) is index 1 in the V19 stage list. */
export const BRIEF_STAGE_INDEX = 1;

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

export type AdapterScope = 'coordinator' | 'brief' | 'creative';

export type CoordinatorPhase = 'idle' | 'pending' | 'live' | 'mock' | 'failed';
export type BriefPhase = 'idle' | 'pending' | 'applied' | 'rejected' | 'failed' | 'mock';

export interface AdapterTelemetry {
  coordinator: CoordinatorPhase;
  brief: BriefPhase;
  /** True while V19's generating treatment is being held open for a live brief. */
  pending: boolean;
  runId: number | null;
  lastRejection?: string;
}

type CoordinatorOutcome =
  | { status: 'live'; result: CoordinatorResult }
  | { status: 'mock' }
  | { status: 'failed'; reason: string };

/**
 * One workflow run. Replay increments V19's `teamsState.runId`, which retires
 * the session so an in-flight result from the previous run can never land on
 * the new one.
 */
interface Session {
  runId: number;
  mode: Promise<'mock' | 'gemini' | null> | null;
  coordinator: Promise<CoordinatorOutcome> | null;
  brief: Promise<void> | null;
  pendingMarked: boolean;
  /** Set once the brief outcome is known, so nothing can re-open the pending state. */
  settled: boolean;
  disposed: boolean;
}

const telemetry: AdapterTelemetry = { coordinator: 'idle', brief: 'idle', pending: false, runId: null };
let activeSession: Session | null = null;
let onErrorHook: ((scope: AdapterScope, error: unknown) => void) | undefined;
/** Live brief last successfully applied; used by manual creative regeneration. */
let lastAppliedBrief: BriefResult | null = null;

export function getAdapterTelemetry(): AdapterTelemetry {
  return { ...telemetry };
}

/** The live brief currently backing Stage 7 creative generation, if any. */
export function getLastAppliedBrief(): BriefResult | null {
  return lastAppliedBrief;
}

/* ------------------------------------------------------------------ *
 * Runtime preconditions, mirrored from the generated V19 functions
 * ------------------------------------------------------------------ */

/** `startTeamsCreation` bails unless the human has authorised and it is idle. */
export function willStartTeamsCreation(teamsState: V19TeamsState | undefined): boolean {
  return teamsState?.authorised === true && teamsState.generating !== true && teamsState.summaryReady !== true;
}

/** `openCampaignStudioFromTeams` toasts and returns unless the brief is ready. */
export function willOpenStudio(teamsState: V19TeamsState | undefined): boolean {
  return teamsState?.summaryReady === true;
}

function currentRunId(access: V19RuntimeAccess | undefined): number {
  const runId = access?.getTeamsState()?.runId;
  return typeof runId === 'number' ? runId : 0;
}

/* ------------------------------------------------------------------ *
 * Pending presentation, using V19's own generating treatment
 * ------------------------------------------------------------------ */

function studioHidden(): boolean {
  // When there is no DOM to inspect, do not suppress rendering.
  if (typeof document === 'undefined') return false;
  const app = document.getElementById('appRoot');
  return !!app && app.classList.contains('studio-hidden');
}

function renderStudio(): void {
  if (!studioHidden()) window.renderAll?.();
}

/**
 * Holds Stage 2 in V19's existing "agent is generating" state. No new markup,
 * copy or spinner: `renderConversation` already prefers `renderGeneratingState`
 * over `renderBrief` whenever `generatingStage` matches the stage.
 */
function markBriefPending(access: V19RuntimeAccess | undefined, session: Session): void {
  // `settled` covers the race where the mode lookup resolves after the workflow
  // has already finished or failed; Stage 2 must not be re-opened as pending.
  if (session.pendingMarked || session.settled || session.disposed) return;
  const state = access?.getState();
  if (!state) return;
  // Never fight a generation V19 started itself.
  if (state.generatingStage !== null && state.generatingStage !== undefined) return;

  state.generatingStage = BRIEF_STAGE_INDEX;
  session.pendingMarked = true;
  telemetry.pending = true;
  renderStudio();
}

function clearBriefPending(access: V19RuntimeAccess | undefined, session: Session): void {
  if (!session.pendingMarked) return;
  session.pendingMarked = false;
  telemetry.pending = false;
  const state = access?.getState();
  if (state && state.generatingStage === BRIEF_STAGE_INDEX) state.generatingStage = null;
}

/**
 * Ends the pending treatment and re-renders only if something actually changed.
 * In mock mode nothing is ever pending and nothing is written, so V19 is left
 * completely alone — no extra render, no altered fixture.
 */
function settlePending(access: V19RuntimeAccess | undefined, session: Session, changed: boolean): void {
  const wasPending = session.pendingMarked;
  session.settled = true;
  clearBriefPending(access, session);
  if (wasPending || changed) renderStudio();
}

/* ------------------------------------------------------------------ *
 * Session lifecycle
 * ------------------------------------------------------------------ */

function ensureSession(access: V19RuntimeAccess | undefined): Session {
  const runId = currentRunId(access);
  if (activeSession && !activeSession.disposed && activeSession.runId === runId) return activeSession;

  if (activeSession) {
    activeSession.disposed = true;
    clearBriefPending(access, activeSession);
  }

  activeSession = { runId, mode: null, coordinator: null, brief: null, pendingMarked: false, settled: false, disposed: false };
  // A new run has no applied live brief until this workflow finishes.
  lastAppliedBrief = null;
  // The creative run shares this identity, so replay retires any in-flight
  // candidate and Stage 7 returns to the approved backgrounds.
  beginCreativeRun(runId);
  telemetry.coordinator = 'idle';
  telemetry.brief = 'idle';
  telemetry.pending = false;
  telemetry.runId = runId;
  delete telemetry.lastRejection;
  return activeSession;
}

/** A result may only be applied if its session is still the live one. */
function isStale(access: V19RuntimeAccess | undefined, session: Session): boolean {
  return session.disposed || activeSession !== session || currentRunId(access) !== session.runId;
}

/* ------------------------------------------------------------------ *
 * Context collection
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * Agents
 * ------------------------------------------------------------------ */

async function resolveMode(bridge: BarclaysServices, session: Session): Promise<'mock' | 'gemini' | null> {
  if (!session.mode) {
    session.mode = bridge
      .health()
      .then((response) => (response.ok ? response.data.mode : null))
      .catch(() => null);
  }
  return session.mode;
}

async function runCoordinator(
  bridge: BarclaysServices,
  access: V19RuntimeAccess | undefined,
): Promise<CoordinatorOutcome> {
  const discussion = collectDiscussionContext(access);
  if (!discussion) {
    telemetry.coordinator = 'failed';
    telemetry.lastRejection = 'no discussion context available';
    return { status: 'failed', reason: 'no-discussion' };
  }

  telemetry.coordinator = 'pending';
  const response = await bridge.agents.analyseDiscussion(discussion);

  if (!response.ok) {
    telemetry.coordinator = 'failed';
    telemetry.lastRejection = `coordinator ${response.error.category}`;
    return { status: 'failed', reason: response.error.category };
  }
  if (response.data.source === 'mock' || response.data.result === null) {
    telemetry.coordinator = 'mock';
    return { status: 'mock' };
  }

  telemetry.coordinator = 'live';
  return { status: 'live', result: response.data.result };
}

function applyLiveBrief(access: V19RuntimeAccess | undefined, brief: BriefResult): boolean {
  const sections = access?.getBriefSections();
  const plan = planBriefUpdate(brief, sections);
  if (!plan.ok) {
    telemetry.brief = 'rejected';
    telemetry.lastRejection = `brief mapping ${plan.reason}`;
    return false;
  }

  applyBriefUpdate(sections as NonNullable<typeof sections>, plan.updates);

  const state = access?.getState();
  const liveName = brief.campaignName;
  if (state && typeof liveName === 'string' && liveName.trim()) state.campaignName = liveName.trim();

  lastAppliedBrief = brief;
  telemetry.brief = 'applied';
  return true;
}

/**
 * Candidate generation reads its context from the brief that was just applied,
 * so a background is never described from fixture values.
 */
function candidateOptions(
  bridge: BarclaysServices,
  access: V19RuntimeAccess | undefined,
  session: Session,
  brief: BriefResult,
): StartCandidatesOptions {
  return {
    bridge,
    runId: session.runId,
    request: (channel) => buildImageRequest(brief, access?.getState(), channel),
    onError: (_channel, error) => onErrorHook?.('creative', error),
  };
}

async function runBrief(
  bridge: BarclaysServices,
  access: V19RuntimeAccess | undefined,
  session: Session,
  coordinator: CoordinatorOutcome,
): Promise<void> {
  const discussion = collectDiscussionContext(access);
  if (!discussion) {
    telemetry.brief = 'failed';
    telemetry.lastRejection = 'no discussion context available';
    settlePending(access, session, false);
    return;
  }

  const state = access?.getState();
  const campaignName = typeof state?.campaignName === 'string' ? state.campaignName : undefined;

  telemetry.brief = 'pending';
  const response = await bridge.agents.generateBrief({
    discussion,
    ...(coordinator.status === 'live' ? { coordinator: coordinator.result } : {}),
    ...(campaignName ? { campaignName } : {}),
  });

  // A replay while the request was in flight retires this result entirely.
  if (isStale(access, session)) {
    telemetry.lastRejection = 'discarded stale brief from a previous run';
    return;
  }

  let changed = false;
  if (!response.ok) {
    telemetry.brief = 'failed';
    telemetry.lastRejection = `brief ${response.error.category}`;
  } else if (response.data.source === 'mock' || response.data.result === null) {
    telemetry.brief = 'mock';
  } else {
    const brief = response.data.result;
    changed = applyLiveBrief(access, brief);
    // The applied live brief is the authoritative signal that enough campaign
    // context exists to describe a background, and it arrives before Stage 7 is
    // ever opened. One candidate per channel, per run.
    if (changed) startCreativeCandidates(candidateOptions(bridge, access, session, brief));
  }

  // Whatever happened, Stage 2 must stop showing the pending treatment: either
  // the live values are in place, or the deterministic fixture is restored.
  settlePending(access, session, changed);
}

/**
 * Starts Coordinator analysis and, once it settles, brief generation.
 *
 * Both are memoised on the session, so repeated triggers cannot produce a
 * second provider call. Coordinator begins as soon as the human has authorised
 * creation, overlapping the remaining Teams animation; the brief follows the
 * Coordinator because it genuinely depends on its validated result.
 */
function startWorkflow(bridge: BarclaysServices, access: V19RuntimeAccess | undefined): Session {
  const session = ensureSession(access);
  if (session.coordinator) return session;

  // Knowing the mode up front is what allows the pending treatment to be shown
  // from the first Stage 2 render instead of after the Coordinator returns.
  void resolveMode(bridge, session).then((mode) => {
    if (mode === 'gemini' && !isStale(access, session)) markBriefPending(access, session);
  });

  session.coordinator = runCoordinator(bridge, access).catch((error) => {
    onErrorHook?.('coordinator', error);
    telemetry.coordinator = 'failed';
    return { status: 'failed', reason: 'exception' } as CoordinatorOutcome;
  });

  session.brief = session.coordinator.then(async (outcome) => {
    if (isStale(access, session)) return;
    if (outcome.status === 'failed') {
      // Do not spend a brief call behind a failed Coordinator; fall back.
      telemetry.brief = 'failed';
      telemetry.lastRejection = `brief skipped: coordinator ${outcome.reason}`;
      settlePending(access, session, false);
      return;
    }
    try {
      await runBrief(bridge, access, session, outcome);
    } catch (error) {
      onErrorHook?.('brief', error);
      telemetry.brief = 'failed';
      settlePending(access, session, false);
    }
  });

  return session;
}

/* ------------------------------------------------------------------ *
 * Installation
 * ------------------------------------------------------------------ */

export interface AdapterOptions {
  bridge: BarclaysServices;
  onError?: (scope: AdapterScope, error: unknown) => void;
}

/**
 * Wraps the two V19 entry points. Returns an uninstall function so tests (and
 * any future React replacement of these stages) can detach cleanly.
 */
export function installV19Adapter({ bridge, onError }: AdapterOptions): () => void {
  const access = installRuntimeAccess() ?? getRuntimeAccess();
  onErrorHook = onError;

  const originalCreation = window.startTeamsCreation;
  const originalOpen = window.openCampaignStudioFromTeams;

  if (typeof originalCreation === 'function') {
    window.startTeamsCreation = function patchedStartTeamsCreation(this: unknown, ...args: unknown[]) {
      // Only act when V19 itself will proceed: an ignored call must cost nothing.
      if (willStartTeamsCreation(access?.getTeamsState())) startWorkflow(bridge, access);
      return (originalCreation as (...a: unknown[]) => unknown).apply(this, args);
    };
  }

  if (typeof originalOpen === 'function') {
    window.openCampaignStudioFromTeams = function patchedOpenStudio(this: unknown, ...args: unknown[]) {
      // V19 refuses to open Stage 2 until the brief is ready and shows a toast.
      // Respect that precondition before starting any work, so an early click
      // makes zero provider calls and mutates nothing.
      if (willOpenStudio(access?.getTeamsState())) startWorkflow(bridge, access);
      return (originalOpen as (...a: unknown[]) => unknown).apply(this, args);
    };
  }

  window.__V19_ADAPTER_INSTALLED__ = true;

  return function uninstall() {
    if (activeSession) {
      activeSession.disposed = true;
      clearBriefPending(access, activeSession);
    }
    activeSession = null;
    lastAppliedBrief = null;
    resetCreativeCandidates();
    onErrorHook = undefined;
    if (originalCreation) window.startTeamsCreation = originalCreation;
    if (originalOpen) window.openCampaignStudioFromTeams = originalOpen;
    window.__V19_ADAPTER_INSTALLED__ = false;
    telemetry.coordinator = 'idle';
    telemetry.brief = 'idle';
    telemetry.pending = false;
    telemetry.runId = null;
    delete telemetry.lastRejection;
  };
}
