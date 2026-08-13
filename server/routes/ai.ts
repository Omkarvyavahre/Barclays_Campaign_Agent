/**
 * HTTP surface for the AI service.
 *
 * Written against Node's raw request/response types so the exact same handler
 * can be mounted as Vite dev middleware and inside a standalone production
 * server, with no framework dependency and no duplicated routing.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import { loadDotEnv } from '../env.ts';
import { loadAiConfig, toPublicAiConfig } from '../ai/config.ts';
import { AiServiceError, safeErrorPayload } from '../ai/errors.ts';
import { analyseDiscussion } from '../ai/coordinator.ts';
import { generateBrief } from '../ai/briefAgent.ts';
import { validateAnalyseRequest, validateBriefRequest } from '../ai/schemas.ts';
import type { GatewayDeps } from '../ai/gateway.ts';

export const API_BASE_PATH = '/api/ai';
export const ROUTES = {
  health: `${API_BASE_PATH}/health`,
  analyse: `${API_BASE_PATH}/coordinator/analyse`,
  brief: `${API_BASE_PATH}/brief/generate`,
} as const;

const MAX_BODY_BYTES = 512 * 1024;

export interface AiApiOptions {
  env?: Record<string, string | undefined>;
  deps?: GatewayDeps;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}

function sendError(res: ServerResponse, error: unknown): void {
  const safe = error instanceof AiServiceError ? error : new AiServiceError('upstream_error');
  if (safe.internalDetail) console.error(`[ai] ${safe.category}: ${safe.internalDetail}`);
  sendJson(res, safe.httpStatus, safeErrorPayload(safe));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new AiServiceError('bad_request', 'request body too large');
    chunks.push(buffer);
  }

  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AiServiceError('bad_request', 'request body was not valid JSON');
  }
}

/**
 * Returns a handler that resolves to `true` when it has taken ownership of the
 * request, so a host server can fall through to its own routing otherwise.
 */
export function createAiApiHandler(options: AiApiOptions = {}) {
  // Read once when the API is mounted. Editing .env therefore requires a
  // server restart, which keeps configuration stable for the duration of a run.
  if (!options.env) loadDotEnv();

  return async function handleAiRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = (req.url ?? '').split('?')[0];
    if (!url.startsWith(API_BASE_PATH)) return false;

    try {
      const config = loadAiConfig(options.env ?? process.env);

      if (url === ROUTES.health) {
        if (req.method !== 'GET') throw new AiServiceError('bad_request', `method ${req.method} not allowed`);
        sendJson(res, 200, { ok: true, ...toPublicAiConfig(config) });
        return true;
      }

      if (url === ROUTES.analyse) {
        if (req.method !== 'POST') throw new AiServiceError('bad_request', `method ${req.method} not allowed`);
        const parsed = validateAnalyseRequest(await readJsonBody(req));
        if (!parsed.ok) throw new AiServiceError('bad_request', parsed.issues.join('; '));

        const outcome = await analyseDiscussion(config, parsed.value.discussion, options.deps);
        sendJson(res, 200, { ok: true, ...outcome });
        return true;
      }

      if (url === ROUTES.brief) {
        if (req.method !== 'POST') throw new AiServiceError('bad_request', `method ${req.method} not allowed`);
        const parsed = validateBriefRequest(await readJsonBody(req));
        if (!parsed.ok) throw new AiServiceError('bad_request', parsed.issues.join('; '));

        const outcome = await generateBrief(config, parsed.value, options.deps);
        sendJson(res, 200, { ok: true, ...outcome });
        return true;
      }

      throw new AiServiceError('bad_request', `unknown route ${url}`);
    } catch (error) {
      sendError(res, error);
      return true;
    }
  };
}
