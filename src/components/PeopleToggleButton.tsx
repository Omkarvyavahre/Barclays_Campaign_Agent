import { TEAMS_PEOPLE_PANEL_ID } from '../runtime/peopleBridge';

type PeopleToggleButtonProps = {
  open: boolean;
  count: number | null;
  onToggle: () => void;
};

export function PeopleToggleButton({ open, count, onToggle }: PeopleToggleButtonProps) {
  return (
    <button
      type="button"
      className={`teams-top-button v19-people-toggle${open ? ' is-open' : ''}`}
      data-testid="people-toggle"
      aria-expanded={open}
      aria-controls={TEAMS_PEOPLE_PANEL_ID}
      onClick={onToggle}
    >
      People
      {count === null ? null : <span className="teams-people-toggle-count">{count}</span>}
    </button>
  );
}
