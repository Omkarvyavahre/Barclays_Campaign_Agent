# Migration notes

This baseline prioritizes exact V19 parity. It is **not an iframe**: the V19 DOM is mounted directly in the React root. The original prototype runtime is kept under `public/runtime` so behavior and demo data remain identical.

Recommended next refactor, without changing pixels/copy:

1. Freeze Teams DOM/CSS as the approved surface.
2. Replace Campaign Studio topbar + rail with React components.
3. Replace persistent conversation frame.
4. Replace Stages 1-8 one at a time, retaining the exact V19 fixture values.
5. Replace comments/context/version panels.
6. After screenshot parity, replace mock/runtime calls with service interfaces for Gemini, Firefly and RT-CDP.

At each step, keep the original `reference/V19-authoritative.html` as the acceptance source.
