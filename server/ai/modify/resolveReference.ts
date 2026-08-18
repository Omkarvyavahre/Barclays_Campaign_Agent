/**
 * Firefly reference resolution for the Modify workflow.
 *
 * Priority:
 * 1) active edit-source asset image (DAM original or existing Firefly derivative)
 * 2) approved KG visualReference as supporting style reference when the edit source
 *    has no usable image
 * 3) root/edit source id-only fallback (prompt continues; never Retail/logo)
 *
 * Never falls back to Retail, great_escape, unknown, or logos.
 */

import { readFileSync, existsSync } from 'node:fs';
import { basename, extname, resolve as resolvePath } from 'node:path';
import { listLogoAssets, resolveVisualAbsolutePath, selectVisualReference } from '../../knowledge/visualReferences';
import { VISUAL_ENTRIES } from '../../knowledge/catalogue';
import { readRegisteredGeneratedBytes } from '../firefly/storage';
import type { CreativeSpecification, PublicVisualReference } from '../creative/types';
import type { ResolvedFireflyReference, SourceDamAssetReference } from './types';

export class ReferenceResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReferenceResolutionError';
  }
}

const FORBIDDEN_FALLBACK_IDS = new Set(
  VISUAL_ENTRIES.filter(
    (v) =>
      v.businessDomain === 'retail' ||
      v.businessDomain === 'unknown' ||
      /great_escape/i.test(v.sourceFile) ||
      /great_escape/i.test(v.assetPath) ||
      v.category === 'logo' ||
      v.assetKind === 'logo'
  ).map((v) => v.id)
);

function decodeDataUrlOrBase64(input: string, mimeHint?: string): { bytes: Buffer; mimeType: string } | null {
  const dataUrl = /^data:([^;]+);base64,(.+)$/i.exec(input);
  if (dataUrl) {
    return { bytes: Buffer.from(dataUrl[2]!, 'base64'), mimeType: dataUrl[1]! };
  }
  // bare base64
  if (/^[A-Za-z0-9+/=\s]+$/.test(input) && input.replace(/\s/g, '').length > 64) {
    return { bytes: Buffer.from(input.replace(/\s/g, ''), 'base64'), mimeType: mimeHint ?? 'image/png' };
  }
  return null;
}

function assertNotForbiddenReference(id: string, label: string): void {
  if (FORBIDDEN_FALLBACK_IDS.has(id)) {
    throw new ReferenceResolutionError(`${label} is forbidden as a Firefly generative reference`);
  }
  const logos = listLogoAssets();
  if (logos.some((l) => l.id === id)) {
    throw new ReferenceResolutionError('Logo assets cannot be used as Firefly generative references');
  }
}

function generatedIdFromUrl(imageUrl: string): string | null {
  const match = /^\/api\/ai\/generated\/([^/?#]+)/i.exec(imageUrl);
  return match?.[1] ?? null;
}

function mimeFromAssetPath(filePath: string, mimeHint?: string): string {
  if (mimeHint?.startsWith('image/')) return mimeHint;
  const ext = extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/png';
}

/**
 * Resolve trusted public static creatives such as `/assets/iportal-creative-single.png`.
 * Only filenames under `public/assets/` are accepted — no path traversal.
 */
function readPublicAssetBytes(
  imageUrl: string,
  mimeHint?: string
): { bytes: Buffer; mimeType: string } | null {
  const match = /^\/assets\/([^/?#]+)$/i.exec(imageUrl.trim());
  if (!match) return null;
  const fileName = basename(match[1]!);
  if (!fileName || fileName !== match[1]) return null;
  const absolute = resolvePath(process.cwd(), 'public', 'assets', fileName);
  const assetsRoot = resolvePath(process.cwd(), 'public', 'assets');
  if (!absolute.startsWith(assetsRoot) || !existsSync(absolute)) return null;
  return {
    bytes: readFileSync(absolute),
    mimeType: mimeFromAssetPath(absolute, mimeHint)
  };
}

/**
 * Load the active edit-source image. Generated `/api/ai/generated/:id` URLs are
 * resolved to registered bytes so providers receive uploadable image bytes.
 */
export function resolveEditSourceReferenceImage(
  sourceDamAsset: SourceDamAssetReference
): NonNullable<ResolvedFireflyReference['referenceImage']> | null {
  if (!sourceDamAsset) return null;

  if (sourceDamAsset.imageUrl?.startsWith('http')) {
    return { url: sourceDamAsset.imageUrl, mimeType: sourceDamAsset.mimeType };
  }

  if (sourceDamAsset.imageUrl?.startsWith('data:') || sourceDamAsset.imageBase64) {
    const decoded = decodeDataUrlOrBase64(
      sourceDamAsset.imageBase64 ?? sourceDamAsset.imageUrl!,
      sourceDamAsset.mimeType
    );
    if (decoded) {
      return { bytes: decoded.bytes, mimeType: decoded.mimeType };
    }
  }

  if (sourceDamAsset.imageUrl?.startsWith('/assets/')) {
    const local = readPublicAssetBytes(sourceDamAsset.imageUrl, sourceDamAsset.mimeType);
    if (local) {
      return { bytes: local.bytes, mimeType: local.mimeType };
    }
  }

  if (sourceDamAsset.imageUrl?.startsWith('/api/ai/generated/')) {
    const generatedId = generatedIdFromUrl(sourceDamAsset.imageUrl);
    if (generatedId) {
      const registered = readRegisteredGeneratedBytes(generatedId);
      if (registered) {
        return { bytes: registered.bytes, mimeType: registered.mimeType };
      }
    }
    // Registry miss (e.g. after restart) — keep the public URL for local diagnostics.
    return { url: sourceDamAsset.imageUrl, mimeType: sourceDamAsset.mimeType };
  }

  return null;
}

/**
 * Resolve the current asset to concrete image bytes for Gemini image edit.
 * Prefer registered generated bytes / data URLs; fetch remote http(s) when needed.
 * Never returns URL-only references — the image API requires bytes.
 */
export async function resolveEditSourceImageBytes(
  sourceDamAsset: SourceDamAssetReference,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const resolved = resolveEditSourceReferenceImage(sourceDamAsset);
  if (!resolved) return null;

  if (resolved.bytes?.length && resolved.mimeType) {
    return { bytes: resolved.bytes, mimeType: resolved.mimeType };
  }

  if (resolved.url?.startsWith('http')) {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new ReferenceResolutionError('No fetch implementation available to load edit-source image');
    }
    const response = await fetchImpl(resolved.url);
    if (!response.ok) {
      throw new ReferenceResolutionError(
        `Unable to download current asset image (HTTP ${response.status})`
      );
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const mimeType =
      response.headers.get('content-type')?.split(';')[0]?.trim() ||
      resolved.mimeType ||
      sourceDamAsset.mimeType ||
      'image/png';
    return { bytes, mimeType };
  }

  return null;
}

function resolveKnowledgeGraphReference(
  specification: CreativeSpecification,
  visualReference: PublicVisualReference
): ResolvedFireflyReference {
  assertNotForbiddenReference(visualReference.id, 'KG visual reference');
  if (listLogoAssets().some((l) => l.id === visualReference.id)) {
    throw new ReferenceResolutionError('Logo assets cannot be used as Firefly generative references');
  }
  if (
    specification.businessDomain === 'corporate' &&
    visualReference.businessDomain === 'retail'
  ) {
    throw new ReferenceResolutionError('Retail imagery cannot be used for Corporate Firefly reference');
  }
  if (visualReference.businessDomain === 'unknown') {
    throw new ReferenceResolutionError('Unknown-domain imagery cannot be used as Firefly reference');
  }

  const entry = VISUAL_ENTRIES.find((v) => v.id === visualReference.id);
  let bytes: Buffer | undefined;
  let mimeType = visualReference.mimeType;
  if (entry) {
    const abs = resolveVisualAbsolutePath(entry);
    if (existsSync(abs)) {
      bytes = readFileSync(abs);
      mimeType = entry.mimeType;
    }
  }

  return {
    referenceSource: 'knowledge-graph',
    visualReference,
    referenceId: visualReference.id,
    referenceImage: bytes ? { bytes, mimeType } : null
  };
}

/**
 * Resolves visual references for provider-specific operations.
 *
 * `modify` requires the current asset image.
 * `generate` uses only optional KG style guidance and never treats the current
 * asset as permission for an image edit.
 */
export function resolveModifyVisualReference(options: {
  mode: 'modify' | 'generate';
  specification: CreativeSpecification;
  visualReference: PublicVisualReference | null;
  sourceDamAsset: SourceDamAssetReference;
  /** When true, refuse prompt-only fallback — the edit source image is mandatory. */
  requireEditSourceImage?: boolean;
}): ResolvedFireflyReference {
  const { specification, visualReference, sourceDamAsset, mode } = options;

  if (!sourceDamAsset?.id) {
    throw new ReferenceResolutionError(
      'No edit-source asset supplied for Modify reference resolution'
    );
  }

  assertNotForbiddenReference(sourceDamAsset.id, 'Edit source asset');

  // Defence in depth: never silently pick a retail KG image when corporate ref is null.
  const accidentalRetail = selectVisualReference({
    businessDomain: 'retail',
    campaignType: specification.campaignType,
    channel: specification.channel,
    visualFamily: specification.visualFamily
  });
  if (accidentalRetail && specification.businessDomain === 'corporate') {
    // We deliberately do not use accidentalRetail.
  }

  // New generation must not silently edit the current asset.
  if (mode === 'generate') {
    // KG style guidance is optional and only valid when it matches the visual family
    // deterministically inferred from the marketer's generation prompt.
    if (visualReference?.visualFamily === specification.visualFamily) {
      return resolveKnowledgeGraphReference(specification, visualReference);
    }
    return {
      referenceSource: 'none',
      visualReference: null,
      referenceId: sourceDamAsset.id,
      referenceImage: null
    };
  }

  // Priority 1 — active selected asset image (original DAM or Firefly derivative).
  const editSourceImage = resolveEditSourceReferenceImage(sourceDamAsset);
  if (editSourceImage) {
    return {
      referenceSource: 'source-dam-asset',
      visualReference: null,
      referenceId: sourceDamAsset.id,
      referenceImage: editSourceImage
    };
  }

  if (options.requireEditSourceImage) {
    throw new ReferenceResolutionError(
      'modify_current_asset requires the current asset image as the edit source'
    );
  }

  // Priority 2 — approved KG style reference only when the edit source has no image.
  if (visualReference) {
    return resolveKnowledgeGraphReference(specification, visualReference);
  }

  // Priority 3 — id-only fallback so generation can continue without retail/logo images.
  return {
    referenceSource: 'source-dam-asset',
    visualReference: null,
    referenceId: sourceDamAsset.id,
    referenceImage: null
  };
}

export function isForbiddenFallbackId(id: string): boolean {
  return FORBIDDEN_FALLBACK_IDS.has(id);
}
