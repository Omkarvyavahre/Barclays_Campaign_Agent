/**
 * GET /api/ai/generated/:id
 *
 * Serves only session-registered Firefly derivatives.
 * Does not scan or auto-expose historical `.generated/` files.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { readRegisteredGeneratedBytes } from '../firefly/storage';

export const GENERATED_IMAGE_PATH_PREFIX = '/api/ai/generated/';

export async function handleGeneratedImageRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const url = req.url?.split('?')[0] ?? '';
  if (!url.startsWith(GENERATED_IMAGE_PATH_PREFIX)) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end('Method not allowed');
    return;
  }

  const id = decodeURIComponent(url.slice(GENERATED_IMAGE_PATH_PREFIX.length)).replace(/\/$/, '');
  if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) {
    res.statusCode = 400;
    res.end('Invalid id');
    return;
  }

  const file = readRegisteredGeneratedBytes(id);
  if (!file) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Generated image not found in this session' }));
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(file.bytes);
}
