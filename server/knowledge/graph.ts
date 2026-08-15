/**
 * Lightweight in-memory knowledge graph.
 * Relationships are only created where source evidence supports them.
 */

import { TEXTUAL_ENTRIES, VISUAL_ENTRIES } from './catalogue';
import type { KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from './types';

function domainNode(domain: 'corporate' | 'retail' | 'cross-business'): KnowledgeNode {
  return {
    id: `domain-${domain}`,
    type: 'Domain',
    label: domain === 'cross-business' ? 'Cross-business' : domain[0].toUpperCase() + domain.slice(1),
    domain
  };
}

export function buildKnowledgeGraph(): KnowledgeGraph {
  const nodes: KnowledgeNode[] = [
    domainNode('corporate'),
    domainNode('retail'),
    domainNode('cross-business'),
    { id: 'channel-email', type: 'Channel', label: 'Email' },
    { id: 'channel-meta', type: 'Channel', label: 'Meta Ads' },
    { id: 'channel-linkedin', type: 'Channel', label: 'LinkedIn Ads' },
    { id: 'channel-display', type: 'Channel', label: 'Display Ads' },
    { id: 'channel-web', type: 'Channel', label: 'Web' },
    { id: 'vf-abstract-digital', type: 'VisualFamily', label: 'Abstract digital' },
    { id: 'vf-lifestyle', type: 'VisualFamily', label: 'Lifestyle' },
    { id: 'vf-product-led', type: 'VisualFamily', label: 'Product-led' },
    { id: 'vf-photographic', type: 'VisualFamily', label: 'Photographic' },
    { id: 'vf-interface-led', type: 'VisualFamily', label: 'Interface-led' },
    { id: 'vf-illustration', type: 'VisualFamily', label: 'Illustration' }
  ];

  const edges: KnowledgeEdge[] = [];

  const addNode = (node: KnowledgeNode) => {
    if (!nodes.some((n) => n.id === node.id)) nodes.push(node);
  };

  const addEdge = (edge: Omit<KnowledgeEdge, 'id'> & { id?: string }) => {
    const id = edge.id ?? `edge-${edge.type}-${edge.from}-${edge.to}`;
    if (!edges.some((e) => e.id === id)) edges.push({ ...edge, id });
  };

  for (const entry of TEXTUAL_ENTRIES) {
    const type =
      entry.category === 'product'
        ? 'Product'
        : entry.category === 'proposition'
          ? 'Proposition'
          : entry.category === 'persona'
            ? 'Persona'
            : entry.category === 'tone-of-voice'
              ? 'ToneOfVoice'
              : entry.category === 'brand'
                ? 'BrandGuideline'
                : entry.category === 'guardrail'
                  ? 'Guardrail'
                  : entry.category === 'genstudio'
                    ? 'GenStudioGuidance'
                    : 'BrandGuideline';

    addNode({
      id: entry.id,
      type,
      label: entry.title,
      domain: entry.businessDomain,
      refId: entry.id
    });

    if (entry.businessDomain === 'retail' || entry.businessDomain === 'cross-business' || entry.businessDomain === 'corporate') {
      addEdge({
        type: entry.category === 'guardrail' || entry.category === 'tone-of-voice' || entry.category === 'brand' || entry.category === 'genstudio'
          ? 'appliesTo'
          : 'belongsTo',
        from: entry.id,
        to: `domain-${entry.businessDomain}`,
        evidenceSourceFile: entry.sourceFile
      });
    }

    if (entry.id === 'txt-prop-credit-cards') {
      addEdge({
        type: 'hasProposition',
        from: 'txt-product-credit-cards',
        to: entry.id,
        evidenceSourceFile: entry.sourceFile
      });
    }
    if (entry.id === 'txt-prop-mortgages') {
      addEdge({
        type: 'hasProposition',
        from: 'txt-product-mortgages',
        to: entry.id,
        evidenceSourceFile: entry.sourceFile
      });
    }
    if (entry.id === 'txt-prop-loans') {
      addEdge({
        type: 'hasProposition',
        from: 'txt-product-loans',
        to: entry.id,
        evidenceSourceFile: entry.sourceFile
      });
    }

    if (entry.id === 'txt-email-guidelines') {
      addEdge({ type: 'usableFor', from: entry.id, to: 'channel-email', evidenceSourceFile: entry.sourceFile });
    }
    if (entry.id === 'txt-meta-ads-guidelines') {
      addEdge({ type: 'usableFor', from: entry.id, to: 'channel-meta', evidenceSourceFile: entry.sourceFile });
    }
    if (entry.id === 'txt-display-ads-guidelines') {
      addEdge({ type: 'usableFor', from: entry.id, to: 'channel-display', evidenceSourceFile: entry.sourceFile });
    }
    if (entry.id === 'txt-gs4pm-channels') {
      addEdge({ type: 'usableFor', from: entry.id, to: 'channel-email', evidenceSourceFile: entry.sourceFile });
      addEdge({ type: 'usableFor', from: entry.id, to: 'channel-meta', evidenceSourceFile: entry.sourceFile });
      addEdge({ type: 'usableFor', from: entry.id, to: 'channel-linkedin', evidenceSourceFile: entry.sourceFile });
      addEdge({ type: 'usableFor', from: entry.id, to: 'channel-display', evidenceSourceFile: entry.sourceFile });
    }

    if (entry.category === 'guardrail') {
      addEdge({
        type: 'constrains',
        from: entry.id,
        to: 'domain-retail',
        evidenceSourceFile: entry.sourceFile
      });
    }

    // Persona needs inferred only from explicit communication / needs language in the source.
    if (entry.id === 'txt-persona-starting-out') {
      addNode({ id: 'need-financial-confidence', type: 'Audience', label: 'Build financial confidence', domain: 'retail' });
      addEdge({
        type: 'hasNeed',
        from: entry.id,
        to: 'need-financial-confidence',
        evidenceSourceFile: entry.sourceFile
      });
    }
  }

  for (const visual of VISUAL_ENTRIES) {
    addNode({
      id: visual.id,
      type: visual.category === 'logo' ? 'Logo' : 'VisualReference',
      label: visual.title,
      domain: visual.businessDomain,
      refId: visual.id
    });

    if (visual.businessDomain !== 'unknown') {
      addEdge({
        type: 'belongsTo',
        from: visual.id,
        to: `domain-${visual.businessDomain}`,
        evidenceSourceFile: visual.sourceFile
      });
    }

    if (visual.visualFamily) {
      addEdge({
        type: 'visualFamily',
        from: visual.id,
        to: `vf-${visual.visualFamily}`,
        evidenceSourceFile: visual.sourceFile
      });
    }

    if (visual.channel === 'web') {
      addEdge({ type: 'usableFor', from: visual.id, to: 'channel-web', evidenceSourceFile: visual.sourceFile });
    }

    if (visual.campaignType === 'mortgage') {
      addEdge({
        type: 'relevantTo',
        from: visual.id,
        to: 'txt-product-mortgages',
        evidenceSourceFile: visual.sourceFile
      });
    }

    if (visual.campaignType === 'iportal-digital-adoption') {
      addEdge({
        type: 'usableFor',
        from: visual.id,
        to: 'channel-linkedin',
        evidenceSourceFile: visual.sourceFile
      });
    }
  }

  // Image guidelines constrain owned logo assets for brand imagery.
  addEdge({
    type: 'constrains',
    from: 'txt-image-guidelines',
    to: 'vis-logo-svg',
    evidenceSourceFile: 'Barclays_Retail_Banking_Tone_of_Voice_Guidelines.pdf'
  });
  addEdge({
    type: 'constrains',
    from: 'txt-image-guidelines',
    to: 'vis-logo-png',
    evidenceSourceFile: 'Barclays_Retail_Banking_Tone_of_Voice_Guidelines.pdf'
  });

  return { nodes, edges };
}

export function getGraphSummary(graph: KnowledgeGraph = buildKnowledgeGraph()): {
  entityTypes: string[];
  relationshipTypes: string[];
  nodeCount: number;
  edgeCount: number;
} {
  return {
    entityTypes: [...new Set(graph.nodes.map((n) => n.type))].sort(),
    relationshipTypes: [...new Set(graph.edges.map((e) => e.type))].sort(),
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length
  };
}
