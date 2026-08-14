/**
 * The composition layer is what stops Firefly from ever needing to spell a word.
 *
 * The properties worth pinning: copy always comes from live runtime state, only
 * the headline goes inside the creative (never the channel body), the logo
 * always comes from the approved asset already in the DOM, the background can
 * only ever be one of our own stored assets, and nothing happens at all when a
 * channel has no generated background.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BarclaysServices, GeneratedImageAsset, ImageChannel } from '../bridge/types';
import {
  CHANNEL_PLANS,
  COMPOSED_ATTRIBUTE,
  OVERLAY_CLASS,
  PRODUCT_LINE,
  backgroundValue,
  buildOverlayHtml,
  composeCreative,
  deriveCampaignCopy,
  installCampaignCreative,
  readBrandLogo,
  resolveBackground,
} from './campaignCreative';
import type { CompositionDocument, CompositionElement } from './campaignCreative';
import {
  resetCreativeCandidates,
  settleCreativeCandidates,
  startCreativeCandidates,
} from './creativeCandidates';
import type { V19RuntimeAccess, V19State } from './runtimeAccess';

const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg';
const LINKEDIN_ASSET = '/api/images/asset/linkedin-f1bca403-4fd1-4246-8789-50bbd52f2bec';
const EMAIL_ASSET = '/api/images/asset/email-3d1fdbd4-f174-4950-b8d2-e22536521002';

const LINKEDIN_BODY = 'Discover how iPortal brings payments, reporting and self-service into one front door.';
const EMAIL_BODY = 'From moving to iPortal, to doing more digitally with Barclays.';

function state(overrides: Record<string, unknown> = {}): V19State {
  return {
    outputs: {
      linkedin: {
        headline: 'A step change in how you bank with Barclays',
        body: LINKEDIN_BODY,
        cta: 'Discover iPortal',
      },
      email: { headline: 'Discover what is possible with iPortal', body: EMAIL_BODY, cta: 'Explore iPortal' },
    },
    ...overrides,
  };
}

/** Minimal stand-in for the slice of the DOM the composer touches. */
class FakeSlot implements CompositionElement {
  html = '';
  attributes = new Map<string, string>();

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  querySelector(selectors: string): unknown {
    return this.html.includes(selectors.replace('.', 'class="')) ? {} : null;
  }

  insertAdjacentHTML(_position: 'beforeend', html: string): void {
    this.html += html;
  }

  /** What the V19 renderer effectively does on every re-render. */
  wipe(): void {
    this.html = '';
    this.attributes.delete(COMPOSED_ATTRIBUTE);
  }
}

/** Serves slots per selector, so channel scoping can be asserted. */
function fakeDocument(slots: Partial<Record<string, FakeSlot[]>>, logo: string | null = LOGO) {
  const properties = new Map<string, string>();
  const doc: CompositionDocument = {
    querySelector: () => (logo === null ? null : { getAttribute: () => logo }),
    querySelectorAll: (selectors) => slots[selectors] ?? [],
    documentElement: { style: { setProperty: (name, value) => void properties.set(name, value) } },
  };
  return { doc, properties };
}

function linkedInDocument(slot: FakeSlot, logo: string | null = LOGO) {
  return fakeDocument({ [CHANNEL_PLANS.linkedin.selector]: [slot] }, logo);
}

describe('campaign copy comes from live runtime state', () => {
  it('reads the headline for each channel from its own output', () => {
    expect(deriveCampaignCopy(state(), 'linkedin')?.headline).toBe('A step change in how you bank with Barclays');
    expect(deriveCampaignCopy(state(), 'email')?.headline).toBe('Discover what is possible with iPortal');
    expect(deriveCampaignCopy(state(), 'email')?.product).toBe(PRODUCT_LINE);
  });

  it('follows the state rather than any hard-coded campaign wording', () => {
    const copy = deriveCampaignCopy(
      state({ outputs: { linkedin: { headline: 'Treasury, simplified', body: 'One connected view.' } } }),
      'linkedin',
    );

    expect(copy?.headline).toBe('Treasury, simplified');
  });

  it('clips an overlong headline to a whole word', () => {
    const headline = `${'Sustained visibility across every entity and currency '.repeat(6)}end`;
    const copy = deriveCampaignCopy(state({ outputs: { linkedin: { headline } } }), 'linkedin');

    expect(copy?.headline.length).toBeLessThanOrEqual(120);
    expect(copy?.headline.endsWith(' ')).toBe(false);
  });

  it('declines to compose when the channel has no headline yet', () => {
    expect(deriveCampaignCopy(undefined, 'linkedin')).toBeNull();
    expect(deriveCampaignCopy({}, 'email')).toBeNull();
    expect(deriveCampaignCopy(state({ outputs: { linkedin: { headline: '   ' } } }), 'linkedin')).toBeNull();
  });
});

describe('the overlay is real, escaped HTML text', () => {
  it('carries the approved logo, lockup line, product line and headline', () => {
    const html = buildOverlayHtml(deriveCampaignCopy(state(), 'linkedin')!, LOGO);

    expect(html).toContain(`src="${LOGO}"`);
    expect(html).toContain('alt="Barclays"');
    // The strapline as the approved reference and the V19 email asset spell it.
    expect(html).toContain('Backing your future');
    expect(html).toContain('Barclays iPortal.');
    expect(html).toContain('A step change in how you bank with Barclays');
  });

  it('never repeats the channel body inside the creative', () => {
    const linkedin = buildOverlayHtml(deriveCampaignCopy(state(), 'linkedin')!, LOGO);
    const email = buildOverlayHtml(deriveCampaignCopy(state(), 'email')!, LOGO);

    expect(linkedin).not.toContain(LINKEDIN_BODY);
    expect(email).not.toContain(EMAIL_BODY);
    expect(linkedin).not.toContain('bx-campaign-support');
  });

  it('falls back to a text wordmark rather than inventing an image', () => {
    const html = buildOverlayHtml(deriveCampaignCopy(state(), 'linkedin')!, undefined);
    expect(html).not.toContain('<img');
    expect(html).toContain('bx-lockup-word');
  });

  it('escapes campaign copy so state can never inject markup', () => {
    const html = buildOverlayHtml(
      deriveCampaignCopy(state({ outputs: { linkedin: { headline: '<img src=x onerror="go()">' } } }), 'linkedin')!,
      LOGO,
    );

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=&quot;go()&quot;&gt;');
  });

  it('accepts only our own stored assets as a background', () => {
    expect(backgroundValue(LINKEDIN_ASSET)).toBe(`url("${LINKEDIN_ASSET}")`);
    expect(backgroundValue('https://firefly-api.adobe.io/thing.jpg')).toBeUndefined();
    expect(backgroundValue('C:/server/assets/firefly-references/firefly_reference_1.png')).toBeUndefined();
    expect(backgroundValue('/api/images/asset/x") url("evil')).toBeUndefined();
  });

  it('uses the logo already in the V19 markup and ignores anything else', () => {
    expect(readBrandLogo(linkedInDocument(new FakeSlot(), LOGO).doc)).toBe(LOGO);
    expect(readBrandLogo(linkedInDocument(new FakeSlot(), 'https://example.test/logo.png').doc)).toBeUndefined();
    expect(readBrandLogo(linkedInDocument(new FakeSlot(), null).doc)).toBeUndefined();
  });
});

describe('composition is scoped to the frozen creative slots', () => {
  it('composes the LinkedIn slot and publishes its background variable', () => {
    const slot = new FakeSlot();
    const { doc, properties } = linkedInDocument(slot);

    expect(composeCreative(doc, { channel: 'linkedin', assetUrl: LINKEDIN_ASSET, state: state() })).toBe(1);
    expect(properties.get(CHANNEL_PLANS.linkedin.variable)).toBe(`url("${LINKEDIN_ASSET}")`);
    expect(slot.getAttribute(COMPOSED_ATTRIBUTE)).toBe('true');
    expect(slot.html).toContain(OVERLAY_CLASS);
  });

  it('composes the email hero with the email headline and its own variable', () => {
    const hero = new FakeSlot();
    const { doc, properties } = fakeDocument({ [CHANNEL_PLANS.email.selector]: [hero] });

    expect(composeCreative(doc, { channel: 'email', assetUrl: EMAIL_ASSET, state: state() })).toBe(1);
    expect(properties.get(CHANNEL_PLANS.email.variable)).toBe(`url("${EMAIL_ASSET}")`);
    expect(hero.html).toContain('Discover what is possible with iPortal');
    expect(hero.html).not.toContain('A step change');
  });

  it('leaves the other channel alone when only one background exists', () => {
    const linkedin = new FakeSlot();
    const email = new FakeSlot();
    const { doc, properties } = fakeDocument({
      [CHANNEL_PLANS.linkedin.selector]: [linkedin],
      [CHANNEL_PLANS.email.selector]: [email],
    });

    composeCreative(doc, { channel: 'linkedin', assetUrl: LINKEDIN_ASSET, state: state() });

    expect(email.html).toBe('');
    expect(email.getAttribute(COMPOSED_ATTRIBUTE)).toBeNull();
    expect(properties.has(CHANNEL_PLANS.email.variable)).toBe(false);
  });

  it('is idempotent, so repeated DOM mutations cannot stack overlays', () => {
    const slot = new FakeSlot();
    const { doc } = linkedInDocument(slot);

    composeCreative(doc, { channel: 'linkedin', assetUrl: LINKEDIN_ASSET, state: state() });
    expect(composeCreative(doc, { channel: 'linkedin', assetUrl: LINKEDIN_ASSET, state: state() })).toBe(0);
    expect(slot.html.match(new RegExp(OVERLAY_CLASS, 'g'))).toHaveLength(1);
  });

  it('re-composes after the V19 renderer rebuilds the slot', () => {
    const slot = new FakeSlot();
    const { doc } = linkedInDocument(slot);

    composeCreative(doc, { channel: 'linkedin', assetUrl: LINKEDIN_ASSET, state: state() });
    slot.wipe();

    expect(composeCreative(doc, { channel: 'linkedin', assetUrl: LINKEDIN_ASSET, state: state() })).toBe(1);
    expect(slot.html).toContain(OVERLAY_CLASS);
  });

  it('picks up changed campaign copy on the next render', () => {
    const slot = new FakeSlot();
    const { doc } = linkedInDocument(slot);

    composeCreative(doc, { channel: 'linkedin', assetUrl: LINKEDIN_ASSET, state: state() });
    slot.wipe();
    composeCreative(doc, {
      channel: 'linkedin',
      assetUrl: LINKEDIN_ASSET,
      state: state({ outputs: { linkedin: { headline: 'A live Gemini headline' } } }),
    });

    expect(slot.html).toContain('A live Gemini headline');
    expect(slot.html).not.toContain('A step change');
  });

  it('does nothing without a stored background, leaving V19 untouched', () => {
    const slot = new FakeSlot();
    const { doc, properties } = linkedInDocument(slot);

    expect(composeCreative(doc, { channel: 'linkedin', assetUrl: '', state: state() })).toBe(0);
    expect(slot.html).toBe('');
    expect(slot.getAttribute(COMPOSED_ATTRIBUTE)).toBeNull();
    expect(properties.size).toBe(0);
  });

  it('does nothing when the runtime has no campaign copy', () => {
    const slot = new FakeSlot();
    const { doc } = linkedInDocument(slot);

    expect(composeCreative(doc, { channel: 'linkedin', assetUrl: LINKEDIN_ASSET, state: {} })).toBe(0);
    expect(slot.html).toBe('');
  });

  it('leaks no filesystem path, provider host or credential into the DOM', () => {
    const slot = new FakeSlot();
    const { doc } = linkedInDocument(slot);
    composeCreative(doc, { channel: 'linkedin', assetUrl: LINKEDIN_ASSET, state: state() });

    for (const token of ['firefly-api', 'adobe', 'ims-na1', 'server/assets', '.generated', 'uploadId']) {
      expect(slot.html.toLowerCase()).not.toContain(token.toLowerCase());
    }
  });
});

/* ------------------------------------------------------------------ *
 * Resolution order and the reader contract
 * ------------------------------------------------------------------ */

const CANDIDATE_IDS: Record<ImageChannel, string> = {
  linkedin: 'linkedin-11111111-2222-4333-8444-555555555555',
  email: 'email-66666666-7777-4888-8999-aaaaaaaaaaaa',
};

function candidateAsset(channel: ImageChannel): GeneratedImageAsset {
  const id = CANDIDATE_IDS[channel];
  return { id, url: `/api/images/asset/${id}`, channel, width: 2688, height: 1536, bytes: 1500000 };
}

/** Promotes a real candidate through the store, exactly as the workflow does. */
async function promoteCandidate(channel: ImageChannel) {
  const generate = vi.fn(async (payload: { channel: ImageChannel }) => ({
    ok: true as const,
    data: { source: 'firefly' as const, asset: candidateAsset(payload.channel), referenceSlot: 1 as const },
  }));

  startCreativeCandidates({
    bridge: { images: { generate } } as unknown as BarclaysServices,
    runId: 1,
    request: (requested) => (requested === channel ? ({ channel: requested } as never) : null),
  });
  await settleCreativeCandidates();
}

interface ReaderStub {
  bridge: BarclaysServices;
  latest: ReturnType<typeof vi.fn>;
  generate: ReturnType<typeof vi.fn>;
}

/** A bridge whose only legitimate use by this module is the approved lookup. */
function readerBridge(approved: Partial<Record<ImageChannel, string>>): ReaderStub {
  const latest = vi.fn(async (channel: ImageChannel) => ({
    ok: true as const,
    data: {
      channel,
      asset: approved[channel] ? ({ url: approved[channel] } as GeneratedImageAsset) : null,
    },
  }));
  const generate = vi.fn(async () => {
    throw new Error('the composition layer must never generate an image');
  });

  return { latest, generate, bridge: { images: { latest, generate } } as unknown as BarclaysServices };
}

afterEach(() => resetCreativeCandidates());

describe('14 & 15. the background resolves current-run, then approved, then V19', () => {
  it('prefers a validated current-run candidate over the approved asset', async () => {
    await promoteCandidate('linkedin');

    expect(resolveBackground('linkedin', LINKEDIN_ASSET)).toBe(`/api/images/asset/${CANDIDATE_IDS.linkedin}`);
    expect(resolveBackground('email', EMAIL_ASSET)).toBe(EMAIL_ASSET);
  });

  it('falls back to the approved asset with no candidate', () => {
    expect(resolveBackground('linkedin', LINKEDIN_ASSET)).toBe(LINKEDIN_ASSET);
  });

  it('resolves nothing when neither exists, leaving the V19 creative alone', () => {
    expect(resolveBackground('linkedin', undefined)).toBeUndefined();
  });

  it('keeps the channels independent when only one candidate is promoted', async () => {
    await promoteCandidate('email');

    expect(resolveBackground('linkedin', LINKEDIN_ASSET)).toBe(LINKEDIN_ASSET);
    expect(resolveBackground('email', EMAIL_ASSET)).toBe(`/api/images/asset/${CANDIDATE_IDS.email}`);
  });
});

describe('8 & 9. the composition layer is a reader, never a generator', () => {
  const access: V19RuntimeAccess = {
    getState: () => state(),
    getBriefSections: () => undefined,
    getTeamsState: () => undefined,
  };

  function environment(slots: Record<string, FakeSlot[]>) {
    const { doc, properties } = fakeDocument(slots);
    let notify: (() => void) | undefined;
    const disconnect = vi.fn();

    return {
      properties,
      /** Stands in for a MutationObserver callback. */
      mutate: () => notify?.(),
      disconnect,
      env: {
        doc,
        watch(onChange: () => void) {
          notify = onChange;
          return disconnect;
        },
      },
    };
  }

  it('composes from the approved lookup without ever generating', async () => {
    const slot = new FakeSlot();
    const stub = readerBridge({ linkedin: LINKEDIN_ASSET });
    const harness = environment({ [CHANNEL_PLANS.linkedin.selector]: [slot] });

    const uninstall = installCampaignCreative({ bridge: stub.bridge, access, environment: harness.env });
    await settleCreativeCandidates();
    await Promise.resolve();

    expect(harness.properties.get(CHANNEL_PLANS.linkedin.variable)).toBe(`url("${LINKEDIN_ASSET}")`);
    expect(stub.generate).not.toHaveBeenCalled();
    expect(stub.latest).toHaveBeenCalledTimes(2);

    // Re-renders, tab switches and any other DOM churn arrive as mutations.
    slot.wipe();
    harness.mutate();
    await Promise.resolve();
    harness.mutate();
    await Promise.resolve();

    expect(stub.generate).not.toHaveBeenCalled();
    expect(stub.latest).toHaveBeenCalledTimes(2);
    uninstall();
    expect(harness.disconnect).toHaveBeenCalled();
  });

  it('switches to a promoted candidate in place, with no blank frame', async () => {
    const slot = new FakeSlot();
    const stub = readerBridge({ linkedin: LINKEDIN_ASSET });
    const harness = environment({ [CHANNEL_PLANS.linkedin.selector]: [slot] });

    const uninstall = installCampaignCreative({ bridge: stub.bridge, access, environment: harness.env });
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.properties.get(CHANNEL_PLANS.linkedin.variable)).toBe(`url("${LINKEDIN_ASSET}")`);

    await promoteCandidate('linkedin');

    // The overlay was never removed; only the background changed.
    expect(harness.properties.get(CHANNEL_PLANS.linkedin.variable)).toBe(
      `url("/api/images/asset/${CANDIDATE_IDS.linkedin}")`,
    );
    expect(slot.html.match(new RegExp(OVERLAY_CLASS, 'g'))).toHaveLength(1);
    expect(stub.generate).not.toHaveBeenCalled();
    uninstall();
  });

  it('leaves the slot untouched when neither a candidate nor an approved asset exists', async () => {
    const slot = new FakeSlot();
    const stub = readerBridge({});
    const harness = environment({ [CHANNEL_PLANS.linkedin.selector]: [slot] });

    const uninstall = installCampaignCreative({ bridge: stub.bridge, access, environment: harness.env });
    await Promise.resolve();
    await Promise.resolve();
    harness.mutate();

    expect(slot.html).toBe('');
    expect(harness.properties.size).toBe(0);
    expect(stub.generate).not.toHaveBeenCalled();
    uninstall();
  });
});
