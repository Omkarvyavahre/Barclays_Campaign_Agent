import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { V19_MARKUP } from '../runtime/v19Markup';
import { TEAMS_PEOPLE_PANEL_ID, type PeopleSnapshot } from '../runtime/peopleBridge';
import { V19Runtime } from './V19Runtime';

const hostCss = readFileSync(resolve(process.cwd(), 'src/styles/react-host.css'), 'utf8');

type RuntimeWindow = typeof window & {
  __v19PeopleSnapshot?: () => PeopleSnapshot;
  toggleTeamsPeople?: (force?: boolean) => void;
};

/**
 * Stands in for the V19 runtime: publishes the roster size and mirrors the open
 * flag back out the way renderTeamsPeople does after each toggle.
 */
function installRuntimeStub(count: number) {
  const state: PeopleSnapshot = { open: false, count };
  const toggleTeamsPeople = vi.fn((force?: boolean) => {
    state.open = typeof force === 'boolean' ? force : !state.open;
    window.dispatchEvent(new CustomEvent('v19:people', { detail: { ...state } }));
  });

  const runtime = window as RuntimeWindow;
  runtime.__v19PeopleSnapshot = () => ({ ...state });
  runtime.toggleTeamsPeople = toggleTeamsPeople;

  return { toggleTeamsPeople };
}

function renderRuntime(count = 7) {
  const runtime = installRuntimeStub(count);
  const view = render(<V19Runtime />);

  return {
    ...runtime,
    view,
    layout: view.container.querySelector<HTMLElement>('#v19-layout')!,
    button: view.getByTestId('people-toggle'),
    panel: view.container.querySelector<HTMLElement>(`#${TEAMS_PEOPLE_PANEL_ID}`)!
  };
}

function declarationsFor(selector: string): string {
  const start = hostCss.indexOf(selector);
  if (start === -1) return '';
  const open = hostCss.indexOf('{', start);
  return hostCss.slice(open + 1, hostCss.indexOf('}', open));
}

afterEach(() => {
  const runtime = window as RuntimeWindow;
  delete runtime.__v19PeopleSnapshot;
  delete runtime.toggleTeamsPeople;
  cleanup();
});

describe('people panel visibility', () => {
  it('starts collapsed', () => {
    const { layout, button } = renderRuntime();

    expect(layout.className).toBe('v19-people-closed');
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('exposes the People control in the Teams top actions', () => {
    const { button } = renderRuntime();

    expect(button.closest('.teams-top-actions')).not.toBeNull();
    expect(button.tagName).toBe('BUTTON');
    expect(button.textContent).toContain('People');
  });

  it('takes the count from the runtime roster rather than a fixed number', () => {
    const { button } = renderRuntime(7);

    expect(button.querySelector('.teams-people-toggle-count')?.textContent).toBe('7');
  });

  it('follows the roster when its size differs', () => {
    const { button } = renderRuntime(4);

    expect(button.querySelector('.teams-people-toggle-count')?.textContent).toBe('4');
  });

  it('counts human participants only, excluding AI agents', () => {
    const roster = [
      { initials: 'SC', type: 'human' },
      { initials: 'JO', type: 'human' },
      { initials: 'HM', type: 'human' },
      { initials: 'PS', type: 'human' },
      { initials: 'DR', type: 'human' },
      { initials: 'CL', type: 'human' },
      { initials: 'AI', type: 'agent' },
      { initials: 'CA', type: 'agent' }
    ];
    const g = globalThis as Record<string, unknown>;
    g.TEAMS_PARTICIPANTS = roster;
    g.teamsState = { peopleOpen: false };

    const bridge = readFileSync(resolve(process.cwd(), 'public/runtime/v19-people-bridge.js'), 'utf8');
    new Function(bridge)();

    const snapshot = (window as RuntimeWindow).__v19PeopleSnapshot?.();
    expect(snapshot?.count).toBe(6);

    delete g.TEAMS_PARTICIPANTS;
    delete g.teamsState;
  });

  it('no longer ships the hard-coded count in the markup', () => {
    expect(V19_MARKUP).not.toContain('teams-people-toggle-count">6');
    expect(V19_MARKUP).not.toContain('onclick="toggleTeamsPeople()"');
  });

  it('opens the panel on click and closes it on the next click', () => {
    const { layout, button, toggleTeamsPeople } = renderRuntime();

    fireEvent.click(button);
    expect(layout.className).toBe('v19-people-open');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(toggleTeamsPeople).toHaveBeenLastCalledWith(true);

    fireEvent.click(button);
    expect(layout.className).toBe('v19-people-closed');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(toggleTeamsPeople).toHaveBeenLastCalledWith(false);
  });

  it('collapses again when the panel close control reports it shut', () => {
    const { layout, button } = renderRuntime();
    fireEvent.click(button);

    fireEvent(window, new CustomEvent('v19:people', { detail: { open: false, count: 7 } }));

    expect(layout.className).toBe('v19-people-closed');
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('points aria-controls at the runtime panel element', () => {
    const { button, panel } = renderRuntime();

    expect(button.getAttribute('aria-controls')).toBe(TEAMS_PEOPLE_PANEL_ID);
    expect(panel).not.toBeNull();
    expect(panel.getAttribute('aria-label')).toBe('People in this discussion');
  });

  it('leaves panel contents to the runtime across toggles', () => {
    const { button, panel } = renderRuntime();
    panel.innerHTML =
      '<div class="teams-people-head"><h3>People in this discussion</h3><div class="teams-people-count">7 participants</div></div>' +
      '<section class="teams-people-section"><div class="teams-person" data-initials="SC"></div></section>' +
      '<section class="teams-people-section teams-people-agent-group"><div class="teams-person" data-initials="CA"></div></section>';
    const rendered = panel.innerHTML;

    fireEvent.click(button);
    expect(panel.innerHTML).toBe(rendered);

    fireEvent.click(button);
    expect(panel.innerHTML).toBe(rendered);
  });

  it('keeps the runtime DOM alive across toggles so playback is unaffected', () => {
    const { view, button, panel } = renderRuntime();
    const feed = view.container.querySelector('#teamsFeedInner')!;
    const replay = view.container.querySelector('.teams-top-actions button')!;

    // The runtime keeps references to these nodes; rebuilding them would reset
    // playback, the composer and the Campaign Studio handoff.
    fireEvent.click(button);
    fireEvent.click(button);

    expect(document.contains(feed)).toBe(true);
    expect(document.contains(replay)).toBe(true);
    expect(document.contains(panel)).toBe(true);
    expect(view.container.querySelector('#teamsFeedInner')).toBe(feed);
    expect(view.getByTestId('people-toggle')).toBe(button);
  });

  it('keeps the preserved header and tab controls untouched', () => {
    const { view } = renderRuntime();
    const actions = view.container.querySelector('.teams-top-actions')!;

    expect(actions.querySelector('button[onclick="replayTeamsDiscussion()"]')).not.toBeNull();
    expect(actions.querySelector('.teams-profile')?.textContent).toBe('SC');
    expect(view.container.querySelector('.teams-head-tabs')?.textContent).toBe('PostsFilesNotes');
  });
});

describe('collapsed layout', () => {
  it('drops the panel column so the conversation takes the freed width', () => {
    const shell = declarationsFor('#v19-layout.v19-people-closed .teams-shell');

    expect(shell).toContain('grid-template-columns: 62px 220px minmax(0, 1fr) !important');
    expect(shell).not.toContain('250px');
  });

  it('removes the panel instead of leaving an empty reserved column', () => {
    expect(declarationsFor('#v19-layout.v19-people-closed .teams-people')).toContain('display: none !important');
  });

  it('lets the composer span the full conversation width', () => {
    expect(declarationsFor('#v19-layout.v19-people-closed .teams-composer-wrap')).toContain('right: 0 !important');
  });

  it('shows the People control at every width rather than only on narrow viewports', () => {
    const toggle = declarationsFor('#v19-host .teams-top-actions > .v19-people-toggle');

    expect(toggle).toContain('display: inline-flex');
    // Anything width-scoped would reintroduce the desktop-only defect.
    expect(hostCss.slice(0, hostCss.indexOf('@media'))).toContain('.v19-people-toggle');
  });

  it('only scopes the expanded-width overrides to the width that reserves a column', () => {
    const mediaQueries = hostCss.match(/@media[^{]+/g) ?? [];

    expect(mediaQueries).toEqual(['@media (min-width: 1281px) ']);
  });
});
