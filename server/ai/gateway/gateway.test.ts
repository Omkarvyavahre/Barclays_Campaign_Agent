/**
 * Canonical gateway config / URL / preflight tests.
 * No live provider calls — DNS/TCP and fetch are injected.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildGatewayCompletionsUrl,
  describeGatewayConfig,
  isGeminiLive,
  normalizeGatewayBaseUrl,
  probeGatewayReachability,
  readGatewayConfig,
  toPublicGatewayHealth
} from './index';
import { createGeminiClient, GeminiClientError } from '../gemini/client';
import { handleModifyAssetRequest } from '../http/modifyAssetRoute';
import type { IncomingMessage, ServerResponse } from 'node:http';

const ENV_KEYS = [
  'AI_MODE',
  'AI_BACKEND',
  'AI_GATEWAY_BASE_URL',
  'AI_GATEWAY_API_KEY',
  'AI_GATEWAY_PROTOCOL',
  'AI_GATEWAY_CHAT_PATH',
  'AI_GATEWAY_STRUCTURED_OUTPUT',
  'AI_GATEWAY_TIMEOUT_MS',
  'GEMINI_MODEL',
  'GEMINI_LIVE',
  'GEMINI_API_KEY',
  'GEMINI_IMAGE_API_KEY',
  'GEMINI_IMAGE_MODEL',
  'GEMINI_IMAGE_BASE_URL',
  'GEMINI_IMAGE_LIVE'
] as const;

const snapshot: Record<string, string | undefined> = {};

function captureEnv() {
  for (const key of ENV_KEYS) snapshot[key] = process.env[key];
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

function setGatewayEnv(baseUrl = 'https://gateway.example.invalid/v1') {
  process.env.AI_MODE = 'gemini';
  process.env.AI_BACKEND = 'internal_gateway';
  process.env.AI_GATEWAY_BASE_URL = baseUrl;
  process.env.AI_GATEWAY_API_KEY = 'test-gateway-key';
  process.env.AI_GATEWAY_PROTOCOL = 'openai';
  process.env.GEMINI_MODEL = 'vertex_ai.test-model';
  process.env.AI_GATEWAY_TIMEOUT_MS = '30000';
  delete process.env.GEMINI_LIVE;
  delete process.env.GEMINI_API_KEY;
}

afterEach(() => {
  restoreEnv();
  vi.restoreAllMocks();
});

captureEnv();

describe('gateway config + URL construction', () => {
  it('normalizes host-only base URLs by appending /v1 once', () => {
    expect(normalizeGatewayBaseUrl('https://gateway.example.invalid')).toBe(
      'https://gateway.example.invalid/v1'
    );
    expect(normalizeGatewayBaseUrl('https://gateway.example.invalid/')).toBe(
      'https://gateway.example.invalid/v1'
    );
    expect(normalizeGatewayBaseUrl('https://gateway.example.invalid/v1')).toBe(
      'https://gateway.example.invalid/v1'
    );
    expect(normalizeGatewayBaseUrl('https://gateway.example.invalid/v1/')).toBe(
      'https://gateway.example.invalid/v1'
    );
  });

  it('builds the canonical OpenAI chat-completions URL without doubling /v1', () => {
    expect(buildGatewayCompletionsUrl('https://gateway.example.invalid/v1')).toBe(
      'https://gateway.example.invalid/v1/chat/completions'
    );
    expect(buildGatewayCompletionsUrl('https://gateway.example.invalid')).toBe(
      'https://gateway.example.invalid/v1/chat/completions'
    );
  });

  it('reads the canonical environment contract', () => {
    setGatewayEnv();
    const config = readGatewayConfig();
    expect(config.protocol).toBe('openai');
    expect(config.model).toBe('vertex_ai.test-model');
    expect(config.completionsUrl).toBe('https://gateway.example.invalid/v1/chat/completions');
    expect(config.host).toBe('gateway.example.invalid');
    expect(config.authHeader).toBe('Authorization');
    expect(config.authScheme).toBe('Bearer');
  });

  it('treats AI_MODE=gemini as live', () => {
    setGatewayEnv();
    expect(isGeminiLive()).toBe(true);
    process.env.AI_MODE = 'mock';
    delete process.env.GEMINI_LIVE;
    expect(isGeminiLive()).toBe(false);
    process.env.GEMINI_LIVE = '1';
    expect(isGeminiLive()).toBe(true);
  });
});

describe('gateway client request contract', () => {
  it('sends Bearer auth, OpenAI messages, and json_object by default', async () => {
    setGatewayEnv();
    process.env.AI_GATEWAY_STRUCTURED_OUTPUT = 'json_object';

    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://gateway.example.invalid/v1/chat/completions');
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer test-gateway-key');
      expect(headers['Content-Type']).toBe('application/json');
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('vertex_ai.test-model');
      expect(body.temperature).toBe(0.2);
      expect(body.messages).toEqual([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'usr' }
      ]);
      expect(body.response_format).toEqual({ type: 'json_object' });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
        })
      };
    });

    const client = createGeminiClient({ live: true, fetchImpl: fetchImpl as never });
    const result = await client.generateJson({ system: 'sys', user: 'usr' });
    expect(result.text).toBe('{"ok":true}');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends json_schema response_format when configured and schema is supplied', async () => {
    setGatewayEnv();
    process.env.AI_GATEWAY_STRUCTURED_OUTPUT = 'json_schema';

    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.response_format).toEqual({
        type: 'json_schema',
        json_schema: {
          name: 'creative_specification',
          strict: true,
          schema: { type: 'object', properties: { ok: { type: 'boolean' } } }
        }
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] })
      };
    });

    const client = createGeminiClient({ live: true, fetchImpl: fetchImpl as never });
    await client.generateJson({
      system: 'sys',
      user: 'usr',
      schemaName: 'creative_specification',
      jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }
    });
  });

  it('classifies ENOTFOUND as a network_error with VPN guidance', async () => {
    setGatewayEnv();
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('getaddrinfo ENOTFOUND gateway.example.invalid'), {
          code: 'ENOTFOUND'
        })
      });
    });

    const client = createGeminiClient({ live: true, fetchImpl: fetchImpl as never });
    await expect(client.generateJson({ system: 's', user: 'u' })).rejects.toMatchObject({
      name: 'GeminiClientError',
      category: 'network_error',
      message: expect.stringContaining('corporate network/VPN')
    });
  });

  it('classifies abort as timeout', async () => {
    setGatewayEnv();
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });
    const client = createGeminiClient({ live: true, fetchImpl: fetchImpl as never });
    await expect(client.generateJson({ system: 's', user: 'u' })).rejects.toThrow(/timed out/);
  });

  it('maps gateway HTTP 401 to auth_error', async () => {
    setGatewayEnv();
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => 'unauthorized'
    }));
    const client = createGeminiClient({ live: true, fetchImpl: fetchImpl as never });
    await expect(client.generateJson({ system: 's', user: 'u' })).rejects.toMatchObject({
      category: 'auth_error'
    });
  });
});

describe('gateway preflight', () => {
  it('reports reachable when DNS and TCP succeed', async () => {
    setGatewayEnv();
    const result = await probeGatewayReachability({
      lookupImpl: (async () => [{ address: '127.0.0.1', family: 4 }]) as never,
      tcpConnectImpl: async () => true
    });
    expect(result).toEqual({
      configured: true,
      reachable: true,
      host: 'gateway.example.invalid',
      reason: null
    });
    expect(toPublicGatewayHealth(result)).toEqual({ configured: true, reachable: true });
  });

  it('reports unreachable without exposing credentials', async () => {
    setGatewayEnv();
    const result = await probeGatewayReachability({
      lookupImpl: (async () => {
        throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
      }) as never,
      tcpConnectImpl: async () => true
    });
    expect(result.reachable).toBe(false);
    expect(result.reason).toBe('dns_unresolved');
    const publicBody = JSON.stringify(toPublicGatewayHealth(result));
    expect(publicBody).not.toContain('test-gateway-key');
    expect(publicBody).not.toContain('AI_GATEWAY_API_KEY');
    expect(JSON.parse(publicBody)).toEqual({ configured: true, reachable: false });
  });

  it('describeGatewayConfig never leaks the API key', () => {
    setGatewayEnv();
    const summary = JSON.stringify(describeGatewayConfig());
    expect(summary).not.toContain('test-gateway-key');
    expect(summary).toContain('"configured":true');
  });
});

describe('Modify preflight gate', () => {
  function mockRes() {
    const chunks: string[] = [];
    const res = {
      statusCode: 0,
      headersSent: false,
      setHeader() {},
      end(payload?: string) {
        if (payload) chunks.push(payload);
      }
    } as unknown as ServerResponse;
    return { res, body: () => JSON.parse(chunks.join('') || '{}') };
  }

  function mockReq(body: unknown): IncomingMessage {
    const json = JSON.stringify(body);
    return {
      method: 'POST',
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(json);
      }
    } as unknown as IncomingMessage;
  }

  it('stops before Gemini image edit when the gateway is unreachable', async () => {
    setGatewayEnv();
    process.env.GEMINI_LIVE = '1';
    process.env.GEMINI_IMAGE_API_KEY = 'sk-test-image';
    process.env.GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
    const editImage = vi.fn();
    const { res, body } = mockRes();

    await handleModifyAssetRequest(
      mockReq({
        mode: 'modify',
        campaignBrief: { product: 'iPortal' },
        asset: { id: 'DAM-0188', channel: 'LinkedIn' },
        modification: {
          title: 'T',
          description: 'D',
          cta: 'C',
          prompt: 'Make the background darker'
        },
        campaignContext: {
          businessDomain: 'corporate',
          campaignType: 'iPortal',
          channel: 'LinkedIn'
        },
        sourceDamAsset: { id: 'DAM-0188' }
      }),
      res,
      {
        gatewayPreflight: async () => ({
          configured: true,
          reachable: false,
          host: 'gateway.example.invalid',
          reason: 'dns_unresolved'
        }),
        // Leave gemini undefined so production client + preflight path is exercised.
        gemini: undefined,
        firefly: {
          generateImage: vi.fn()
        } as never
      }
    );

    const payload = body();
    expect(payload.error).toMatch(/corporate network\/VPN/i);
    expect(payload.stage).toBe('interpreting');
    expect(editImage).not.toHaveBeenCalled();
  });
});
