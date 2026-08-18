/**
 * One-shot controlled live Creative Interpreter validation.
 * Loads .env without printing secrets. Makes exactly ONE Gemini call.
 * Firefly is never imported or called.
 *
 * Usage: npx tsx server/ai/creative/liveValidation.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createGeminiClient } from '../gemini/client';
import { interpretCreativeRequest, toPublicCreativeInterpretationResult } from './interpret';
import { buildGeminiGrounding } from '../../knowledge/grounding';
import { getKnowledgeForCampaign, getBrandGuardrails } from '../../knowledge/retrieval';
import type { CreativeInterpreterInput } from './types';

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

const INPUT: CreativeInterpreterInput = {
  campaignBrief: {
    campaignName: 'iPortal Digital Adoption',
    objective: 'Increase iPortal self-service adoption among UKC clients',
    audience: 'Digital Adoption',
    proposition: 'Discover what is possible with iPortal',
    product: 'iPortal'
  },
  asset: {
    id: 'DAM-IPORTAL-LN-001',
    sourceId: 'DAM-IPORTAL-LN-001',
    lineage: 'Adobe DAM · DAM-IPORTAL-LN-001',
    channel: 'LinkedIn',
    format: 'Sponsored image',
    dimensions: '1200x627',
    headline: 'Discover what is possible with iPortal',
    copy: 'Bring payments, reporting and self-service together.',
    cta: 'Discover iPortal'
  },
  modification: {
    title: 'Discover what is possible with iPortal',
    description: 'Discover a simpler way to manage your digital banking with iPortal.',
    cta: 'Discover iPortal',
    prompt:
      'Make the background darker, simplify the cyan ribbons and leave more negative space on the left.'
  },
  campaignContext: {
    businessDomain: 'corporate',
    campaignType: 'iPortal',
    channel: 'LinkedIn'
  }
};

function precheck(): Record<string, unknown> {
  const hasGateway = Boolean(process.env.AI_GATEWAY_BASE_URL && process.env.AI_GATEWAY_API_KEY);
  const hasGoogle = Boolean(process.env.GEMINI_API_KEY);
  return {
    geminiLive: process.env.GEMINI_LIVE === '1',
    credentialsAvailable: hasGateway || hasGoogle,
    credentialMode: hasGateway ? 'internal_gateway' : hasGoogle ? 'google_api' : 'none',
    gatewayProtocol: process.env.AI_GATEWAY_PROTOCOL ?? null,
    model: process.env.GEMINI_MODEL ?? null,
    apiMountedPath: '/api/ai/creative-interpret',
    knowledgeAvailable: true,
    fireflyEnvPresent: Boolean(process.env.ADOBE_FIREFLY_CLIENT_ID),
    fireflyUsedByThisScript: false
  };
}

async function main(): Promise<void> {
  const pre = precheck();
  if (!pre.geminiLive || !pre.credentialsAvailable) {
    writeFileSync(
      resolve(process.cwd(), 'server/ai/creative/live-validation-report.json'),
      JSON.stringify({ success: false, stage: 'precheck', precheck: pre }, null, 2)
    );
    console.error('Precheck failed — see live-validation-report.json');
    process.exit(1);
  }

  // Server-side grounding inspection for the report (not returned on public API).
  const grounding = buildGeminiGrounding({
    businessDomain: 'corporate',
    campaignType: 'iPortal',
    channel: 'LinkedIn',
    categories: ['brand', 'tone-of-voice', 'proposition', 'genstudio', 'guardrail', 'audience']
  });
  const campaignKnowledge = getKnowledgeForCampaign({
    businessDomain: 'corporate',
    campaignType: 'iPortal',
    channel: 'LinkedIn'
  });
  const guardrails = getBrandGuardrails({ businessDomain: 'corporate' });
  const groundingSummary = {
    entryCount: grounding.provenance.length,
    entryIds: grounding.provenance.map((p) => p.entryId),
    sourceFilenamesOnly: grounding.provenance.map((p) => p.sourceFile),
    textualDomains: [...new Set(campaignKnowledge.textual.map((e) => e.businessDomain))],
    textualCategories: [...new Set(campaignKnowledge.textual.map((e) => e.category))],
    guardrailDomains: [...new Set(guardrails.map((g) => g.businessDomain))],
    visualDomains: [...new Set(campaignKnowledge.visual.map((v) => v.businessDomain))],
    retailTextualCount: campaignKnowledge.textual.filter((e) => e.businessDomain === 'retail').length,
    retailVisualCount: campaignKnowledge.visual.filter((v) => v.businessDomain === 'retail').length,
    textMentionsMortgage: /mortgage/i.test(grounding.text),
    textMentionsFresco: /fresco/i.test(grounding.text),
    textMentionsRetailTone: /retail banking tone/i.test(grounding.text),
    textMentionsGreatEscape: /great_escape/i.test(grounding.text)
  };

  let geminiCalls = 0;
  const baseClient = createGeminiClient({ live: true });
  const countingClient = {
    async generateJson(req: Parameters<typeof baseClient.generateJson>[0]) {
      geminiCalls += 1;
      if (geminiCalls > 1) {
        throw new Error('Refusing second Gemini call — limit is 1');
      }
      return baseClient.generateJson(req);
    }
  };

  const fireflyFetchHits: string[] = [];
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (/firefly|adobe|ims-na1|services\.adobe/i.test(url)) {
      fireflyFetchHits.push(url.split('?')[0]!);
      throw new Error('Firefly call blocked during Creative Interpreter validation');
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    const internal = await interpretCreativeRequest(INPUT, { gemini: countingClient });
    const publicResult = toPublicCreativeInterpretationResult(internal);
    const publicJson = JSON.stringify(publicResult);

    const report = {
      success: true,
      precheck: pre,
      geminiCallCount: geminiCalls,
      fireflyCallCount: fireflyFetchHits.length,
      fireflyFetchHits,
      providerMeta: internal.providerMeta ?? null,
      titleUnchanged: internal.specification.content.title === INPUT.modification.title,
      descriptionUnchanged: internal.specification.content.description === INPUT.modification.description,
      ctaUnchanged: internal.specification.content.cta === INPUT.modification.cta,
      titleByteMatch: Buffer.from(internal.specification.content.title).equals(
        Buffer.from(INPUT.modification.title)
      ),
      descriptionByteMatch: Buffer.from(internal.specification.content.description).equals(
        Buffer.from(INPUT.modification.description)
      ),
      ctaByteMatch: Buffer.from(internal.specification.content.cta).equals(Buffer.from(INPUT.modification.cta)),
      logoGuardrailPresent: internal.specification.avoid.some((a) => /logo|barclays mark/i.test(a)),
      filenameOrPathInSpec: /\.jpg|\.png|\.svg|great_escape|\\|\/barclays|onedrive/i.test(
        JSON.stringify(internal.specification)
      ),
      groundingSummary,
      retailExcluded:
        !groundingSummary.textMentionsMortgage &&
        !groundingSummary.textMentionsFresco &&
        !groundingSummary.textMentionsRetailTone &&
        !groundingSummary.textMentionsGreatEscape,
      publicApiResponse: publicResult,
      publicResponseHasGrounding: 'groundingText' in publicResult || 'groundingProvenance' in publicResult,
      publicResponseHasFilesystemPath: /OneDrive|Barclays Brand Guidelines|C:\\\\/i.test(publicJson),
      specification: internal.specification,
      visualReference: internal.visualReference,
      referenceStatus: internal.referenceStatus
    };

    writeFileSync(
      resolve(process.cwd(), 'server/ai/creative/live-validation-report.json'),
      JSON.stringify(report, null, 2),
      'utf8'
    );
    console.log('LIVE_VALIDATION_OK');
    console.log(
      JSON.stringify(
        {
          success: true,
          model: report.providerMeta?.model,
          latencyMs: report.providerMeta?.latencyMs,
          usage: report.providerMeta?.usage,
          referenceStatus: report.referenceStatus,
          geminiCallCount: report.geminiCallCount,
          fireflyCallCount: report.fireflyCallCount,
          titleUnchanged: report.titleUnchanged,
          descriptionUnchanged: report.descriptionUnchanged,
          ctaUnchanged: report.ctaUnchanged
        },
        null,
        2
      )
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Scrub any accidental credential leakage from error text.
    const scrubbed = message
      .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
      .replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED_KEY]')
      .replace(/key=[^&\s]+/gi, 'key=[REDACTED]');
    writeFileSync(
      resolve(process.cwd(), 'server/ai/creative/live-validation-report.json'),
      JSON.stringify(
        {
          success: false,
          stage: 'interpret',
          precheck: pre,
          geminiCallCount: geminiCalls,
          fireflyCallCount: fireflyFetchHits.length,
          error: scrubbed
        },
        null,
        2
      ),
      'utf8'
    );
    console.error('LIVE_VALIDATION_FAILED');
    console.error(scrubbed);
    process.exit(1);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main();
