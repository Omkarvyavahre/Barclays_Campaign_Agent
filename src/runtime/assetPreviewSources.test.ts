/**
 * Per-slot preview sources.
 *
 * The whole V19 runtime chain is evaluated so these tests read the shipped asset records and
 * the active damPreview/renderAssets implementations. One physical creative must never stand
 * in for a slot that has no matched asset. No Gemini or Firefly calls happen: the
 * modify-asset endpoint is mocked and every request URL is asserted.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scanInteriorBlankBands } from '../../server/ai/modify/blankBand';
import { V19_MARKUP } from './v19Markup';
import { V19_SCRIPTS } from './scriptManifest';

type AnyRecord = Record<string, unknown>;

const EMAIL_CREATIVE = '/assets/iportal-creative-single.png';
const MOBILE_CREATIVE = '/assets/iportal-creative-linkedin-mobile.png';
const WEB_CREATIVE = '/assets/iportal-creative-linkedin-web.png';
const GENERATED_WEB_IMAGE = '/api/ai/generated/ff-web-0001';

function publicAsset(url: string): Buffer {
  return readFileSync(resolve(process.cwd(), 'public' + url));
}

function globals() {
  return globalThis as unknown as AnyRecord;
}

function loadV19Runtime() {
  document.body.innerHTML = `<div id="v19-host">${V19_MARKUP}</div>`;
  if (!('scrollTo' in Element.prototype)) {
    (Element.prototype as unknown as AnyRecord).scrollTo = () => {};
  }
  const sources = V19_SCRIPTS.map((src) =>
    readFileSync(resolve(process.cwd(), 'public' + src), 'utf8')
  );
  (0, eval)(sources.join('\n;\n') + '\n;window.state = state;');
  globals().renderTeams = () => {};
}

function assets(): AnyRecord[] {
  return (globals().state as AnyRecord).assets as AnyRecord[];
}

function assetIndex(id: string): number {
  return assets().findIndex((a) => a.id === id);
}

function assetById(id: string): AnyRecord {
  return assets()[assetIndex(id)]!;
}

/** Stage 5 markup for one slot, rendered through the live tab renderer. */
function slotMarkup(id: string): string {
  (globals().state as AnyRecord).assetTab = assetIndex(id);
  return (globals().renderAssets as () => string)();
}

function parse(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

function buttonLabels(html: string): string[] {
  return Array.from(parse(html).querySelectorAll('button')).map((b) => (b.textContent || '').trim());
}

/** Selected variant thumb — asserting on the whole card would also match metadata text. */
function previewMarkup(id: string): string {
  const root = parse(slotMarkup(id));
  const selected = root.querySelector('.v19-variant-row.is-selected .v19-variant-thumb');
  if (selected) return selected.outerHTML;
  return root.querySelector('.v17-asset-preview')?.innerHTML ?? root.innerHTML;
}

function mockRegenerateEndpoint(imageUrl = GENERATED_WEB_IMAGE) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    return {
      ok: true,
      status: 200,
      json: async () => ({
        stage: 'ready',
        intent: 'modify_current_asset',
        instruction: '',
        confidence: 0.9,
        derivedAsset: {
          id: 'FF-DER-WEB0000001',
          sourceId: body.rootSourceDamAssetId,
          editSourceAssetId: body.editSourceAssetId,
          derivedFromAssetId: body.editSourceAssetId,
          rootSourceDamAssetId: body.rootSourceDamAssetId,
          derived: true,
          generationSource: body.regenerate ? 'firefly' : 'gemini-image',
          channel: 'LinkedIn',
          format: 'Sponsored content · web',
          dimensions: '1200 × 627',
          requirement: 'LinkedIn sponsored content — web',
          name: 'LinkedIn web creative · generated',
          headline: 'One connected digital front door',
          copy: 'Bring payments and reporting together.',
          cta: 'Discover iPortal',
          imageUrl,
          matchStatus: 'AI-modified',
          confidence: 'Campaign-ready draft',
          sourceType: 'Adobe Firefly',
          lineage: 'Generated creative',
          jobId: 'FF-WEB-1',
          version: 1
        },
        interpretation: { visualReference: null }
      })
    };
  });
  globals().fetch = fetchMock;
  return fetchMock;
}

async function regenerate(id: string, prompt = 'A photographic corporate banking web hero') {
  const index = assetIndex(id);
  (globals().regenerateFireflyDerivative as (i: number) => void)(index);
  (document.getElementById('fireflyGenerationPrompt') as HTMLTextAreaElement).value = prompt;
  await (globals().submitFireflyRegeneration as (i: number) => Promise<void>)(index);
  return index;
}

async function modify(id: string, prompt = 'Remove the on-image text') {
  const index = assetIndex(id);
  (globals().openGenStudioRequest as (i: number, mode: string) => void)(index, 'modify');
  const field = document.getElementById('gsPrompt') as HTMLTextAreaElement | null;
  if (field) field.value = prompt;
  await (globals().submitGenStudioAssetRequest as (i: number, mode: string) => Promise<void>)(
    index,
    'modify'
  );
  return index;
}

function requestBodies(fetchMock: ReturnType<typeof vi.fn>): AnyRecord[] {
  return fetchMock.mock.calls.map(([, init]) =>
    JSON.parse(String((init as RequestInit).body))
  ) as AnyRecord[];
}

function requestUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input));
}

describe('preloaded asset previews per channel', () => {
  beforeEach(() => {
    loadV19Runtime();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as AnyRecord).fetch;
  });

  it('gives the email slot the single-panel creative and no embedded base64', () => {
    expect(assetById('DAM-0231').imageUrl).toBe(EMAIL_CREATIVE);

    const runtime = readFileSync(resolve(process.cwd(), 'public/runtime/v19-0.js'), 'utf8');
    expect(runtime).not.toMatch(/data:image\/png;base64,/);
    expect(previewMarkup('DAM-0231')).toContain(EMAIL_CREATIVE);
  });

  it('gives the LinkedIn mobile slot its own square source, not the email creative', () => {
    expect(assetById('DAM-0188').imageUrl).toBe(MOBILE_CREATIVE);

    const preview = previewMarkup('DAM-0188');
    expect(preview).toContain(MOBILE_CREATIVE);
    expect(preview).not.toContain(EMAIL_CREATIVE);
  });

  it('fits previews with a centred cover instead of the old 200% anchored crop', () => {
    for (const id of ['DAM-0188', 'DAM-0231', 'REQ-LI-WEB']) {
      const preview = previewMarkup(id);
      expect(preview).toContain('v19-variant-thumb');
      expect(preview).not.toContain('200%');
      expect(preview).not.toContain('asset-crop-right');
      expect(preview).not.toContain('asset-crop-left');
    }

    const styles = readFileSync(resolve(process.cwd(), 'src/styles/v19.css'), 'utf8');
    expect(styles).toMatch(/\.v19-variant-thumb\{[^}]*center\/cover/);
    const runtime = readFileSync(resolve(process.cwd(), 'public/runtime/v19-1.js'), 'utf8');
    expect(runtime).not.toContain('asset-crop-right');
  });

  it('gives the LinkedIn web slot its own landscape source, not mobile or email', () => {
    const web = assetById('REQ-LI-WEB');
    expect(web.imageUrl).toBe(WEB_CREATIVE);
    expect(web.found).toBe(true);
    expect(web.matchStatus).not.toMatch(/No suitable/i);
    expect(web.confidence).not.toBe('No match');

    const preview = previewMarkup('REQ-LI-WEB');
    expect(preview).toContain(WEB_CREATIVE);
    expect(preview).not.toContain(EMAIL_CREATIVE);
    expect(preview).not.toContain(MOBILE_CREATIVE);
    expect(preview).not.toContain('is-missing');
    expect(preview).not.toContain('Creative required');
  });

  it('shows Adaptation recommended rather than a no-match gap for LinkedIn web', () => {
    const markup = slotMarkup('REQ-LI-WEB');
    expect(markup).toContain('Adaptation recommended');
    expect(markup).not.toContain('No suitable DAM asset');
    expect(markup).not.toContain('No match');
    expect(markup).not.toContain('Creative required');
  });

  it('offers Modify, Add new creative and agency approval once the web slot owns a creative', () => {
    for (const id of ['DAM-0188', 'DAM-0231', 'REQ-LI-WEB']) {
      const labels = buttonLabels(slotMarkup(id));
      expect(labels).toContain('Modify asset');
      // Generation entry point now lives in the bottom action bar, not per card.
      expect(labels).not.toContain('Regenerate creative');
      expect(labels).toContain('Add new creative');
      expect(labels).toContain('Send for agency approval');
    }
  });

  it('refuses to open Modify for a slot with no source instead of borrowing another creative', async () => {
    const toasts: string[] = [];
    globals().toast = (message: string) => toasts.push(message);
    const fetchMock = vi.fn();
    globals().fetch = fetchMock;

    // A synthetic gap slot proves the guard still works even though every shipped
    // channel now carries its own preloaded creative.
    (globals().state as AnyRecord).assets = [
      ...assets(),
      {
        id: 'REQ-GAP',
        channel: 'LinkedIn',
        format: 'Gap',
        dimensions: '800 × 800',
        found: false,
        imageUrl: null,
        requirement: 'Unmatched gap'
      }
    ];

    (globals().openGenStudioRequest as (i: number, mode: string) => void)(
      assetIndex('REQ-GAP'),
      'modify'
    );

    expect(document.getElementById('modalRoot')?.innerHTML).toBe('');
    expect(toasts.join(' ')).toMatch(/no creative to modify/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends each asset its own image as the modify source', async () => {
    const emailFetch = mockRegenerateEndpoint('/api/ai/generated/gm-email-0001');
    await modify('DAM-0231');

    const [emailBody] = requestBodies(emailFetch);
    expect(requestUrls(emailFetch)).toEqual(['/api/ai/modify-asset']);
    expect((emailBody!.sourceDamAsset as AnyRecord).id).toBe('DAM-0231');
    expect((emailBody!.sourceDamAsset as AnyRecord).imageUrl).toBe(EMAIL_CREATIVE);

    loadV19Runtime();
    const mobileFetch = mockRegenerateEndpoint('/api/ai/generated/gm-mobile-0001');
    await modify('DAM-0188');

    const [mobileBody] = requestBodies(mobileFetch);
    expect(requestUrls(mobileFetch)).toEqual(['/api/ai/modify-asset']);
    expect((mobileBody!.sourceDamAsset as AnyRecord).id).toBe('DAM-0188');
    expect((mobileBody!.sourceDamAsset as AnyRecord).imageUrl).toBe(MOBILE_CREATIVE);

    loadV19Runtime();
    const webFetch = mockRegenerateEndpoint('/api/ai/generated/gm-web-0001');
    await modify('REQ-LI-WEB');

    const [webBody] = requestBodies(webFetch);
    expect(requestUrls(webFetch)).toEqual(['/api/ai/modify-asset']);
    expect((webBody!.sourceDamAsset as AnyRecord).id).toBe('REQ-LI-WEB');
    expect((webBody!.sourceDamAsset as AnyRecord).imageUrl).toBe(WEB_CREATIVE);
  });

  it('edits the Modified candidate image, not the Original, once a slot has been modified', async () => {
    mockRegenerateEndpoint('/api/ai/generated/gm-email-0002');
    await modify('DAM-0231');

    const slot = assetById('DAM-0231');
    expect(slot.id).toBe('DAM-0231');
    expect(slot.imageUrl).toBe(EMAIL_CREATIVE);
    expect((slot.modifiedCandidate as AnyRecord).imageUrl).toBe('/api/ai/generated/gm-email-0002');
    expect(slot.selectedCandidateKind).toBe('modified');

    const fetchMock = mockRegenerateEndpoint('/api/ai/generated/gm-email-0003');
    await modify('DAM-0231');

    const [body] = requestBodies(fetchMock);
    expect((body!.sourceDamAsset as AnyRecord).imageUrl).toBe('/api/ai/generated/gm-email-0002');
    expect((slot.modifiedCandidate as AnyRecord).imageUrl).toBe('/api/ai/generated/gm-email-0003');
  });

  it('regenerates the web slot and upserts Generated without replacing Original', async () => {
    const fetchMock = mockRegenerateEndpoint();
    const index = await regenerate('REQ-LI-WEB');

    const [body] = requestBodies(fetchMock);
    expect(requestUrls(fetchMock)).toEqual(['/api/ai/modify-asset']);
    expect(body!.regenerate).toBe(true);
    expect((body!.sourceDamAsset as AnyRecord).imageUrl).toBe(WEB_CREATIVE);
    expect((body!.asset as AnyRecord).channel).toBe('LinkedIn');
    expect((body!.asset as AnyRecord).dimensions).toBe('1200 × 627');

    const slot = assets()[index]!;
    expect(slot.id).toBe('REQ-LI-WEB');
    expect(slot.imageUrl).toBe(WEB_CREATIVE);
    expect((slot.generatedCandidate as AnyRecord).id).toBe('FF-DER-WEB0000001');
    expect((slot.generatedCandidate as AnyRecord).imageUrl).toBe(GENERATED_WEB_IMAGE);
    expect(slot.selectedCandidateKind).toBe('generated');
    expect(slot.rootAssetSnapshot).toMatchObject({ id: 'REQ-LI-WEB', imageUrl: WEB_CREATIVE });

    (globals().state as AnyRecord).assetTab = index;
    const markup = (globals().renderAssets as () => string)();
    const selectedThumb =
      parse(markup).querySelector('.v19-variant-row.is-selected .v19-variant-thumb')?.outerHTML ??
      '';
    expect(selectedThumb).toContain(GENERATED_WEB_IMAGE);
    expect(selectedThumb).not.toContain(WEB_CREATIVE);
    expect(selectedThumb).not.toContain(EMAIL_CREATIVE);
    expect(buttonLabels(markup)).toContain('Modify asset');
    expect(
      [...parse(markup).querySelectorAll('.v19-variant-label')].map((n) => n.textContent)
    ).toEqual(['Original', 'Generated']);
  });

  it('hands the web creative to Stage 7 when the LinkedIn web slot is selected', () => {
    const g = globals();
    const webIndex = assetIndex('REQ-LI-WEB');
    // Deselect every other LinkedIn asset so the channel output must come from the web slot.
    for (const asset of assets()) {
      if (String(asset.channel) === 'LinkedIn') asset.included = asset.id === 'REQ-LI-WEB';
    }
    (g.acceptStageAsset as (i: number, label: string) => void)(5, 'Asset-selection package');

    const output = ((g.state as AnyRecord).outputs as AnyRecord).linkedin as AnyRecord;
    expect(output.assetId).toBe('REQ-LI-WEB');
    expect(output.imageUrl).toBe(WEB_CREATIVE);

    (g.state as AnyRecord).outputTab = 'linkedin';
    const markup = (g.renderOutputs as () => string)();
    expect(markup).toContain(WEB_CREATIVE);
    expect(markup).not.toContain(MOBILE_CREATIVE);
    expect(markup).not.toContain(EMAIL_CREATIVE);
  });

  it('keeps damPreview free of a global creative fallback', () => {
    const damPreview = globals().damPreview as (a: AnyRecord) => string;

    expect(damPreview({ id: 'UNKNOWN-1', dimensions: '800 × 800' })).toContain('is-missing');
    expect(damPreview({ id: 'UNKNOWN-1', dimensions: '800 × 800' })).not.toContain(EMAIL_CREATIVE);
    expect(damPreview({ id: 'X', imageUrl: '/api/ai/generated/x' })).toContain(
      '/api/ai/generated/x'
    );
  });
});

describe('LinkedIn mobile source file', () => {
  it('is a valid 1080 x 1080 PNG', async () => {
    const bytes = publicAsset(MOBILE_CREATIVE);
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );

    const meta = await sharp(bytes).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1080);
  });

  it('is an aspect-preserving crop of the single-panel creative, not a stretch', async () => {
    // The crop is square in the source too, so the only transform is a uniform upscale.
    const source = await sharp(publicAsset(EMAIL_CREATIVE)).metadata();
    expect([source.width, source.height]).toEqual([559, 706]);

    const crop = { left: 44, top: 42, width: 481, height: 481 };
    const expected = await sharp(publicAsset(EMAIL_CREATIVE))
      .extract(crop)
      .resize(1080, 1080, { fit: 'cover', position: 'center', kernel: 'lanczos3' })
      .raw()
      .toBuffer();
    const actual = await sharp(publicAsset(MOBILE_CREATIVE)).raw().toBuffer();

    expect(crop.width / crop.height).toBe(1);
    expect(actual.equals(expected)).toBe(true);
  });

  it('carries no blank gutter that would split the composition', async () => {
    const scan = await scanInteriorBlankBands(publicAsset(MOBILE_CREATIVE));
    expect(scan.width).toBe(1080);
    expect(scan.height).toBe(1080);
    expect(scan.bands).toEqual([]);
  });

  it('keeps the navy hero panel dominant and unduplicated', async () => {
    const { data, info } = await sharp(publicAsset(MOBILE_CREATIVE))
      .raw()
      .toBuffer({ resolveWithObject: true });

    const navyRow = (y: number) => {
      let count = 0;
      for (let x = 0; x < info.width; x += 1) {
        const i = (y * info.width + x) * info.channels;
        const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
        if (b > 40 && b < 190 && r < 90 && g < 120 && b - r > 25) count += 1;
      }
      return count / info.width;
    };

    const heroRows: number[] = [];
    for (let y = 0; y < info.height; y += 1) if (navyRow(y) > 0.5) heroRows.push(y);

    // One contiguous hero block covering most of the square: a duplicated panel would
    // show up as two separated runs.
    expect(heroRows.length / info.height).toBeGreaterThan(0.55);
    const runs = heroRows.reduce(
      (total, y, index) => (index > 0 && y !== heroRows[index - 1]! + 1 ? total + 1 : total),
      1
    );
    expect(runs).toBe(1);
  });
});

describe('LinkedIn web source file', () => {
  it('is a valid 1200 x 627 PNG', async () => {
    const bytes = publicAsset(WEB_CREATIVE);
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );

    const meta = await sharp(bytes).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(627);
  });

  it('is an aspect-preserving landscape crop of the single-panel creative, not a stretch', async () => {
    const crop = { left: 44, top: 170, width: 481, height: 251 };
    const expected = await sharp(publicAsset(EMAIL_CREATIVE))
      .extract(crop)
      .resize(1200, 627, { fit: 'cover', position: 'center', kernel: 'lanczos3' })
      .raw()
      .toBuffer();
    const actual = await sharp(publicAsset(WEB_CREATIVE)).raw().toBuffer();

    expect(actual.equals(expected)).toBe(true);
  });

  it('carries no blank gutter that would split the composition', async () => {
    const scan = await scanInteriorBlankBands(publicAsset(WEB_CREATIVE));
    expect(scan.width).toBe(1200);
    expect(scan.height).toBe(627);
    expect(scan.bands).toEqual([]);
  });

  it('keeps a single contiguous navy hero without duplicated panels', async () => {
    const { data, info } = await sharp(publicAsset(WEB_CREATIVE))
      .raw()
      .toBuffer({ resolveWithObject: true });

    const navyRow = (y: number) => {
      let count = 0;
      for (let x = 0; x < info.width; x += 1) {
        const i = (y * info.width + x) * info.channels;
        const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
        if (b > 40 && b < 190 && r < 90 && g < 120 && b - r > 25) count += 1;
      }
      return count / info.width;
    };

    const heroRows: number[] = [];
    for (let y = 0; y < info.height; y += 1) if (navyRow(y) > 0.5) heroRows.push(y);

    expect(heroRows.length / info.height).toBeGreaterThan(0.85);
    const runs = heroRows.reduce(
      (total, y, index) => (index > 0 && y !== heroRows[index - 1]! + 1 ? total + 1 : total),
      1
    );
    expect(runs).toBe(1);
  });
});