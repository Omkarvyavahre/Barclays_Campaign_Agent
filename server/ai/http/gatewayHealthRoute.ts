/**
 * GET /api/ai/gateway-health
 *
 * Sanitized connectivity/preflight for the configured internal Gemini gateway
 * and Gemini image-edit capability flags. Never performs inference and never
 * returns secrets.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { describeGeminiImageConfig } from '../gemini/imageConfig';
import { probeGatewayReachability, toPublicGatewayHealth } from '../gateway';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export async function handleGatewayHealthRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const preflight = await probeGatewayReachability();
  const imageCaps = describeGeminiImageConfig();
  sendJson(res, 200, {
    ...toPublicGatewayHealth(preflight),
    geminiImageConfigured: imageCaps.geminiImageConfigured,
    geminiImageModelConfigured: imageCaps.geminiImageModelConfigured
  });
}

export const GATEWAY_HEALTH_PATH = '/api/ai/gateway-health';
