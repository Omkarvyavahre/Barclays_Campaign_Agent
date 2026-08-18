/**
 * Live KG-grounded Modify + Regenerate validation via the running Vite API.
 *
 * Usage (server must already be up with NODE_OPTIONS=--use-system-ca):
 *   npx.cmd tsx server/ai/modify/kgLiveValidation.ts
 *
 * Stops after the first failure. No architecture changes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import {
  getCreativeGrounding,
  toBrandGroundingMetadata
} from '../../knowledge/creativeGrounding';

const API = process.env.KG_LIVE_API_BASE || 'http://localhost:5173';
const REPORT_PATH = resolve(process.cwd(), 'server/ai/modify/kg-live-validation-report.json');
const MOBILE_SOURCE = '/assets/iportal-creative-linkedin-mobile.png';
const MODIFY_INSTRUCTION = 'Move the Barclays wordmark slightly toward the bottom centre.';
const REGENERATE_PROMPT =
  'Create a premium photographic corporate banking hero with realistic business professionals in a modern office and warm natural light. No illustration.';
const RETAIL_LEAK = /mortgage|credit.?card|personal.?loan|fresco|rising.?metropolitans|barclaycard/i;

type Report = Record<string, unknown>;

/** Replays the last live run's derived assets so UI/Stage 7 checks cost 0 provider calls. */
const REUSE = process.env.KG_LIVE_REUSE === '1';

type StoredRun = {
  derivedId?: string;
  imageUrl?: string;
  approval?: string;
  brandGrounding?: { applied?: boolean; ruleCount?: number; sources?: string[] };
  instruction?: string;
  referenceSource?: string;
};

function loadPreviousReport(): { modify?: StoredRun; regenerate?: StoredRun } {
  try {
    return JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/** Persist after every stage — a later crash must not discard live provider evidence. */
function snapshot(report: Report): void {
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
}

function fail(stage: string, detail: string, report: Report): never {
  report.failedStage = stage;
  report.failure = detail;
  report.ok = false;
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.error(`\nFAIL @ ${stage}: ${detail}`);
  console.error(`Report: ${REPORT_PATH}`);
  process.exit(1);
}

function assertNoRetail(blob: string, stage: string, report: Report): void {
  if (RETAIL_LEAK.test(blob)) {
    fail(stage, `Retail knowledge leaked into corporate grounding: ${blob.slice(0, 240)}`, report);
  }
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'modify',
    campaignBrief: {
      campaignName: 'iPortal Digital Adoption',
      objective: 'Increase iPortal self-service adoption among UKC clients',
      audience: 'Digital Adoption',
      proposition: 'Discover what is possible with iPortal',
      product: 'iPortal'
    },
    asset: {
      id: 'DAM-0188',
      sourceId: 'DAM-0188',
      lineage: 'Adobe DAM · DAM-0188',
      channel: 'LinkedIn',
      format: 'Sponsored content · mobile crop',
      dimensions: '1080 × 1080',
      headline: 'A step change in how you bank with Barclays',
      copy: 'Discover more ways to use iPortal.',
      cta: 'Learn more'
    },
    modification: {
      title: 'A step change in how you bank with Barclays',
      description: 'Discover more ways to use iPortal.',
      cta: 'Learn more',
      prompt: MODIFY_INSTRUCTION
    },
    campaignContext: {
      businessDomain: 'corporate',
      campaignType: 'iPortal',
      channel: 'LinkedIn'
    },
    sourceDamAsset: {
      id: 'DAM-0188',
      imageUrl: MOBILE_SOURCE,
      mimeType: 'image/png'
    },
    editSourceAssetId: 'DAM-0188',
    rootSourceDamAssetId: 'DAM-0188',
    ...overrides
  };
}

async function postModify(body: Record<string, unknown>) {
  const response = await fetch(`${API}/api/ai/modify-asset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = (await response.json()) as Record<string, unknown>;
  return { status: response.status, json };
}

function installUiHarness(modified: Record<string, unknown>, generated: Record<string, unknown>) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="modalRoot"></div></body></html>', {
    url: 'http://localhost/'
  });
  const { window } = dom;
  const g = globalThis as unknown as Record<string, unknown>;
  Object.assign(g, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node
  });

  const slot: Record<string, unknown> = {
    id: 'DAM-0188',
    name: 'iPortal step-change social creative',
    requirement: 'LinkedIn sponsored content — mobile',
    sourceType: 'Adobe DAM',
    channel: 'LinkedIn',
    format: 'Sponsored content · mobile crop',
    dimensions: '1080 × 1080',
    approval: 'Approved source asset',
    rights: 'UK paid social',
    expiry: '30 Sep 2027',
    matchStatus: 'Adaptation recommended',
    confidence: '81%',
    matchReason: 'Adaptation recommended for Digital Adoption.',
    found: true,
    included: true,
    generated: false,
    imageUrl: MOBILE_SOURCE,
    headline: 'A step change in how you bank with Barclays',
    copy: 'Discover more ways to use iPortal.',
    cta: 'Learn more',
    commentsKey: 'dam-mobile',
    selectedCandidateKind: 'original',
    modifiedCandidate: null,
    generatedCandidate: null
  };

  g.state = {
    campaignName: 'iPortal',
    objective: 'Adoption',
    audience: ['Digital Adoption'],
    channels: ['Email', 'LinkedIn'],
    assets: [slot],
    outputs: {
      linkedin: {
        channel: 'LinkedIn',
        label: 'LinkedIn sponsored',
        headline: slot.headline,
        body: slot.copy,
        cta: slot.cta,
        sourceAssetIds: ['DAM-0188'],
        format: slot.format,
        dimensions: slot.dimensions,
        version: 1,
        audience: 'Digital Adoption',
        tracking: 'utm',
        accessibility: 'alt text',
        commentsKey: 'output-linkedin',
        approved: false,
        excluded: false,
        previousVersions: []
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
  g.esc = (v: unknown) =>
    String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  g.renderAll = () => {};
  g.toast = () => {};
  g.addActivity = () => {};
  g.closeModal = () => {
    window.document.getElementById('modalRoot')!.innerHTML = '';
  };
  g.openGenStudioRequest = () => {};
  g.beginStageGeneration = () => {};
  g.beginAssetRegistration = () => {};
  g.acceptStageAsset = () => {};
  g.toggleAsset = () => {};
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
  g.renderOutputs = () => '<div class="clean-list"></div>';
  g.renderOutputCard = (_key: string, o: { label?: string; brandStatus?: string }) =>
    `<div class="clean-row"><strong>${o.label || ''}</strong><span>${o.brandStatus || ''}</span></div>`;
  g.IPORTAL_CREATIVE = '/assets/iportal-creative-single.png';
  g.openExternalApprovalRequest = () => {};
  g.refreshOutputsForSelectionChange = () => {};
  g.stripOutputActionCtas = (html: string) => html;

  const bridge = readFileSync(resolve(process.cwd(), 'public/runtime/v19-modify-firefly.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function(bridge)();

  // Bare assignments in the bridge land on globalThis, but `window.x = ...` lands on the
  // jsdom window; mirror those so the harness calls the same functions the browser does.
  const w = window as unknown as Record<string, unknown>;
  for (const key of [
    'selectAssetCandidate',
    'previewAssetCandidate',
    'syncOutputsFromSelectedAssets',
    'resolveOutputCreative'
  ]) {
    if (typeof w[key] === 'function') g[key] = w[key];
  }

  const attach = (derived: Record<string, unknown>, kind: 'modified' | 'generated') => {
    const candidate = {
      ...derived,
      kind,
      label: kind === 'modified' ? 'Modified' : 'Generated',
      channel: slot.channel,
      format: slot.format,
      dimensions: slot.dimensions,
      headline: slot.headline,
      copy: slot.copy,
      cta: slot.cta,
      derived: true,
      brandGrounding: derived.brandGrounding || null
    };
    if (kind === 'modified') slot.modifiedCandidate = candidate;
    else slot.generatedCandidate = candidate;
    slot.selectedCandidateKind = kind;
  };

  attach(modified, 'modified');
  attach(generated, 'generated');
  return g;
}

async function main(): Promise<void> {
  const report: Report = {
    startedAt: new Date().toISOString(),
    ok: false,
    apiBase: API,
    geminiLiveCalls: 0,
    fireflyLiveCalls: 0
  };

  console.log('=== KG live validation (HTTP) ===');
  console.log(`API ${API}`);

  console.log('1) Pre-check corporate grounding (no providers)');
  const preGrounding = getCreativeGrounding({
    businessDomain: 'corporate',
    campaignType: 'iPortal',
    channel: 'LinkedIn',
    product: 'iPortal',
    visualFamily: 'photographic',
    requestedChange: REGENERATE_PROMPT
  });
  const preMeta = toBrandGroundingMetadata(preGrounding);
  report.precheck = {
    businessDomain: 'corporate',
    campaignType: 'iPortal',
    grounded: preGrounding.grounded,
    ruleCount: preMeta.ruleCount,
    sourceCount: preMeta.sources.length,
    sources: preMeta.sources,
    entryIds: preMeta.entryIds,
    visualReferenceSource: preGrounding.visualReference?.id ?? null
  };
  console.log(
    `[kg] businessDomain=corporate ruleCount=${preMeta.ruleCount} sourceCount=${preMeta.sources.length} visualReferenceSource=${preGrounding.visualReference?.id ?? 'none'}`
  );
  if (!preGrounding.grounded || preMeta.ruleCount < 1) {
    fail('KG retrieval', 'Expected compatible corporate/cross-business guidance', report);
  }
  assertNoRetail(
    [...preGrounding.guardrails, ...preMeta.sources, ...preMeta.entryIds].join('\n'),
    'KG retrieval',
    report
  );
  if (/Investment Banking/i.test(preGrounding.guardrails.join(' '))) {
    fail('KG retrieval', 'Must not claim Investment Banking guidelines', report);
  }

  const previous = REUSE ? loadPreviousReport() : {};

  let modified: Record<string, any>;
  let modifyInstruction: string;
  if (REUSE) {
    console.log('2) Replaying last live Modify (KG_LIVE_REUSE=1, 0 provider calls)');
    const stored = previous.modify;
    if (!stored?.derivedId || !stored.imageUrl || !stored.brandGrounding) {
      fail(
        'reuse',
        'No stored live Modify result. Run once without KG_LIVE_REUSE=1 first.',
        report
      );
    }
    modified = {
      id: stored.derivedId,
      imageUrl: stored.imageUrl,
      approval: stored.approval,
      brandGrounding: stored.brandGrounding,
      rootSourceDamAssetId: 'DAM-0188'
    };
    modifyInstruction = stored.instruction ?? MODIFY_INSTRUCTION;
    report.geminiLiveCalls = 0;
  } else {
    console.log('2) Live Modify via /api/ai/modify-asset');
    const modifyHttp = await postModify(baseBody());
    report.geminiLiveCalls = 1;
    if (modifyHttp.status !== 200 || modifyHttp.json.stage !== 'ready') {
      fail(
        'provider request',
        `Modify HTTP ${modifyHttp.status}: ${JSON.stringify({
          error: modifyHttp.json.error,
          stage: modifyHttp.json.stage,
          message: modifyHttp.json.message,
          details: modifyHttp.json.details
        }).slice(0, 600)}`,
        report
      );
    }
    modified = modifyHttp.json.derivedAsset as Record<string, any>;
    modifyInstruction = modifyHttp.json.instruction as string;
  }

  if (!modified?.brandGrounding?.applied) {
    fail('candidate persistence', 'Modified missing brandGrounding.applied', report);
  }
  if (modified.approval !== 'Brand guidance applied') {
    fail('candidate persistence', `Unexpected Modified approval: ${modified.approval}`, report);
  }
  if (modifyInstruction !== MODIFY_INSTRUCTION) {
    fail('prompt assembly', 'User Modify instruction was not preserved', report);
  }
  if (modified.rootSourceDamAssetId !== 'DAM-0188') {
    fail('candidate persistence', 'Root DAM id changed after Modify', report);
  }
  assertNoRetail((modified.brandGrounding.sources || []).join('\n'), 'candidate persistence', report);
  report.modify = {
    derivedId: modified.id,
    imageUrl: modified.imageUrl,
    approval: modified.approval,
    brandGrounding: modified.brandGrounding,
    instruction: modifyInstruction
  };
  snapshot(report);
  console.log(
    `[modify] ok id=${modified.id} ruleCount=${modified.brandGrounding.ruleCount} approval=${modified.approval}`
  );

  let generated: Record<string, any>;
  let referenceSource: unknown;
  if (REUSE) {
    console.log('3) Replaying last live Regenerate (KG_LIVE_REUSE=1, 0 provider calls)');
    const stored = previous.regenerate;
    if (!stored?.derivedId || !stored.imageUrl || !stored.brandGrounding) {
      fail(
        'reuse',
        'No stored live Regenerate result. Run once without KG_LIVE_REUSE=1 first.',
        report
      );
    }
    generated = {
      id: stored.derivedId,
      imageUrl: stored.imageUrl,
      approval: stored.approval,
      brandGrounding: stored.brandGrounding
    };
    referenceSource = stored.referenceSource;
    report.fireflyLiveCalls = 0;
  } else {
    console.log('3) Live Regenerate via /api/ai/modify-asset');
    const regenerateHttp = await postModify(
      baseBody({
        regenerate: true,
        generationPrompt: REGENERATE_PROMPT,
        modification: {
          title: 'A step change in how you bank with Barclays',
          description: 'Discover more ways to use iPortal.',
          cta: 'Learn more',
          prompt: ''
        }
      })
    );
    report.fireflyLiveCalls = 1;
    if (regenerateHttp.status !== 200 || regenerateHttp.json.stage !== 'ready') {
      fail(
        'provider request',
        `Regenerate HTTP ${regenerateHttp.status}: ${JSON.stringify({
          error: regenerateHttp.json.error,
          stage: regenerateHttp.json.stage,
          message: regenerateHttp.json.message,
          details: regenerateHttp.json.details
        }).slice(0, 600)}`,
        report
      );
    }
    generated = regenerateHttp.json.derivedAsset as Record<string, any>;
    referenceSource = regenerateHttp.json.referenceSource;
  }

  if (!generated?.brandGrounding?.applied) {
    fail('candidate persistence', 'Generated missing brandGrounding.applied', report);
  }
  if (generated.approval !== 'Brand guidance applied') {
    fail('candidate persistence', `Unexpected Generated approval: ${generated.approval}`, report);
  }
  if (referenceSource === 'knowledge-graph') {
    fail('prompt assembly', 'Unexpected KG visual reference for corporate/iPortal', report);
  }
  report.regenerate = {
    derivedId: generated.id,
    imageUrl: generated.imageUrl,
    approval: generated.approval,
    brandGrounding: generated.brandGrounding,
    referenceSource
  };
  snapshot(report);
  console.log(
    `[regenerate] ok id=${generated.id} ruleCount=${generated.brandGrounding.ruleCount} referenceSource=${referenceSource}`
  );

  console.log('4) Variant stack + selection + Stage 7');
  const g = installUiHarness(modified, generated);
  const html = (g.renderAssets as () => string)();
  const ui = {
    labels: [...html.matchAll(/v19-variant-label[^>]*>([^<]+)/g)].map((m) => m[1]),
    hasApprovedSource: html.includes('Approved source asset'),
    hasBrandGuidance: html.includes('Brand guidance applied'),
    hasAutomatedClaim: html.includes('Automated brand check passed'),
    hasInvestmentBankingClaim: /Investment Banking brand guidelines/i.test(html)
  };
  report.ui = ui;
  if (JSON.stringify(ui.labels) !== JSON.stringify(['Original', 'Modified', 'Generated'])) {
    fail('variant stack', `Expected Original/Modified/Generated, got ${JSON.stringify(ui.labels)}`, report);
  }
  if (!ui.hasApprovedSource || !ui.hasBrandGuidance) {
    fail('variant stack', 'Brand status indicators missing on stack', report);
  }
  if (ui.hasAutomatedClaim) {
    fail('variant stack', 'Misleading Automated brand check passed still visible', report);
  }
  if (ui.hasInvestmentBankingClaim) {
    fail('variant stack', 'Investment Banking claim displayed without IB material', report);
  }

  const select = g.selectAssetCandidate as (i: number, kind: string) => void;
  const sync = g.syncOutputsFromSelectedAssets as () => void;
  const outputs = () => (g.state as { outputs: { linkedin: Record<string, unknown> } }).outputs.linkedin;

  select(0, 'modified');
  sync();
  const modifiedOut = outputs();
  report.stage7Modified = {
    assetId: modifiedOut.assetId,
    imageUrl: modifiedOut.imageUrl,
    brandStatus: modifiedOut.brandStatus,
    brandGrounding: modifiedOut.brandGrounding
  };
  if (modifiedOut.assetId !== modified.id || modifiedOut.imageUrl !== modified.imageUrl) {
    fail('Stage 7 handoff', 'Modified selection did not flow to Stage 7', report);
  }
  if (modifiedOut.brandStatus !== 'Brand guidance applied') {
    fail('Stage 7 handoff', 'Modified Stage 7 brandStatus incorrect', report);
  }

  select(0, 'original');
  sync();
  const originalOut = outputs();
  report.stage7Original = {
    assetId: originalOut.assetId,
    imageUrl: originalOut.imageUrl,
    brandStatus: originalOut.brandStatus
  };
  if (originalOut.assetId !== 'DAM-0188' || originalOut.imageUrl !== MOBILE_SOURCE) {
    fail('Stage 7 handoff', 'Original selection did not restore Stage 7 to DAM-0188', report);
  }
  if (originalOut.brandStatus !== 'Approved source asset') {
    fail('Stage 7 handoff', 'Original Stage 7 brandStatus incorrect', report);
  }

  select(0, 'generated');
  sync();
  const generatedOut = outputs();
  report.stage7Generated = {
    assetId: generatedOut.assetId,
    imageUrl: generatedOut.imageUrl,
    brandStatus: generatedOut.brandStatus,
    brandGrounding: generatedOut.brandGrounding
  };
  if (generatedOut.assetId !== generated.id || generatedOut.imageUrl !== generated.imageUrl) {
    fail('Stage 7 handoff', 'Generated selection did not flow to Stage 7', report);
  }
  if (generatedOut.brandStatus !== 'Brand guidance applied') {
    fail('Stage 7 handoff', 'Generated Stage 7 brandStatus incorrect', report);
  }

  const outputHtml = (g.renderOutputCard as (k: string, o: Record<string, unknown>) => string)(
    'linkedin',
    generatedOut
  );
  const stage7OutputCard = {
    showsBrandGuidance: outputHtml.includes('Brand guidance applied'),
    showsAutomatedClaim: outputHtml.includes('Automated brand check passed')
  };
  report.stage7OutputCard = stage7OutputCard;
  if (!stage7OutputCard.showsBrandGuidance) {
    fail('Stage 7 handoff', 'Stage 7 output card missing Brand guidance applied', report);
  }

  report.ok = true;
  report.finishedAt = new Date().toISOString();
  snapshot(report);
  console.log('\nPASS — KG-grounded Modify + Regenerate + Stage 7 validated');
  console.log(`Report: ${REPORT_PATH}`);
  console.log(
    JSON.stringify(
      {
        modifyRuleCount: modified.brandGrounding.ruleCount,
        regenerateRuleCount: generated.brandGrounding.ruleCount,
        visualReferenceSource: referenceSource,
        geminiLiveCalls: report.geminiLiveCalls,
        fireflyLiveCalls: report.fireflyLiveCalls
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
