/**
 * Regenerate creative (Firefly) runtime tests.
 *
 * The prompt-only modal no longer collects Title / Description / CTA, so these tests drive the
 * real V19 runtime chain and then hand the captured payload to the real server entry point with a
 * stubbed Firefly client. No Gemini or Firefly call is made.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { V19_MARKUP } from './v19Markup';
import { V19_SCRIPTS } from './scriptManifest';
import { modifyAsset } from '../../server/ai/modify/modifyAsset';
import type { FireflyClient } from '../../server/ai/firefly/types';
import type { GeminiJsonClient } from '../../server/ai/gemini/types';

type AnyRecord = Record<string, unknown>;
type AssetRecord = AnyRecord & {
  id: string;
  channel?: string;
  headline?: string;
  copy?: string;
  cta?: string;
  imageUrl?: string;
  derived?: boolean;
};
type RuntimeState = { assets: AssetRecord[]; assetTab: number };

const GENERATED_ID = 'FF-REGEN-1234567890';
const GENERATED_IMAGE = '/api/ai/generated/ff-regenerate-test';
const PROMPT = 'Create a premium abstract corporate banking visual with open negative space.';

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
  globals().IPORTAL_CREATIVE = '/assets/iportal-creative-single.png';
}

function runtimeState(): RuntimeState {
  return globals().state as unknown as RuntimeState;
}

function assetIndex(id: string): number {
  return runtimeState().assets.findIndex((a) => a.id === id);
}

/** DAM-0188 and REQ-LI-WEB both carry campaign copy on the shipped records. */
const SLOT_WITH_COPY = 'DAM-0188';
const SLOT_WITHOUT_COPY = 'REQ-LI-WEB';

function openRegenerateModal(id: string): number {
  const index = assetIndex(id);
  expect(index).toBeGreaterThanOrEqual(0);
  (globals().regenerateFireflyDerivative as (i: number) => void)(index);
  return index;
}

function modalRoot(): HTMLElement {
  return document.getElementById('modalRoot') as HTMLElement;
}

function typePrompt(text: string) {
  const textarea = modalRoot().querySelector('textarea') as HTMLTextAreaElement;
  textarea.value = text;
}

function successResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      stage: 'ready',
      intent: 'regenerate_with_firefly',
      instruction: PROMPT,
      derivedAsset: {
        id: GENERATED_ID,
        sourceId: 'DAM-0188',
        derived: true,
        generationSource: 'firefly',
        channel: 'LinkedIn',
        format: 'Sponsored content · web',
        dimensions: '1200 × 627',
        requirement: 'LinkedIn · AI-generated',
        name: 'Regenerated creative',
        headline: 'A step change in how you bank',
        copy: 'One connected digital front door.',
        cta: 'Learn more',
        imageUrl: GENERATED_IMAGE,
        matchStatus: 'AI-generated',
        confidence: 'Campaign-ready draft',
        jobId: 'FF-TEST-1',
        version: 1
      }
    })
  };
}

/** Runs the modal → submit flow and returns the captured request body. */
async function submitRegeneration(
  id: string,
  response: () => unknown = successResponse
): Promise<{ index: number; body: AnyRecord; fetchMock: ReturnType<typeof vi.fn> }> {
  const index = openRegenerateModal(id);
  typePrompt(PROMPT);

  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    void _input;
    void init;
    return response();
  });
  globals().fetch = fetchMock;

  await (globals().submitFireflyRegeneration as (i: number) => Promise<void>)(index);

  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  const body = init?.body ? (JSON.parse(String(init.body)) as AnyRecord) : {};
  return { index, body, fetchMock };
}

afterEach(() => {
  vi.restoreAllMocks();
  globals().renderAll = () => {};
  globals().renderTeams = () => {};
  globals().toast = () => {};
  document.body.innerHTML = '';
});

describe('Regenerate creative modal', () => {
  it('renders a prompt-only modal with exactly one textarea', () => {
    loadV19Runtime();
    openRegenerateModal(SLOT_WITH_COPY);

    const root = modalRoot();
    expect(root.textContent).toContain('Add new creative');
    expect(root.querySelectorAll('textarea').length).toBe(1);
    expect(root.querySelector('#outHeadline')).toBeNull();
    expect(root.querySelector('#outBody')).toBeNull();
    expect(root.querySelector('#outCta')).toBeNull();
    expect(root.querySelectorAll('input').length).toBe(0);
    expect(root.textContent).not.toMatch(/Gemini|Firefly|GenStudio/i);
  });

  it('does not submit an empty prompt', async () => {
    loadV19Runtime();
    const index = openRegenerateModal(SLOT_WITH_COPY);
    typePrompt('   ');
    const fetchMock = vi.fn();
    globals().fetch = fetchMock;

    await (globals().submitFireflyRegeneration as (i: number) => Promise<void>)(index);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Regenerate creative request', () => {
  it('sends the typed prompt and the current slot identity', async () => {
    loadV19Runtime();
    const { body } = await submitRegeneration(SLOT_WITH_COPY);

    expect(body.regenerate).toBe(true);
    expect(body.mode).toBe('modify');
    expect(String(body.generationPrompt)).toBe(PROMPT);
    expect(String(body.generationPrompt).trim().length).toBeGreaterThan(0);

    const asset = body.asset as AnyRecord;
    expect(asset.id).toBe(SLOT_WITH_COPY);
    expect(asset.channel).toBe('LinkedIn');
    expect(asset.dimensions).toBeTruthy();
    expect(body.editSourceAssetId).toBe(SLOT_WITH_COPY);
    expect(body.rootSourceDamAssetId).toBe(SLOT_WITH_COPY);
    expect((body.sourceDamAsset as AnyRecord).id).toBe(SLOT_WITH_COPY);
  });

  it('supplies campaign content for a slot that has no copy of its own', async () => {
    loadV19Runtime();
    const { body } = await submitRegeneration(SLOT_WITHOUT_COPY);

    // The modal no longer collects these, so they must be resolved from campaign state.
    const modification = body.modification as AnyRecord;
    expect(String(modification.title).trim().length).toBeGreaterThan(0);
    expect(String(modification.description).trim().length).toBeGreaterThan(0);
    expect(String(modification.cta).trim().length).toBeGreaterThan(0);
    // The Modify instruction is never reused by a regeneration.
    expect(modification.prompt).toBe('');
  });
});

describe('Regenerate creative outcome', () => {
  it('upserts Generated under the current slot on success without replacing Original', async () => {
    loadV19Runtime();
    const before = runtimeState().assets.map((a) => a.id);
    const { index } = await submitRegeneration(SLOT_WITHOUT_COPY);

    const slot = runtimeState().assets[index];
    expect(slot.id).toBe(before[index]);
    expect(slot.selectedCandidateKind).toBe('generated');
    expect((slot.generatedCandidate as AnyRecord).id).toBe(GENERATED_ID);
    expect((slot.generatedCandidate as AnyRecord).imageUrl).toBe(GENERATED_IMAGE);
    expect((slot.generatedCandidate as AnyRecord).derived).toBe(true);

    const after = runtimeState().assets.map((a) => a.id);
    expect(after.length).toBe(before.length);
    before.forEach((id, i) => {
      expect(after[i]).toBe(id);
    });
  });

  it('leaves the slot unchanged when the server rejects the request', async () => {
    loadV19Runtime();
    const index = assetIndex(SLOT_WITH_COPY);
    const original = { ...runtimeState().assets[index] };

    await submitRegeneration(SLOT_WITH_COPY, () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Creative generation failed', stage: 'generating' })
    }));

    const slot = runtimeState().assets[index];
    expect(slot.id).toBe(original.id);
    expect(slot.headline).toBe(original.headline);
    expect(slot.imageUrl).toBe(original.imageUrl);
  });

  it('never calls the Modify (Gemini) submit path', async () => {
    loadV19Runtime();
    const modifySpy = vi.fn();
    globals().submitGenStudioAssetRequest = modifySpy;

    await submitRegeneration(SLOT_WITH_COPY);
    expect(modifySpy).not.toHaveBeenCalled();
  });
});

describe('Regenerate creative server contract', () => {
  function stubFirefly(): FireflyClient & { generateImage: ReturnType<typeof vi.fn> } {
    return {
      generateImage: vi.fn(async () => ({
        images: [{ id: 'ff-contract', imageUrl: '/api/ai/generated/ff-contract' }],
        jobId: 'FF-CONTRACT'
      }))
    };
  }

  function unusedGemini(): GeminiJsonClient & { generateJson: ReturnType<typeof vi.fn> } {
    return { generateJson: vi.fn(), editImage: vi.fn() } as never;
  }

  for (const slot of [SLOT_WITH_COPY, SLOT_WITHOUT_COPY]) {
    it(`is accepted by the server and reaches the Firefly branch for ${slot}`, async () => {
      loadV19Runtime();
      const { body } = await submitRegeneration(slot);

      const firefly = stubFirefly();
      const gemini = unusedGemini();
      const result = await modifyAsset(body, { firefly, gemini });

      expect(result.stage).toBe('ready');
      expect(result.intent).toBe('regenerate_with_firefly');
      expect(result.instruction).toBe(PROMPT);
      expect(firefly.generateImage).toHaveBeenCalledTimes(1);
      // Regeneration must never take the Gemini image-edit path.
      expect(gemini.generateJson).not.toHaveBeenCalled();
      expect(result.derivedAsset?.imageUrl).toBeTruthy();
      expect(result.derivedAsset?.headline?.trim()).toBeTruthy();
      expect(result.derivedAsset?.cta?.trim()).toBeTruthy();
    });
  }
});
