/**
 * POST /api/ai/creative-interpret
 *
 * Follows the project's server-side convention: Node/Vite middleware,
 * never imported by the React client bundle.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createGeminiClient } from '../gemini/client';
import type { GeminiJsonClient } from '../gemini/types';
import { isGeminiLive } from '../gateway';
import {
  CreativeInterpreterError,
  interpretCreativeRequest,
  toPublicCreativeInterpretationResult
} from '../creative/interpret';

export type CreativeInterpretRouteDeps = {
  gemini?: GeminiJsonClient;
};

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(payload);
}

/**
 * Vite / Node middleware handler for the Creative Interpreter API.
 * Live Gemini remains opt-in via GEMINI_LIVE=1 + GEMINI_API_KEY.
 * Tests may inject a mock Gemini client via deps.
 */
export async function handleCreativeInterpretRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: CreativeInterpretRouteDeps = {}
): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const live = isGeminiLive();
    const gemini = deps.gemini ?? createGeminiClient({ live });
    const result = await interpretCreativeRequest(body, { gemini });
    sendJson(res, 200, toPublicCreativeInterpretationResult(result));
  } catch (error) {
    if (error instanceof CreativeInterpreterError) {
      sendJson(res, error.statusCode, {
        error: error.message,
        details: error.details
      });
      return;
    }
    if (error instanceof SyntaxError) {
      sendJson(res, 400, { error: 'Request body must be valid JSON' });
      return;
    }
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    sendJson(res, 500, { error: message });
  }
}

export const CREATIVE_INTERPRET_PATH = '/api/ai/creative-interpret';
