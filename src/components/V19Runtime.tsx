import { memo, useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { V19_MARKUP } from '../runtime/v19Markup';
import { V19_SCRIPTS } from '../runtime/scriptManifest';
import {
  readPeopleSnapshot,
  setLegacyPeopleOpen,
  subscribeToPeopleSnapshot,
  type PeopleSnapshot
} from '../runtime/peopleBridge';
import { PeopleToggleButton } from './PeopleToggleButton';

const V19_HTML = { __html: V19_MARKUP };

/**
 * Mounts the V19 DOM once and never re-renders.
 *
 * Re-rendering this element makes React rebuild the whole injected subtree,
 * which would discard the running Teams playback DOM and any node the runtime
 * or a portal is holding on to. State that affects the V19 layout therefore
 * lives on the wrapper below, never on this element.
 */
const V19Markup = memo(function V19Markup({ hostRef }: { hostRef: RefObject<HTMLDivElement | null> }) {
  return <div id="v19-host" ref={hostRef} dangerouslySetInnerHTML={V19_HTML} />;
});

/**
 * Preservation-first React host for the V19 campaign demo.
 *
 * The V19 DOM is mounted inside the React root (no iframe). The original
 * script blocks are then loaded in their original order so inline handlers,
 * scripted Teams playback, stage rendering, comments and modal flows retain
 * the prototype's exact behavior while the app is hosted by React/Vite.
 *
 * React additionally owns whether the people panel is shown, at every viewport
 * width: the header control is a React button portalled into the Teams top
 * actions, and the collapsed/expanded layout is selected by a class on the
 * wrapper element. The panel's contents stay rendered by the V19 runtime.
 */
export function V19Runtime() {
  const [ready, setReady] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [participantCount, setParticipantCount] = useState<number | null>(null);
  const [topActions, setTopActions] = useState<HTMLElement | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    setTopActions(hostRef.current?.querySelector<HTMLElement>('.teams-top-actions') ?? null);
  }, []);

  useEffect(() => {
    const apply = (snapshot: PeopleSnapshot) => {
      setParticipantCount(snapshot.count);
      setPeopleOpen(snapshot.open);
    };

    const initial = readPeopleSnapshot();
    if (initial) apply(initial);

    return subscribeToPeopleSnapshot(apply);
  }, []);

  const togglePeople = useCallback(() => {
    const next = !peopleOpen;
    setPeopleOpen(next);
    setLegacyPeopleOpen(next);
  }, [peopleOpen]);

  return (
    <>
      <div id="v19-layout" className={peopleOpen ? 'v19-people-open' : 'v19-people-closed'}>
        <V19Markup hostRef={hostRef} />
      </div>
      {topActions
        ? createPortal(
            <PeopleToggleButton open={peopleOpen} count={participantCount} onToggle={togglePeople} />,
            topActions
          )
        : null}
      <span hidden data-v19-react-ready={ready ? 'true' : 'false'} />
    </>
  );
}
