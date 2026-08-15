/**
 * Vite plugin that mounts AI APIs on the dev server.
 * Kept out of the client bundle — only loaded by vite.config.ts.
 */

import type { Plugin } from 'vite';
import { describeServerAiEnv, loadServerEnvFile } from './serverEnv';

const AI_API_PREFIX = '/api/ai/';

export function barclaysAiApiPlugin(): Plugin {
  return {
    name: 'barclays-ai-api',
    apply: 'serve',
    enforce: 'pre',
    configureServer(server) {
      // Dev-server API routes read credentials from process.env, which Vite does not populate.
      loadServerEnvFile(server.config.root);
      console.log('[barclays-ai-api] mounted', JSON.stringify(describeServerAiEnv()));

      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (!url.startsWith(AI_API_PREFIX)) {
          next();
          return;
        }

        const fail = (error: unknown) => {
          console.error('[barclays-ai-api]', error);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Unexpected server error' }));
          }
        };

        if (url === '/api/ai/creative-interpret') {
          void import('./ai/http/creativeInterpretRoute')
            .then(({ handleCreativeInterpretRequest }) => handleCreativeInterpretRequest(req, res))
            .catch(fail);
          return;
        }

        if (url === '/api/ai/modify-asset') {
          void import('./ai/http/modifyAssetRoute')
            .then(({ handleModifyAssetRequest }) => handleModifyAssetRequest(req, res))
            .catch(fail);
          return;
        }

        if (url === '/api/ai/gateway-health') {
          void import('./ai/http/gatewayHealthRoute')
            .then(({ handleGatewayHealthRequest }) => handleGatewayHealthRequest(req, res))
            .catch(fail);
          return;
        }

        if (url.startsWith('/api/ai/generated/')) {
          void import('./ai/http/generatedImageRoute')
            .then(({ handleGeneratedImageRequest }) => handleGeneratedImageRequest(req, res))
            .catch(fail);
          return;
        }

        next();
      });
    }
  };
}
