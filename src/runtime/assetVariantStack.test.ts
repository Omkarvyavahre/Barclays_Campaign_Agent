/**
 * Asset variant stack: Original / Modified / Generated per channel slot.
 * Mocked Modify + Regenerate only — no provider calls.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const BRIDGE_SOURCE = readFileSync(
  resolve(process.cwd(), 'public/runtime/v19-modify-firefly.js'),
  'utf8'
);

type AnyRecord = Record<string, unknown>;

const MOBILE_SOURCE = '/assets/iportal-creative-linkedin-mobile.png';
const WEB_SOURCE = '/assets/iportal-creative-linkedin-web.png';
const EMAIL_SOURCE = '/assets/iportal-creative-single.png';

function esc(v: unknown) {
  return String(v).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c] as string
  );
}

function slot(overrides: AnyRecord = {}): AnyRecord {
  return {
    id: 'DAM-0188',
    name: 'iPortal mobile',
    requirement: 'LinkedIn sponsored content — mobile',
    sourceType: 'Adobe DAM',
    channel: 'LinkedIn',
    format: 'Sponsored content · mobile crop',
    dimensions: '1080 × 1080',
    approval: 'Approved',
    rights: 'UK paid social',
    expiry: '2027-01-01',
    matchStatus: 'Adaptation recommended',
    confidence: '81%',
    matchReason: 'Needs crop adaptation.',
    found: true,
    included: false,
    commentsKey: 'dam-mobile',
    headline: 'A step change in how you bank with Barclays',
    copy: 'Discover more ways to use iPortal.',
    cta: 'Learn more',
    imageUrl: MOBILE_SOURCE,
    ...overrides
  };
}

function baseAssets(): AnyRecord[] {
  return [
    slot(),
    slot({
      id: 'REQ-LI-WEB',
      requirement: 'LinkedIn sponsored content — web',
      format: 'Sponsored content · web',
      dimensions: '1200 × 627',
      commentsKey: 'dam-web',
      imageUrl: WEB_SOURCE
    }),
    slot({
      id: 'DAM-0231',
      requirement: 'Email activation banner',
      channel: 'Email',
      format: 'HTML email hero',
      dimensions: '1200 × 480',
      commentsKey: 'dam-email',
      imageUrl: EMAIL_SOURCE
    })
  ];
}

function install(assets = baseAssets()) {
  const g = globalThis as unknown as AnyRecord;
  g.state = {
    campaignName: 'iPortal',
    objective: 'Adoption',
    audience: ['Digital Adoption'],
    channels: ['Email', 'LinkedIn'],
    assets,
    outputs: {
      email: {
        channel: 'Email',
        headline: 'Email headline',
        body: 'Email body',
        cta: 'Explore',
        sourceAssetIds: ['DAM-0231']
      },
      linkedin: {
        channel: 'LinkedIn',
        headline: 'LI headline',
        body: 'LI body',
        cta: 'Learn more',
        sourceAssetIds: ['DAM-0188']
      }
    },
    subAssetComments: {},
    assetTab: 0,
    damGeneratePhase: null,
    damGenerateError: null,
    damGeneratingId: null,
    generatingStage: null,
    savingStage: null,
    acceptedAssets: {},
    completed: new Set()
  };
  g.esc = esc;
  g.renderAll = () => {};
  g.toast = () => {};
  g.addActivity = () => {};
  g.closeModal = () => {
    document.getElementById('modalRoot')!.innerHTML = '';
  };
  g.openGenStudioRequest = () => {};
  g.beginStageGeneration = () => {};
  g.beginAssetRegistration = () => {};
  g.acceptStageAsset = () => {};
  g.toggleAsset = (i: number) => {
    (g.state as { assets: AnyRecord[] }).assets[i].included = !(
      g.state as { assets: AnyRecord[] }
    ).assets[i].included;
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
  g.damPreview = () => '';
  g.renderAssets = () => '';
  g.renderOutputCard = (_key: string, o: AnyRecord) =>
    `<div class="clean-row"><strong>${esc(o.label || o.channel || '')}</strong>` +
    `<span>${esc(o.brandStatus || '')}</span></div><div style="margin-top:9px"></div>`;
  g.IPORTAL_CREATIVE = '/assets/iportal-creative-single.png';
  g.openExternalApprovalRequest = () => {};
  document.body.innerHTML = `<div id="modalRoot"></div><input id="gsPrompt" value="Move the logo">`;
  new Function(BRIDGE_SOURCE)();
  return g;
}

function mockDerived(id: string, regenerate = false) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const familyId = `GEN-FAM-${String(id).replace(/[^A-Z0-9]/gi, '').slice(0, 8).toUpperCase() || 'TEST'}`;
    const masterId = `ff-master-${String(id).toLowerCase()}`;
    const baseDerived = {
      editSourceAssetId: body.editSourceAssetId,
      derivedFromAssetId: body.editSourceAssetId,
      rootSourceDamAssetId: body.rootSourceDamAssetId,
      derived: true,
      generationSource: regenerate || body.regenerate ? 'firefly' : 'gemini-image',
      imageUrl: '/api/ai/generated/' + id.toLowerCase(),
      name: id,
      approval: 'Brand guidance applied',
      lineage: 'Adobe DAM · ' + body.rootSourceDamAssetId + ' → AI',
      brandGrounding: {
        applied: true,
        entryIds: ['gr-owned-logo-assets', 'txt-gs4pm-scope'],
        sources: ['Barclays-Logo.wine.svg', 'Barclays x Adobe GS4PM.pptx'],
        ruleCount: 2
      },
      logoComposition:
        regenerate || body.regenerate
          ? {
              applied: true,
              entryId: 'vis-logo-png',
              sourceFile: 'ESD_FY23_Academy-Resource.Barclays Logo.png',
              placement: 'top-left'
            }
          : undefined,
      generationFamilyId: regenerate || body.regenerate ? familyId : undefined,
      masterGeneratedAssetId: regenerate || body.regenerate ? masterId : undefined,
      derivedFromMasterGeneratedAssetId: regenerate || body.regenerate ? masterId : undefined
    };

    let channelDerivatives: AnyRecord[] | undefined;
    if ((regenerate || body.regenerate) && Array.isArray(body.channelTargets) && body.channelTargets.length) {
      channelDerivatives = body.channelTargets.map((target: AnyRecord, index: number) => {
        const channelId = `${id}-${index + 1}`;
        return {
          ...baseDerived,
          id: channelId,
          rootSourceDamAssetId: target.rootSourceDamAssetId,
          editSourceAssetId: target.rootSourceDamAssetId,
          derivedFromAssetId: target.rootSourceDamAssetId,
          channel: target.channel,
          format: target.format,
          dimensions: target.dimensions,
          targetDimensions: target.dimensions,
          finalImageDimensions: target.dimensions,
          formatAdaptation: 'cover-crop',
          imageUrl: '/api/ai/generated/' + String(channelId).toLowerCase(),
          included: false
        };
      });
    }

    const derivedAsset = channelDerivatives
      ? channelDerivatives.find((d) => d.rootSourceDamAssetId === body.rootSourceDamAssetId) ||
        channelDerivatives[0]
      : { ...baseDerived, id };

    return {
      ok: true,
      status: 200,
      json: async () => ({
        stage: 'ready',
        intent: regenerate || body.regenerate ? 'regenerate_with_firefly' : 'modify_current_asset',
        derivedAsset,
        channelDerivatives,
        channelDerivativeFailures: [],
        generationFamilyId: channelDerivatives ? familyId : undefined,
        masterGeneratedAssetId: channelDerivatives ? masterId : undefined
      })
    };
  });
  (globalThis as unknown as AnyRecord).fetch = fetchMock;
  return fetchMock;
}

function assets(g: AnyRecord) {
  return (g.state as { assets: AnyRecord[] }).assets;
}

function labels(g: AnyRecord) {
  const root = document.createElement('div');
  root.innerHTML = (g.renderAssets as () => string)();
  return [...root.querySelectorAll('.v19-variant-label')].map((n) => n.textContent);
}

describe('asset variant stack', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('A. initial — Original only, Original selected', () => {
    const g = install();
    expect(labels(g)).toEqual(['Original']);
    expect(assets(g)[0].selectedCandidateKind).toBe('original');
    expect(assets(g)[0].modifiedCandidate).toBeNull();
    expect(assets(g)[0].generatedCandidate).toBeNull();
    expect((g.renderAssets as () => string)()).toContain(
      '--v19-creative-ratio:1080 / 1080'
    );
  });

  it('reserves each channel slot thumbnail using its declared aspect ratio', () => {
    const g = install();
    const expected = ['1080 / 1080', '1200 / 627', '1200 / 480'];
    expected.forEach((ratio, index) => {
      (g.state as AnyRecord).assetTab = index;
      expect((g.renderAssets as () => string)()).toContain(
        `--v19-creative-ratio:${ratio}`
      );
    });
  });

  it('keeps the current creative and card in place during Modify loading', () => {
    const g = install();
    const runtime = g.state as AnyRecord;
    runtime.damGeneratingId = 'DAM-0188';
    runtime.damGeneratePhase = 'editing';

    const html = (g.renderAssets as () => string)();
    expect(html).toContain('v19-asset-variant-panel');
    expect(html).toContain('v19-operation-slot');
    expect(html).toContain('genstudio-inline');
    expect(html).toContain(MOBILE_SOURCE);
    expect(html).toContain('data-kind="original"');
    expect(html).toMatch(/<button class="btn" disabled[^>]*>Modify asset<\/button>/);
  });

  it('B. Modify only — Original + Modified selected, Generated absent', async () => {
    const g = install();
    mockDerived('GM-MOD-1');
    await (g.submitGenStudioAssetRequest as (i: number, m: string) => Promise<void>)(0, 'modify');
    expect(labels(g)).toEqual(['Original', 'Modified']);
    expect(assets(g)[0].selectedCandidateKind).toBe('modified');
    expect(assets(g)[0].generatedCandidate).toBeNull();
    expect(assets(g)[0].id).toBe('DAM-0188');
    expect(assets(g)[0].imageUrl).toBe(MOBILE_SOURCE);
  });

  it('C. Regenerate only — Original + Generated selected, Modified absent', async () => {
    const g = install();
    mockDerived('FF-GEN-1', true);
    (g.regenerateFireflyDerivative as (i: number) => void)(0);
    (document.getElementById('fireflyGenerationPrompt') as HTMLTextAreaElement).value =
      'Photographic corporate hero';
    await (g.submitFireflyRegeneration as (i: number) => Promise<void>)(0);
    expect(labels(g)).toEqual(['Original', 'Generated']);
    expect(assets(g)[0].selectedCandidateKind).toBe('generated');
    expect(assets(g)[0].modifiedCandidate).toBeNull();
  });

  it('D. Both — Original + Modified + Generated, Generated selected after regenerate', async () => {
    const g = install();
    mockDerived('GM-MOD-1');
    await (g.submitGenStudioAssetRequest as (i: number, m: string) => Promise<void>)(0, 'modify');
    mockDerived('FF-GEN-1', true);
    (g.regenerateFireflyDerivative as (i: number) => void)(0);
    (document.getElementById('fireflyGenerationPrompt') as HTMLTextAreaElement).value = 'New visual';
    await (g.submitFireflyRegeneration as (i: number) => Promise<void>)(0);
    expect(labels(g)).toEqual(['Original', 'Modified', 'Generated']);
    expect(assets(g)[0].selectedCandidateKind).toBe('generated');
  });

  it('E/F. Manual override switches Stage 7 handoff candidate', async () => {
    const g = install();
    mockDerived('GM-MOD-1');
    await (g.submitGenStudioAssetRequest as (i: number, m: string) => Promise<void>)(0, 'modify');
    mockDerived('FF-GEN-1', true);
    (g.regenerateFireflyDerivative as (i: number) => void)(0);
    (document.getElementById('fireflyGenerationPrompt') as HTMLTextAreaElement).value = 'New visual';
    await (g.submitFireflyRegeneration as (i: number) => Promise<void>)(0);

    assets(g)[0].included = true;
    (g.selectAssetCandidate as (i: number, kind: string) => void)(0, 'modified');
    (g.syncOutputsFromSelectedAssets as () => void)();
    expect((g.state as AnyRecord).outputs).toMatchObject({
      linkedin: {
        assetId: 'GM-MOD-1',
        imageUrl: '/api/ai/generated/gm-mod-1',
        sourceAssetIds: ['GM-MOD-1']
      }
    });

    (g.selectAssetCandidate as (i: number, kind: string) => void)(0, 'original');
    (g.syncOutputsFromSelectedAssets as () => void)();
    expect((g.state as AnyRecord).outputs).toMatchObject({
      linkedin: {
        assetId: 'DAM-0188',
        imageUrl: MOBILE_SOURCE,
        sourceAssetIds: ['DAM-0188'],
        generated: false
      }
    });
  });

  it('G. Repeated Modify replaces Modified only', async () => {
    const g = install();
    mockDerived('GM-MOD-1');
    await (g.submitGenStudioAssetRequest as (i: number, m: string) => Promise<void>)(0, 'modify');
    mockDerived('FF-GEN-KEEP');
    (g.regenerateFireflyDerivative as (i: number) => void)(0);
    (document.getElementById('fireflyGenerationPrompt') as HTMLTextAreaElement).value = 'Keep me';
    await (g.submitFireflyRegeneration as (i: number) => Promise<void>)(0);
    (g.selectAssetCandidate as (i: number, kind: string) => void)(0, 'modified');
    mockDerived('GM-MOD-2');
    await (g.submitGenStudioAssetRequest as (i: number, m: string) => Promise<void>)(0, 'modify');

    expect(assets(g)[0].id).toBe('DAM-0188');
    expect((assets(g)[0].modifiedCandidate as AnyRecord).id).toBe('GM-MOD-2');
    expect((assets(g)[0].generatedCandidate as AnyRecord).id).toBe('FF-GEN-KEEP-1');
    expect(labels(g)).toEqual(['Original', 'Modified', 'Generated']);
  });

  it('H. Repeated Regenerate accumulates Generated candidates (never overwrites)', async () => {
    const g = install();
    mockDerived('GM-MOD-KEEP');
    await (g.submitGenStudioAssetRequest as (i: number, m: string) => Promise<void>)(0, 'modify');
    mockDerived('FF-GEN-1', true);
    (g.regenerateFireflyDerivative as (i: number) => void)(0);
    (document.getElementById('fireflyGenerationPrompt') as HTMLTextAreaElement).value = 'One';
    await (g.submitFireflyRegeneration as (i: number) => Promise<void>)(0);
    mockDerived('FF-GEN-2', true);
    (g.regenerateFireflyDerivative as (i: number) => void)(0);
    (document.getElementById('fireflyGenerationPrompt') as HTMLTextAreaElement).value = 'Two';
    await (g.submitFireflyRegeneration as (i: number) => Promise<void>)(0);

    // Modify still replaces the single Modified; both Generated candidates are preserved.
    expect((assets(g)[0].modifiedCandidate as AnyRecord).id).toBe('GM-MOD-KEEP');
    const generated = assets(g)[0].generatedCandidates as AnyRecord[];
    expect(generated.map((c) => c.id)).toEqual(['FF-GEN-1-1', 'FF-GEN-2-1']);
    expect((assets(g)[0].generatedCandidate as AnyRecord).id).toBe('FF-GEN-2-1');
    expect(labels(g)).toEqual(['Original', 'Modified', 'Generated 1', 'Generated 2']);
    // Latest generated is auto-selected in the stack, but Original is never lost.
    expect(assets(g)[0].selectedCandidateId).toBe('FF-GEN-2-1');
    expect(assets(g)[0].imageUrl).toBe(MOBILE_SOURCE);
  });

  it('I. Preview opens the exact candidate image', async () => {
    const g = install();
    mockDerived('GM-MOD-1');
    await (g.submitGenStudioAssetRequest as (i: number, m: string) => Promise<void>)(0, 'modify');
    mockDerived('FF-GEN-1', true);
    (g.regenerateFireflyDerivative as (i: number) => void)(0);
    (document.getElementById('fireflyGenerationPrompt') as HTMLTextAreaElement).value = 'New visual';
    await (g.submitFireflyRegeneration as (i: number) => Promise<void>)(0);

    const expected: Record<string, string> = {
      original: MOBILE_SOURCE,
      modified: '/api/ai/generated/gm-mod-1',
      generated: '/api/ai/generated/ff-gen-1-1'
    };
    for (const [kind, image] of Object.entries(expected)) {
      (g.previewAssetCandidate as (i: number, kind: string) => void)(0, kind);
      const root = document.getElementById('modalRoot')!;
      expect(root.innerHTML).toContain(image);
      expect(root.querySelector('.modal.wide.v19-candidate-preview-modal')).not.toBeNull();
      expect(root.querySelector('.v19-candidate-preview-frame img')).not.toBeNull();
      expect(
        (root.querySelector('.v19-candidate-preview-modal') as HTMLElement).style.getPropertyValue(
          '--v19-preview-ratio'
        )
      ).toBe('1080 / 1080');
      expect(root.querySelector('.modal-actions .btn')?.textContent).toBe('Close');
    }
  });

  it('J. Channel isolation — mobile variants stay off web/email tabs', async () => {
    const g = install();
    mockDerived('GM-MOBILE');
    await (g.submitGenStudioAssetRequest as (i: number, m: string) => Promise<void>)(0, 'modify');

    (g.state as AnyRecord).assetTab = 1;
    expect(labels(g)).toEqual(['Original']);
    (g.state as AnyRecord).assetTab = 2;
    expect(labels(g)).toEqual(['Original']);
    expect(assets(g)[1].modifiedCandidate).toBeNull();
    expect(assets(g)[2].modifiedCandidate).toBeNull();
  });

  it('K. Stage 7 uses selected candidate id/image/copy/cta exactly', async () => {
    const g = install();
    assets(g)[0].headline = 'Mobile headline';
    assets(g)[0].copy = 'Mobile copy';
    assets(g)[0].cta = 'Mobile CTA';
    assets(g)[0].included = true;
    mockDerived('GM-MOD-1');
    await (g.submitGenStudioAssetRequest as (i: number, m: string) => Promise<void>)(0, 'modify');
    (g.syncOutputsFromSelectedAssets as () => void)();

    expect((g.state as AnyRecord).outputs).toMatchObject({
      linkedin: {
        assetId: 'GM-MOD-1',
        sourceAssetIds: ['GM-MOD-1'],
        imageUrl: '/api/ai/generated/gm-mod-1',
        headline: 'Mobile headline',
        body: 'Mobile copy',
        cta: 'Mobile CTA',
        derivedFromAssetId: 'DAM-0188',
        brandStatus: 'Brand guidance applied',
        brandGrounding: { applied: true, ruleCount: 2 }
      }
    });
  });

  it('shows Approved source asset on Original and Brand guidance applied on Modified/Generated', async () => {
    const g = install();
    mockDerived('GM-MOD-1');
    await (g.submitGenStudioAssetRequest as (i: number, m: string) => Promise<void>)(0, 'modify');
    mockDerived('FF-GEN-1', true);
    (g.regenerateFireflyDerivative as (i: number) => void)(0);
    (document.getElementById('fireflyGenerationPrompt') as HTMLTextAreaElement).value = 'New visual';
    await (g.submitFireflyRegeneration as (i: number) => Promise<void>)(0);

    const html = (g.renderAssets as () => string)();
    expect(html).toContain('Approved source asset');
    expect(html).toContain('Brand guidance applied');
    expect(html).toContain('Approved logo applied');
    expect(html).not.toContain('Automated brand check passed');
    expect(html).not.toMatch(/Investment Banking brand guidelines/i);

    expect((assets(g)[0].modifiedCandidate as AnyRecord).brandGrounding).toMatchObject({
      applied: true
    });
    expect((assets(g)[0].generatedCandidate as AnyRecord).brandGrounding).toMatchObject({
      applied: true
    });
    expect((assets(g)[0].generatedCandidate as AnyRecord).logoComposition).toMatchObject({
      applied: true,
      entryId: 'vis-logo-png'
    });
    expect((assets(g)[0].modifiedCandidate as AnyRecord).logoComposition).toBeFalsy();

    // Without grounding metadata the claim must not appear.
    (assets(g)[0].modifiedCandidate as AnyRecord).brandGrounding = null;
    (assets(g)[0].modifiedCandidate as AnyRecord).approval = 'Campaign creative draft';
    const without = (g.renderAssets as () => string)();
    const modifiedRow =
      without.match(/data-kind="modified"[\s\S]*?(?=data-kind="generated"|$)/)?.[0] || '';
    expect(modifiedRow).not.toContain('Brand guidance applied');
  });

  it('Stage 7 uses the composited Generated imageUrl and logoComposition metadata', async () => {
    const g = install();
    mockDerived('FF-GEN-LOGO', true);
    (g.regenerateFireflyDerivative as (i: number) => void)(0);
    (document.getElementById('fireflyGenerationPrompt') as HTMLTextAreaElement).value =
      'Premium photographic corporate banking hero';
    await (g.submitFireflyRegeneration as (i: number) => Promise<void>)(0);

    const generated = assets(g)[0].generatedCandidate as AnyRecord;
    expect(generated.imageUrl).toBe('/api/ai/generated/ff-gen-logo-1');
    expect(generated.logoComposition).toMatchObject({ applied: true });

    assets(g)[0].included = true;
    (g.selectAssetCandidate as (i: number, kind: string) => void)(0, 'generated');
    (g.syncOutputsFromSelectedAssets as () => void)();
    const out = (g.state as { outputs: { linkedin: AnyRecord } }).outputs.linkedin;
    expect(out.assetId).toBe(generated.id);
    expect(out.imageUrl).toBe(generated.imageUrl);
    expect(out.brandStatus).toBe('Brand guidance applied');
    expect(out.logoComposition).toMatchObject({ applied: true, entryId: 'vis-logo-png' });

    const card = (g.renderOutputCard as (k: string, o: AnyRecord) => string)('linkedin', out);
    expect(card).toContain('Brand guidance applied');
    expect(card).toContain('Approved logo applied');
  });

  it('A. Regenerate creative is removed from the per-asset control row', () => {
    const g = install();
    const html = (g.renderAssets as () => string)();
    // The generation entry point is no longer inside the per-card controls.
    expect(html).not.toContain('>Regenerate creative<');
    const controls = html.match(/v17-asset-controls">([\s\S]*?)<\/div>/)?.[1] || '';
    expect(controls).toContain('Modify asset');
    expect(controls).not.toContain('Add new creative');
  });

  it('B. Add new creative sits beside Accept selected assets in the bottom action row', () => {
    const g = install();
    const html = (g.renderAssets as () => string)();
    const actions = html.match(/clean-primary-actions">([\s\S]*?)<\/div>/)?.[1] || '';
    expect(actions).toContain('Add new creative');
    expect(actions).toContain('Accept selected assets');
    expect(actions.indexOf('Add new creative')).toBeLessThan(actions.indexOf('Accept selected assets'));
  });

  it('C. Add new creative targets the active channel tab', () => {
    const g = install();
    [0, 1, 2].forEach((tabIndex) => {
      (g.state as AnyRecord).assetTab = tabIndex;
      const html = (g.renderAssets as () => string)();
      const btn = html.match(
        /onclick="regenerateFireflyDerivative\((\d+)\)">Add new creative<\/button>/
      );
      expect(btn?.[1]).toBe(String(tabIndex));
    });
  });

  it('D/P. Generating twice keeps Original + Generated 1 + Generated 2', async () => {
    const g = install();
    mockDerived('FF-GEN-1', true);
    (g.regenerateFireflyDerivative as (i: number) => void)(0);
    (document.getElementById('fireflyGenerationPrompt') as HTMLTextAreaElement).value = 'One';
    await (g.submitFireflyRegeneration as (i: number) => Promise<void>)(0);
    mockDerived('FF-GEN-2', true);
    (g.regenerateFireflyDerivative as (i: number) => void)(0);
    (document.getElementById('fireflyGenerationPrompt') as HTMLTextAreaElement).value = 'Two';
    await (g.submitFireflyRegeneration as (i: number) => Promise<void>)(0);

    expect(labels(g)).toEqual(['Original', 'Generated 1', 'Generated 2']);
    expect((assets(g)[0].generatedCandidates as AnyRecord[]).map((c) => c.id)).toEqual([
      'FF-GEN-1-1',
      'FF-GEN-2-1'
    ]);
  });

  it('L. One Add new creative distributes Generated 1 to mobile, web and email', async () => {
    const g = install();
    const fetchMock = mockDerived('FF-CROSS', true);
    (g.regenerateFireflyDerivative as (i: number) => void)(0);
    (document.getElementById('fireflyGenerationPrompt') as HTMLTextAreaElement).value =
      'Campaign hero visual';
    await (g.submitFireflyRegeneration as (i: number) => Promise<void>)(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.channelTargets).toHaveLength(3);

    expect((assets(g)[0].generatedCandidates as AnyRecord[]).map((c) => c.id)).toEqual([
      'FF-CROSS-1'
    ]);
    expect((assets(g)[1].generatedCandidates as AnyRecord[]).map((c) => c.id)).toEqual([
      'FF-CROSS-2'
    ]);
    expect((assets(g)[2].generatedCandidates as AnyRecord[]).map((c) => c.id)).toEqual([
      'FF-CROSS-3'
    ]);

    const family = (assets(g)[0].generatedCandidates as AnyRecord[])[0].generationFamilyId;
    expect(family).toBeTruthy();
    expect((assets(g)[1].generatedCandidates as AnyRecord[])[0].generationFamilyId).toBe(family);
    expect((assets(g)[2].generatedCandidates as AnyRecord[])[0].generationFamilyId).toBe(family);

    expect((assets(g)[0].generatedCandidates as AnyRecord[])[0].dimensions).toBe('1080 × 1080');
    expect((assets(g)[1].generatedCandidates as AnyRecord[])[0].dimensions).toBe('1200 × 627');
    expect((assets(g)[2].generatedCandidates as AnyRecord[])[0].dimensions).toBe('1200 × 480');

    // Campaign inclusion remains manual.
    expect(assets(g)[0].included).toBe(false);
    expect(assets(g)[1].included).toBe(false);
    expect(assets(g)[2].included).toBe(false);

    for (const slot of assets(g)) {
      const gen = (slot.generatedCandidates as AnyRecord[])[0];
      expect(gen.brandGrounding).toMatchObject({ applied: true });
      expect(gen.logoComposition).toMatchObject({ applied: true });
      expect(gen.imageUrl).toMatch(/^\/api\/ai\/generated\//);
    }
  });

  it('M. Second Add new creative adds Generated 2 on every tab without deleting Generated 1', async () => {
    const g = install();
    mockDerived('FF-A', true);
    (g.regenerateFireflyDerivative as (i: number) => void)(2);
    (document.getElementById('fireflyGenerationPrompt') as HTMLTextAreaElement).value = 'First';
    await (g.submitFireflyRegeneration as (i: number) => Promise<void>)(2);
    mockDerived('FF-B', true);
    (g.regenerateFireflyDerivative as (i: number) => void)(1);
    (document.getElementById('fireflyGenerationPrompt') as HTMLTextAreaElement).value = 'Second';
    await (g.submitFireflyRegeneration as (i: number) => Promise<void>)(1);

    for (const index of [0, 1, 2]) {
      expect((assets(g)[index].generatedCandidates as AnyRecord[]).map((c) => c.id)).toEqual([
        `FF-A-${index + 1}`,
        `FF-B-${index + 1}`
      ]);
    }
  });

  it('Modify remains channel-specific after cross-channel generation', async () => {
    const g = install();
    mockDerived('FF-CROSS', true);
    (g.regenerateFireflyDerivative as (i: number) => void)(0);
    (document.getElementById('fireflyGenerationPrompt') as HTMLTextAreaElement).value = 'Shared';
    await (g.submitFireflyRegeneration as (i: number) => Promise<void>)(0);
    mockDerived('GM-MOBILE-ONLY');
    await (g.submitGenStudioAssetRequest as (i: number, m: string) => Promise<void>)(0, 'modify');

    expect((assets(g)[0].modifiedCandidate as AnyRecord).id).toBe('GM-MOBILE-ONLY');
    expect(assets(g)[1].modifiedCandidate).toBeNull();
    expect(assets(g)[2].modifiedCandidate).toBeNull();
    expect((assets(g)[1].generatedCandidates as AnyRecord[]).map((c) => c.id)).toEqual([
      'FF-CROSS-2'
    ]);
    expect((assets(g)[2].generatedCandidates as AnyRecord[]).map((c) => c.id)).toEqual([
      'FF-CROSS-3'
    ]);
  });

  it('N. All three channel tabs render the same candidate/CTA format', () => {
    const g = install();
    [0, 1, 2].forEach((tabIndex) => {
      (g.state as AnyRecord).assetTab = tabIndex;
      const html = (g.renderAssets as () => string)();
      expect(html).toContain('v19-variant-stack');
      expect(html).toContain('data-kind="original"');
      expect(html).toContain('Modify asset');
      expect(html).toContain('Send for agency approval');
      expect(html).toContain('Add new creative');
      expect(html).toContain('Accept selected assets');
      expect(html).toContain('>Preview<');
      expect(html).toContain('Select for campaign');
    });
  });

  it('single-candidate selection is radio-like within a channel', async () => {
    const g = install();
    mockDerived('FF-GEN-1', true);
    (g.regenerateFireflyDerivative as (i: number) => void)(0);
    (document.getElementById('fireflyGenerationPrompt') as HTMLTextAreaElement).value = 'One';
    await (g.submitFireflyRegeneration as (i: number) => Promise<void>)(0);
    mockDerived('FF-GEN-2', true);
    (g.regenerateFireflyDerivative as (i: number) => void)(0);
    (document.getElementById('fireflyGenerationPrompt') as HTMLTextAreaElement).value = 'Two';
    await (g.submitFireflyRegeneration as (i: number) => Promise<void>)(0);

    (g.selectAssetCandidate as (i: number, ref: string) => void)(0, 'FF-GEN-1-1');
    expect(assets(g)[0].selectedCandidateId).toBe('FF-GEN-1-1');
    const root = document.createElement('div');
    root.innerHTML = (g.renderAssets as () => string)();
    const checked = [...root.querySelectorAll('.v19-variant-row input[type="checkbox"]')].filter(
      (n) => (n as HTMLInputElement).checked
    );
    expect(checked.length).toBe(1);
    const selectedRow = root.querySelector('.v19-variant-row.is-selected');
    expect(selectedRow?.getAttribute('data-candidate-id')).toBe('FF-GEN-1-1');
  });
});
