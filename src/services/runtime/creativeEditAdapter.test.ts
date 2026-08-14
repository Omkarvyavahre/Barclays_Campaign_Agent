/**
 * Stage 7 edit-modal regenerate CTA.
 *
 * Proves the button appears without editing frozen V19 files, that one click
 * equals one Firefly request for the active channel only, that GenStudio save
 * is never invoked, and that draft form values feed the request context.
 *
 * @vitest-environment happy-dom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BarclaysServices, BriefResult, ImageChannel, ImageOutcome } from '../bridge/types';
import { EXPECTED_ASSET_SIZE, currentRunAsset, resetCreativeCandidates } from './creativeCandidates';
import {
  REGENERATE_BUTTON_CLASS,
  REGENERATE_BUTTON_ID,
  REGENERATE_IDLE_LABEL,
  REGENERATE_PENDING_LABEL,
  REGENERATE_STATUS_HOST_ID,
  REGENERATE_STATUS_ID,
  REGENERATE_SUCCESS_MESSAGE,
  briefFromSections,
  injectRegenerateCreativeButton,
  installCreativeEditAdapter,
  readDraftOutputContext,
} from './creativeEditAdapter';
import type { V19RuntimeAccess } from './runtimeAccess';

const IDS: Record<ImageChannel, string> = {
  linkedin: 'linkedin-f1bca403-4fd1-4246-8789-50bbd52f2bec',
  email: 'email-8781d5ae-a62f-43c7-b41b-e3524ff0f0b3',
};

function asset(channel: ImageChannel, id = IDS[channel]) {
  return {
    id,
    url: `/api/images/asset/${id}`,
    channel,
    width: EXPECTED_ASSET_SIZE.width,
    height: EXPECTED_ASSET_SIZE.height,
    bytes: 1000,
  };
}

function liveBrief(): BriefResult {
  return {
    campaignName: 'iPortal Adoption',
    fields: {
      qualObjectives: 'Deepen digital adoption across corporate clients with measurable self-serve outcomes.',
      audience: 'Corporate treasury and payments operations teams across UKC.',
      painPoints: 'Manual servicing creates friction, delay and duplicated effort for clients.',
      offering: 'One connected digital front door for servicing and onboarding journeys.',
      audienceMessaging: 'Premium, calm and confident digital transformation for corporate clients.',
      attributes: 'Brand-safe abstract visual language only.',
      cta: 'Explore iPortal',
    },
  };
}

function modalMarkup(label: string): string {
  return `<div class="modal-backdrop"><div class="modal wide"><h2>Edit ${label}</h2>
    <div class="form-grid">
      <div class="field full"><label>Headline</label><input id="outHeadline" value="Draft headline from modal"></div>
      <div class="field full"><label>Body copy</label><textarea id="outBody">Body</textarea></div>
      <div class="field"><label>CTA</label><input id="outCta" value="Draft CTA"></div>
      <div class="field"><label>Tracking details</label><input id="outTracking" value="utm"></div>
      <div class="field full"><label>Accessibility text</label><textarea id="outAccessibility">Alt</textarea></div>
    </div>
    <div class="modal-actions">
      <button class="btn" type="button" id="cancelBtn">Cancel</button>
      <button class="btn primary" type="button" id="sendBtn">Send update to Adobe GenStudio</button>
    </div>
  </div></div>`;
}

describe('creative edit adapter', () => {
  let submitSpy: ReturnType<typeof vi.fn<(key: string) => unknown>>;

  beforeEach(() => {
    resetCreativeCandidates();
    document.body.innerHTML = '<div id="modalRoot"></div>';
    submitSpy = vi.fn<(key: string) => unknown>();
    window.submitOutputEdit = submitSpy;
    window.openOutputEdit = (key: string) => {
      const label = key === 'email' ? 'Email activation journey' : 'LinkedIn sponsored content — web';
      document.getElementById('modalRoot')!.innerHTML = modalMarkup(label);
    };
  });

  afterEach(() => {
    resetCreativeCandidates();
    document.body.innerHTML = '';
    delete window.openOutputEdit;
    delete window.submitOutputEdit;
    delete window.__BARCLAYS_REGENERATE_CREATIVE__;
    delete window.__V19_CREATIVE_EDIT_ADAPTER_INSTALLED__;
  });

  function access(brief: BriefResult = liveBrief()): V19RuntimeAccess {
    return {
      getState: () => ({
        campaignName: brief.campaignName,
        outputs: {
          linkedin: { headline: 'Stored LinkedIn headline', cta: 'Stored LinkedIn CTA' },
          email: { headline: 'Stored Email headline', cta: 'Stored Email CTA' },
        },
      }),
      getBriefSections: () => [
        {
          name: 'Brief',
          fields: Object.entries(brief.fields).map(([key, value]) => [key, key, value] as [string, string, string]),
        },
      ],
      getTeamsState: () => ({ runId: 7, authorised: true, summaryReady: true }),
    };
  }

  function install(generate: ReturnType<typeof vi.fn>, channelBrief?: BriefResult) {
    const bridge = { images: { generate } } as unknown as BarclaysServices;
    const applied = channelBrief ?? liveBrief();
    const uninstall = installCreativeEditAdapter({
      bridge,
      access: access(applied),
      getAppliedBrief: () => applied,
    });
    return { bridge, uninstall };
  }

  it('1. shows Regenerate creative in the Stage 7 edit modal', async () => {
    const generate = vi.fn();
    const { uninstall } = install(generate);
    window.openOutputEdit?.('linkedin');
    await Promise.resolve();

    const button = document.getElementById(REGENERATE_BUTTON_ID) as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.textContent).toBe(REGENERATE_IDLE_LABEL);
    expect(button.className).toContain('btn');
    expect(document.getElementById('sendBtn')?.textContent).toContain('Send update to Adobe GenStudio');
    uninstall();
  });

  it.each(['linkedin', 'email'] as const)(
    'orders the %s footer Cancel -> Regenerate creative -> Send update',
    async (channel) => {
      const { uninstall } = install(vi.fn());
      window.openOutputEdit?.(channel);
      await Promise.resolve();

      const actions = document.querySelector('#modalRoot .modal-actions')!;
      expect([...actions.querySelectorAll('button')].map((el) => el.textContent)).toEqual([
        'Cancel',
        REGENERATE_IDLE_LABEL,
        'Send update to Adobe GenStudio',
      ]);
      uninstall();
    },
  );

  it('gives the CTA the shared action-button box with a stepped-back fill', async () => {
    const { uninstall } = install(vi.fn());
    window.openOutputEdit?.('linkedin');
    await Promise.resolve();

    const button = document.getElementById(REGENERATE_BUTTON_ID) as HTMLButtonElement;
    const send = document.getElementById('sendBtn') as HTMLButtonElement;

    // Same base + primary classes as the save action, so metrics come from V19.
    expect(button.classList.contains('btn')).toBe(true);
    expect(button.classList.contains('primary')).toBe(true);
    expect(send.classList.contains('btn')).toBe(true);
    expect(send.classList.contains('primary')).toBe(true);
    // Its own modifier is what steps the fill back.
    expect(button.classList.contains('bx-regenerate-creative')).toBe(true);
    expect(button.className).toBe(REGENERATE_BUTTON_CLASS);
    uninstall();
  });

  it('keeps the footer row to three buttons by hosting status above it', async () => {
    const generate = vi.fn(async () => ({
      ok: false as const,
      error: { category: 'upstream_error', message: 'no' },
    }));
    const { uninstall } = install(generate);
    window.openOutputEdit?.('linkedin');
    await Promise.resolve();

    document.getElementById(REGENERATE_BUTTON_ID)!.click();
    await vi.waitFor(() => expect(document.getElementById(REGENERATE_STATUS_ID)).toBeTruthy());

    const actions = document.querySelector('#modalRoot .modal-actions')!;
    expect(actions.querySelectorAll('button')).toHaveLength(3);
    expect(actions.contains(document.getElementById(REGENERATE_STATUS_ID))).toBe(false);
    expect(document.getElementById(REGENERATE_STATUS_HOST_ID)?.nextElementSibling).toBe(actions);
    uninstall();
  });

  it('2 & 4. LinkedIn modal regenerates LinkedIn only with exactly one request', async () => {
    const generate = vi.fn(async (payload: { channel: ImageChannel }) => ({
      ok: true as const,
      data: {
        source: 'firefly' as const,
        asset: asset(payload.channel, 'linkedin-11111111-1111-1111-1111-111111111111'),
        referenceSlot: 1 as const,
      } satisfies ImageOutcome,
    }));
    const { uninstall } = install(generate);
    window.openOutputEdit?.('linkedin');
    await Promise.resolve();

    document.getElementById(REGENERATE_BUTTON_ID)!.click();
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(currentRunAsset('linkedin')?.id).toContain('linkedin-11111111'));

    expect(generate.mock.calls[0][0].channel).toBe('linkedin');
    expect(currentRunAsset('email')).toBeNull();
    uninstall();
  });

  it('3. Email modal regenerates Email only', async () => {
    const generate = vi.fn(async (payload: { channel: ImageChannel }) => ({
      ok: true as const,
      data: {
        source: 'firefly' as const,
        asset: asset(payload.channel, 'email-22222222-2222-2222-2222-222222222222'),
        referenceSlot: 1 as const,
      },
    }));
    const { uninstall } = install(generate);
    window.openOutputEdit?.('email');
    await Promise.resolve();

    document.getElementById(REGENERATE_BUTTON_ID)!.click();
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    expect(generate.mock.calls[0][0].channel).toBe('email');
    expect(currentRunAsset('linkedin')).toBeNull();
    uninstall();
  });

  it('5 & 6. double click while pending does not duplicate; button shows Regenerating…', async () => {
    let release: (value: unknown) => void = () => {};
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const generate = vi.fn(async (payload: { channel: ImageChannel }) => {
      await gate;
      return {
        ok: true as const,
        data: { source: 'firefly' as const, asset: asset(payload.channel), referenceSlot: 1 as const },
      };
    });
    const { uninstall } = install(generate);
    window.openOutputEdit?.('linkedin');
    await Promise.resolve();

    const button = document.getElementById(REGENERATE_BUTTON_ID) as HTMLButtonElement;
    button.click();
    await vi.waitFor(() => expect(button.textContent).toBe(REGENERATE_PENDING_LABEL));
    expect(button.disabled).toBe(true);
    button.click();
    button.click();
    expect(generate).toHaveBeenCalledTimes(1);

    release(undefined);
    await vi.waitFor(() => expect(button.textContent).toBe(REGENERATE_IDLE_LABEL));
    uninstall();
  });

  it('7. success promotes the new current asset and shows status', async () => {
    const generate = vi.fn(async (payload: { channel: ImageChannel }) => ({
      ok: true as const,
      data: {
        source: 'firefly' as const,
        asset: asset(payload.channel, 'linkedin-33333333-3333-3333-3333-333333333333'),
        referenceSlot: 1 as const,
      },
    }));
    const { uninstall } = install(generate);
    window.openOutputEdit?.('linkedin');
    await Promise.resolve();
    document.getElementById(REGENERATE_BUTTON_ID)!.click();

    await vi.waitFor(() =>
      expect(currentRunAsset('linkedin')?.id).toBe('linkedin-33333333-3333-3333-3333-333333333333'),
    );
    await vi.waitFor(() =>
      expect(document.getElementById('bx-regenerate-status')?.textContent).toBe(REGENERATE_SUCCESS_MESSAGE),
    );
    uninstall();
  });

  it('8. failure preserves the previous image', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        data: { source: 'firefly', asset: asset('linkedin'), referenceSlot: 1 },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: { category: 'upstream_error', message: 'no' },
      });
    const { uninstall } = install(generate);
    window.openOutputEdit?.('linkedin');
    await Promise.resolve();

    document.getElementById(REGENERATE_BUTTON_ID)!.click();
    await vi.waitFor(() => expect(currentRunAsset('linkedin')?.id).toBe(IDS.linkedin));

    document.getElementById(REGENERATE_BUTTON_ID)!.click();
    await vi.waitFor(() =>
      expect(document.getElementById('bx-regenerate-status')?.textContent).toMatch(/kept|failed|upstream/i),
    );
    expect(currentRunAsset('linkedin')?.id).toBe(IDS.linkedin);
    uninstall();
  });

  it('10. does not trigger Send update to Adobe GenStudio', async () => {
    const generate = vi.fn(async () => ({
      ok: true as const,
      data: { source: 'mock' as const, asset: null, referenceSlot: 1 as const },
    }));
    const { uninstall } = install(generate);
    window.openOutputEdit?.('linkedin');
    await Promise.resolve();
    document.getElementById(REGENERATE_BUTTON_ID)!.click();
    await vi.waitFor(() => expect(generate).toHaveBeenCalled());
    expect(submitSpy).not.toHaveBeenCalled();
    uninstall();
  });

  it('11. uses current draft form values as context', async () => {
    const generate = vi.fn(async () => ({
      ok: true as const,
      data: { source: 'mock' as const, asset: null, referenceSlot: 1 as const },
    }));
    const { uninstall } = install(generate);
    window.openOutputEdit?.('linkedin');
    await Promise.resolve();

    expect(readDraftOutputContext()).toEqual({
      headline: 'Draft headline from modal',
      cta: 'Draft CTA',
    });

    document.getElementById(REGENERATE_BUTTON_ID)!.click();
    await vi.waitFor(() => expect(generate).toHaveBeenCalled());
    const calls = generate.mock.calls as unknown as Array<[{ outputContext: { headline: string; cta: string }; compositionIdentity?: string }]>;
    const payload = calls[0]![0];
    expect(payload.outputContext).toMatchObject({
      headline: 'Draft headline from modal',
      cta: 'Draft CTA',
    });
    expect(payload.compositionIdentity).toMatch(/^7:linkedin:manual-1:/);
    uninstall();
  });

  it('13. injecting the button / modal rerenders do not generate again', async () => {
    const generate = vi.fn();
    const { uninstall } = install(generate);
    window.openOutputEdit?.('linkedin');
    await Promise.resolve();
    injectRegenerateCreativeButton('linkedin');
    injectRegenerateCreativeButton('linkedin');
    window.openOutputEdit?.('linkedin');
    await Promise.resolve();
    expect(generate).not.toHaveBeenCalled();
    expect(document.querySelectorAll(`#${REGENERATE_BUTTON_ID}`)).toHaveLength(1);
    uninstall();
  });

  it('builds a brief from runtime sections when needed', () => {
    const brief = briefFromSections(access().getBriefSections(), 'iPortal Adoption');
    expect(brief?.fields.qualObjectives).toContain('Deepen digital adoption');
  });
});
