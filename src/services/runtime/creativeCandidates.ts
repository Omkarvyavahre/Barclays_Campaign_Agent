/**
 * Run-scoped Firefly candidate generation.
 *
 * A fresh campaign run may generate one new background per channel. The run is
 * identified by V19's own `teamsState.runId`, the same identity the Gemini
 * workflow session already uses, so there is no second notion of a session.
 *
 * Four states are kept apart deliberately:
 *
 *   candidate     a new Firefly output awaiting validation
 *   current-run   a candidate that passed objective validation for this runId
 *   approved      the human-approved background pinned server-side
 *   V19 original  the creative the frozen renderer draws by itself
 *
 * This module only ever produces the first two. Promotion to *approved* is a
 * human edit of `server/images/approved.ts`; nothing here can write it.
 *
 * Generation is memoised per run and channel, so the trigger is idempotent:
 * opening Stage 7, switching tabs, re-rendering, replaying DOM mutations or
 * calling the entry point again cannot produce a second provider call. A run
 * that has been retired can no longer promote anything, so a slow result from a
 * previous run cannot land on a newer one.
 */

import type { BarclaysServices, GeneratedImageAsset, ImageChannel, ImageRequestPayload } from '../bridge/types';

export const CANDIDATE_CHANNELS: readonly ImageChannel[] = ['linkedin', 'email'];

/** The size both channel recipes request, and therefore the only size accepted. */
export const EXPECTED_ASSET_SIZE = { width: 2688, height: 1536 } as const;

export const ASSET_URL_PREFIX = '/api/images/asset/';
export const ASSET_ID_PATTERN = /^[a-z]+-[0-9a-f-]{36}$/;

export type CandidateStatus = 'idle' | 'pending' | 'ready' | 'rejected' | 'failed' | 'mock';

export interface CandidateTelemetry {
  runId: number | null;
  linkedin: CandidateStatus;
  email: CandidateStatus;
  lastRejection?: string;
}

interface ChannelEntry {
  status: CandidateStatus;
  asset: GeneratedImageAsset | null;
  promise: Promise<void>;
}

interface Run {
  runId: number;
  entries: Map<ImageChannel, ChannelEntry>;
}

let activeRun: Run | null = null;
let lastRejection: string | undefined;
const listeners = new Set<() => void>();

/* ------------------------------------------------------------------ *
 * Objective validation, mirroring the server's own checks
 * ------------------------------------------------------------------ */

/**
 * Whether an asset descriptor may be promoted for a channel.
 *
 * The server has already validated the stored bytes; this repeats the checks it
 * can make from the descriptor alone, so a malformed or mismatched response can
 * never reach the composition layer. Nothing about the picture is judged here.
 */
export function isPromotableAsset(
  asset: GeneratedImageAsset | null | undefined,
  channel: ImageChannel,
): asset is GeneratedImageAsset {
  if (!asset) return false;
  if (asset.channel !== channel) return false;
  if (!ASSET_ID_PATTERN.test(asset.id) || !asset.id.startsWith(`${channel}-`)) return false;
  if (asset.url !== `${ASSET_URL_PREFIX}${asset.id}`) return false;
  if (asset.width !== EXPECTED_ASSET_SIZE.width || asset.height !== EXPECTED_ASSET_SIZE.height) return false;
  return typeof asset.bytes === 'number' && asset.bytes > 0;
}

/* ------------------------------------------------------------------ *
 * Run lifecycle
 * ------------------------------------------------------------------ */

function statusOf(channel: ImageChannel): CandidateStatus {
  return activeRun?.entries.get(channel)?.status ?? 'idle';
}

export function getCandidateTelemetry(): CandidateTelemetry {
  return {
    runId: activeRun?.runId ?? null,
    linkedin: statusOf('linkedin'),
    email: statusOf('email'),
    ...(lastRejection ? { lastRejection } : {}),
  };
}

/**
 * Retires any previous run and opens a fresh one. Replay therefore restores the
 * approved backgrounds until the new run applies a live brief of its own.
 */
export function beginCreativeRun(runId: number): void {
  if (activeRun?.runId === runId) return;
  activeRun = { runId, entries: new Map() };
  lastRejection = undefined;
  notify();
}

/**
 * Drops all run state. Subscriptions are left alone: each subscriber owns its
 * own unsubscribe, and a reader that is still mounted must keep working.
 */
export function resetCreativeCandidates(): void {
  activeRun = null;
  lastRejection = undefined;
}

/** The validated background for the active run, or null while none exists. */
export function currentRunAsset(channel: ImageChannel): GeneratedImageAsset | null {
  const entry = activeRun?.entries.get(channel);
  return entry?.status === 'ready' ? entry.asset : null;
}

export function subscribeToCreativeCandidates(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/* ------------------------------------------------------------------ *
 * Generation
 * ------------------------------------------------------------------ */

export interface StartCandidatesOptions {
  bridge: BarclaysServices;
  /** V19's `teamsState.runId` for the run whose brief has just been applied. */
  runId: number;
  /** Returns the request for a channel, or null when context is insufficient. */
  request: (channel: ImageChannel) => ImageRequestPayload | null;
  onError?: (channel: ImageChannel, error: unknown) => void;
}

function stale(run: Run): boolean {
  return activeRun !== run;
}

async function generate(
  options: StartCandidatesOptions,
  run: Run,
  channel: ImageChannel,
  entry: ChannelEntry,
): Promise<void> {
  const payload = options.request(channel);
  if (!payload) {
    entry.status = 'rejected';
    lastRejection = `${channel}: insufficient campaign context`;
    return;
  }

  const response = await options.bridge.images.generate(payload);

  // A replay while the request was in flight retires this result entirely.
  if (stale(run)) {
    lastRejection = `${channel}: discarded a candidate from a previous run`;
    return;
  }

  if (!response.ok) {
    entry.status = 'failed';
    lastRejection = `${channel}: ${response.error.category}`;
    return;
  }

  // Mock mode carries no asset, which means "keep the existing background".
  if (response.data.source === 'mock' || !response.data.asset) {
    entry.status = 'mock';
    return;
  }

  if (!isPromotableAsset(response.data.asset, channel)) {
    entry.status = 'rejected';
    lastRejection = `${channel}: candidate failed objective validation`;
    return;
  }

  entry.asset = response.data.asset;
  entry.status = 'ready';
  notify();
}

/**
 * Starts at most one generation per channel for this run.
 *
 * Channels are independent: one failing leaves the other free to promote, and
 * each falls back to its own approved background.
 */
export function startCreativeCandidates(options: StartCandidatesOptions): void {
  beginCreativeRun(options.runId);
  const run = activeRun;
  if (!run) return;

  for (const channel of CANDIDATE_CHANNELS) {
    if (run.entries.has(channel)) continue;

    const entry: ChannelEntry = { status: 'pending', asset: null, promise: Promise.resolve() };
    run.entries.set(channel, entry);

    entry.promise = generate(options, run, channel, entry).catch((error) => {
      if (!stale(run)) {
        entry.status = 'failed';
        lastRejection = `${channel}: exception`;
      }
      options.onError?.(channel, error);
    });
  }
}

/** Test-only: awaits the in-flight generations of the active run. */
export function settleCreativeCandidates(): Promise<unknown> {
  const entries = activeRun ? [...activeRun.entries.values()] : [];
  return Promise.all(entries.map((entry) => entry.promise));
}
