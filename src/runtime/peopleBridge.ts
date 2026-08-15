/**
 * Typed seam between the V19 runtime and the React host for the people panel.
 *
 * React owns whether the panel is shown; the V19 runtime keeps owning the
 * roster and the live per-person statuses it renders into the panel.
 */

/** Id of the people panel element in the V19 markup, used for aria-controls. */
export const TEAMS_PEOPLE_PANEL_ID = 'teamsPeople';

const PEOPLE_EVENT = 'v19:people';

export type PeopleSnapshot = {
  open: boolean;
  /** null until the V19 runtime has loaded and published its roster. */
  count: number | null;
};

type RuntimeWindow = Window & {
  __v19PeopleSnapshot?: () => PeopleSnapshot;
  toggleTeamsPeople?: (force?: boolean) => void;
};

export function readPeopleSnapshot(): PeopleSnapshot | null {
  const read = (window as RuntimeWindow).__v19PeopleSnapshot;
  return typeof read === 'function' ? read() : null;
}

export function subscribeToPeopleSnapshot(listener: (snapshot: PeopleSnapshot) => void): () => void {
  const handler = (event: Event) => {
    const { detail } = event as CustomEvent<PeopleSnapshot>;
    if (detail) listener(detail);
  };

  window.addEventListener(PEOPLE_EVENT, handler);
  return () => window.removeEventListener(PEOPLE_EVENT, handler);
}

/** Keeps the V19 runtime flag in step so its close control and drawer agree with React. */
export function setLegacyPeopleOpen(open: boolean): void {
  (window as RuntimeWindow).toggleTeamsPeople?.(open);
}
