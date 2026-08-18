/**
 * @vitest-environment node
 *
 * Phase 3 — Gemini Creative Interpreter tests.
 * Gemini and Firefly network calls must remain 0.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildGeminiGrounding } from '../../knowledge/grounding';
import { getKnowledgeForCampaign } from '../../knowledge/retrieval';
import { listLogoAssets, selectVisualReference } from '../../knowledge/visualReferences';
import type { GeminiJsonClient } from '../gemini/types';
import { createGeminiClient, GeminiClientError } from '../gemini/client';
import {
  assembleCreativeSpecification,
  buildCreativeInterpreterSystemPrompt,
  buildCreativeInterpreterUserPrompt,
  CreativeInterpreterError,
  interpretCreativeRequest,
  parseGeminiJson,
  preserveUserRequestedChange,
  toPublicCreativeInterpretationResult,
  validateCreativeInterpreterInput,
  validateCreativeSpecificationPartial,
  type CreativeInterpreterInput
} from './index';
import { CREATIVE_INTERPRET_PATH, handleCreativeInterpretRequest } from '../http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

const CORPORATE_INPUT: CreativeInterpreterInput = {
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

const MOCK_GEMINI_SPEC = {
  requestedChange: 'Darken the background and simplify the flowing cyan visual elements.',
  visualFamily: 'abstract-digital' as const,
  composition: 'Simplified flowing-light composition with reduced visual density.',
  negativeSpace: 'left' as const,
  tone: ['premium', 'confident', 'modern'],
  preserve: ['approved iPortal visual identity', 'source asset lineage', 'owned Barclays logo as composition mark'],
  avoid: ['generated logos or simulated Barclays marks', 'crowded ribbon density'],
  accessibility: ['maintain sufficient contrast after darkening', 'keep clear separation for text safe area']
};

function mockGemini(payload: unknown = MOCK_GEMINI_SPEC): GeminiJsonClient {
  return {
    generateJson: vi.fn(async () => ({ text: JSON.stringify(payload) }))
  };
}

function mockRequest(body: unknown, method = 'POST'): IncomingMessage {
  const stream = Readable.from([Buffer.from(JSON.stringify(body))]) as IncomingMessage;
  stream.method = method;
  stream.url = CREATIVE_INTERPRET_PATH;
  stream.headers = { 'content-type': 'application/json' };
  return stream;
}

function mockResponse(): ServerResponse & { body: string; statusCode: number } {
  const state = { body: '', statusCode: 200, headers: {} as Record<string, string> };
  const res = {
    get statusCode() {
      return state.statusCode;
    },
    set statusCode(value: number) {
      state.statusCode = value;
    },
    setHeader(name: string, value: string) {
      state.headers[name.toLowerCase()] = value;
    },
    end(chunk?: string) {
      state.body = chunk ?? '';
    },
    get body() {
      return state.body;
    }
  };
  return res as unknown as ServerResponse & { body: string; statusCode: number };
}

describe('CreativeSpecification validation', () => {
  it('accepts a valid CreativeSpecification partial', () => {
    const result = validateCreativeSpecificationPartial(MOCK_GEMINI_SPEC);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.negativeSpace).toBe('left');
      expect(result.value.visualFamily).toBe('abstract-digital');
    }
  });

  it('rejects invalid Gemini JSON safely', () => {
    expect(parseGeminiJson('not-json{').ok).toBe(false);
  });

  it('fails validation when required fields are missing', () => {
    const result = validateCreativeSpecificationPartial({
      requestedChange: 'darken',
      tone: []
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('visualFamily'))).toBe(true);
      expect(result.errors.some((e) => e.includes('negativeSpace'))).toBe(true);
    }
  });

  it('rejects invalid free-text visualFamily values', () => {
    const result = validateCreativeSpecificationPartial({
      ...MOCK_GEMINI_SPEC,
      visualFamily: 'Totally Invented Family'
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /visualFamily must be one of/i.test(e))).toBe(true);
    }
  });

  it('normalizes obvious legacy Corporate iPortal wording to abstract-digital', () => {
    const result = validateCreativeSpecificationPartial({
      ...MOCK_GEMINI_SPEC,
      visualFamily: 'Barclays Corporate iPortal',
      requestedChange: 'Darken the background and simplify the cyan ribbons.',
      composition: 'Dark abstract background with simplified cyan ribbons.'
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.visualFamily).toBe('abstract-digital');
    }
  });

  it('rejects Gemini attempts to select image filenames', () => {
    const result = validateCreativeSpecificationPartial({
      ...MOCK_GEMINI_SPEC,
      visualFamily: 'great_escape_16_9.xxsmall.medium_quality.jpg'
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /filenames|filesystem|visualFamily must be one of/i.test(e))).toBe(true);
    }
  });
});

describe('modification.prompt priority', () => {
  it('instructs Gemini that modification.prompt is the highest-priority creative instruction', () => {
    const system = buildCreativeInterpreterSystemPrompt();
    expect(system).toMatch(/modification\.prompt/i);
    expect(system).toMatch(/highest-priority creative instruction/i);
    expect(system).toMatch(/MUST preserve the substance of the requested visual change/i);
    expect(system).toMatch(/Do NOT let source DAM identity.*override a clear user visual instruction/i);
  });

  it('marks modification.prompt as highest priority in the user prompt', () => {
    const user = buildCreativeInterpreterUserPrompt(CORPORATE_INPUT, 'grounding');
    expect(user).toMatch(/highest-priority creative instruction/i);
    expect(user).toContain(CORPORATE_INPUT.modification.prompt);
  });

  it('preserves user requestedChange when Gemini drops distinctive visual tokens', () => {
    const merged = preserveUserRequestedChange(
      'Add sharp magenta diagonal beams and open negative space on the right.',
      'Apply a premium corporate abstract digital treatment.'
    );
    expect(merged.toLowerCase()).toMatch(/magenta/);
    expect(merged.toLowerCase()).toMatch(/right/);
  });

  it('keeps Gemini wording when it already preserves user visual intent', () => {
    const merged = preserveUserRequestedChange(
      'Make the background darker and simplify cyan ribbons.',
      'Darken the background and simplify the flowing cyan ribbons while keeping a premium feel.'
    );
    expect(merged).toBe(
      'Darken the background and simplify the flowing cyan ribbons while keeping a premium feel.'
    );
  });

  it('assembleCreativeSpecification restores dropped user intent into requestedChange', () => {
    const spec = assembleCreativeSpecification(CORPORATE_INPUT, {
      ...MOCK_GEMINI_SPEC,
      requestedChange: 'Apply a generic premium corporate visual refresh.'
    });
    expect(spec.requestedChange.toLowerCase()).toMatch(/darker|cyan|ribbon|negative space/i);
  });
});

describe('Authoritative content protection', () => {
  it('keeps submitted Title, Description and CTA unchanged', async () => {
    const gemini = mockGemini({
      ...MOCK_GEMINI_SPEC,
      content: {
        title: 'REWRITE THIS TITLE',
        description: 'REWRITE THIS DESCRIPTION',
        cta: 'REWRITE THIS CTA'
      }
    });

    const result = await interpretCreativeRequest(CORPORATE_INPUT, { gemini });

    expect(result.specification.content.title).toBe(CORPORATE_INPUT.modification.title);
    expect(result.specification.content.description).toBe(CORPORATE_INPUT.modification.description);
    expect(result.specification.content.cta).toBe(CORPORATE_INPUT.modification.cta);
  });

  it('assembles authoritative content from the marketer form', () => {
    const spec = assembleCreativeSpecification(CORPORATE_INPUT, {
      requestedChange: MOCK_GEMINI_SPEC.requestedChange,
      visualFamily: MOCK_GEMINI_SPEC.visualFamily,
      composition: MOCK_GEMINI_SPEC.composition,
      negativeSpace: 'left',
      tone: MOCK_GEMINI_SPEC.tone,
      preserve: MOCK_GEMINI_SPEC.preserve,
      avoid: MOCK_GEMINI_SPEC.avoid,
      accessibility: MOCK_GEMINI_SPEC.accessibility
    });
    expect(spec.content).toEqual({
      title: CORPORATE_INPUT.modification.title,
      description: CORPORATE_INPUT.modification.description,
      cta: CORPORATE_INPUT.modification.cta
    });
    expect(spec.sourceAsset.id).toBe('DAM-IPORTAL-LN-001');
    expect(spec.sourceAsset.lineage).toContain('Adobe DAM');
  });
});

describe('Knowledge grounding and domain separation', () => {
  it('Corporate campaign excludes Retail knowledge', () => {
    const grounding = buildGeminiGrounding({
      businessDomain: 'corporate',
      campaignType: 'iPortal',
      channel: 'LinkedIn',
      categories: ['brand', 'tone-of-voice', 'proposition', 'genstudio', 'guardrail', 'audience']
    });
    const retail = getKnowledgeForCampaign({
      businessDomain: 'corporate',
      campaignType: 'iPortal',
      channel: 'LinkedIn'
    });

    expect(retail.textual.every((e) => e.businessDomain !== 'retail')).toBe(true);
    expect(retail.textual.some((e) => e.category === 'persona')).toBe(false);
    expect(retail.textual.some((e) => e.category === 'product')).toBe(false);
    expect(grounding.text.toLowerCase()).not.toMatch(/fresco|mortgage hub|first-time buyer persona/);
  });

  it('Retail campaign can retrieve Retail knowledge', () => {
    const retail = getKnowledgeForCampaign({
      businessDomain: 'retail',
      campaignType: 'mortgage',
      channel: 'email'
    });
    expect(retail.textual.some((e) => e.businessDomain === 'retail')).toBe(true);
  });
});

describe('interpretCreativeRequest orchestration', () => {
  it('runs the deterministic selector after validation and returns null for Corporate iPortal', async () => {
    const gemini = mockGemini();
    const result = await interpretCreativeRequest(CORPORATE_INPUT, { gemini });

    expect(gemini.generateJson).toHaveBeenCalledTimes(1);
    expect(result.visualReference).toBeNull();
    expect(result.referenceStatus).toBe('no-approved-corporate-reference');
    expect(result.specification.requestedChange).toMatch(/darken/i);
    expect(result.specification.negativeSpace).toBe('left');
    expect(result.specification.visualFamily).toBe('abstract-digital');
    expect(result.specification.sourceAsset.id).toBe('DAM-IPORTAL-LN-001');
  });

  it('does not automatically select great_escape for Corporate', async () => {
    const result = await interpretCreativeRequest(CORPORATE_INPUT, { gemini: mockGemini() });
    expect(result.visualReference?.id).not.toBe('vis-great-escape');
    const selected = selectVisualReference({
      businessDomain: 'corporate',
      campaignType: 'iPortal',
      visualFamily: 'abstract-digital',
      requestedChange: 'darker cyan ribbons'
    });
    expect(selected).toBeNull();
  });

  it('treats logo resources as owned assets, not generative references', async () => {
    const logos = listLogoAssets();
    expect(logos.length).toBe(2);

    const result = await interpretCreativeRequest(CORPORATE_INPUT, { gemini: mockGemini() });
    expect(result.specification.avoid.some((a) => /logo|barclays mark/i.test(a))).toBe(true);
    expect(result.visualReference).toBeNull();
  });

  it('preserves source asset ID and lineage', async () => {
    const result = await interpretCreativeRequest(CORPORATE_INPUT, { gemini: mockGemini() });
    expect(result.specification.sourceAsset).toEqual({
      id: 'DAM-IPORTAL-LN-001',
      sourceId: 'DAM-IPORTAL-LN-001',
      lineage: 'Adobe DAM · DAM-IPORTAL-LN-001'
    });
  });

  it('fails safely when Gemini JSON is invalid', async () => {
    const gemini: GeminiJsonClient = {
      generateJson: async () => ({ text: '<<<not json>>>' })
    };
    await expect(interpretCreativeRequest(CORPORATE_INPUT, { gemini })).rejects.toBeInstanceOf(
      CreativeInterpreterError
    );
  });

  it('fails when required input fields are missing', async () => {
    const invalid = validateCreativeInterpreterInput({
      campaignBrief: {},
      asset: {},
      modification: { title: '' },
      campaignContext: {}
    });
    expect(invalid.ok).toBe(false);
  });

  it('never exposes grounding or filesystem paths in the public result', async () => {
    const internal = await interpretCreativeRequest(CORPORATE_INPUT, { gemini: mockGemini() });
    const publicResult = toPublicCreativeInterpretationResult(internal);
    const json = JSON.stringify(publicResult);

    expect(publicResult).not.toHaveProperty('groundingText');
    expect(publicResult).not.toHaveProperty('groundingProvenance');
    expect(json).not.toMatch(/Barclays Brand Guidelines/i);
    expect(json).not.toMatch(/OneDrive/i);
    expect(json).not.toMatch(/C:\\\\/i);
    expect(json).not.toMatch(/assetPath/);
  });
});

describe('Provider call guarantees', () => {
  it('default Gemini client makes zero live calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('Unexpected network call');
    });

    const client = createGeminiClient({ live: false });
    await expect(client.generateJson({ system: 'x', user: 'y' })).rejects.toBeInstanceOf(GeminiClientError);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('interpretCreativeRequest never invokes Firefly or live Gemini when mocked', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('Unexpected network call');
    });

    await interpretCreativeRequest(CORPORATE_INPUT, { gemini: mockGemini() });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('HTTP API contract', () => {
  it('POST /api/ai/creative-interpret returns a public payload without provenance', async () => {
    const req = mockRequest(CORPORATE_INPUT);
    const res = mockResponse();
    await handleCreativeInterpretRequest(req, res, { gemini: mockGemini() });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      specification: { content: { title: string } };
      visualReference: null;
      referenceStatus: string;
      groundingText?: string;
      groundingProvenance?: unknown;
    };

    expect(body.specification.content.title).toBe(CORPORATE_INPUT.modification.title);
    expect(body.visualReference).toBeNull();
    expect(body.referenceStatus).toBe('no-approved-corporate-reference');
    expect(body.groundingText).toBeUndefined();
    expect(body.groundingProvenance).toBeUndefined();
    expect(res.body).not.toMatch(/Barclays Brand Guidelines|OneDrive|assetPath|GEMINI_API_KEY/i);
  });

  it('fails closed when live Gemini is disabled and no mock is injected', async () => {
    const previous = process.env.GEMINI_LIVE;
    delete process.env.GEMINI_LIVE;

    const req = mockRequest(CORPORATE_INPUT);
    const res = mockResponse();
    await handleCreativeInterpretRequest(req, res);

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body) as { error: string };
    expect(body.error).toMatch(/Live Gemini calls are disabled|GEMINI/i);

    if (previous === undefined) delete process.env.GEMINI_LIVE;
    else process.env.GEMINI_LIVE = previous;
  });

  it('exposes the Creative Interpreter path constant', () => {
    expect(CREATIVE_INTERPRET_PATH).toBe('/api/ai/creative-interpret');
  });
});

describe('Example Corporate CreativeSpecification', () => {
  it('matches the darker cyan ribbons / left negative-space example', async () => {
    const result = await interpretCreativeRequest(CORPORATE_INPUT, { gemini: mockGemini() });
    expect(result.specification).toMatchObject({
      businessDomain: 'corporate',
      campaignType: 'iportal-digital-adoption',
      channel: 'LinkedIn',
      content: {
        title: 'Discover what is possible with iPortal',
        description: 'Discover a simpler way to manage your digital banking with iPortal.',
        cta: 'Discover iPortal'
      },
      requestedChange: 'Darken the background and simplify the flowing cyan visual elements.',
      visualFamily: 'abstract-digital',
      negativeSpace: 'left'
    });
    expect(result.referenceStatus).toBe('no-approved-corporate-reference');
    expect(result.visualReference).toBeNull();
  });
});
