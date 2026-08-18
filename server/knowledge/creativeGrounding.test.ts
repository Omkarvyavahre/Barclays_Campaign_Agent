/**
 * @vitest-environment node
 *
 * Creative grounding helper — reuses the existing knowledge layer.
 * Provider calls = 0.
 */
import { describe, expect, it } from 'vitest';
import {
  getCreativeGrounding,
  toBrandGroundingMetadata
} from './creativeGrounding';

describe('getCreativeGrounding', () => {
  it('returns compatible corporate/iPortal guidance without retail leakage', () => {
    const grounding = getCreativeGrounding({
      businessDomain: 'corporate',
      campaignType: 'iPortal',
      channel: 'LinkedIn',
      product: 'iPortal',
      visualFamily: 'photographic',
      requestedChange: 'A photographic corporate banking hero'
    });

    expect(grounding.grounded).toBe(true);
    expect(grounding.guardrails.length).toBeGreaterThan(0);
    expect(grounding.visualReference).toBeNull();

    const blob = [
      ...grounding.guardrails,
      ...grounding.provenance.map((p) => `${p.title} ${p.sourceFile} ${p.entryId}`)
    ].join('\n');

    expect(blob).not.toMatch(/mortgage|credit.?card|personal.?loan|fresco|rising.?metropolitans/i);
    expect(blob).toMatch(/logo|GenStudio|GS4PM|owned/i);

    const meta = toBrandGroundingMetadata(grounding);
    expect(meta.applied).toBe(true);
    expect(meta.ruleCount).toBe(grounding.guardrails.length);
    expect(meta.sources.every((s) => !/[\\/]/.test(s) || !/OneDrive|C:\\/i.test(s))).toBe(true);
  });

  it('never invents investment-banking-specific claims', () => {
    const grounding = getCreativeGrounding({
      businessDomain: 'corporate',
      campaignType: 'iPortal',
      channel: 'Email'
    });
    const blob = grounding.guardrails.join(' ');
    expect(blob).not.toMatch(/Investment Banking brand guidelines/i);
  });

  it('returns retail mortgage guidance when domain is retail', () => {
    const grounding = getCreativeGrounding({
      businessDomain: 'retail',
      campaignType: 'mortgage',
      channel: 'email',
      visualFamily: 'lifestyle'
    });

    expect(grounding.grounded).toBe(true);
    expect(grounding.guardrails.some((g) => /fear-based|logo|inclusiv|slang/i.test(g))).toBe(true);
  });

  it('keeps guardrail strings compact', () => {
    const grounding = getCreativeGrounding({
      businessDomain: 'corporate',
      campaignType: 'iPortal',
      channel: 'LinkedIn'
    });
    expect(grounding.guardrails.every((g) => g.length <= 160)).toBe(true);
    expect(grounding.guardrails.length).toBeLessThanOrEqual(6);
  });
});
