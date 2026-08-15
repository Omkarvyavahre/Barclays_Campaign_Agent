/**
 * POST /api/ai/modify-asset
 *
 * Provider split endpoint:
 * - Modify asset → Gemini image edit (GEMINI_IMAGE_API_KEY)
 * - Regenerate creative → Adobe Firefly generation
 * Live image/Firefly remain opt-in (GEMINI_IMAGE_LIVE / GEMINI_LIVE / FIREFLY_LIVE).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createGeminiClient } from '../gemini/client';
import type { GeminiJsonClient } from '../gemini/types';
import { withGeminiImageEdit } from '../gemini/imageEditClient';
import {
  describeGeminiImageConfig,
  isGeminiImageEditConfigured,
  isGeminiImageLive
} from '../gemini/imageConfig';
import { createFireflyClient } from '../firefly/client';
import type { FireflyClient } from '../firefly/types';
import { probeGatewayReachability } from '../gateway';
import { ModifyAssetError, modifyAsset, toPublicModifyAssetResult } from '../modify/modifyAsset';

export type ModifyAssetRouteDeps = {
  gemini?: GeminiJsonClient;
  firefly?: FireflyClient;
  /** Injected in tests to skip real DNS/TCP. */
  gatewayPreflight?: typeof probeGatewayReachability;
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

/** Redacts credential-shaped substrings before any local logging. */
function sanitizeDetail(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]')
    .replace(/("?(access_token|client_secret|api[_-]?key)"?\s*[:=]\s*)("?[^",\s]+"?)/gi, '$1[REDACTED]')
    .replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, 'data:image/[REDACTED]')
    .replace(/[A-Za-z0-9+/]{120,}={0,2}/g, '[BASE64_REDACTED]')
    .slice(0, 500);
}

/** Dev-only sanitized diagnostics — never logs credentials or image bytes. */
function logDev(event: string, fields: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'production') return;
  console.log(`[modify-asset] ${event}`, JSON.stringify(fields));
}

/** Shape/presence summary of the incoming payload (no free-text content besides prompt length). */
function summarizeRequest(body: unknown): Record<string, unknown> {
  const b = (body ?? {}) as Record<string, any>;
  const imageUrl = typeof b.sourceDamAsset?.imageUrl === 'string' ? b.sourceDamAsset.imageUrl : '';
  return {
    hasCampaignBrief: Boolean(b.campaignBrief),
    assetId: b.asset?.id ?? null,
    assetSourceId: b.asset?.sourceId ?? null,
    assetChannel: b.asset?.channel ?? null,
    businessDomain: b.campaignContext?.businessDomain ?? null,
    campaignType: b.campaignContext?.campaignType ?? null,
    contextChannel: b.campaignContext?.channel ?? null,
    promptLength: typeof b.modification?.prompt === 'string' ? b.modification.prompt.length : 0,
    promptPreview:
      typeof b.modification?.prompt === 'string' ? b.modification.prompt.slice(0, 120) : null,
    hasTitle: Boolean(b.modification?.title),
    hasDescription: Boolean(b.modification?.description),
    hasCta: Boolean(b.modification?.cta),
    sourceDamAssetId: b.sourceDamAsset?.id ?? null,
    sourceMimeType: b.sourceDamAsset?.mimeType ?? null,
    sourceImageKind: imageUrl.startsWith('data:')
      ? 'data-url'
      : imageUrl.startsWith('/api/ai/generated/')
        ? 'generated'
        : imageUrl.startsWith('http')
          ? 'http'
          : imageUrl
            ? 'other'
            : 'none',
    sourceImageUrlLength: imageUrl.length
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(payload);
}

function productionGeminiClient(): GeminiJsonClient {
  const base = createGeminiClient({ live: false });
  return withGeminiImageEdit(base, { live: isGeminiImageLive() });
}

export async function handleModifyAssetRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ModifyAssetRouteDeps = {}
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
    const requestBody = body as { regenerate?: boolean };
    const isFireflyRegenerate = requestBody?.regenerate === true;
    const imageLive = isGeminiImageLive();
    const fireflyLive = process.env.FIREFLY_LIVE === '1';
    const imageCaps = describeGeminiImageConfig();
    logDev('request received', {
      imageLive,
      fireflyLive,
      geminiImageConfigured: imageCaps.geminiImageConfigured,
      geminiImageModelConfigured: imageCaps.geminiImageModelConfigured,
      ...summarizeRequest(body)
    });

    if (imageLive && !isFireflyRegenerate && !deps.gemini && isGeminiImageEditConfigured()) {
      const probe = deps.gatewayPreflight ?? probeGatewayReachability;
      const preflight = await probe();
      if (!preflight.reachable && preflight.configured) {
        logDev('preflight blocked', {
          configured: preflight.configured,
          reachable: false,
          reason: preflight.reason,
          host: preflight.host
        });
        throw new ModifyAssetError(
          'AI service unavailable. Check corporate network/VPN connection.',
          503,
          'interpreting',
          [preflight.reason ?? 'gateway_unreachable']
        );
      }
    }

    const gemini = deps.gemini ?? productionGeminiClient();
    const firefly = deps.firefly ?? createFireflyClient({ live: fireflyLive });
    const result = await modifyAsset(body, { gemini, firefly });
    sendJson(res, 200, toPublicModifyAssetResult(result));
  } catch (error) {
    if (error instanceof ModifyAssetError) {
      const message =
        error.message.startsWith('AI service unavailable')
          ? error.message
          : error.stage === 'routing'
            ? error.message
            : error.stage === 'interpreting'
              ? error.message.includes('interpretation') ||
                error.message.includes('AI service') ||
                error.message.includes('edit source') ||
                error.message.includes('clarify') ||
                error.message.includes('current asset image')
                ? error.message
                : 'Creative interpretation failed'
              : error.message.startsWith('Gemini image edit')
                ? error.message
                : 'Creative generation failed';
      logDev('failed', {
        stage: error.stage,
        statusCode: error.statusCode,
        reason: sanitizeDetail(error.message),
        details: error.details?.map(sanitizeDetail)
      });
      sendJson(res, error.statusCode, {
        error: message,
        stage: error.stage,
        details: error.details
      });
      return;
    }
    if (error instanceof SyntaxError) {
      logDev('failed', { stage: 'request', reason: 'invalid JSON body' });
      sendJson(res, 400, { error: 'Request body must be valid JSON' });
      return;
    }
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    logDev('failed', { stage: 'unexpected', reason: sanitizeDetail(message) });
    sendJson(res, 500, { error: message });
  }
}

export const MODIFY_ASSET_PATH = '/api/ai/modify-asset';
