/**
 * Presentation regression tests for the Modify-in-GenStudio runtime bridge.
 * The bridge is a browser script, so it is evaluated here against stubbed V19 globals.
 * No Gemini or Firefly calls happen: fetch is mocked.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const BRIDGE_SOURCE = readFileSync(
  resolve(process.cwd(), 'public/runtime/v19-modify-firefly.js'),
  'utf8'
);

type AnyRecord = Record<string, unknown>;

const escape = (v: unknown) =>
  String(v).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c] as string
  );

function linkedInAsset(overrides: AnyRecord = {}): AnyRecord {
  return {
    id: 'DAM-0188',
    name: 'iPortal adoption hero',
    requirement: 'LinkedIn sponsored content — mobile crop',
    sourceType: 'Adobe DAM',
    channel: 'LinkedIn',
    format: 'Sponsored content · mobile crop',
    dimensions: '1080 × 1080',
    approval: 'Approved',
    rights: 'Client marketing',
    expiry: '2027-01-01',
    matchStatus: 'Reusable',
    confidence: 'High',
    matchReason: 'Approved iPortal creative.',
    found: true,
    included: false,
    commentsKey: 'dam-mobile',
    headline: 'Discover what is possible with iPortal',
    copy: 'Self-serve more of your day-to-day banking.',
    cta: 'Explore iPortal',
    previewType: 'social',
    ...overrides
  };
}

function baseAssets(): AnyRecord[] {
  return [
    linkedInAsset({
      id: 'DAM-0188',
      requirement: 'LinkedIn sponsored content — mobile',
      format: 'Sponsored content · mobile crop'
    }),
    linkedInAsset({
      id: 'REQ-LI-WEB',
      name: 'LinkedIn web creative',
      requirement: 'LinkedIn sponsored content — web',
      format: 'Sponsored content · web',
      dimensions: '1200 × 627',
      found: false,
      sourceType: 'Requirement',
      commentsKey: 'dam-linkedin-web'
    }),
    linkedInAsset({
      id: 'DAM-0231',
      name: 'Email activation banner',
      requirement: 'Email — Email activation banner',
      channel: 'Email',
      format: 'Email activation banner',
      dimensions: '1200 × 600',
      commentsKey: 'dam-email'
    })
  ];
}

function installGlobals(assets: AnyRecord[]) {
  const g = globalThis as unknown as AnyRecord;

  g.state = {
    campaignName: 'iPortal Digital Engagement',
    objective: 'Adoption',
    audience: ['Self-Service Opportunity'],
    channels: ['Email', 'LinkedIn'],
    assets,
    outputs: {},
    subAssetComments: {},
    assetTab: 0,
    damCriteriaOpen: false,
    damGeneratePhase: null,
    damGenerateError: null,
    damGeneratingId: null,
    generatingStage: null,
    savingStage: null
  };

  g.esc = escape;
  g.renderAll = () => {};
  g.toast = () => {};
  g.addActivity = () => {};
  g.closeModal = () => {};
  g.openGenStudioRequest = () => {};
  g.beginStageGeneration = () => {};
  g.beginAssetRegistration = () => {};
  g.acceptStageAsset = () => {};
  g.toggleAsset = (i: number) => {
    const state = g.state as { assets: AnyRecord[] };
    state.assets[i].included = !state.assets[i].included;
  };
  g.previewDamAsset = () => {};
  g.renderOutputPreview = () => '';
  g.submitGenStudioAssetRequest = () => {};
  g.setAssetTab = () => {};
  g.selectedCommentsForStage = () => 0;
  g.stageHeader = () => '<header></header>';
  g.assetIconForStage = () => '';
  g.renderAssetHeaderRight = () => '';
  g.renderDamCriteria = () => '';
  g.renderInlineOperation = () => '';
  g.externalStatusMarkup = () => '';
  g.teamsTypingDots = () => '';
  g.damPreview = (a: AnyRecord) =>
    `<div class="clean-creative asset-crop-right" style="background-image:url('${String(a.id)}')"></div>`;
  g.renderAssets = () => '';
  g.IPORTAL_CREATIVE = 'data:image/png;base64,IPORTALCREATIVEUNDERTEST';
  g.openExternalApprovalRequest = () => {};

  document.body.innerHTML = `
    <div id="modalRoot"></div>
    <input id="gsPrompt" value="Make the background darker and simplify the composition">
  `;

  new Function(BRIDGE_SOURCE)();
  return g;
}

function mockDerivativeResponse(id: string, overrides: AnyRecord = {}) {
  const channel = String(overrides.channel || 'LinkedIn');
  const format = String(overrides.format || 'Sponsored content · mobile crop');
  const dimensions = String(overrides.dimensions || '1080 × 1080');
  const intent = String(overrides.intent || 'modify_current_asset');
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (intent === 'update_copy_only') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          stage: 'ready',
          intent: 'update_copy_only',
          instruction: String(body.modification?.prompt || ''),
          confidence: 0.95,
          keepImage: true,
          contentUpdate: {
            headline: String(body.modification?.title || ''),
            copy: String(body.modification?.description || ''),
            cta: String(body.modification?.cta || '')
          }
        })
      };
    }
    const editSourceAssetId = String(body.editSourceAssetId || body.sourceDamAsset?.id || '');
    const rootSourceDamAssetId = String(body.rootSourceDamAssetId || editSourceAssetId);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        stage: 'ready',
        intent,
        instruction: String(body.modification?.prompt || ''),
        confidence: 0.92,
        derivedAsset: {
          id,
          sourceId: rootSourceDamAssetId,
          editSourceAssetId,
          derivedFromAssetId: editSourceAssetId,
          rootSourceDamAssetId,
          derived: true,
          generationSource: body.regenerate ? 'firefly' : 'gemini-image',
          channel,
          format,
          dimensions,
          requirement: channel + ' · AI-modified',
          name: 'iPortal adoption hero · Firefly derivative',
          headline: 'Modified headline for ' + id,
          copy: 'Modified description for ' + id,
          cta: 'Modified CTA',
          imageUrl: '/api/ai/generated/ff-test-' + id.toLowerCase(),
          matchStatus: 'AI-modified',
          confidence: 'Campaign-ready draft',
          matchReason: 'Gemini Creative Interpreter validated the requested change.',
          sourceType: body.regenerate ? 'Adobe Firefly' : 'Gemini',
          lineage:
            editSourceAssetId === rootSourceDamAssetId
              ? `Adobe DAM · ${rootSourceDamAssetId} → Gemini Creative Interpreter → Adobe Firefly`
              : `Adobe DAM · ${rootSourceDamAssetId} → Firefly derivative ${editSourceAssetId} → Gemini Creative Interpreter → Adobe Firefly`,
          jobId: 'FF-ADAPT-00001',
          creativeSpecification: {
            negativeSpace: 'right',
            channel,
            content: {
              title: 'Modified headline for ' + id,
              description: 'Modified description for ' + id,
              cta: 'Modified CTA'
            },
            requestedChange: 'Make the background darker and simplify the composition'
          },
          version: 1,
          ...overrides
        },
        interpretation: { visualReference: null }
      })
    };
  });
  (globalThis as unknown as AnyRecord).fetch = fetchMock;
  return fetchMock;
}

function mockFailedModify(stage: 'interpreting' | 'generating' = 'generating') {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    return {
      ok: false,
      status: 502,
      json: async () => ({ stage, error: 'Creative generation failed' })
    };
  });
  (globalThis as unknown as AnyRecord).fetch = fetchMock;
  return fetchMock;
}

function renderAssetDom(g: AnyRecord): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = (g.renderAssets as () => string)();
  return root;
}

function assets(g: AnyRecord): AnyRecord[] {
  return (g.state as { assets: AnyRecord[] }).assets;
}

function assetIndex(g: AnyRecord, id: string): number {
  return assets(g).findIndex((asset) => asset.id === id);
}

function modify(g: AnyRecord, index: number): Promise<void> {
  return (g.submitGenStudioAssetRequest as (i: number, m: string) => Promise<void>)(
    index,
    'modify'
  );
}

function requestBody(
  fetchMock: ReturnType<typeof mockDerivativeResponse>,
  callIndex = 0
): AnyRecord {
  const init = fetchMock.mock.calls[callIndex]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body));
}

describe('generated assets replace the current asset in place', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps exactly three format tabs after generating a derivative', async () => {
    const g = installGlobals(baseAssets());
    mockDerivativeResponse('FF-DER-ABC1234567');

    await modify(g, 0);

    const root = renderAssetDom(g);
    const tabs = [...root.querySelectorAll('.v19-parent-asset-tabs > .v17-tab')].map(
      (node) => node.textContent
    );
    expect(tabs).toEqual([
      'LinkedIn · mobile',
      'LinkedIn · web',
      'Email · Email activation banner'
    ]);
    expect(assets(g)).toHaveLength(3);
    expect(root.querySelector('.v19-parent-asset-tabs .active')?.textContent).toBe(
      'LinkedIn · mobile'
    );
  });

  it('renders no Original / AI-modified candidate selector', async () => {
    const g = installGlobals(baseAssets());
    mockDerivativeResponse('FF-DER-ABC1234567');
    await modify(g, 0);
    mockDerivativeResponse('FF-DER-DEF7654321');
    await modify(g, 0);

    const root = renderAssetDom(g);
    expect(root.querySelectorAll('.v19-candidate-tabs')).toHaveLength(0);
    expect(root.textContent).not.toContain('AI-modified 2');
    expect(
      [...root.querySelectorAll('button')].map((node) => node.textContent)
    ).not.toContain('Original');
    expect((g as AnyRecord).setAssetCandidate).toBeUndefined();
  });

  it('drops the Recommendation block for generated assets but keeps it for DAM matches', async () => {
    const g = installGlobals(baseAssets());
    expect(renderAssetDom(g).querySelectorAll('.v17-recommendation')).toHaveLength(1);

    mockDerivativeResponse('FF-DER-ABC1234567');
    await modify(g, 0);

    const root = renderAssetDom(g);
    expect(root.querySelectorAll('.v17-recommendation')).toHaveLength(0);
    expect(root.textContent).not.toContain('Recommendation:');
    expect(root.textContent).not.toContain('Gemini Creative Interpreter validated');
  });

  it('replaces the LinkedIn mobile creative in place and leaves web and email alone', async () => {
    const g = installGlobals(baseAssets());
    mockDerivativeResponse('FF-DER-ABC1234567');

    await modify(g, 0);

    const [mobile, web, email] = assets(g);
    expect(mobile.id).toBe('FF-DER-ABC1234567');
    expect(mobile.imageUrl).toBe('/api/ai/generated/ff-test-ff-der-abc1234567');
    // Visual-only Modify keeps campaign copy unchanged on the slot.
    expect(mobile.headline).toBe('Discover what is possible with iPortal');
    expect(mobile.copy).toBe('Self-serve more of your day-to-day banking.');
    expect(mobile.cta).toBe('Explore iPortal');
    // The slot keeps its channel/format identity, so the tab label never changes.
    expect(mobile.requirement).toBe('LinkedIn sponsored content — mobile');
    expect(mobile.format).toBe('Sponsored content · mobile crop');
    expect(mobile.commentsKey).toBe('dam-mobile');

    expect(web.id).toBe('REQ-LI-WEB');
    expect(web.imageUrl).toBeUndefined();
    expect(email.id).toBe('DAM-0231');
    expect(email.imageUrl).toBeUndefined();

    const root = renderAssetDom(g);
    expect(root.querySelector('h3')?.textContent).toBe('LinkedIn sponsored content — mobile');
    expect(root.querySelector('.v17-asset-preview')?.innerHTML).toContain(
      '/api/ai/generated/ff-test-ff-der-abc1234567'
    );
  });

  it('replaces email and web slots only within their own format', async () => {
    const g = installGlobals(baseAssets());

    mockDerivativeResponse('FF-DER-WEB0000001', {
      format: 'Sponsored content · web',
      dimensions: '1200 × 627'
    });
    await modify(g, assetIndex(g, 'REQ-LI-WEB'));

    mockDerivativeResponse('FF-DER-EMAIL00001', {
      channel: 'Email',
      format: 'Email activation banner',
      dimensions: '1200 × 600'
    });
    await modify(g, assetIndex(g, 'DAM-0231'));

    const [mobile, web, email] = assets(g);
    expect(mobile.id).toBe('DAM-0188');
    expect(web.id).toBe('FF-DER-WEB0000001');
    expect(web.rootSourceDamAssetId).toBe('REQ-LI-WEB');
    expect(web.requirement).toBe('LinkedIn sponsored content — web');
    expect(email.id).toBe('FF-DER-EMAIL00001');
    expect(email.rootSourceDamAssetId).toBe('DAM-0231');
    expect(email.requirement).toBe('Email — Email activation banner');

    const tabs = [...renderAssetDom(g).querySelectorAll('.v19-parent-asset-tabs > .v17-tab')].map(
      (node) => node.textContent
    );
    expect(tabs).toEqual([
      'LinkedIn · mobile',
      'LinkedIn · web',
      'Email · Email activation banner'
    ]);
  });

  it('modifies the generated image again and keeps only the newest derivative visible', async () => {
    const g = installGlobals(baseAssets());
    mockDerivativeResponse('FF-DER-CHAIN-001');
    await modify(g, 0);

    const second = mockDerivativeResponse('FF-DER-CHAIN-002');
    await modify(g, 0);

    const body = requestBody(second);
    // Second edit uses the previous derivative — and its generated bytes — as the edit source.
    expect(body.editSourceAssetId).toBe('FF-DER-CHAIN-001');
    expect(body.rootSourceDamAssetId).toBe('DAM-0188');
    expect((body.sourceDamAsset as AnyRecord).id).toBe('FF-DER-CHAIN-001');
    expect((body.sourceDamAsset as AnyRecord).imageUrl).toBe(
      '/api/ai/generated/ff-test-ff-der-chain-001'
    );

    const mobile = assets(g)[0];
    expect(assets(g)).toHaveLength(3);
    expect(mobile.id).toBe('FF-DER-CHAIN-002');
    expect(mobile.imageUrl).toBe('/api/ai/generated/ff-test-ff-der-chain-002');
    expect(mobile.editSourceAssetId).toBe('FF-DER-CHAIN-001');
    expect(mobile.derivedFromAssetId).toBe('FF-DER-CHAIN-001');
    expect(mobile.rootSourceDamAssetId).toBe('DAM-0188');
    expect(mobile.sourceAssetId).toBe('DAM-0188');
    expect(mobile.lineage).toContain('DAM-0188');
    expect(mobile.lineage).toContain('FF-DER-CHAIN-001');
  });

  it('sends the original DAM creative as the edit source for the first modification', async () => {
    const g = installGlobals(baseAssets());
    const fetchMock = mockDerivativeResponse('FF-DER-FROM-ORIG');
    await modify(g, 0);

    const body = requestBody(fetchMock);
    expect(body.regenerate).toBe(false);
    expect(body.editSourceAssetId).toBe('DAM-0188');
    expect(body.rootSourceDamAssetId).toBe('DAM-0188');
    expect((body.sourceDamAsset as AnyRecord).imageUrl).toBe(
      'data:image/png;base64,IPORTALCREATIVEUNDERTEST'
    );
    expect(body.regenerate).toBe(false);
  });

  it('rejects empty modification instructions and does not offer copy-only editing', async () => {
    const g = installGlobals(baseAssets());
    const toasts: string[] = [];
    g.toast = (message: string) => {
      toasts.push(message);
    };
    const fetchMock = mockDerivativeResponse('FF-UNUSED', { intent: 'update_copy_only' });
    (document.getElementById('gsPrompt') as HTMLInputElement).value = '';

    await modify(g, 0);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(assets(g)[0].id).toBe('DAM-0188');
    expect(assets(g)[0].imageUrl).toBeUndefined();
    expect(assets(g)[0].cta).toBe('Explore iPortal');
    expect(toasts).toContain('Enter modification instructions');
  });

  it('shows unsupported image editing without provider branding and leaves the asset unchanged', async () => {
    const g = installGlobals(baseAssets());
    const toasts: string[] = [];
    g.toast = (message: string) => {
      toasts.push(message);
    };
    (globalThis as unknown as AnyRecord).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        stage: 'unsupported',
        intent: 'modify_current_asset',
        message:
          'Gemini image editing is not configured. Set GEMINI_IMAGE_API_KEY and GEMINI_IMAGE_MODEL. The current asset was left unchanged.'
      })
    }));
    (document.getElementById('gsPrompt') as HTMLInputElement).value =
      'Remove all text from this image.';

    await modify(g, 0);

    expect(assets(g)[0].id).toBe('DAM-0188');
    expect(assets(g)[0].derived).toBeUndefined();
    expect(toasts.some((message) => /not configured/i.test(message))).toBe(true);
  });

  it('keeps the current asset when channel adaptation cannot preserve the composition', async () => {
    const g = installGlobals(baseAssets());
    const toasts: string[] = [];
    g.toast = (message: string) => {
      toasts.push(message);
    };
    (globalThis as unknown as AnyRecord).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        stage: 'unsupported',
        intent: 'modify_current_asset',
        message:
          'Channel format adaptation could not preserve the creative composition. The current asset was left unchanged.'
      })
    }));
    (document.getElementById('gsPrompt') as HTMLInputElement).value =
      'Remove all text from this image.';

    await modify(g, 0);

    expect(assets(g)[0].id).toBe('DAM-0188');
    expect(assets(g)[0].derived).toBeUndefined();
    expect(assets(g)[0].imageUrl).toBeUndefined();
    expect(
      toasts.some((message) =>
        /could not preserve the creative composition/i.test(message)
      )
    ).toBe(true);
  });

  it('shows a temporary timeout message and leaves the current asset unchanged', async () => {
    const g = installGlobals(baseAssets());
    const toasts: string[] = [];
    g.toast = (message: string) => {
      toasts.push(message);
    };
    (globalThis as unknown as AnyRecord).fetch = vi.fn(async () => ({
      ok: false,
      status: 504,
      json: async () => ({
        stage: 'generating',
        error: 'Gemini image edit timed out'
      })
    }));
    (document.getElementById('gsPrompt') as HTMLInputElement).value =
      'Remove all text from this image.';

    await modify(g, 0);

    expect(assets(g)[0].id).toBe('DAM-0188');
    expect(assets(g)[0].derived).toBeUndefined();
    expect(assets(g)[0].imageUrl).toBeUndefined();
    expect(toasts).toContain('Image editing timed out. The current asset was left unchanged.');
    // Temporary toast only — no permanent warning card on the asset.
    expect((g.renderAssets as () => string)()).not.toMatch(/timed out/i);
  });

  it('labels the modify action "Modify asset" with no GenStudio wording on visible buttons', async () => {
    const g = installGlobals(baseAssets());
    mockDerivativeResponse('FF-DER-LABEL0001');
    await modify(g, 0);

    const html = (g.renderAssets as () => string)();
    expect(html).toContain('>Modify asset</button>');
    expect(html).not.toContain('Modify in GenStudio');
  });

  it('keeps the root DAM asset available internally after replacement', async () => {
    const g = installGlobals(baseAssets());
    mockDerivativeResponse('FF-DER-PROV-0001');
    await modify(g, 0);
    mockDerivativeResponse('FF-DER-PROV-0002');
    await modify(g, 0);

    const mobile = assets(g)[0];
    const snapshot = mobile.rootAssetSnapshot as AnyRecord;
    expect(snapshot.id).toBe('DAM-0188');
    expect(snapshot.sourceType).toBe('Adobe DAM');
    expect(snapshot.matchStatus).toBe('Reusable');
    expect(snapshot.imageUrl).toBeUndefined();
    expect((mobile.derivativeHistory as AnyRecord[]).map((entry) => entry.id)).toEqual([
      'FF-DER-PROV-0001',
      'FF-DER-PROV-0002'
    ]);
    expect(renderAssetDom(g).textContent).toContain('DAM-0188');
  });

  it('leaves the current asset untouched when generation fails', async () => {
    const g = installGlobals(baseAssets());
    mockDerivativeResponse('FF-DER-GOOD-0001');
    await modify(g, 0);

    const before = { ...assets(g)[0] };
    mockFailedModify('generating');
    await modify(g, 0);

    const after = assets(g)[0];
    expect(assets(g)).toHaveLength(3);
    expect(after.id).toBe(before.id);
    expect(after.imageUrl).toBe(before.imageUrl);
    expect(after.headline).toBe(before.headline);
    expect(after.copy).toBe(before.copy);
    expect(after.cta).toBe(before.cta);
    expect(renderAssetDom(g).querySelector('.v17-asset-preview')?.innerHTML).toContain(
      String(before.imageUrl)
    );
  });

  it('does not replace the current asset when no generated image was persisted', async () => {
    const g = installGlobals(baseAssets());
    (globalThis as unknown as AnyRecord).fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          stage: 'ready',
          intent: 'modify_current_asset',
          derivedAsset: { id: 'FF-DER-NOIMAGE01', headline: 'x' },
          interpretation: {}
        })
      };
    });

    await modify(g, 0);

    expect(assets(g)[0].id).toBe('DAM-0188');
    expect(assets(g)[0].imageUrl).toBeUndefined();
    expect(assets(g)[0].derived).toBeUndefined();
  });

  it('selects the current derivative for the campaign, not the root DAM asset', async () => {
    const g = installGlobals(baseAssets());
    mockDerivativeResponse('FF-DER-SELECT0001');
    await modify(g, 0);

    (g.toggleAsset as (i: number) => void)(0);

    const selected = assets(g).filter((asset) => asset.included);
    expect(selected.map((asset) => asset.id)).toEqual(['FF-DER-SELECT0001']);
    expect(selected[0].rootSourceDamAssetId).toBe('DAM-0188');
    const html = (g.renderAssets as () => string)();
    expect(html).toContain('onchange="toggleAsset(0)"');
  });

  it('keeps a campaign selection made before the modification', async () => {
    const g = installGlobals(baseAssets());
    (g.toggleAsset as (i: number) => void)(0);
    mockDerivativeResponse('FF-DER-KEEPSEL001');
    await modify(g, 0);

    const selected = assets(g).filter((asset) => asset.included);
    expect(selected.map((asset) => asset.id)).toEqual(['FF-DER-KEEPSEL001']);
  });

  it('offers Modify and Regenerate as different actions for the generated asset', async () => {
    const g = installGlobals(baseAssets());
    mockDerivativeResponse('FF-DER-MODREG-001');
    await modify(g, 0);

    const html = (g.renderAssets as () => string)();
    expect(html).toContain("openGenStudioRequest(0,'modify')");
    expect(html).toContain('regenerateFireflyDerivative(0)');
  });

  it('opens a prompt-only Modify asset modal with no preview or campaign-copy fields', () => {
    const g = installGlobals(baseAssets());
    (g.openGenStudioRequest as (i: number, mode: string) => void)(0, 'modify');

    const modal = document.getElementById('modalRoot')!;
    expect(modal.querySelectorAll('textarea')).toHaveLength(1);
    expect(modal.querySelectorAll('input')).toHaveLength(0);
    expect(modal.querySelector('img')).toBeNull();
    expect(modal.querySelector('.genstudio-source-preview')).toBeNull();
    expect(modal.querySelector('.genstudio-context')).toBeNull();
    expect(modal.textContent).toContain('Modify asset');
    expect(modal.textContent).toContain(
      'Describe the visual changes you want to make to the current asset.'
    );
    expect(modal.textContent).toContain('MODIFICATION INSTRUCTIONS');
    expect(modal.textContent).toContain('Apply changes');
    expect(modal.textContent).toContain('Cancel');
    expect(modal.textContent).not.toMatch(/\bTitle\b|\bDescription\b|\bCTA\b/);
    expect(modal.textContent).not.toMatch(/Gemini|Firefly|GenStudio/i);
    expect((document.getElementById('gsPrompt') as HTMLTextAreaElement).placeholder).toBe(
      'Describe the changes you want to make to the current asset.'
    );
  });

  it('sends current-slot campaign copy with the Modify request and keeps it unchanged after success', async () => {
    const g = installGlobals(baseAssets());
    assets(g)[0].headline = 'Keep this title';
    assets(g)[0].copy = 'Keep this description';
    assets(g)[0].cta = 'Keep this CTA';
    const fetchMock = mockDerivativeResponse('FF-DER-COPYKEEP01');
    await modify(g, 0);

    const body = requestBody(fetchMock);
    expect((body.modification as AnyRecord).title).toBe('Keep this title');
    expect((body.modification as AnyRecord).description).toBe('Keep this description');
    expect((body.modification as AnyRecord).cta).toBe('Keep this CTA');
    expect((body.modification as AnyRecord).prompt).toBe(
      'Make the background darker and simplify the composition'
    );
    expect(assets(g)[0].headline).toBe('Keep this title');
    expect(assets(g)[0].copy).toBe('Keep this description');
    expect(assets(g)[0].cta).toBe('Keep this CTA');
  });

  it('removes Preview, threaded comments, search evidence and collaborator generation from the asset workflow', async () => {
    const g = installGlobals(baseAssets());
    mockDerivativeResponse('FF-DER-CLEANUI001');
    await modify(g, 0);

    const root = renderAssetDom(g);
    const html = root.innerHTML;
    const visible = root.textContent || '';
    expect(html).toContain('>Modify asset</button>');
    expect(html).toContain('>Regenerate creative</button>');
    expect(html).toContain('>Send for agency approval</button>');
    expect(html).toContain('Select for campaign');
    expect(html).toContain('>Accept selected assets</button>');
    expect(html).not.toContain('>Preview</button>');
    expect(visible).not.toMatch(/Threaded comments/i);
    expect(visible).not.toMatch(/View search evidence|Adobe DAM search criteria/i);
    expect(visible).not.toMatch(/Generate with collaborator comments/i);
    expect(visible).not.toMatch(/Create in GenStudio|Modify in GenStudio/i);
    // Visible copy only — onclick handler names may still contain internal identifiers.
    expect(visible).not.toMatch(/Gemini|Firefly|GenStudio/i);
  });

  it('opens a prompt-only Regenerate creative modal', () => {
    const g = installGlobals(baseAssets());
    (g.regenerateFireflyDerivative as (i: number) => void)(0);

    const modal = document.getElementById('modalRoot')!;
    expect(modal.querySelectorAll('textarea')).toHaveLength(1);
    expect(modal.querySelectorAll('input')).toHaveLength(0);
    expect(modal.querySelector('img')).toBeNull();
    expect(modal.querySelector('.genstudio-source-preview')).toBeNull();
    expect(modal.textContent).toContain('Regenerate creative');
    expect(modal.textContent).toContain(
      'Describe the new visual you want to create for this channel.'
    );
    expect(modal.textContent).toContain('GENERATION PROMPT');
    expect(modal.textContent).toContain('Generate creative');
    expect(modal.textContent).not.toMatch(/Firefly|Gemini|GenStudio/i);
    expect(modal.textContent).not.toMatch(/Title|Description|CTA/i);
    expect(
      (document.getElementById('fireflyGenerationPrompt') as HTMLTextAreaElement).placeholder
    ).toBe('Describe the new visual you want to generate.');
  });

  it('regenerates against the current derivative and replaces it in place', async () => {
    const g = installGlobals(baseAssets());
    mockDerivativeResponse('FF-DER-REGEN00001');
    await modify(g, 0);

    const regenMock = mockDerivativeResponse('FF-DER-REGEN00002');
    (g.regenerateFireflyDerivative as (i: number) => void)(0);
    const prompt = document.getElementById('fireflyGenerationPrompt') as HTMLTextAreaElement;
    prompt.value = 'Create a new premium corporate visual with clean space on the left.';
    await (g.submitFireflyRegeneration as (i: number) => Promise<void>)(0);

    const body = requestBody(regenMock);
    expect(body.regenerate).toBe(true);
    expect(body.generationPrompt).toBe(
      'Create a new premium corporate visual with clean space on the left.'
    );
    expect((body.modification as AnyRecord).prompt).toBe('');
    expect(body.editSourceAssetId).toBe('FF-DER-REGEN00001');
    expect(body.rootSourceDamAssetId).toBe('DAM-0188');
    expect(assets(g)).toHaveLength(3);
    expect(assets(g)[0].id).toBe('FF-DER-REGEN00002');
  });

  it('renders the generated creative in the full preview slot with a cover crop', () => {
    const g = installGlobals([linkedInAsset()]);
    const markup = (g.damPreview as (a: AnyRecord) => string)({
      derived: true,
      generationSource: 'firefly',
      imageUrl: '/api/ai/generated/ff-test',
      dimensions: '1080 × 1080',
      headline: 'Discover what is possible with iPortal',
      creativeSpecification: { negativeSpace: 'right' }
    });

    expect(markup).toContain('class="clean-creative asset-crop-full"');
    expect(markup).toContain('background-size:cover');
    expect(markup).toContain('background-position:right center');
    expect(markup).toContain('background-repeat:no-repeat');
    expect(markup).not.toContain('dam-thumb');
    expect(markup).not.toContain('1080');
  });

  it('previews a server-adapted creative centred, ignoring negative space', () => {
    const g = installGlobals([linkedInAsset()]);
    const markup = (g.damPreview as (a: AnyRecord) => string)({
      derived: true,
      generationSource: 'gemini-image',
      formatAdaptation: 'cover-crop',
      imageUrl: '/api/ai/generated/gm-test',
      dimensions: '1080 × 1080',
      creativeSpecification: { negativeSpace: 'right' }
    });

    expect(markup).toContain('background-position:center;');
    expect(markup).not.toContain('right center');
  });

  it('keeps the slot heading stable and shows provider-neutral provenance in asset details', async () => {
    const g = installGlobals(baseAssets());
    mockDerivativeResponse('FF-DER-ABC1234567');
    await modify(g, 0);

    assets(g)[0].sourceDimensions = '2048 × 2048';

    const html = (g.renderAssets as () => string)();
    const visible = renderAssetDom(g).textContent || '';
    expect(html).toContain('<h3>LinkedIn sponsored content — mobile</h3>');
    expect(html).not.toContain('<h3>LinkedIn · AI-modified</h3>');
    expect(html).toContain('AI-modified');
    expect(html).toContain('AI-assisted');
    expect(html).toContain(
      '<label>Target format</label><span>Sponsored content · mobile crop · 1080 × 1080</span>'
    );
    expect(html).toContain('<label>Source</label><span>AI-assisted · 2048 × 2048</span>');
    expect(html).toContain('<label>Original DAM asset</label><span>DAM-0188</span>');
    expect(visible).not.toMatch(/Gemini|Firefly|GenStudio/i);
  });

  it('labels the raw provider output as Source and the crop as Final asset without provider names', async () => {
    const g = installGlobals(baseAssets());
    mockDerivativeResponse('GM-DER-ADAPTED01', {
      sourceImageDimensions: '1360 × 768',
      sourceImageUrl: '/api/ai/generated/gm-raw-source',
      sourceImageId: 'gm-raw-source',
      targetDimensions: '1080 × 1080',
      finalImageDimensions: '1080 × 1080',
      formatAdaptation: 'cover-crop',
      lineage:
        'Adobe DAM · DAM-0188 → Gemini image edit (1360 × 768) → channel crop/format adaptation (1080 × 1080)'
    });
    await modify(g, 0);

    const slot = assets(g)[0]!;
    // The adapted crop is never presented as the source image.
    expect(slot.sourceDimensions).toBe('1360 × 768');
    expect(slot.finalImageDimensions).toBe('1080 × 1080');
    // Internal lineage still retains the real provider string.
    expect(slot.lineage).toMatch(/Gemini image edit/);

    const html = (g.renderAssets as () => string)();
    const visible = renderAssetDom(g).textContent || '';
    expect(html).toContain('<label>Source</label><span>AI-assisted · 1360 × 768</span>');
    expect(html).toContain('<label>Final asset</label><span>1080 × 1080</span>');
    expect(html).toContain('AI-assisted modification');
    expect(html).toContain('channel format adaptation');
    expect(visible).not.toMatch(/Gemini|Firefly|GenStudio/i);
  });
});
