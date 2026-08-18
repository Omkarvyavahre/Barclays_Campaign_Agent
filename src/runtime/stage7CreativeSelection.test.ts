/**
 * Stage 7 channel-output creative resolution.
 *
 * The invariant under test: the creative rendered in a channel output package is the
 * image of the candidate the marketer explicitly selected in Stage 6 — never the raw
 * provider artifact behind a composited Generated candidate, never another channel's
 * asset, and never a global iPortal stand-in.
 *
 * The real V19 chain is evaluated in load order; the modify-asset endpoint is mocked,
 * so no Gemini or Firefly call happens.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { V19_MARKUP } from './v19Markup';
import { V19_SCRIPTS } from './scriptManifest';

type AnyRecord = Record<string, unknown>;

/** DAM-0188 · LinkedIn sponsored content — mobile. */
const LINKEDIN_MOBILE = 1;
/** REQ-LI-WEB · LinkedIn sponsored content — web. */
const LINKEDIN_WEB = 2;

const MOBILE_ORIGINAL = '/assets/iportal-creative-linkedin-mobile.png';
const WEB_ORIGINAL = '/assets/iportal-creative-linkedin-web.png';
const EMAIL_ORIGINAL = '/assets/iportal-creative-single.png';

const MODIFIED_IMAGE = '/api/ai/generated/gm-stage7-modified';
/** Final logo-composited asset. */
const GENERATED_IMAGE = '/api/ai/generated/ff-stage7-composited';
/** Raw Firefly artifact kept for provenance — must never reach Stage 7. */
const GENERATED_RAW_IMAGE = '/api/ai/generated/ff-stage7-raw';

function globals() {
  return globalThis as unknown as AnyRecord;
}

function state(): { assets: AnyRecord[]; outputs: Record<string, AnyRecord>; outputTab: string } {
  return globals().state as never;
}

function loadRuntime() {
  document.body.innerHTML = `<div id="v19-host">${V19_MARKUP}</div>`;
  if (!('scrollTo' in Element.prototype)) {
    (Element.prototype as unknown as AnyRecord).scrollTo = () => {};
  }
  const sources = V19_SCRIPTS.map((src) =>
    readFileSync(resolve(process.cwd(), 'public' + src), 'utf8')
  );
  (0, eval)(sources.join('\n;\n') + '\n;window.state = state;');
  globals().renderTeams = () => {};
}

function mockDerivative(id: string, imageUrl: string, regenerate: boolean) {
  globals().fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    return {
      ok: true,
      status: 200,
      json: async () => ({
        stage: 'ready',
        intent: 'modify_current_asset',
        derivedAsset: {
          id,
          sourceId: body.rootSourceDamAssetId,
          editSourceAssetId: body.editSourceAssetId,
          derivedFromAssetId: body.editSourceAssetId,
          rootSourceDamAssetId: body.rootSourceDamAssetId,
          derived: true,
          generationSource: regenerate ? 'firefly' : 'gemini-image',
          channel: 'LinkedIn',
          imageUrl,
          // Regenerate persists the raw Firefly output separately from the branded final.
          sourceImageUrl: regenerate ? GENERATED_RAW_IMAGE : undefined,
          sourceImageId: regenerate ? 'ff-stage7-raw' : undefined,
          name: id,
          approval: 'Brand guidance applied',
          lineage: 'Adobe DAM · DAM-0188 → AI',
          jobId: 'JOB-STAGE7',
          brandGrounding: {
            applied: true,
            entryIds: ['gr-owned-logo-assets'],
            sources: ['Barclays-Logo.wine.svg'],
            ruleCount: 5
          },
          logoComposition: regenerate
            ? { applied: true, entryId: 'vis-logo-png', placement: 'top-left' }
            : undefined
        }
      })
    };
  });
}

async function modify(index: number, id = 'GM-DER-STAGE7', imageUrl = MODIFIED_IMAGE) {
  const g = globals();
  mockDerivative(id, imageUrl, false);
  (g.openGenStudioRequest as (i: number, m: string) => void)(index, 'modify');
  (document.getElementById('gsPrompt') as HTMLTextAreaElement).value = 'Darken the background';
  await (g.submitGenStudioAssetRequest as (i: number, m: string) => Promise<void>)(index, 'modify');
}

async function regenerate(index: number, id = 'FF-DER-STAGE7', imageUrl = GENERATED_IMAGE) {
  const g = globals();
  mockDerivative(id, imageUrl, true);
  (g.regenerateFireflyDerivative as (i: number) => void)(index);
  (document.getElementById('fireflyGenerationPrompt') as HTMLTextAreaElement).value =
    'Premium photographic corporate banking hero';
  await (g.submitFireflyRegeneration as (i: number) => Promise<void>)(index);
}

function include(index: number) {
  (globals().toggleAsset as (i: number) => void)(index);
}

function select(index: number, kind: 'original' | 'modified' | 'generated') {
  (globals().selectAssetCandidate as (i: number, k: string) => void)(index, kind);
}

function stageSeven(tab: 'linkedin' | 'email'): string {
  state().outputTab = tab;
  return (globals().renderOutputs as () => string)();
}

function creativeElement(html: string): HTMLElement | null {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.querySelector<HTMLElement>('.v17-li-creative,.v17-email-creative');
}

/** The URL the Stage 7 creative element actually paints. */
function creativeUrl(html: string): string {
  const style = creativeElement(html)?.getAttribute('style') || '';
  return /url\('([^']*)'\)/.exec(style)?.[1] ?? '';
}

afterEach(() => {
  vi.restoreAllMocks();
  globals().renderAll = () => {};
  globals().renderTeams = () => {};
  globals().toast = () => {};
  document.body.innerHTML = '';
});

describe('Stage 7 renders the explicitly selected Stage 6 candidate', () => {
  it('locks page overflow while a preview modal is open and restores it on close', async () => {
    loadRuntime();
    (globals().previewAssetCandidate as (i: number, kind: string) => void)(
      LINKEDIN_MOBILE,
      'original'
    );
    await Promise.resolve();
    expect(document.body.classList.contains('modal-open')).toBe(true);
    expect(document.querySelector('.v19-candidate-preview-modal')).not.toBeNull();

    (globals().closeModal as () => void)();
    await Promise.resolve();
    expect(document.body.classList.contains('modal-open')).toBe(false);
  });

  it('shows the Original DAM creative when Original is selected', () => {
    loadRuntime();
    include(LINKEDIN_MOBILE);

    expect(state().outputs.linkedin.imageUrl).toBe(MOBILE_ORIGINAL);
    expect(creativeUrl(stageSeven('linkedin'))).toBe(MOBILE_ORIGINAL);
  });

  it('shows the Modified creative when Modified is selected', async () => {
    loadRuntime();
    include(LINKEDIN_MOBILE);
    await modify(LINKEDIN_MOBILE);

    expect(state().assets[LINKEDIN_MOBILE].selectedCandidateKind).toBe('modified');
    expect(state().outputs.linkedin.imageUrl).toBe(MODIFIED_IMAGE);
    expect(creativeUrl(stageSeven('linkedin'))).toBe(MODIFIED_IMAGE);
  });

  it('shows the logo-composited Generated creative, not the raw Firefly artifact', async () => {
    loadRuntime();
    include(LINKEDIN_MOBILE);
    await regenerate(LINKEDIN_MOBILE);

    const generated = state().assets[LINKEDIN_MOBILE].generatedCandidate as AnyRecord;
    expect(generated.imageUrl).toBe(GENERATED_IMAGE);
    expect(generated.sourceImageUrl).toBe(GENERATED_RAW_IMAGE);

    const output = state().outputs.linkedin;
    expect(output.assetId).toBe('FF-DER-STAGE7');
    expect(output.imageUrl).toBe(GENERATED_IMAGE);
    expect(output.logoComposition).toMatchObject({ applied: true, entryId: 'vis-logo-png' });

    const markup = stageSeven('linkedin');
    expect(creativeUrl(markup)).toBe(GENERATED_IMAGE);
    expect(markup).not.toContain(GENERATED_RAW_IMAGE);
  });

  it('switches the Stage 7 creative immediately as the selection changes', async () => {
    loadRuntime();
    include(LINKEDIN_MOBILE);
    await modify(LINKEDIN_MOBILE);
    await regenerate(LINKEDIN_MOBILE);
    const previousScrollIntoView = Element.prototype.scrollIntoView;
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;

    try {
      expect(creativeUrl(stageSeven('linkedin'))).toBe(GENERATED_IMAGE);

      select(LINKEDIN_MOBILE, 'modified');
      expect(state().outputs.linkedin.imageUrl).toBe(MODIFIED_IMAGE);
      expect(creativeUrl(stageSeven('linkedin'))).toBe(MODIFIED_IMAGE);

      select(LINKEDIN_MOBILE, 'original');
      expect(state().outputs.linkedin.imageUrl).toBe(MOBILE_ORIGINAL);
      expect(creativeUrl(stageSeven('linkedin'))).toBe(MOBILE_ORIGINAL);

      select(LINKEDIN_MOBILE, 'generated');
      expect(creativeUrl(stageSeven('linkedin'))).toBe(GENERATED_IMAGE);
      expect(scrollSpy).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = previousScrollIntoView;
    }
  });

  it('keeps the Email package on its own creative while LinkedIn changes', async () => {
    loadRuntime();
    include(LINKEDIN_MOBILE);
    await regenerate(LINKEDIN_MOBILE);

    expect(creativeUrl(stageSeven('email'))).toBe(EMAIL_ORIGINAL);
    expect(creativeUrl(stageSeven('linkedin'))).toBe(GENERATED_IMAGE);
  });
});

describe('Stage 7 LinkedIn inclusion is mutually exclusive', () => {
  it('keeps only one LinkedIn slot included and surfaces its format on the package', async () => {
    loadRuntime();
    include(LINKEDIN_MOBILE);
    expect(state().assets[LINKEDIN_MOBILE].included).toBe(true);
    expect(state().outputs.linkedin.label).toMatch(/mobile/i);
    expect(state().outputs.linkedin.dimensions).toBe('1080 × 1080');

    include(LINKEDIN_WEB);
    expect(state().assets[LINKEDIN_MOBILE].included).toBe(false);
    expect(state().assets[LINKEDIN_WEB].included).toBe(true);
    expect(state().outputs.linkedin.assetId).toBe('REQ-LI-WEB');
    expect(state().outputs.linkedin.imageUrl).toBe(WEB_ORIGINAL);
    expect(state().outputs.linkedin.label).toMatch(/web/i);
    expect(state().outputs.linkedin.dimensions).toBe('1200 × 627');
    expect(creativeUrl(stageSeven('linkedin'))).toBe(WEB_ORIGINAL);
  });

  it('maps the included LinkedIn slot candidate, never a released sibling', async () => {
    loadRuntime();
    include(LINKEDIN_MOBILE);
    await regenerate(LINKEDIN_MOBILE);
    expect(state().outputs.linkedin.imageUrl).toBe(GENERATED_IMAGE);

    include(LINKEDIN_WEB);
    expect(state().assets[LINKEDIN_MOBILE].included).toBe(false);
    expect(state().outputs.linkedin.imageUrl).toBe(WEB_ORIGINAL);
    expect(creativeUrl(stageSeven('linkedin'))).toBe(WEB_ORIGINAL);
    expect(stageSeven('linkedin')).not.toContain(GENERATED_IMAGE);
  });
});

describe('Stage 7 with no creative selected for a channel', () => {
  it('uses the same reserved creative geometry for empty and populated output', () => {
    loadRuntime();
    const empty = creativeElement(stageSeven('linkedin'))!;
    expect(empty.classList.contains('is-empty')).toBe(true);
    expect(empty.style.getPropertyValue('--v19-output-ratio')).toBe('1200 / 627');

    include(LINKEDIN_WEB);
    const populated = creativeElement(stageSeven('linkedin'))!;
    expect(populated.classList.contains('is-empty')).toBe(false);
    expect(populated.classList.contains('v17-li-creative')).toBe(true);
    expect(populated.style.getPropertyValue('--v19-output-ratio')).toBe(
      empty.style.getPropertyValue('--v19-output-ratio')
    );
  });

  it('names the empty state instead of rendering a blank creative band', async () => {
    loadRuntime();
    // The marketer worked on the LinkedIn slot but never selected it for the campaign.
    await regenerate(LINKEDIN_MOBILE);
    expect(state().assets[LINKEDIN_MOBILE].included).toBe(false);
    expect(state().assets[LINKEDIN_MOBILE].selectedCandidateKind).toBe('generated');

    const markup = stageSeven('linkedin');
    expect(state().outputs.linkedin.imageUrl).toBeUndefined();
    expect(creativeUrl(markup)).toBe('');
    expect(markup).toContain('No creative selected for this channel');
    expect(creativeElement(markup)?.className).toContain('is-empty');
    // No stand-in creative from another channel or a global iPortal image.
    expect(markup).not.toContain(EMAIL_ORIGINAL);
    expect(markup).not.toContain(MOBILE_ORIGINAL);
    expect(markup).not.toContain(GENERATED_IMAGE);
  });

  it('recovers the creative as soon as the slot joins the campaign', async () => {
    loadRuntime();
    await regenerate(LINKEDIN_MOBILE);
    expect(stageSeven('linkedin')).toContain('No creative selected for this channel');

    include(LINKEDIN_MOBILE);

    const markup = stageSeven('linkedin');
    expect(state().outputs.linkedin.imageUrl).toBe(GENERATED_IMAGE);
    expect(creativeUrl(markup)).toBe(GENERATED_IMAGE);
    expect(markup).not.toContain('No creative selected for this channel');
  });

  it('clears LinkedIn Stage 7 creative after include → uninclude', async () => {
    loadRuntime();
    include(LINKEDIN_MOBILE);
    await regenerate(LINKEDIN_MOBILE);
    expect(state().outputs.linkedin.imageUrl).toBe(GENERATED_IMAGE);
    expect(state().outputs.linkedin.assetId).toBe('FF-DER-STAGE7');
    expect(state().outputs.linkedin.logoComposition).toMatchObject({ applied: true });

    // Uncheck Select for campaign.
    include(LINKEDIN_MOBILE);

    const out = state().outputs.linkedin;
    expect(out.imageUrl).toBeUndefined();
    expect(out.assetId).toBeUndefined();
    expect(out.sourceAssetIds).toEqual([]);
    expect(out.brandGrounding).toBeUndefined();
    expect(out.logoComposition).toBeUndefined();
    expect(out.brandStatus).toBeUndefined();
    expect(out.generated).toBeUndefined();
    expect(out.derivedFromAssetId).toBeUndefined();

    const markup = stageSeven('linkedin');
    expect(creativeUrl(markup)).toBe('');
    expect(markup).toContain('No creative selected for this channel');
    expect(markup).not.toContain(GENERATED_IMAGE);
  });

  it('clears Email Stage 7 creative after include → uninclude', () => {
    loadRuntime();
    // Email starts included with its Original creative in the default fixture.
    expect(state().assets[0].id).toBe('DAM-0231');
    expect(state().assets[0].included).toBe(true);
    (globals().syncOutputsFromSelectedAssets as () => void)();
    expect(state().outputs.email.imageUrl).toBe(EMAIL_ORIGINAL);
    expect(state().outputs.email.assetId).toBe('DAM-0231');

    include(0); // uninclude Email

    const out = state().outputs.email;
    expect(out.imageUrl).toBeUndefined();
    expect(out.assetId).toBeUndefined();
    expect(out.sourceAssetIds).toEqual([]);
    expect(out.brandGrounding).toBeUndefined();
    expect(out.logoComposition).toBeUndefined();

    const markup = stageSeven('email');
    expect(creativeUrl(markup)).toBe('');
    expect(markup).toContain('No creative selected for this channel');
    expect(markup).not.toContain(EMAIL_ORIGINAL);
  });

  it('reinclude resolves the currently selected candidate, not a stale Generated', async () => {
    loadRuntime();
    include(LINKEDIN_MOBILE);
    await regenerate(LINKEDIN_MOBILE);
    expect(state().outputs.linkedin.imageUrl).toBe(GENERATED_IMAGE);

    include(LINKEDIN_MOBILE); // uninclude — clears Stage 7
    expect(state().outputs.linkedin.imageUrl).toBeUndefined();

    select(LINKEDIN_MOBILE, 'original');
    include(LINKEDIN_MOBILE); // reinclude with Original selected

    expect(state().outputs.linkedin.assetId).toBe('DAM-0188');
    expect(state().outputs.linkedin.imageUrl).toBe(MOBILE_ORIGINAL);
    expect(state().outputs.linkedin.logoComposition).toBeUndefined();
    expect(creativeUrl(stageSeven('linkedin'))).toBe(MOBILE_ORIGINAL);
    expect(stageSeven('linkedin')).not.toContain(GENERATED_IMAGE);
  });
});
