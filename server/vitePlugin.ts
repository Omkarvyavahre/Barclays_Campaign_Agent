/**
 * Mounts the AI API inside Vite's dev and preview servers.
 *
 * This keeps the browser talking to a same-origin `/api/ai/*` endpoint during
 * development without standing up a second process, while the handler itself
 * stays framework-agnostic and reusable in production.
 */

import type { Connect, Plugin, ViteDevServer, PreviewServer } from 'vite';

import { createAiApiHandler } from './routes/ai.ts';
import { createImagesApiHandler } from './routes/images.ts';

type Handler = (req: Connect.IncomingMessage, res: ServerResponseLike) => Promise<boolean>;
type ServerResponseLike = Parameters<Connect.NextHandleFunction>[1];

function mount(name: string, handle: Handler): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    handle(req, res)
      .then((handled) => {
        if (!handled) next();
      })
      .catch(next);
  };

  return {
    name,
    configureServer(server: ViteDevServer) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use(middleware);
    },
  };
}

export function aiApiPlugin(): Plugin {
  return mount('barclays-ai-api', createAiApiHandler());
}

/** Serves `/api/images/*`, keeping Firefly behind our own origin. */
export function imagesApiPlugin(): Plugin {
  return mount('barclays-images-api', createImagesApiHandler());
}
