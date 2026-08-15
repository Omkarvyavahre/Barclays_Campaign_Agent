/**
 * Runtime validation for CreativeInterpreterInput and CreativeSpecification.
 * Hand-rolled to match the knowledge layer's zero-extra-dependency style.
 */

import type {
  CreativeInterpreterInput,
  CreativeSpecification,
  NegativeSpace,
  ValidationResult
} from './types';
import type { KnowledgeDomain, VisualFamily } from '../../knowledge/types';
import { VISUAL_FAMILIES, normalizeVisualFamily } from '../../knowledge/visualFamily';

const DOMAINS: KnowledgeDomain[] = ['corporate', 'retail', 'cross-business', 'unknown'];
const NEGATIVE_SPACES: NegativeSpace[] = ['left', 'right', 'top', 'bottom', 'balanced', 'unspecified'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asStringArray(value: unknown, field: string, errors: string[]): string[] | null {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array of strings`);
    return null;
  }
  if (!value.every((v) => typeof v === 'string')) {
    errors.push(`${field} must contain only strings`);
    return null;
  }
  return value as string[];
}

export function validateCreativeInterpreterInput(input: unknown): ValidationResult<CreativeInterpreterInput> {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ['input must be an object'] };

  if (!isRecord(input.campaignBrief)) errors.push('campaignBrief must be an object');

  if (!isRecord(input.asset)) {
    errors.push('asset must be an object');
  } else if (!asString(input.asset.id)?.trim()) {
    errors.push('asset.id is required');
  }

  if (!isRecord(input.modification)) {
    errors.push('modification must be an object');
  } else {
    for (const key of ['title', 'description', 'cta', 'prompt'] as const) {
      if (!asString(input.modification[key])?.trim()) {
        errors.push(`modification.${key} is required`);
      }
    }
  }

  if (!isRecord(input.campaignContext)) {
    errors.push('campaignContext must be an object');
  } else {
    const domain = asString(input.campaignContext.businessDomain);
    if (!domain || !DOMAINS.includes(domain as KnowledgeDomain)) {
      errors.push('campaignContext.businessDomain must be corporate|retail|cross-business|unknown');
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: input as CreativeInterpreterInput };
}

/**
 * Validates Gemini JSON into a CreativeSpecification skeleton.
 * Authoritative content / domain / sourceAsset are enforced afterwards by the orchestrator.
 */
export function validateCreativeSpecificationPartial(
  value: unknown
): ValidationResult<Omit<CreativeSpecification, 'content' | 'businessDomain' | 'sourceAsset' | 'campaignType' | 'channel'> & {
  content?: CreativeSpecification['content'];
  businessDomain?: KnowledgeDomain;
  sourceAsset?: CreativeSpecification['sourceAsset'];
  campaignType?: string;
  channel?: string;
  requestedChange: string;
  visualFamily: VisualFamily;
  composition: string;
  negativeSpace: NegativeSpace;
  tone: string[];
  preserve: string[];
  avoid: string[];
  accessibility: string[];
}> {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ['CreativeSpecification must be an object'] };

  const requestedChange = asString(value.requestedChange)?.trim();
  if (!requestedChange) errors.push('requestedChange is required');

  const composition = asString(value.composition)?.trim();
  if (!composition) errors.push('composition is required');

  const rawFamily = asString(value.visualFamily)?.trim();
  if (!rawFamily) {
    errors.push('visualFamily is required');
  }

  const normalizedFamily = rawFamily
    ? normalizeVisualFamily(rawFamily, {
        requestedChange: requestedChange ?? undefined,
        composition: composition ?? undefined
      })
    : null;

  if (rawFamily && !normalizedFamily) {
    errors.push(
      `visualFamily must be one of: ${VISUAL_FAMILIES.join(', ')} (could not normalize "${rawFamily}")`
    );
  }

  const negativeSpace = asString(value.negativeSpace);
  if (!negativeSpace || !NEGATIVE_SPACES.includes(negativeSpace as NegativeSpace)) {
    errors.push(`negativeSpace must be one of: ${NEGATIVE_SPACES.join(', ')}`);
  }

  const tone = asStringArray(value.tone, 'tone', errors);
  const preserve = asStringArray(value.preserve, 'preserve', errors);
  const avoid = asStringArray(value.avoid, 'avoid', errors);
  const accessibility = asStringArray(value.accessibility, 'accessibility', errors);

  if (tone && tone.length === 0) errors.push('tone must not be empty');
  if (preserve && preserve.length === 0) errors.push('preserve must not be empty');
  if (avoid && avoid.length === 0) errors.push('avoid must not be empty');
  if (accessibility && accessibility.length === 0) errors.push('accessibility must not be empty');

  // Reject Gemini attempting to pick local filenames / paths.
  const blob = JSON.stringify(value).toLowerCase();
  if (
    blob.includes('.jpg') ||
    blob.includes('.jpeg') ||
    blob.includes('.png') ||
    blob.includes('.svg') ||
    blob.includes('great_escape') ||
    blob.includes('\\barclays') ||
    blob.includes('/barclays')
  ) {
    errors.push('CreativeSpecification must not reference image filenames or filesystem paths');
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      requestedChange: requestedChange!,
      visualFamily: normalizedFamily!,
      composition: composition!,
      negativeSpace: negativeSpace as NegativeSpace,
      tone: tone!,
      preserve: preserve!,
      avoid: avoid!,
      accessibility: accessibility!,
      content: isRecord(value.content)
        ? {
            title: asString(value.content.title) ?? '',
            description: asString(value.content.description) ?? '',
            cta: asString(value.content.cta) ?? ''
          }
        : undefined,
      businessDomain: DOMAINS.includes(value.businessDomain as KnowledgeDomain)
        ? (value.businessDomain as KnowledgeDomain)
        : undefined,
      campaignType: asString(value.campaignType) ?? undefined,
      channel: asString(value.channel) ?? undefined,
      sourceAsset: isRecord(value.sourceAsset)
        ? {
            id: asString(value.sourceAsset.id) ?? '',
            sourceId: asString(value.sourceAsset.sourceId) ?? undefined,
            lineage: asString(value.sourceAsset.lineage) ?? undefined
          }
        : undefined
    }
  };
}

export function parseGeminiJson(text: string): ValidationResult<unknown> {
  try {
    const trimmed = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false, errors: ['Gemini response was not valid JSON'] };
  }
}
