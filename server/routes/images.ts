/**
 * HTTP surface for the image service.
 *
 * Same framework-agnostic shape as the AI routes, so one handler serves Vite
 * dev, Vite preview and a standalone production server. Three routes only:
 * health, generate, and serving a stored generated asset by opaque id.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import { loadDotEnv } from '../env.ts';
import { loadImageConfig, toPublicImageConfig } from '../images/config.ts';
import { ImageServiceError, safeImageErrorPayload } from '../images/errors.ts';
import type { ImageDeps } from '../images/firefly.ts';
import { generateChannelImage } from '../images/generator.ts';
import { allReferencesAvailable } from '../images/references.ts';
import { validateImageRequest } from '../images/schemas.ts';
import { ASSET_URL_PREFIX, currentChannelAsset, readGeneratedImage } from '../images/storage.ts';
import type { ImageChannel } from '../images/types.ts';

export const IMAGES_API_BASE_PATH = '/api/images';
export const IMAGE_ROUTES = {
  health: `${IMAGES_API_BASE_PATH}/health`,
  generate: `${IMAGES_API_BASE_PATH}/generate`,
  latest: `${IMAGES_API_BASE_PATH}/latest`,
  asset: ASSET_URL_PREFIX,
} as const;

const CHANNELS: readonly ImageChannel[] = ['linkedin', 'email'];

function requireChannel(value: string | null): ImageChannel {
  const channel = CHANNELS.find((candidate) => candidate === value);
  if (!channel) throw new ImageServiceError('bad_request', `unknown channel ${value}`);
  return channel;
}

const MAX_BODY_BYTES = 256 * 1024;

export interface ImagesApiOptions {
  env?: Record<string, string | undefined>;
  deps?: ImageDeps;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

function sendError(res: ServerResponse, error: unknown): void {
  const safe = error instanceof ImageServiceError ? error : new ImageServiceError('upstream_error');
  if (safe.internalDetail) console.error(`[images] ${safe.category}: ${safe.internalDetail}`);
  sendJson(res, safe.httpStatus, safeImageErrorPayload(safe));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new ImageServiceError('bad_request', 'request body too large');
    chunks.push(buffer);
  }

  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ImageServiceError('bad_request', 'request body was not valid JSON');
  }
}

export function createImagesApiHandler(options: ImagesApiOptions = {}) {
  if (!options.env) loadDotEnv();

  return async function handleImagesRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const [url, query = ''] = (req.url ?? '').split('?');
    if (!url.startsWith(IMAGES_API_BASE_PATH)) return false;

    try {
      const config = loadImageConfig(options.env ?? process.env);

      if (url === IMAGE_ROUTES.health) {
        if (req.method !== 'GET') throw new ImageServiceError('bad_request', `method ${req.method} not allowed`);
        sendJson(res, 200, { ok: true, ...toPublicImageConfig(config, allReferencesAvailable()) });
        return true;
      }

      if (url === IMAGE_ROUTES.generate) {
        if (req.method !== 'POST') throw new ImageServiceError('bad_request', `method ${req.method} not allowed`);
        const parsed = validateImageRequest(await readJsonBody(req));
        if (!parsed.ok) throw new ImageServiceError('bad_request', parsed.issues.join('; '));

        const outcome = await generateChannelImage(config, parsed.value, options.deps);
        sendJson(res, 200, { ok: true, ...outcome });
        return true;
      }

      // Lets Stage 7 compose against an already-generated background without
      // spending a provider call, e.g. after a page reload. This serves the
      // approved asset for the channel, not simply the newest file, so the path
      // name is kept only for the established browser contract.
      if (url === IMAGE_ROUTES.latest) {
        if (req.method !== 'GET') throw new ImageServiceError('bad_request', `method ${req.method} not allowed`);
        const channel = requireChannel(new URLSearchParams(query).get('channel'));
        sendJson(res, 200, { ok: true, channel, asset: currentChannelAsset(channel) });
        return true;
      }

      if (url.startsWith(IMAGE_ROUTES.asset)) {
        if (req.method !== 'GET') throw new ImageServiceError('bad_request', `method ${req.method} not allowed`);
        const stored = readGeneratedImage(decodeURIComponent(url.slice(IMAGE_ROUTES.asset.length)));
        res.statusCode = 200;
        res.setHeader('content-type', stored.contentType);
        // Generated assets are addressed by an opaque single-use id, so there is
        // nothing to gain from caching and something to lose from staleness.
        res.setHeader('cache-control', 'no-store');
        res.end(stored.bytes);
        return true;
      }

      throw new ImageServiceError('bad_request', `unknown route ${url}`);
    } catch (error) {
      sendError(res, error);
      return true;
    }
  };
}
