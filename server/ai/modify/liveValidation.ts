/**
 * One-shot controlled live Modify E2E validation.
 * Gemini Creative Interpreter (1) → Firefly (1) → derived asset.
 *
 * Usage: npx tsx server/ai/modify/liveValidation.ts
 *
 * Does NOT retry. Does NOT call Coordinator/Brief agents.
 * Does NOT load historical .generated files into the Asset Library.
 */
import { accessSync, constants, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { selectVisualReference } from '../../knowledge/visualReferences';
import { createGeminiClient } from '../gemini/client';
import { createFireflyClient } from '../firefly/client';
import {
  clearGeneratedImageRegistry,
  getDefaultGeneratedDir,
  getRegisteredGeneratedImage,
  listRegisteredGeneratedIds,
  resolveFireflyContentClass
} from '../firefly';
import { modifyAsset, toPublicModifyAssetResult } from './modifyAsset';
import type { ModifyAssetRequest } from './types';

function loadEnvFile(path: string): void {
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(resolve(process.cwd(), '.env'));
process.env.GEMINI_LIVE = '1';
process.env.FIREFLY_LIVE = '1';

const TITLE = 'Discover what is possible with iPortal';
const DESCRIPTION = 'Discover a simpler way to manage your digital banking with iPortal.';
const CTA = 'Discover iPortal';

const REQUEST: ModifyAssetRequest = {
  mode: 'modify',
  campaignBrief: {
    campaignName: 'iPortal Digital Adoption',
    objective: 'Increase iPortal self-service adoption among UKC clients',
    audience: 'Digital Adoption',
    proposition: TITLE,
    product: 'iPortal'
  },
  asset: {
    id: 'DAM-IPORTAL-LN-001',
    sourceId: 'DAM-IPORTAL-LN-001',
    lineage: 'Adobe DAM · DAM-IPORTAL-LN-001',
    channel: 'LinkedIn',
    format: 'Sponsored image',
    dimensions: '1200x627',
    headline: TITLE,
    copy: 'Bring payments, reporting and self-service together.',
    cta: CTA
  },
  modification: {
    title: TITLE,
    description: DESCRIPTION,
    cta: CTA,
    prompt:
      'Make the background darker, simplify the cyan ribbons and leave more negative space on the left.'
  },
  campaignContext: {
    businessDomain: 'corporate',
    campaignType: 'iPortal',
    channel: 'LinkedIn'
  },
  sourceDamAsset: {
    id: 'DAM-IPORTAL-LN-001',
    mimeType: 'image/png'
  }
};

const REPORT_PATH = resolve(process.cwd(), 'server/ai/modify/live-validation-report.json');

function precheck(): Record<string, unknown> {
  const generatedDir = getDefaultGeneratedDir();
  let generatedDirWritable = false;
  try {
    accessSync(generatedDir, constants.W_OK);
    generatedDirWritable = true;
  } catch {
    try {
      accessSync(resolve(process.cwd()), constants.W_OK);
      generatedDirWritable = true;
    } catch {
      generatedDirWritable = false;
    }
  }

  const kg = selectVisualReference({
    businessDomain: 'corporate',
    campaignType: 'iPortal',
    channel: 'LinkedIn',
    visualFamily: 'abstract-digital',
    requestedChange: 'darker background simplify cyan ribbons'
  });

  return {
    geminiLive: process.env.GEMINI_LIVE === '1',
    fireflyLive: process.env.FIREFLY_LIVE === '1',
    geminiGatewayConfigured: Boolean(process.env.AI_GATEWAY_BASE_URL && process.env.AI_GATEWAY_API_KEY),
    geminiModel: process.env.GEMINI_MODEL ?? null,
    fireflyCredentialsConfigured: Boolean(
      process.env.ADOBE_FIREFLY_CLIENT_ID && process.env.ADOBE_FIREFLY_CLIENT_SECRET
    ),
    fireflyClientConfigured: true,
    sourceDamAssetId: REQUEST.asset.id,
    generatedDir,
    generatedDirWritable,
    corporateIportalVisualReference: kg,
    expectedReferenceSource: 'source-dam-asset'
  };
}

type FetchHit = { host: string; path: string };

async function main(): Promise<void> {
  clearGeneratedImageRegistry();
  const pre = precheck();

  if (
    !pre.geminiLive ||
    !pre.fireflyLive ||
    !pre.geminiGatewayConfigured ||
    !pre.fireflyCredentialsConfigured ||
    !pre.generatedDirWritable
  ) {
    writeFileSync(
      REPORT_PATH,
      JSON.stringify({ success: false, stage: 'precheck', precheck: pre }, null, 2)
    );
    console.error('Precheck failed — see live-validation-report.json');
    process.exit(1);
  }

  if (pre.corporateIportalVisualReference !== null) {
    writeFileSync(
      REPORT_PATH,
      JSON.stringify(
        {
          success: false,
          stage: 'precheck',
          reason: 'Expected selectVisualReference() null for Corporate/iPortal',
          precheck: pre
        },
        null,
        2
      )
    );
    console.error('Precheck failed — KG visual reference unexpectedly non-null');
    process.exit(1);
  }

  const geminiHits: FetchHit[] = [];
  const fireflyHits: FetchHit[] = [];
  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    let host = '';
    let path = '';
    try {
      const u = new URL(url);
      host = u.host;
      path = u.pathname;
    } catch {
      host = url;
    }

    if (/genai-sharedservice|generativelanguage\.googleapis|googleapis\.com\/.*generateContent|chat\/completions/i.test(url)) {
      geminiHits.push({ host, path });
    }
    if (/ims-na1\.adobelogin|firefly-api\.adobe\.io|services\.adobe/i.test(url)) {
      fireflyHits.push({ host, path });
    }

    return originalFetch(input, init);
  }) as typeof fetch;

  const originalAssetSnapshot = {
    id: REQUEST.asset.id,
    headline: REQUEST.asset.headline,
    copy: REQUEST.asset.copy,
    cta: REQUEST.asset.cta,
    lineage: REQUEST.asset.lineage
  };

  const demoLibrary = [
    { id: 'DAM-0231', channel: 'Email', included: true, headline: 'See every account', copy: 'One place', cta: 'Explore iPortal' },
    { id: 'DAM-0188', channel: 'LinkedIn', included: false, headline: 'A step change', copy: 'Discover more', cta: 'Learn more' },
    { id: 'REQ-LI-WEB', channel: 'LinkedIn', included: false, headline: '', copy: '', cta: '' },
    {
      id: originalAssetSnapshot.id,
      channel: 'LinkedIn',
      included: false,
      headline: originalAssetSnapshot.headline,
      copy: originalAssetSnapshot.copy,
      cta: originalAssetSnapshot.cta
    }
  ];

  const baseGemini = createGeminiClient({ live: true, fetchImpl: globalThis.fetch });
  const baseFirefly = createFireflyClient({ live: true, fetchImpl: globalThis.fetch });

  let geminiMeta: Record<string, unknown> = {};
  let fireflyLatencyMs: number | undefined;

  const gemini = {
    async generateJson(request: Parameters<typeof baseGemini.generateJson>[0]) {
      const response = await baseGemini.generateJson(request);
      geminiMeta = {
        model: response.model,
        latencyMs: response.latencyMs,
        usage: response.usage
      };
      return response;
    }
  };

  const firefly = {
    async generateImage(request: Parameters<typeof baseFirefly.generateImage>[0]) {
      const started = Date.now();
      const response = await baseFirefly.generateImage(request);
      fireflyLatencyMs = response.latencyMs ?? Date.now() - started;
      return response;
    }
  };

  let fireflyCheckpoint: Record<string, unknown> | null = null;

  let result;
  try {
    result = await modifyAsset(REQUEST, {
      gemini,
      firefly,
      onBeforeFireflyGeneration: (meta) => {
        fireflyCheckpoint = {
          specification: meta.specification,
          fireflyPromptLength: meta.fireflyPromptLength,
          fireflyPrompt: meta.fireflyPrompt,
          contentClass: meta.contentClass,
          referenceSource: meta.referenceSource
        };
        writeFileSync(
          resolve(process.cwd(), 'server/ai/modify/live-firefly-checkpoint.json'),
          JSON.stringify(fireflyCheckpoint, null, 2)
        );
      }
    });
  } catch (error) {
    const details =
      error && typeof error === 'object' && 'details' in error
        ? (error as { details?: string[] }).details
        : undefined;
    const stage =
      error && typeof error === 'object' && 'stage' in error
        ? (error as { stage?: string }).stage
        : 'provider';
    writeFileSync(
      REPORT_PATH,
      JSON.stringify(
        {
          success: false,
          stage,
          error: error instanceof Error ? error.message : String(error),
          details,
          precheck: pre,
          geminiCallCount: geminiHits.length,
          fireflyCallCount: fireflyHits.length,
          geminiHits,
          fireflyHits,
          geminiMeta,
          fireflyCheckpoint,
          note: 'Stopped after provider failure — no automatic retry'
        },
        null,
        2
      )
    );
    console.error('Live Modify failed — see live-validation-report.json');
    if (details?.length) console.error('Details:', details.join(' | '));
    process.exit(1);
  }

  const pub = toPublicModifyAssetResult(result);
  const derived = result.derivedAsset;
  if (!derived || !result.interpretation || !result.fireflyPrompt) {
    console.error('Live Modify returned no derived asset — unexpected for this validation path');
    process.exit(1);
  }
  const imageRecord = getRegisteredGeneratedImage(derived.imageUrl.replace('/api/ai/generated/', ''));
  let imageMeta: Record<string, unknown> = { resolved: false };
  if (imageRecord) {
    const st = statSync(imageRecord.absolutePath);
    const bytes = readFileSync(imageRecord.absolutePath);
    let width: number | null = null;
    let height: number | null = null;
    // PNG IHDR
    if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
      width = bytes.readUInt32BE(16);
      height = bytes.readUInt32BE(20);
    }
    imageMeta = {
      resolved: true,
      absolutePathRedacted: true,
      mimeType: imageRecord.mimeType,
      fileSizeBytes: st.size,
      width,
      height,
      publicUrl: derived.imageUrl,
      registeredOnlyInSession: listRegisteredGeneratedIds().includes(imageRecord.id),
      localPathForInspection: imageRecord.absolutePath
    };
  }

  // Asset Library simulation: append only this session derivative (do not load historical .generated).
  const libraryBefore = demoLibrary.map((a) => a.id);
  demoLibrary.push({
    id: derived.id,
    channel: derived.channel,
    included: false,
    headline: derived.headline,
    copy: derived.copy,
    cta: derived.cta
  });
  const historicalGeneratedNotLoaded = true;

  // Selection → Channel Outputs (no Firefly call)
  const selected = demoLibrary.find((a) => a.id === derived.id)!;
  selected.included = true;
  const channelOutputs = {
    linkedin: {
      headline: selected.headline,
      body: selected.copy,
      cta: selected.cta,
      sourceAssetIds: [selected.id],
      imageUrl: derived.imageUrl
    }
  };

  const titleOk = derived.headline === TITLE;
  const descriptionOk = derived.copy === DESCRIPTION;
  const ctaOk = derived.cta === CTA;
  const originalUnchanged =
    originalAssetSnapshot.id === REQUEST.asset.id &&
    originalAssetSnapshot.headline === REQUEST.asset.headline &&
    originalAssetSnapshot.copy === REQUEST.asset.copy &&
    originalAssetSnapshot.cta === REQUEST.asset.cta;

  const contentClass = resolveFireflyContentClass(result.interpretation.specification);

  const report = {
    success: true,
    stage: 'ready',
    precheck: pre,
    gemini: {
      success: true,
      model: geminiMeta.model ?? process.env.GEMINI_MODEL ?? null,
      latencyMs: geminiMeta.latencyMs ?? null,
      usage: geminiMeta.usage ?? null,
      callCount:
        geminiHits.filter((h) => /chat\/completions|generateContent/i.test(h.path)).length ||
        geminiHits.length,
      hits: geminiHits
    },
    creativeSpecification: result.interpretation.specification,
    visualReference: result.interpretation.visualReference,
    referenceStatus: result.interpretation.referenceStatus,
    referenceSource: result.referenceSource,
    firefly: {
      success: true,
      contentClass,
      api: 'https://firefly-api.adobe.io/v3/images/generate-async',
      latencyMs: fireflyLatencyMs ?? null,
      callCount: fireflyHits.filter((h) => /images\/generate/i.test(h.path)).length,
      authAndStorageHits: fireflyHits.length,
      hits: fireflyHits.map((h) => `${h.host}${h.path}`),
      promptPreview: result.fireflyPrompt.slice(0, 500),
      jobTelemetry: result.fireflyJobTelemetry ?? null
    },
    fireflyCheckpoint,
    image: imageMeta,
    derivedAsset: {
      id: derived.id,
      sourceId: derived.sourceId,
      lineage: derived.lineage,
      generationSource: derived.generationSource,
      referenceSource: derived.referenceSource,
      visualFamily: derived.visualFamily,
      headline: derived.headline,
      copy: derived.copy,
      cta: derived.cta,
      imageUrl: derived.imageUrl,
      matchStatus: derived.matchStatus
    },
    originalAssetUnchanged: originalUnchanged,
    assetLibrary: {
      demoIdsPreserved: ['DAM-0231', 'DAM-0188', 'REQ-LI-WEB'].every((id) => libraryBefore.includes(id)),
      derivativeAppended: demoLibrary.some((a) => a.id === derived.id),
      derivativeCount: demoLibrary.filter((a) => a.id === derived.id).length,
      historicalGeneratedNotLoaded,
      status: derived.matchStatus
    },
    channelOutputs,
    contentByteStable: { titleOk, descriptionOk, ctaOk },
    provenance: result.provenance,
    publicPayloadKeys: Object.keys(pub)
  };

  if (result.fireflyJobTelemetry) {
    const enrichedCheckpoint = {
      ...(fireflyCheckpoint ?? {}),
      fireflyJobId: result.fireflyJobTelemetry.fireflyJobId,
      initialResponseStatus: result.fireflyJobTelemetry.initialResponseStatus,
      pollCount: result.fireflyJobTelemetry.pollCount,
      statusTransitions: result.fireflyJobTelemetry.statusTransitions,
      finalJobStatus: result.fireflyJobTelemetry.finalJobStatus,
      generatedImageAvailable: result.fireflyJobTelemetry.generatedImageAvailable
    };
    writeFileSync(
      resolve(process.cwd(), 'server/ai/modify/live-firefly-checkpoint.json'),
      JSON.stringify(enrichedCheckpoint, null, 2)
    );
  }

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log('Live Modify E2E succeeded — report written to server/ai/modify/live-validation-report.json');
  console.log(
    JSON.stringify(
      {
        derivedId: derived.id,
        referenceSource: result.referenceSource,
        geminiCalls: report.gemini.callCount,
        fireflyGenerateCalls: report.firefly.callCount,
        imageUrl: derived.imageUrl
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      {
        success: false,
        stage: 'unexpected',
        error: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    )
  );
  console.error(error);
  process.exit(1);
});
