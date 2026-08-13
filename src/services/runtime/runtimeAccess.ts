/**
 * Read access to the generated V19 runtime's internal state.
 *
 * The V19 scripts declare `state`, `briefSections` and `teamsState` with `const`
 * at classic-script top level. Those bindings live in the global *lexical*
 * environment, which means they are deliberately not reachable as
 * `window.state` from a module.
 *
 * Rather than edit the generated runtime, a tiny classic script is injected
 * after it loads. Being a classic script, it can see those bindings and expose
 * getters for them. This is the entire seam: it reads, it never redefines.
 */

export type V19BriefField = [key: string, label: string, value: string];

export interface V19BriefSection {
  name: string;
  fields: V19BriefField[];
}

export interface V19TeamsMessage {
  initials?: string;
  name?: string;
  role?: string;
  text?: string;
}

export interface V19TeamsState {
  messages?: V19TeamsMessage[];
  summaryReady?: boolean;
}

export interface V19State {
  campaignName?: string;
  connections?: Record<string, boolean>;
  [key: string]: unknown;
}

export interface V19RuntimeAccess {
  getState(): V19State | undefined;
  getBriefSections(): V19BriefSection[] | undefined;
  getTeamsState(): V19TeamsState | undefined;
}

declare global {
  interface Window {
    __V19_RUNTIME_ACCESS__?: V19RuntimeAccess;
  }
}

const ACCESSOR_SOURCE = `(function(){
  window.__V19_RUNTIME_ACCESS__ = {
    getState: function(){ return typeof state !== 'undefined' ? state : undefined; },
    getBriefSections: function(){ return typeof briefSections !== 'undefined' ? briefSections : undefined; },
    getTeamsState: function(){ return typeof teamsState !== 'undefined' ? teamsState : undefined; }
  };
})();`;

/**
 * Installs the accessor. Safe to call more than once.
 * Must run after the V19 runtime scripts have executed.
 */
export function installRuntimeAccess(): V19RuntimeAccess | undefined {
  if (typeof document === 'undefined') return undefined;
  if (!window.__V19_RUNTIME_ACCESS__) {
    const script = document.createElement('script');
    script.dataset.v19RuntimeAccess = 'true';
    script.textContent = ACCESSOR_SOURCE;
    document.body.appendChild(script);
    script.remove();
  }
  return window.__V19_RUNTIME_ACCESS__;
}

export function getRuntimeAccess(): V19RuntimeAccess | undefined {
  return typeof window === 'undefined' ? undefined : window.__V19_RUNTIME_ACCESS__;
}
