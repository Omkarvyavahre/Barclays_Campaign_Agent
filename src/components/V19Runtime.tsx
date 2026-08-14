import { useEffect, useState } from 'react';
import { V19_MARKUP } from '../runtime/v19Markup';
import { V19_SCRIPTS } from '../runtime/scriptManifest';
import { installBrowserBridge } from '../services/bridge/browserBridge';
import { installCampaignCreative } from '../services/runtime/campaignCreative';
import { installCreativeEditAdapter } from '../services/runtime/creativeEditAdapter';
import { getLastAppliedBrief, installV19Adapter } from '../services/runtime/v19Adapter';

/**
 * Preservation-first React host for the V19 campaign demo.
 *
 * The V19 DOM is mounted inside the React root (no iframe). The original
 * script blocks are then loaded in their original order so inline handlers,
 * scripted Teams playback, stage rendering, comments and modal flows retain
 * the prototype's exact behavior while the app is hosted by React/Vite.
 */
export function V19Runtime() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const mountedScripts: HTMLScriptElement[] = [];
    let uninstallAdapter: (() => void) | undefined;
    let uninstallCreative: (() => void) | undefined;
    let uninstallEdit: (() => void) | undefined;

    const loadScripts = async () => {
      // The DOM must exist before the first V19 script executes.
      await Promise.resolve();

      for (const src of V19_SCRIPTS) {
        if (cancelled) return;
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = src;
          script.async = false;
          script.dataset.v19Runtime = 'true';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error(`Unable to load ${src}`));
          document.body.appendChild(script);
          mountedScripts.push(script);
        });
      }

      if (cancelled) return;

      // Attached only after the runtime exists. The adapter wraps two V19
      // entry points; it does not alter markup, styles or renderers.
      const bridge = installBrowserBridge();
      uninstallAdapter = installV19Adapter({
        bridge,
        onError: (scope, error) => console.error(`[V19 adapter:${scope}]`, error),
      });

      // Composes the Stage 7 LinkedIn creative from an already-generated
      // background. A no-op when none exists, so V19 renders unchanged.
      uninstallCreative = installCampaignCreative({
        bridge,
        onError: (error) => console.error('[V19 creative]', error),
      });

      // Injects "Regenerate creative" into the Stage 7 edit modal without
      // touching frozen V19 artifacts or the GenStudio save path.
      uninstallEdit = installCreativeEditAdapter({
        bridge,
        getAppliedBrief: getLastAppliedBrief,
        onError: (error) => console.error('[V19 creative edit]', error),
      });

      setReady(true);
    };

    loadScripts().catch((error) => {
      console.error('[V19 runtime]', error);
    });

    return () => {
      cancelled = true;
      uninstallEdit?.();
      uninstallCreative?.();
      uninstallAdapter?.();
      for (const script of mountedScripts) script.remove();
    };
  }, []);

  return (
    <>
      <div id="v19-host" dangerouslySetInnerHTML={{ __html: V19_MARKUP }} />
      <span hidden data-v19-react-ready={ready ? 'true' : 'false'} />
    </>
  );
}
