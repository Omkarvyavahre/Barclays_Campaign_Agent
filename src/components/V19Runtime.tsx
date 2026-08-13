import { useEffect, useState } from 'react';
import { V19_MARKUP } from '../runtime/v19Markup';
import { V19_SCRIPTS } from '../runtime/scriptManifest';

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

      if (!cancelled) setReady(true);
    };

    loadScripts().catch((error) => {
      console.error('[V19 runtime]', error);
    });

    return () => {
      cancelled = true;
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
