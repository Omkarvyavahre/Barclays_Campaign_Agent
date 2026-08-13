/**
 * Mounts the AI API inside Vite's dev and preview servers.
 *
 * This keeps the browser talking to a same-origin `/api/ai/*` endpoint during
 * development without standing up a second process, while the handler itself
 * stays framework-agnostic and reusable in production.
 */

import type { Connect, Plugin, ViteDevServer, PreviewServer } from 'vite';

import { createAiApiHandler } from './routes/ai.ts';

export function aiApiPlugin(): Plugin {
  const handle = createAiApiHandler();

  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    handle(req, res)
      .then((handled) => {
        if (!handled) next();
      })
      .catch(next);
  };

  return {
    name: 'barclays-ai-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use(middleware);
    },
  };
}
