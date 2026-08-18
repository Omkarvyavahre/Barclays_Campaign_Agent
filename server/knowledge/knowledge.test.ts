/**
 * @vitest-environment node
 *
 * Server-side knowledge layer tests. These never import the React client
 * and never call Gemini or Firefly.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  TEXTUAL_ENTRIES,
  VISUAL_ENTRIES,
  VISUAL_FAMILIES,
  buildGeminiGrounding,
  buildKnowledgeGraph,
  getBrandGuardrails,
  getGraphSummary,
  getKnowledgeByCategory,
  getKnowledgeByDomain,
  getKnowledgeForCampaign,
  getVisualReferences,
  hasProvenance,
  inventoryResources,
  listGenerativeVisualReferences,
  listLogoAssets,
  loadCatalogue,
  normalizeVisualFamily,
  resourceExists,
  selectVisualReference,
  tryInventoryResources
} from './index';

describe('Barclays knowledge layer', () => {
  it('inventories every resource file successfully', () => {
    expect(resourceExists()).toBe(true);
    const items = inventoryResources();
    expect(items.length).toBe(13);
    expect(items.every((i) => i.id && i.filename && i.relativePath && i.fileType)).toBe(true);
  });

  it('loads the knowledge catalogue', () => {
    const catalogue = loadCatalogue();
    expect(catalogue.textual.length).toBeGreaterThan(0);
    expect(catalogue.visual.length).toBeGreaterThan(0);
    expect(catalogue.textual).toEqual(TEXTUAL_ENTRIES);
    expect(catalogue.visual).toEqual(VISUAL_ENTRIES);
  });

  it('keeps Corporate and Retail textual entries separated', () => {
    const retail = getKnowledgeByDomain('retail');
    const corporate = getKnowledgeByDomain('corporate');

    expect(retail.every((e) => e.businessDomain === 'retail')).toBe(true);
    expect(corporate.every((e) => e.businessDomain === 'corporate')).toBe(true);
    // The resource pack contains no corporate-specific textual entries.
    expect(corporate).toEqual([]);
    expect(retail.some((e) => e.category === 'persona')).toBe(true);
    expect(retail.some((e) => e.category === 'product')).toBe(true);
  });

  it('does not silently classify unknown content as Corporate', () => {
    const unknownVisuals = VISUAL_ENTRIES.filter((v) => v.businessDomain === 'unknown');
    expect(unknownVisuals.length).toBeGreaterThan(0);
    expect(unknownVisuals.every((v) => v.businessDomain !== 'corporate')).toBe(true);

    const inventory = inventoryResources();
    const unknownSources = inventory.filter((s) => s.businessDomain === 'unknown');
    expect(unknownSources.every((s) => s.businessDomain !== 'corporate')).toBe(true);
  });

  it('retrieves visual references', () => {
    const refs = getVisualReferences({ businessDomain: 'retail', campaignType: 'mortgage' });
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.every((r) => r.category === 'visual-reference')).toBe(true);
    expect(refs.every((r) => r.businessDomain === 'retail' || r.businessDomain === 'cross-business')).toBe(true);
  });

  it('distinguishes logo assets from generative visual references', () => {
    const logos = listLogoAssets();
    const generative = listGenerativeVisualReferences();

    expect(logos.length).toBe(2);
    expect(logos.every((l) => l.category === 'logo' || l.assetKind === 'logo')).toBe(true);
    expect(generative.every((g) => g.category !== 'logo' && g.assetKind !== 'logo')).toBe(true);
    expect(generative.some((g) => logos.some((l) => l.id === g.id))).toBe(false);
  });

  it('Corporate iPortal retrieval does not return Retail personas or products', () => {
    const result = getKnowledgeForCampaign({
      businessDomain: 'corporate',
      campaignType: 'iPortal',
      channel: 'LinkedIn'
    });

    expect(result.textual.some((e) => e.category === 'persona')).toBe(false);
    expect(result.textual.some((e) => e.category === 'product')).toBe(false);
    expect(result.textual.every((e) => e.businessDomain !== 'retail')).toBe(true);
    expect(result.visual.every((v) => v.businessDomain !== 'retail')).toBe(true);

    const personas = getKnowledgeByCategory('persona');
    expect(personas.every((p) => p.businessDomain === 'retail')).toBe(true);
  });

  it('retrieval returns provenance', () => {
    const retail = getKnowledgeForCampaign({ businessDomain: 'retail', campaignType: 'mortgage' });
    expect(retail.textual.length).toBeGreaterThan(0);
    expect(retail.textual.every(hasProvenance)).toBe(true);
    expect(retail.textual.every((e) => typeof e.sourceFile === 'string' && e.sourceFile.length > 0)).toBe(true);

    const grounding = buildGeminiGrounding({
      businessDomain: 'retail',
      campaignType: 'mortgage',
      channel: 'email'
    });
    expect(grounding.provenance.length).toBeGreaterThan(0);
    expect(grounding.provenance.every((p) => p.sourceFile)).toBe(true);
    expect(grounding.text.includes('Barclays knowledge grounding')).toBe(true);
  });

  it('fails gracefully when the resource folder is missing', () => {
    const missing = tryInventoryResources('C:\\path\\that\\does\\not\\exist\\Barclays-Resources');
    expect(missing.ok).toBe(false);
    expect(missing.items).toEqual([]);
    expect(missing.error).toMatch(/not found/i);
  });

  it('never calls Gemini or Firefly providers', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('Unexpected network call');
    });

    inventoryResources();
    loadCatalogue();
    buildKnowledgeGraph();
    getKnowledgeForCampaign({ businessDomain: 'retail', campaignType: 'mortgage', channel: 'email' });
    getBrandGuardrails({ businessDomain: 'retail' });
    selectVisualReference({
      businessDomain: 'retail',
      campaignType: 'mortgage',
      visualFamily: 'lifestyle',
      requestedChange: 'warm family home lifestyle'
    });
    buildGeminiGrounding({ businessDomain: 'corporate', campaignType: 'iPortal', channel: 'LinkedIn' });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('selects a deterministic retail visual reference', () => {
    const selected = selectVisualReference({
      businessDomain: 'retail',
      campaignType: 'mortgage',
      visualFamily: 'lifestyle',
      requestedChange: 'first-time buyer home lifestyle'
    });
    expect(selected).not.toBeNull();
    expect(selected?.businessDomain).toBe('retail');
    expect(selected?.category).toBe('visual-reference');
    expect(selected?.assetKind).not.toBe('logo');
  });

  it('returns no retail generative visuals for corporate selection', () => {
    const selected = selectVisualReference({
      businessDomain: 'corporate',
      campaignType: 'iportal-digital-adoption',
      visualFamily: 'abstract-digital',
      requestedChange: 'Darken the background, simplify the cyan ribbons and leave more negative space on the left.'
    });
    // Resource pack still has no corporate generative visuals — null is correct.
    expect(selected).toBeNull();
  });

  it('does not promote great_escape from unknown into corporate selection', () => {
    const selected = selectVisualReference({
      businessDomain: 'corporate',
      campaignType: 'iportal-digital-adoption',
      channel: 'linkedin',
      visualFamily: 'abstract-digital',
      requestedChange: 'abstract digital cyan ribbons'
    });
    expect(selected).toBeNull();
    expect(VISUAL_ENTRIES.some((v) => v.id === 'vis-great-escape' && v.businessDomain === 'unknown')).toBe(true);
  });

  it('keeps owned logos out of generative selection', () => {
    const logos = listLogoAssets();
    const generative = listGenerativeVisualReferences();
    expect(logos.every((l) => l.category === 'logo')).toBe(true);
    expect(logos.every((l) => l.visualFamily === undefined)).toBe(true);
    expect(generative.every((g) => g.category !== 'logo')).toBe(true);
  });

  it('exposes a controlled VisualFamily enum', () => {
    expect(VISUAL_FAMILIES).toEqual([
      'abstract-digital',
      'photographic',
      'lifestyle',
      'product-led',
      'interface-led',
      'illustration',
      'other'
    ]);
    expect(normalizeVisualFamily('lifestyle-home')).toBe('lifestyle');
    expect(normalizeVisualFamily('mortgage-product')).toBe('product-led');
    expect(normalizeVisualFamily('Barclays Corporate iPortal')).toBe('abstract-digital');
    expect(normalizeVisualFamily('Totally Invented Family')).toBeNull();
  });

  it('exposes graph entity and relationship types', () => {
    const summary = getGraphSummary();
    expect(summary.entityTypes).toContain('Product');
    expect(summary.entityTypes).toContain('Persona');
    expect(summary.entityTypes).toContain('Logo');
    expect(summary.relationshipTypes).toContain('belongsTo');
    expect(summary.relationshipTypes).toContain('hasProposition');
    expect(summary.nodeCount).toBeGreaterThan(10);
    expect(summary.edgeCount).toBeGreaterThan(10);
  });
});
