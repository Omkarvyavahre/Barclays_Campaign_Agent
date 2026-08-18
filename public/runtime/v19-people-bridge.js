/*
 * Reports the V19 people state outward to the React host.
 *
 * The participant roster and the per-person statuses stay owned by the V19
 * runtime. This only mirrors the roster size and the open flag so React can
 * drive the header control and the collapsed layout without reading or
 * rewriting the legacy panel DOM. Loaded last so it wraps the final
 * renderTeamsPeople override.
 */
(function () {
  var PEOPLE_EVENT = 'v19:people';

  function peopleCount() {
    if (typeof TEAMS_PARTICIPANTS === 'undefined') return null;
    // "People" means human participants only; the AI agents in the roster
    // (Campaign Coordinator, Marketing Strategy & Campaign Brief Agent) have
    // their own "AI agents" section and are not counted here.
    return TEAMS_PARTICIPANTS.filter(function (p) {
      return p && p.type !== 'agent';
    }).length;
  }

  function snapshot() {
    return {
      open: typeof teamsState !== 'undefined' && !!teamsState.peopleOpen,
      count: peopleCount()
    };
  }

  function emit() {
    window.dispatchEvent(new CustomEvent(PEOPLE_EVENT, { detail: snapshot() }));
  }

  window.__v19PeopleSnapshot = snapshot;

  var renderPeople = window.renderTeamsPeople;
  if (typeof renderPeople === 'function') {
    window.renderTeamsPeople = function () {
      var result = renderPeople.apply(this, arguments);
      emit();
      return result;
    };
  }

  emit();
})();
