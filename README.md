# Barclays V19 React preservation build

This project converts the supplied V19 HTML prototype into a React/Vite application **without an iframe**.

## What is preserved

- All six V19 style blocks, in original cascade order.
- The exact V19 body markup and visible demo copy/data.
- All six original script blocks, loaded in original order after React mounts the DOM.
- Teams scripted discussion and handoff behavior.
- Campaign Studio stages 1-8, demo fixtures, comments, drawers, modals, output examples and responsive behavior.
- Inline base64 assets from the original V19 source.

## Why this shape

This is a preservation-first React migration: the UI is mounted directly inside the React root, so there is no iframe boundary and visual/behavioral parity stays as close as possible to the authoritative V19 prototype. The legacy runtime is intentionally isolated under `public/runtime/` so it can later be replaced region-by-region with idiomatic React components without changing the visual reference.

## Run

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

## Important

No Gemini, Firefly, RT-CDP, credentials, `.env`, or external provider integration is included. This ZIP is the deterministic V19 React UI baseline only.

For later integration work, keep the V19 presentation/data stable and replace runtime functions behind clean React/service seams one area at a time.
