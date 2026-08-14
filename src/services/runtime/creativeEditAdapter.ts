/**
 * Stage 7 edit-modal seam for explicit Firefly regeneration.
 *
 * The frozen V19 runtime owns the modal markup. This adapter wraps
 * `openOutputEdit` only: it injects a secondary "Regenerate creative" CTA into
 * the existing footer without editing V19 artifacts, and never invokes
 * `submitOutputEdit` / GenStudio save.
 *
 * One click → one `/api/images/generate` call for the active channel only.
 */

import type { BarclaysServices, BriefResult, ImageChannel } from '../bridge/types';
import { buildCompositionIdentity } from './compositionIdentity';
import {
  getCandidateTelemetry,
  manualRegenCount,
  regenerateCreativeCandidate,
  subscribeToCreativeCandidates,
} from './creativeCandidates';
import { buildImageRequest, type DraftOutputContext } from './creativeContext';
import { getRuntimeAccess, type V19BriefSection, type V19RuntimeAccess } from './runtimeAccess';

export const REGENERATE_BUTTON_ID = 'bx-regenerate-creative';
export const REGENERATE_STATUS_ID = 'bx-regenerate-status';
/** Status line host, above the footer row so the three actions never wrap. */
export const REGENERATE_STATUS_HOST_ID = 'bx-regenerate-status-host';
/** Modifier that gives the CTA the action-button box with a softer navy fill. */
export const REGENERATE_BUTTON_CLASS = 'btn primary bx-regenerate-creative';

export const REGENERATE_IDLE_LABEL = 'Regenerate creative';
export const REGENERATE_PENDING_LABEL = 'Regenerating…';
export const REGENERATE_SUCCESS_MESSAGE = 'Creative regenerated';

type OpenOutputEditFn = (key: string) => unknown;
type SubmitOutputEditFn = (key: string) => unknown;

declare global {
  interface Window {
    openOutputEdit?: OpenOutputEditFn;
    submitOutputEdit?: SubmitOutputEditFn;
    __BARCLAYS_REGENERATE_CREATIVE__?: (channel: string) => void;
    __V19_CREATIVE_EDIT_ADAPTER_INSTALLED__?: boolean;
  }
}

export interface CreativeEditAdapterOptions {
  bridge: BarclaysServices;
  access?: V19RuntimeAccess;
  /** Last live Gemini brief applied by the V19 adapter, when available. */
  getAppliedBrief?: () => BriefResult | null;
  onError?: (error: unknown) => void;
}

const EDITABLE_CHANNELS = new Set<ImageChannel>(['linkedin', 'email']);

function isImageChannel(value: string): value is ImageChannel {
  return value === 'linkedin' || value === 'email';
}

/** Builds a BriefResult from the runtime's own brief sections (fixture or live). */
export function briefFromSections(
  sections: V19BriefSection[] | undefined,
  campaignName: string | undefined,
): BriefResult | null {
  if (!sections?.length) return null;
  const fields: Record<string, string> = {};
  for (const section of sections) {
    for (const field of section.fields ?? []) {
      if (!Array.isArray(field) || typeof field[0] !== 'string') continue;
      const value = typeof field[2] === 'string' ? field[2].trim() : '';
      if (!value) return null;
      fields[field[0]] = value;
    }
  }
  if (!Object.keys(fields).length) return null;
  return {
    campaignName: typeof campaignName === 'string' && campaignName.trim() ? campaignName.trim() : 'Campaign',
    fields,
  };
}

export function resolveBriefForRegeneration(
  access: V19RuntimeAccess | undefined,
  getAppliedBrief?: () => BriefResult | null,
): BriefResult | null {
  return getAppliedBrief?.() ?? briefFromSections(access?.getBriefSections(), access?.getState()?.campaignName);
}

/** Reads current modal draft fields without writing them into V19 state. */
export function readDraftOutputContext(doc: Document = document): DraftOutputContext {
  const headline = (doc.getElementById('outHeadline') as HTMLInputElement | null)?.value;
  const cta = (doc.getElementById('outCta') as HTMLInputElement | null)?.value;
  return {
    ...(headline !== undefined ? { headline } : {}),
    ...(cta !== undefined ? { cta } : {}),
  };
}

/**
 * Status line host, placed immediately above the footer row.
 *
 * Keeping it out of `.modal-actions` leaves that row as exactly three buttons,
 * so the footer keeps V19's own right-aligned flex layout and cannot wrap.
 */
function ensureStatusHost(actions: HTMLElement, doc: Document): HTMLElement {
  const parent = actions.parentElement;
  const existing = parent?.querySelector<HTMLElement>(`#${REGENERATE_STATUS_HOST_ID}`);
  if (existing) return existing;

  const host = doc.createElement('div');
  host.id = REGENERATE_STATUS_HOST_ID;
  host.className = 'bx-regenerate-status-host';
  parent?.insertBefore(host, actions);
  return host;
}

function setStatus(group: HTMLElement, message: string, tone: 'info' | 'error' | 'success', doc: Document = document): void {
  let status = group.querySelector<HTMLElement>(`#${REGENERATE_STATUS_ID}`);
  if (!status) {
    status = doc.createElement('div');
    status.id = REGENERATE_STATUS_ID;
    status.style.fontSize = '10px';
    status.style.lineHeight = '1.4';
    group.appendChild(status);
  }
  status.textContent = message;
  status.style.color = tone === 'error' ? '#8B1E1E' : tone === 'success' ? '#0F6A4F' : '#53656F';
}

function clearStatus(group: HTMLElement): void {
  group.querySelector(`#${REGENERATE_STATUS_ID}`)?.remove();
}

/**
 * Injects the regenerate CTA into the open edit modal footer, between Cancel and
 * the GenStudio save action. Idempotent for a given modal instance; never
 * triggers generation by itself.
 */
export function injectRegenerateCreativeButton(channel: ImageChannel, doc: Document = document): HTMLButtonElement | null {
  const actions = doc.querySelector('#modalRoot .modal-actions') as HTMLElement | null;
  if (!actions) return null;
  if (actions.querySelector(`#${REGENERATE_BUTTON_ID}`)) {
    return actions.querySelector(`#${REGENERATE_BUTTON_ID}`);
  }

  ensureStatusHost(actions, doc);

  const button = doc.createElement('button');
  button.type = 'button';
  button.id = REGENERATE_BUTTON_ID;
  button.className = REGENERATE_BUTTON_CLASS;
  button.textContent = REGENERATE_IDLE_LABEL;
  button.dataset.channel = channel;
  button.setAttribute('aria-label', REGENERATE_IDLE_LABEL);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.__BARCLAYS_REGENERATE_CREATIVE__?.(channel);
  });

  // V19's footer is Cancel then the primary save action; sitting before the
  // primary puts this second without reordering anything V19 emitted.
  const save = actions.querySelector('.btn.primary');
  if (save) actions.insertBefore(button, save);
  else actions.appendChild(button);

  return button;
}

function syncButtonState(channel: ImageChannel, doc: Document = document): void {
  const button = doc.getElementById(REGENERATE_BUTTON_ID) as HTMLButtonElement | null;
  if (!button || button.dataset.channel !== channel) return;
  const pending = getCandidateTelemetry().pendingChannel === channel;
  button.disabled = pending;
  button.textContent = pending ? REGENERATE_PENDING_LABEL : REGENERATE_IDLE_LABEL;
}

/**
 * Wraps V19 `openOutputEdit` and exposes a click handler for regeneration.
 * Returns an uninstall function for tests and React teardown.
 */
export function installCreativeEditAdapter(options: CreativeEditAdapterOptions): () => void {
  const access = options.access ?? getRuntimeAccess();
  const originalOpen = window.openOutputEdit;
  let disposed = false;
  let inFlightClick = false;

  const handleRegenerate = (rawChannel: string): void => {
    if (disposed || inFlightClick) return;
    if (!isImageChannel(rawChannel)) return;

    const channel = rawChannel;
    const button = document.getElementById(REGENERATE_BUTTON_ID) as HTMLButtonElement | null;
    const group = document.getElementById(REGENERATE_STATUS_HOST_ID) as HTMLElement | null;
    if (button?.disabled) return;

    const brief = resolveBriefForRegeneration(access, options.getAppliedBrief);
    if (!brief) {
      if (group) setStatus(group, 'Campaign context is not ready for regeneration.', 'error');
      return;
    }

    const teamsState = access?.getTeamsState();
    const runId = typeof teamsState?.runId === 'number' ? teamsState.runId : 0;
    const draft = readDraftOutputContext();
    const attemptToken = `manual-${manualRegenCount(channel) + 1}`;

    inFlightClick = true;
    if (button) {
      button.disabled = true;
      button.textContent = REGENERATE_PENDING_LABEL;
    }
    if (group) clearStatus(group);

    const result = regenerateCreativeCandidate({
      bridge: options.bridge,
      runId,
      channel,
      attemptToken,
      request: (ch) => {
        // Build once with draft context; composition identity is attached only
        // for this explicit manual path so automatic runs stay on variant 0.
        const base = buildImageRequest(brief, access?.getState(), ch, { draft });
        if (!base) return null;
        const compositionIdentity = buildCompositionIdentity({
          runId,
          channel: ch,
          attemptToken,
          campaignContext: base.campaignContext,
        });
        return { ...base, compositionIdentity };
      },
      onError: (_ch, error) => options.onError?.(error),
    });

    const finish = (message?: { text: string; tone: 'info' | 'error' | 'success' }) => {
      inFlightClick = false;
      syncButtonState(channel);
      if (group && message) setStatus(group, message.text, message.tone);
    };

    if (!result.started || !result.promise) {
      finish(
        result.reason === 'pending'
          ? { text: 'A regeneration is already in progress.', tone: 'info' }
          : { text: 'Unable to start regeneration.', tone: 'error' },
      );
      return;
    }

    void result.promise
      .then(() => {
        const telemetry = getCandidateTelemetry();
        const status = channel === 'linkedin' ? telemetry.linkedin : telemetry.email;
        if (status === 'ready') {
          finish({ text: REGENERATE_SUCCESS_MESSAGE, tone: 'success' });
          return;
        }
        if (status === 'mock') {
          finish({ text: 'Mock mode kept the existing creative.', tone: 'info' });
          return;
        }
        finish({
          text: telemetry.lastRejection?.startsWith(`${channel}:`)
            ? telemetry.lastRejection.slice(channel.length + 2)
            : 'Regeneration failed. The current creative was kept.',
          tone: 'error',
        });
      })
      .catch((error) => {
        options.onError?.(error);
        finish({ text: 'Regeneration failed. The current creative was kept.', tone: 'error' });
      });
  };

  window.__BARCLAYS_REGENERATE_CREATIVE__ = handleRegenerate;

  if (typeof originalOpen === 'function') {
    window.openOutputEdit = function patchedOpenOutputEdit(this: unknown, key: string, ...rest: unknown[]) {
      const result = (originalOpen as (...args: unknown[]) => unknown).apply(this, [key, ...rest]);
      if (EDITABLE_CHANNELS.has(key as ImageChannel)) {
        // Injection only — never generates. Generation starts on click alone.
        queueMicrotask(() => {
          if (disposed) return;
          injectRegenerateCreativeButton(key as ImageChannel);
          syncButtonState(key as ImageChannel);
        });
      }
      return result;
    };
  }

  const unsubscribe = subscribeToCreativeCandidates(() => {
    const channel = document.getElementById(REGENERATE_BUTTON_ID)?.dataset.channel;
    if (channel && isImageChannel(channel)) syncButtonState(channel);
  });

  window.__V19_CREATIVE_EDIT_ADAPTER_INSTALLED__ = true;

  return function uninstall() {
    disposed = true;
    unsubscribe();
    inFlightClick = false;
    if (originalOpen) window.openOutputEdit = originalOpen;
    delete window.__BARCLAYS_REGENERATE_CREATIVE__;
    window.__V19_CREATIVE_EDIT_ADAPTER_INSTALLED__ = false;
  };
}
