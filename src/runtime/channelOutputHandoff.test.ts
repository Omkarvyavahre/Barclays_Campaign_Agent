/**
 * Stage 6 → Stage 7 handoff tests.
 *
 * The real V19 runtime chain is evaluated in load order (v19-0 … v19-modify-firefly), so these
 * tests exercise the active implementations of syncOutputsFromSelectedAssets and the channel
 * output renderer rather than a superseded copy. No Gemini or Firefly calls happen: the
 * modify-asset endpoint is mocked.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { V19_MARKUP } from './v19Markup';
import { V19_SCRIPTS } from './scriptManifest';

type AnyRecord = Record<string, unknown>;
type OutputRecord = {
  channel: string;
  headline: string;
  body: string;
  cta: string;
  imageUrl?: string;
  assetId?: string;
  sourceAssetIds: string[];
  derivedFromAssetId?: string | null;
  generated?: boolean;
  generationSource?: string | null;
  approved?: boolean;
};
type RuntimeState = {
  started: boolean;
  assets: AnyRecord[];
  outputs: Record<string, OutputRecord>;
  completed: Set<number>;
  acceptedAssets: Record<number, AnyRecord>;
  generatedAssets: Record<number, boolean>;
  stage: number;
  focusStage: number;
  outputTab: string;
};

const DERIVATIVE_ID = 'FF-DER-9A1B2C3D4E';
const DERIVATIVE_IMAGE = '/api/ai/generated/ff-handoff-test';
const DERIVATIVE_HEADLINE = 'One connected digital front door';
const DERIVATIVE_COPY = 'Bring payments, reporting and self-service together with iPortal.';
const DERIVATIVE_CTA = 'Discover iPortal';

// DAM-0188 · LinkedIn sponsored content — mobile. The generated creative replaces this slot.
const LINKEDIN_SLOT_INDEX = 1;

function globals() {
  return globalThis as unknown as AnyRecord;
}

function loadV19Runtime() {
  document.body.innerHTML = `<div id="v19-host">${V19_MARKUP}</div>`;
  // jsdom has no element scrolling, which the Teams feed uses on every render.
  if (!('scrollTo' in Element.prototype)) {
    (Element.prototype as unknown as AnyRecord).scrollTo = () => {};
  }

  const sources = V19_SCRIPTS.map((src) =>
    readFileSync(resolve(process.cwd(), 'public' + src), 'utf8')
  );
  // Script tags share one global lexical scope, so the files are evaluated together;
  // `state` is a top-level const, so the harness re-exposes it for assertions.
  (0, eval)(sources.join('\n;\n') + '\n;window.state = state;');

  // Teams playback is irrelevant here and keeps re-rendering on timers.
  globals().renderTeams = () => {};
  // The shipped creative is a large base64 data URI; a short stand-in keeps full-page
  // renders fast. The runtime reads window.IPORTAL_CREATIVE on every render.
  globals().IPORTAL_CREATIVE = 'data:image/png;base64,IPORTALCREATIVEUNDERTEST';
}

function mockModifyEndpoint(
  id = DERIVATIVE_ID,
  imageUrl = DERIVATIVE_IMAGE,
  headline = DERIVATIVE_HEADLINE
) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    return {
      ok: true,
      status: 200,
      json: async () => ({
        stage: 'ready',
        intent: 'modify_current_asset',
        instruction: String(body.modification?.prompt || ''),
        confidence: 0.93,
        derivedAsset: {
          id,
          sourceId: body.rootSourceDamAssetId || 'DAM-0188',
          editSourceAssetId: body.editSourceAssetId,
          derivedFromAssetId: body.editSourceAssetId,
          rootSourceDamAssetId: body.rootSourceDamAssetId || 'DAM-0188',
          derived: true,
          generationSource: body.regenerate ? 'firefly' : 'gemini-image',
          channel: 'LinkedIn',
          format: 'Sponsored content · mobile crop',
          dimensions: '1080 × 1080',
          requirement: 'LinkedIn · AI-modified',
          name: 'iPortal step-change social creative · Firefly derivative',
          headline,
          copy: DERIVATIVE_COPY,
          cta: DERIVATIVE_CTA,
          imageUrl,
          matchStatus: 'AI-modified',
          confidence: 'Campaign-ready draft',
          sourceType: 'Adobe Firefly',
          lineage: 'Adobe DAM · DAM-0188 → Gemini Creative Interpreter → Adobe Firefly',
          jobId: 'FF-ADAPT-00042',
          creativeSpecification: { negativeSpace: 'right', channel: 'LinkedIn' },
          version: 1
        },
        interpretation: { visualReference: null }
      })
    };
  });
  globals().fetch = fetchMock;
  return fetchMock;
}

/** Runs Modify on the LinkedIn mobile slot; the result replaces that slot. */
async function generateDerivative(
  id = DERIVATIVE_ID,
  imageUrl = DERIVATIVE_IMAGE,
  headline = DERIVATIVE_HEADLINE
) {
  const g = globals();
  mockModifyEndpoint(id, imageUrl, headline);

  const slot = (g.state as RuntimeState).assets[LINKEDIN_SLOT_INDEX];
  // Campaign copy lives on the slot — the Modify modal no longer edits it.
  slot.headline = headline;
  slot.copy = DERIVATIVE_COPY;
  slot.cta = DERIVATIVE_CTA;

  (g.openGenStudioRequest as (i: number, mode: string) => void)(LINKEDIN_SLOT_INDEX, 'modify');
  (document.getElementById('gsPrompt') as HTMLTextAreaElement).value =
    'Make the background darker and simplify the composition';

  await (g.submitGenStudioAssetRequest as (i: number, mode: string) => Promise<void>)(
    LINKEDIN_SLOT_INDEX,
    'modify'
  );

  return LINKEDIN_SLOT_INDEX;
}

function selectAndAccept(index: number) {
  const g = globals();
  (g.toggleAsset as (i: number) => void)(index);
  (g.acceptStageAsset as (i: number, label: string) => void)(5, 'Asset-selection package');
}

function runtimeState(): RuntimeState {
  return globals().state as unknown as RuntimeState;
}

function linkedInOutput(): OutputRecord {
  return runtimeState().outputs.linkedin;
}

/**
 * The live situation: the marketer selected the LinkedIn asset, accepted the asset package
 * and already has a rendered Stage 7 channel output package.
 */
function simulateStageSevenAlreadyGenerated() {
  const g = globals();
  const state = runtimeState();
  (g.toggleAsset as (i: number) => void)(LINKEDIN_SLOT_INDEX);
  state.acceptedAssets[5] = {
    id: 'ASSET-SELECTION-001',
    label: 'Asset-selection package',
    acceptedAt: 'Registered just now'
  };
  state.generatedAssets[6] = true;
  state.outputs.linkedin.approved = true;
  state.completed.add(5);
  state.completed.add(6);
  state.started = true;
  state.stage = 6;
  state.focusStage = 6;
  state.outputTab = 'linkedin';
  (g.renderAll as () => void)();
}

/** The Stage 7 artifact as it currently exists in the conversation. */
function stageSevenArtifact(): string {
  return document.getElementById('conversation-stage-6')?.innerHTML ?? '';
}

function stageSevenMarkup(tab: 'linkedin' | 'email'): string {
  const g = globals();
  (g.state as AnyRecord).outputTab = tab;
  return (g.renderOutputs as () => string)();
}

function stageSevenLinkedInMarkup(): string {
  return stageSevenMarkup('linkedin');
}

function parse(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

function buttonLabels(html: string, selector: string): string[] {
  return Array.from(parse(html).querySelectorAll(`${selector} button`))
    .map((button) => (button.textContent || '').trim())
    .filter(Boolean);
}

function outputCardActions(html: string): string[] {
  return buttonLabels(html, '.v17-output-actions');
}

function packageFooterActions(html: string): string[] {
  return buttonLabels(html, '.artifact-actions .clean-primary-actions');
}

function visibleText(html: string): string {
  return parse(html).textContent ?? '';
}

afterEach(() => {
  vi.restoreAllMocks();
  // Pending V19 timers render and toast after teardown, so both are neutralised first.
  globals().renderAll = () => {};
  globals().renderTeams = () => {};
  globals().toast = () => {};
  document.body.innerHTML = '';
});

describe('Stage 6 → Stage 7 Firefly derivative handoff', () => {
  it('builds the LinkedIn channel output from the asset now occupying the slot', async () => {
    loadV19Runtime();
    const slotIndex = await generateDerivative();

    const slot = runtimeState().assets[slotIndex];
    expect(slot.id).toBe(DERIVATIVE_ID);
    expect(slot.derived).toBe(true);
    expect(slot.generationSource).toBe('gemini-image');
    expect(slot.imageUrl).toBe(DERIVATIVE_IMAGE);
    expect(slot.rootSourceDamAssetId).toBe('DAM-0188');

    selectAndAccept(slotIndex);

    const output = linkedInOutput();
    expect(output.assetId).toBe(DERIVATIVE_ID);
    expect(output.sourceAssetIds).toEqual([DERIVATIVE_ID]);
    expect(output.derivedFromAssetId).toBe('DAM-0188');
    expect(output.generated).toBe(true);
    expect(output.generationSource).toBe('gemini-image');
    expect(output.imageUrl).toBe(DERIVATIVE_IMAGE);
    expect(output.headline).toBe(DERIVATIVE_HEADLINE);
    expect(output.body).toBe(DERIVATIVE_COPY);
    expect(output.cta).toBe(DERIVATIVE_CTA);
  });

  it('renders the derivative creative and copy in Create channel outputs', async () => {
    loadV19Runtime();
    const slotIndex = await generateDerivative();
    selectAndAccept(slotIndex);

    const original = String(globals().IPORTAL_CREATIVE || '');
    const markup = stageSevenLinkedInMarkup();

    expect(markup).toContain(DERIVATIVE_IMAGE);
    expect(markup).not.toContain(original);
    expect(markup).toContain(DERIVATIVE_HEADLINE);
    expect(markup).toContain(DERIVATIVE_COPY);
    expect(markup).toContain(DERIVATIVE_CTA);
    expect(markup).toContain(DERIVATIVE_ID);
  });

  it('keeps the original DAM creative when an unmodified asset is selected', () => {
    loadV19Runtime();
    selectAndAccept(LINKEDIN_SLOT_INDEX);

    const original = String(globals().IPORTAL_CREATIVE || '');
    const output = linkedInOutput();
    expect(output.assetId).toBe('DAM-0188');
    expect(output.imageUrl).toBeUndefined();
    expect(output.generated).toBe(false);

    const markup = stageSevenLinkedInMarkup();
    expect(markup).toContain(original);
    expect(markup).not.toContain('/api/ai/generated/');
  });

  it('refreshes an existing Stage 7 package when the accepted slot is replaced', async () => {
    loadV19Runtime();
    simulateStageSevenAlreadyGenerated();

    const original = String(globals().IPORTAL_CREATIVE || '');
    expect(stageSevenArtifact()).toContain(original);
    expect(linkedInOutput().assetId).toBe('DAM-0188');

    // The replacement keeps the campaign selection that was made on the slot.
    const slotIndex = await generateDerivative();
    expect(runtimeState().assets[slotIndex].included).toBe(true);

    const output = linkedInOutput();
    expect(output.assetId).toBe(DERIVATIVE_ID);
    expect(output.imageUrl).toBe(DERIVATIVE_IMAGE);
    expect(output.headline).toBe(DERIVATIVE_HEADLINE);
    expect(output.body).toBe(DERIVATIVE_COPY);
    expect(output.cta).toBe(DERIVATIVE_CTA);
    expect(output.derivedFromAssetId).toBe('DAM-0188');
    // The accepted output was built from the superseded asset, so it is a draft again.
    expect(output.approved).toBe(false);
    expect(runtimeState().completed.has(6)).toBe(false);

    const artifact = stageSevenArtifact();
    expect(artifact).toContain('/api/ai/generated/');
    expect(artifact).toContain(DERIVATIVE_IMAGE);
    expect(artifact).not.toContain(original);
  });

  it(
    'refreshes Stage 7 again when the generated asset is modified a second time',
    async () => {
      loadV19Runtime();
      simulateStageSevenAlreadyGenerated();
      await generateDerivative();
      expect(linkedInOutput().imageUrl).toBe(DERIVATIVE_IMAGE);

      const secondImage = '/api/ai/generated/ff-handoff-second';
      await generateDerivative('FF-DER-SECOND0001', secondImage, 'Second generated headline');

      const output = linkedInOutput();
      expect(output.assetId).toBe('FF-DER-SECOND0001');
      expect(output.imageUrl).toBe(secondImage);
      expect(output.headline).toBe('Second generated headline');
      expect(output.derivedFromAssetId).toBe('DAM-0188');

      const artifact = stageSevenArtifact();
      expect(artifact).toContain(secondImage);
      expect(artifact).not.toContain(DERIVATIVE_IMAGE);
    },
    30000
  );

  it('leaves Stage 7 on the current creative when a later generation fails', async () => {
    loadV19Runtime();
    simulateStageSevenAlreadyGenerated();
    await generateDerivative();
    expect(linkedInOutput().imageUrl).toBe(DERIVATIVE_IMAGE);

    globals().fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      return {
        ok: false,
        status: 502,
        json: async () => ({ stage: 'generating', error: 'Creative generation failed' })
      };
    });
    (globals().openGenStudioRequest as (i: number, mode: string) => void)(
      LINKEDIN_SLOT_INDEX,
      'modify'
    );
    await (
      globals().submitGenStudioAssetRequest as (i: number, mode: string) => Promise<void>
    )(LINKEDIN_SLOT_INDEX, 'modify');

    expect(runtimeState().assets[LINKEDIN_SLOT_INDEX].id).toBe(DERIVATIVE_ID);
    expect(linkedInOutput().assetId).toBe(DERIVATIVE_ID);
    expect(linkedInOutput().imageUrl).toBe(DERIVATIVE_IMAGE);
    expect(stageSevenLinkedInMarkup()).toContain(DERIVATIVE_IMAGE);
  });
});

describe('Stage 7 channel output actions', () => {
  it('offers only Edit and Accept output on the output card', () => {
    loadV19Runtime();
    selectAndAccept(LINKEDIN_SLOT_INDEX);

    for (const tab of ['linkedin', 'email'] as const) {
      const markup = stageSevenMarkup(tab);
      expect(outputCardActions(markup)).toEqual(['Edit', 'Accept output']);
      expect(packageFooterActions(markup)).toEqual(['Package details', 'Accept output package']);
    }
  });

  it('renders no Preview or collaborator-generation CTA in the Stage 7 markup', () => {
    loadV19Runtime();
    selectAndAccept(LINKEDIN_SLOT_INDEX);

    for (const tab of ['linkedin', 'email'] as const) {
      const markup = stageSevenMarkup(tab);
      expect(markup).not.toMatch(/>\s*Preview\s*</);
      expect(markup).not.toContain('Generate with collaborator comments');
      expect(markup).not.toContain('Generate with selected collaborator comments');
      expect(markup).not.toContain('previewOutput(');
      expect(markup).not.toContain('generateOutputFromComments(');
      // The CTAs are gone rather than disabled, so no button carries either label in any state.
      const labels = Array.from(parse(markup).querySelectorAll('button')).map((button) =>
        (button.textContent || '').trim()
      );
      expect(labels).not.toContain('Preview');
      expect(labels.filter((label) => /collaborator comments/i.test(label))).toEqual([]);
    }
  });

  it('still shows each channel creative and copy alongside the reduced actions', () => {
    loadV19Runtime();
    selectAndAccept(LINKEDIN_SLOT_INDEX);
    const original = String(globals().IPORTAL_CREATIVE || '');

    const linkedin = stageSevenMarkup('linkedin');
    expect(linkedin).toContain(original);
    expect(linkedin).toContain(runtimeState().outputs.linkedin.headline);

    const email = stageSevenMarkup('email');
    expect(email).toContain(runtimeState().outputs.email.headline);
    expect(email).toContain(runtimeState().outputs.email.cta);
  });

  it('keeps the generated creative visible after the CTA removal', async () => {
    loadV19Runtime();
    const slotIndex = await generateDerivative();
    selectAndAccept(slotIndex);

    const markup = stageSevenMarkup('linkedin');
    expect(markup).toContain(DERIVATIVE_IMAGE);
    expect(markup).toContain(DERIVATIVE_HEADLINE);
    expect(outputCardActions(markup)).toEqual(['Edit', 'Accept output']);
  });

  it('names no creative provider in the visible Stage 7 copy', () => {
    loadV19Runtime();
    selectAndAccept(LINKEDIN_SLOT_INDEX);

    for (const tab of ['linkedin', 'email'] as const) {
      expect(visibleText(stageSevenMarkup(tab))).not.toMatch(/Gemini|Firefly|GenStudio/i);
    }
  });

  it('renders Stage 7 without calling any provider endpoint', () => {
    loadV19Runtime();
    selectAndAccept(LINKEDIN_SLOT_INDEX);

    const fetchMock = vi.fn();
    globals().fetch = fetchMock;
    stageSevenMarkup('linkedin');
    stageSevenMarkup('email');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
