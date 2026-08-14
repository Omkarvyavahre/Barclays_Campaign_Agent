/**
 * Deterministic Stage 7 campaign composition.
 *
 * Firefly supplies the abstract background and nothing else. Everything a
 * viewer can read is composed here, as real HTML text over that background:
 *
 *   Firefly background  ->  CSS custom property on the existing creative slot
 *   Barclays logo       ->  the approved PNG already in the V19 topbar
 *   Campaign copy       ->  current V19/Gemini output state, read at apply time
 *
 * Nothing is baked into the JPEG, so spelling is exact, the copy changes with
 * the campaign, and screen readers get real text.
 *
 * The background itself is resolved per channel, in order: the validated
 * current-run candidate, then the human-approved pinned background, then
 * nothing at all — which leaves the original V19 creative untouched.
 *
 * The frozen renderer is untouched. It keeps emitting an empty creative div
 * (`.v17-li-creative` for LinkedIn, `.v17-email-creative` for the email hero)
 * with an inline `background-image`; this module adds a child overlay and a
 * stylesheet-level background that wins over that inline style. When no
 * generated background exists the module does nothing at all, so mock mode and
 * a fresh checkout render byte-identical V19 output.
 */

import type { BarclaysServices, ImageChannel } from '../bridge/types';
import { currentRunAsset, subscribeToCreativeCandidates } from './creativeCandidates';
import { getRuntimeAccess, type V19RuntimeAccess, type V19State } from './runtimeAccess';

export const COMPOSED_ATTRIBUTE = 'data-bx-composed';
export const OVERLAY_CLASS = 'bx-campaign-overlay';

export interface ChannelPlan {
  /** The frozen V19 creative slot for the channel. */
  selector: string;
  variable: string;
}

/**
 * The two creative slots the frozen renderer emits. Each keeps its own custom
 * property so a channel with no generated background stays exactly as V19
 * draws it.
 */
export const CHANNEL_PLANS: Record<ImageChannel, ChannelPlan> = {
  linkedin: { selector: '.v17-li-creative', variable: '--bx-linkedin-creative' },
  email: { selector: '.v17-email-creative', variable: '--bx-email-creative' },
};

export const COMPOSED_CHANNELS: readonly ImageChannel[] = ['linkedin', 'email'];

/** The approved Barclays logo, already present in the V19 topbar markup. */
export const LOGO_SELECTOR = 'img.barclays-official-logo';

/** Only ids minted by our own storage layer may be used as a background. */
export const ASSET_URL_PREFIX = '/api/images/asset/';

/**
 * Brand furniture, not campaign copy: the lockup line and the product line are
 * fixed Barclays/iPortal identity, exactly as they appear in the approved
 * reference. Campaign wording never comes from here.
 */
export const BRAND_TAGLINE = 'Backing your future';
export const PRODUCT_LINE = 'Barclays iPortal.';

export const HEADLINE_MAX = 120;

export interface CampaignCopy {
  tagline: string;
  product: string;
  headline: string;
}

interface V19Output {
  headline?: unknown;
}

/* ------------------------------------------------------------------ *
 * Copy, taken from live campaign state
 * ------------------------------------------------------------------ */

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Clips to a whole word, leaving no dangling punctuation. */
function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const boundary = cut.lastIndexOf(' ');
  const kept = boundary > max / 2 ? cut.slice(0, boundary) : cut;
  return kept.replace(/[\s,;:.\-—]+$/u, '');
}

/**
 * Reads the headline from the channel output the runtime currently holds, which
 * is where a live Gemini result lands. Nothing is hard-coded, so a regenerated
 * campaign changes the creative with it.
 *
 * Only the headline is composed into the creative. The channel's body copy
 * belongs to the surrounding V19 template — the LinkedIn post copy and the
 * email body — and is never repeated inside the image.
 */
export function deriveCampaignCopy(state: V19State | undefined, channel: ImageChannel): CampaignCopy | null {
  const outputs = state?.outputs as Record<string, V19Output> | undefined;
  const headline = clip(text(outputs?.[channel]?.headline), HEADLINE_MAX);
  if (!headline) return null;

  return { tagline: BRAND_TAGLINE, product: PRODUCT_LINE, headline };
}

/* ------------------------------------------------------------------ *
 * Markup
 * ------------------------------------------------------------------ */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Paragraphs rather than headings: the surrounding V19 preview owns the
 * document outline, and inserting an `h3` here would reorder it.
 */
export function buildOverlayHtml(copy: CampaignCopy, logoSrc?: string): string {
  const lockup = logoSrc
    ? `<img class="bx-lockup-logo" src="${escapeHtml(logoSrc)}" alt="Barclays">`
    : `<span class="bx-lockup-word">Barclays</span>`;

  return [
    `<div class="${OVERLAY_CLASS}">`,
    `<div class="bx-lockup">${lockup}`,
    `<span class="bx-lockup-rule" aria-hidden="true"></span>`,
    `<span class="bx-lockup-tagline">${escapeHtml(copy.tagline)}</span>`,
    `</div>`,
    `<div class="bx-campaign-copy">`,
    `<p class="bx-campaign-product">${escapeHtml(copy.product)}</p>`,
    `<p class="bx-campaign-headline">${escapeHtml(copy.headline)}</p>`,
    `</div>`,
    `</div>`,
  ].join('');
}

/** A background may only ever be one of our own stored assets. */
export function backgroundValue(assetUrl: string): string | undefined {
  if (!assetUrl.startsWith(ASSET_URL_PREFIX)) return undefined;
  if (/["'()\\\s]/.test(assetUrl)) return undefined;
  return `url("${assetUrl}")`;
}

/* ------------------------------------------------------------------ *
 * Application
 * ------------------------------------------------------------------ */

/** The narrow slice of the DOM this module needs, so it stays testable. */
export interface CompositionElement {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  querySelector(selectors: string): unknown;
  insertAdjacentHTML(position: 'beforeend', html: string): void;
}

export interface CompositionDocument {
  querySelector(selectors: string): { getAttribute(name: string): string | null } | null;
  querySelectorAll(selectors: string): ArrayLike<CompositionElement>;
  documentElement: { style: { setProperty(name: string, value: string): void } };
}

export function readBrandLogo(doc: CompositionDocument): string | undefined {
  const src = doc.querySelector(LOGO_SELECTOR)?.getAttribute('src') ?? '';
  return src.startsWith('data:image/') ? src : undefined;
}

export interface CompositionOptions {
  channel: ImageChannel;
  assetUrl: string;
  state: V19State | undefined;
}

/**
 * Composes every creative slot for one channel and returns how many were
 * composed. Idempotent: a slot that already carries the overlay is left alone,
 * and the V19 renderer replaces the node (and therefore the overlay) whenever
 * the copy behind it changes.
 */
export function composeCreative(doc: CompositionDocument, options: CompositionOptions): number {
  const plan = CHANNEL_PLANS[options.channel];
  const background = backgroundValue(options.assetUrl);
  const copy = deriveCampaignCopy(options.state, options.channel);
  if (!plan || !background || !copy) return 0;

  doc.documentElement.style.setProperty(plan.variable, background);

  const logo = readBrandLogo(doc);
  const html = buildOverlayHtml(copy, logo);
  const slots = doc.querySelectorAll(plan.selector);

  let composed = 0;
  for (let index = 0; index < slots.length; index++) {
    const slot = slots[index];
    if (slot.querySelector(`.${OVERLAY_CLASS}`)) continue;
    slot.insertAdjacentHTML('beforeend', html);
    slot.setAttribute(COMPOSED_ATTRIBUTE, 'true');
    composed += 1;
  }

  return composed;
}

/* ------------------------------------------------------------------ *
 * Installation
 * ------------------------------------------------------------------ */

/**
 * Resolves which background a channel should show, in the fixed order:
 *
 *   1. the validated current-run candidate for the active run
 *   2. the human-approved background pinned server-side
 *   3. nothing, which leaves the frozen V19 creative exactly as it is
 *
 * Each channel resolves alone, so a channel whose generation failed keeps its
 * approved background while the other shows a fresh one.
 */
export function resolveBackground(channel: ImageChannel, approved: string | undefined): string | undefined {
  return currentRunAsset(channel)?.url ?? approved;
}

export interface InstallOptions {
  bridge: BarclaysServices;
  access?: V19RuntimeAccess;
  onError?: (error: unknown) => void;
  /** Injected by tests. Defaults to the live document and a MutationObserver. */
  environment?: CompositionEnvironment;
}

/** The document plus a way to be told it changed. */
export interface CompositionEnvironment {
  doc: CompositionDocument;
  watch(onChange: () => void): () => void;
}

function browserEnvironment(): CompositionEnvironment | undefined {
  if (typeof document === 'undefined') return undefined;

  return {
    doc: document,
    watch(onChange) {
      // V19 rebuilds the preview on every render, so the overlay is re-applied
      // whenever the DOM changes. Re-entry is impossible: composing is a no-op
      // once the overlay is present.
      const observer = new MutationObserver(onChange);
      observer.observe(document.body, { childList: true, subtree: true });
      return () => observer.disconnect();
    },
  };
}

/**
 * Keeps each Stage 7 creative slot composed against whichever background is
 * currently resolved, as V19 re-renders and as a fresh candidate is promoted.
 *
 * This module is a reader. It never asks for a new image: the approved lookup is
 * a plain read, and a fresh candidate arrives only because the campaign workflow
 * generated one. So opening Stage 7, switching tabs and re-rendering cost
 * nothing. A channel with no background at all is skipped entirely, leaving its
 * slot exactly as the frozen renderer draws it.
 */
export function installCampaignCreative({ bridge, access, onError, environment }: InstallOptions): () => void {
  const env = environment ?? browserEnvironment();
  if (!env) return () => {};

  const runtime = access ?? getRuntimeAccess();
  /** Approved background per channel, the fallback beneath any candidate. */
  const approved = new Map<ImageChannel, string>();
  let disposed = false;
  let unwatch: (() => void) | undefined;
  let watching = false;
  let scheduled = false;

  const apply = () => {
    if (disposed) return;
    try {
      const state = runtime?.getState();
      for (const channel of COMPOSED_CHANNELS) {
        const assetUrl = resolveBackground(channel, approved.get(channel));
        if (assetUrl) composeCreative(env.doc, { channel, assetUrl, state });
      }
    } catch (error) {
      onError?.(error);
    }
  };

  /** Watching starts with the first background, and only once. */
  const ensureWatching = () => {
    if (disposed || watching) return;
    watching = true;
    unwatch = env.watch(() => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        apply();
      });
    });
  };

  // A promoted candidate switches the background in place: the overlay stays
  // put and only the custom property changes, so there is no blank frame.
  const unsubscribe = subscribeToCreativeCandidates(() => {
    apply();
    ensureWatching();
  });

  void (async () => {
    try {
      // Concurrent and applied as each resolves: one channel without a stored
      // background must never hold up a channel that has one.
      await Promise.all(
        COMPOSED_CHANNELS.map(async (channel) => {
          const response = await bridge.images.latest(channel);
          if (disposed || !response.ok || !response.data.asset) return;
          approved.set(channel, response.data.asset.url);
          apply();
          ensureWatching();
        }),
      );
    } catch (error) {
      onError?.(error);
    }
  })();

  return function uninstall() {
    disposed = true;
    unsubscribe();
    unwatch?.();
    unwatch = undefined;
  };
}
