import { readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { resolveResourceRoot, resourceExists } from './paths';
import type { ContentKind, KnowledgeCategory, KnowledgeDomain, SourceInventoryItem } from './types';

type Classification = {
  category: KnowledgeCategory;
  businessDomain: KnowledgeDomain;
  description: string;
  contentKind: ContentKind;
};

/**
 * Classifies a source from filename and extension only.
 * Uncertain files stay `unknown` / `other` — never forced into corporate.
 */
function classifySource(filename: string, fileType: string): Classification {
  const lower = filename.toLowerCase();

  if (fileType === '.svg' || /logo/i.test(filename)) {
    return {
      category: 'logo',
      businessDomain: 'cross-business',
      description: 'Barclays logo asset from the brand resource pack.',
      contentKind: 'visual'
    };
  }

  if (fileType === '.pptx' && /gs4pm|genstudio/i.test(lower)) {
    return {
      category: 'genstudio',
      businessDomain: 'cross-business',
      description: 'Adobe GenStudio for Performance Marketing scope and definitions for Barclays UK.',
      contentKind: 'text'
    };
  }

  if (/tone.?of.?voice|retail.?banking.?tone/i.test(lower)) {
    return {
      category: 'tone-of-voice',
      businessDomain: 'retail',
      description: 'Barclays Retail Banking tone of voice, brand values and channel editorial guidelines.',
      contentKind: 'text'
    };
  }

  if (/product.?description/i.test(lower)) {
    return {
      category: 'product',
      businessDomain: 'retail',
      description: 'Barclays retail product descriptions, propositions and messaging preferences.',
      contentKind: 'text'
    };
  }

  if (/persona|fresco.?segment/i.test(lower)) {
    return {
      category: 'persona',
      businessDomain: 'retail',
      description: 'Fresco segment user personas with communication styles (retail audience segments).',
      contentKind: 'text'
    };
  }

  if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(fileType)) {
    if (/mort|mortgage|shared.?ownership|ftb|first.?time/i.test(lower)) {
      return {
        category: 'visual-reference',
        businessDomain: 'retail',
        description: 'Retail mortgage / home-ownership campaign or lifestyle visual reference.',
        contentKind: 'visual'
      };
    }
    // Corporate / iPortal only when filename or path evidence is explicit.
    if (/iportal|i-portal|corporate.?banking|ukc|gcb|abstract.?digital|cyan.?ribbon/i.test(lower)) {
      return {
        category: 'visual-reference',
        businessDomain: 'corporate',
        description: 'Corporate / iPortal campaign visual reference (filename/path evidence).',
        contentKind: 'visual'
      };
    }
    if (/great.?escape/i.test(lower)) {
      return {
        category: 'visual-reference',
        businessDomain: 'unknown',
        description: 'Campaign visual whose business domain is not stated in the filename or folder structure.',
        contentKind: 'visual'
      };
    }
    return {
      category: 'visual-reference',
      businessDomain: 'unknown',
      description: 'Image asset without enough path/filename evidence to assign a business domain.',
      contentKind: 'visual'
    };
  }

  return {
    category: 'other',
    businessDomain: 'unknown',
    description: 'Unclassified resource; domain left unknown pending clearer evidence.',
    contentKind: fileType === '.pdf' || fileType === '.pptx' || fileType === '.docx' ? 'text' : 'visual'
  };
}

function slugify(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function walkFiles(root: string, dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(root, full, out);
      continue;
    }
    if (entry.isFile()) out.push(full);
  }
}

/**
 * Recursively inventories every file in the Barclays resource folder.
 * Throws a descriptive error when the folder is missing so callers can fail gracefully.
 */
export function inventoryResources(resourceRootOverride?: string): SourceInventoryItem[] {
  if (!resourceExists(resourceRootOverride)) {
    const expected = resolveResourceRoot(resourceRootOverride);
    throw new Error(`Barclays resource folder not found at: ${expected}`);
  }

  const root = resolveResourceRoot(resourceRootOverride);
  const files: string[] = [];
  walkFiles(root, root, files);
  files.sort((a, b) => a.localeCompare(b));

  return files.map((fullPath) => {
    const filename = basename(fullPath);
    const fileType = extname(filename).toLowerCase();
    const relativePath = relative(root, fullPath).split('\\').join('/');
    const classification = classifySource(filename, fileType);
    const stats = statSync(fullPath);

    return {
      id: `src-${slugify(filename)}`,
      filename,
      relativePath,
      fileType: fileType || 'unknown',
      category: classification.category,
      businessDomain: classification.businessDomain,
      description: classification.description,
      contentKind: classification.contentKind,
      bytes: stats.size
    };
  });
}

export function tryInventoryResources(resourceRootOverride?: string): {
  ok: boolean;
  items: SourceInventoryItem[];
  error?: string;
} {
  try {
    return { ok: true, items: inventoryResources(resourceRootOverride) };
  } catch (error) {
    return {
      ok: false,
      items: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
