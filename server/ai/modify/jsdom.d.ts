/**
 * Local declarations for the live-validation harness only.
 *
 * jsdom ships no bundled types and the server tsconfig has no DOM lib, so this
 * covers just the surface the harness touches.
 */
declare module 'jsdom' {
  type HarnessElement = { innerHTML: string };

  type HarnessDocument = {
    getElementById(id: string): HarnessElement | null;
    querySelector(selectors: string): HarnessElement | null;
    body: HarnessElement;
  };

  export class JSDOM {
    constructor(html?: string, options?: Record<string, unknown>);
    readonly window: {
      document: HarnessDocument;
      HTMLElement: unknown;
      Element: unknown;
      Node: unknown;
    };
  }
}
