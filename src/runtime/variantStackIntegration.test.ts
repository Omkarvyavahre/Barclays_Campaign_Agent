/**
 * Variant stack against the real V19 script chain.
 *
 * The isolated bridge tests evaluate v19-modify-firefly.js on its own, so they cannot prove the
 * browser renders the candidate stack. These tests load every runtime script in the shipped order
 * and drive Stage 5 end to end. The modify-asset endpoint is mocked: no Gemini, no Firefly.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { V19_MARKUP } from './v19Markup';
import { V19_SCRIPTS } from './scriptManifest';

type AnyRecord = Record<string, unknown>;

const ORIGINAL_CREATIVE = '/assets/iportal-creative-linkedin-mobile.png';
const MODIFIED_IMAGE = '/api/ai/generated/test-modified.png';
const GENERATED_IMAGE = '/api/ai/generated/test-generated.png';
const MODIFIED_ID = 'GM-DER-MODIFIED1';
const GENERATED_ID = 'FF-DER-GENERATED';

function globals() {
  return globalThis as unknown as AnyRecord;
}

function loadV19Runtime() {
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

function state() {
  return globals().state as { assets: AnyRecord[]; assetTab: number };
}

function assetIndex(id: string): number {
  return state().assets.findIndex((a) => a.id === id);
}

function mockDerivative(id: string, imageUrl: string) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    return {
      ok: true,
      status: 200,
      json: async () => ({
        stage: 'ready',
        intent: 'modify_current_asset',
        confidence: 0.93,
        derivedAsset: {
          id,
          sourceId: body.rootSourceDamAssetId,
          editSourceAssetId: body.editSourceAssetId,
          derivedFromAssetId: body.editSourceAssetId,
          rootSourceDamAssetId: body.rootSourceDamAssetId,
          derived: true,
          generationSource: body.regenerate ? 'firefly' : 'gemini-image',
          channel: 'LinkedIn',
          format: 'Sponsored content · mobile crop',
          dimensions: '1080 × 1080',
          imageUrl,
          name: id,
          matchStatus: 'AI-modified',
          confidence: 'Campaign-ready draft',
          sourceImageDimensions: '1024 × 1024',
          finalImageDimensions: '1080 × 1080',
          formatAdaptation: 'cover-crop',
          lineage:
            'Adobe DAM · DAM-0188 → Gemini image edit (1024 × 1024) → channel crop/format adaptation (1080 × 1080)',
          approval: 'Brand guidance applied',
          brandGrounding: {
            applied: true,
            entryIds: ['gr-owned-logo-assets'],
            sources: ['Barclays-Logo.wine.svg'],
            ruleCount: 1
          }
        },
        interpretation: { visualReference: null }
      })
    };
  });
  globals().fetch = fetchMock;
  return fetchMock;
}

async function modify(index: number, prompt = 'Move the wordmark to the bottom centre') {
  (globals().openGenStudioRequest as (i: number, m: string) => void)(index, 'modify');
  (document.getElementById('gsPrompt') as HTMLTextAreaElement).value = prompt;
  await (globals().submitGenStudioAssetRequest as (i: number, m: string) => Promise<void>)(
    index,
    'modify'
  );
}

async function regenerate(index: number, prompt = 'A photographic corporate banking hero') {
  (globals().regenerateFireflyDerivative as (i: number) => void)(index);
  (document.getElementById('fireflyGenerationPrompt') as HTMLTextAreaElement).value = prompt;
  await (globals().submitFireflyRegeneration as (i: number) => Promise<void>)(index);
}

function stageFiveMarkup(index: number): string {
  state().assetTab = index;
  return (globals().renderAssets as () => string)();
}

function parse(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

function variantLabels(html: string): (string | null)[] {
  return [...parse(html).querySelectorAll('.v19-variant-label')].map((n) => n.textContent);
}

/** Background image URLs of the rendered candidate thumbnails, in row order. */
function variantImages(html: string): string[] {
  return [...parse(html).querySelectorAll('.v19-variant-thumb')].map((node) => {
    const style = node.getAttribute('style') || '';
    return style.match(/url\('([^']+)'\)/)?.[1] ?? '';
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  globals().renderAll = () => {};
  globals().renderTeams = () => {};
  globals().toast = () => {};
  delete globals().fetch;
  document.body.innerHTML = '';
});

describe('variant stack renders in the real V19 script chain', () => {
  it('the shipped bridge owns the active Stage 5 renderer', () => {
    loadV19Runtime();
    // If a legacy renderAssets were still winning, the stack markup would be absent.
    expect(stageFiveMarkup(assetIndex('DAM-0188'))).toContain('v19-variant-stack');
  });

  it('keeps Original and adds Modified after a successful Modify', async () => {
    loadV19Runtime();
    const index = assetIndex('DAM-0188');
    expect(state().assets[index]!.imageUrl).toBe(ORIGINAL_CREATIVE);

    mockDerivative(MODIFIED_ID, MODIFIED_IMAGE);
    await modify(index);

    const slot = state().assets[index]!;
    // Root record still represents Original.
    expect(slot.id).toBe('DAM-0188');
    expect(slot.imageUrl).toBe(ORIGINAL_CREATIVE);
    expect(slot.generatedCandidate).toBeNull();
    expect(slot.selectedCandidateKind).toBe('modified');
    expect((slot.modifiedCandidate as AnyRecord).id).toBe(MODIFIED_ID);
    expect((slot.modifiedCandidate as AnyRecord).imageUrl).toBe(MODIFIED_IMAGE);

    const markup = stageFiveMarkup(index);
    expect(variantLabels(markup)).toEqual(['Original', 'Modified']);
    expect(variantImages(markup)).toEqual([ORIGINAL_CREATIVE, MODIFIED_IMAGE]);
    // Both creatives are on screen — the stack never collapses to a single hero image.
    expect(markup).toContain(ORIGINAL_CREATIVE);
    expect(markup).toContain(MODIFIED_IMAGE);
    expect(parse(markup).querySelectorAll('.v19-variant-row')).toHaveLength(2);
  });

  it('renders Original and Generated when only Regenerate ran', async () => {
    loadV19Runtime();
    const index = assetIndex('DAM-0188');

    mockDerivative(GENERATED_ID, GENERATED_IMAGE);
    await regenerate(index);

    const slot = state().assets[index]!;
    expect(slot.id).toBe('DAM-0188');
    expect(slot.imageUrl).toBe(ORIGINAL_CREATIVE);
    expect(slot.modifiedCandidate).toBeNull();
    expect(slot.selectedCandidateKind).toBe('generated');

    const markup = stageFiveMarkup(index);
    expect(variantLabels(markup)).toEqual(['Original', 'Generated']);
    expect(variantImages(markup)).toEqual([ORIGINAL_CREATIVE, GENERATED_IMAGE]);
  });

  it('renders all three rows with distinct images after Modify then Regenerate', async () => {
    loadV19Runtime();
    const index = assetIndex('DAM-0188');

    mockDerivative(MODIFIED_ID, MODIFIED_IMAGE);
    await modify(index);
    mockDerivative(GENERATED_ID, GENERATED_IMAGE);
    await regenerate(index);

    const slot = state().assets[index]!;
    expect(slot.imageUrl).toBe(ORIGINAL_CREATIVE);
    expect((slot.modifiedCandidate as AnyRecord).imageUrl).toBe(MODIFIED_IMAGE);
    expect((slot.generatedCandidate as AnyRecord).imageUrl).toBe(GENERATED_IMAGE);

    const markup = stageFiveMarkup(index);
    expect(variantLabels(markup)).toEqual(['Original', 'Modified', 'Generated']);
    const images = variantImages(markup);
    expect(images).toEqual([ORIGINAL_CREATIVE, MODIFIED_IMAGE, GENERATED_IMAGE]);
    expect(new Set(images).size).toBe(3);
  });

  it('shows one status badge per state, with no duplicate AI-modified chip', async () => {
    loadV19Runtime();
    const index = assetIndex('DAM-0188');
    mockDerivative(MODIFIED_ID, MODIFIED_IMAGE);
    await modify(index);

    const markup = stageFiveMarkup(index);
    const badges = [...parse(markup).querySelectorAll('.clean-badge')].map((n) =>
      (n.textContent || '').trim()
    );
    expect(badges.filter((label) => label === 'AI-modified').length).toBeLessThanOrEqual(1);
    const visible = parse(markup).textContent || '';
    expect(visible).not.toMatch(/Gemini|Firefly|GenStudio/i);
  });

  it('hands the selected Modified candidate to Stage 7 while Original stays in Stage 6', async () => {
    loadV19Runtime();
    const index = assetIndex('DAM-0188');
    mockDerivative(MODIFIED_ID, MODIFIED_IMAGE);
    await modify(index);

    (globals().toggleAsset as (i: number) => void)(index);
    (globals().syncOutputsFromSelectedAssets as () => void)();

    const outputs = (globals().state as AnyRecord).outputs as Record<string, AnyRecord>;
    expect(outputs.linkedin).toMatchObject({
      assetId: MODIFIED_ID,
      sourceAssetIds: [MODIFIED_ID],
      imageUrl: MODIFIED_IMAGE,
      derivedFromAssetId: 'DAM-0188'
    });

    // Stage 6 still offers the untouched Original alongside the selected Modified candidate.
    expect(variantImages(stageFiveMarkup(index))).toEqual([ORIGINAL_CREATIVE, MODIFIED_IMAGE]);
  });

  it('switching back to Original restores the original creative in Stage 7', async () => {
    loadV19Runtime();
    const index = assetIndex('DAM-0188');
    mockDerivative(MODIFIED_ID, MODIFIED_IMAGE);
    await modify(index);
    (globals().toggleAsset as (i: number) => void)(index);

    (globals().selectAssetCandidate as (i: number, kind: string) => void)(index, 'original');

    const outputs = (globals().state as AnyRecord).outputs as Record<string, AnyRecord>;
    expect(outputs.linkedin).toMatchObject({
      assetId: 'DAM-0188',
      imageUrl: ORIGINAL_CREATIVE,
      generated: false
    });
    expect(variantLabels(stageFiveMarkup(index))).toEqual(['Original', 'Modified']);
  });

  it('makes no provider call while rendering the stack', async () => {
    loadV19Runtime();
    const index = assetIndex('DAM-0188');
    mockDerivative(MODIFIED_ID, MODIFIED_IMAGE);
    await modify(index);

    const fetchMock = vi.fn();
    globals().fetch = fetchMock;
    stageFiveMarkup(index);
    (globals().previewAssetCandidate as (i: number, kind: string) => void)(index, 'modified');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
