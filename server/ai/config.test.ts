import { describe, expect, it } from 'vitest';

import { DEFAULT_TIMEOUT_MS, assertLiveConfig, loadAiConfig, toPublicAiConfig } from './config';
import { AiServiceError } from './errors';

const FULL_ENV = {
  AI_MODE: 'gemini',
  AI_BACKEND: 'internal_gateway',
  AI_GATEWAY_BASE_URL: 'https://gateway.internal.example/v1',
  AI_GATEWAY_API_KEY: 'super-secret-key-value',
  AI_GATEWAY_PROTOCOL: 'openai',
  GEMINI_MODEL: 'gemini-2.5-pro',
};

describe('provider config parsing', () => {
  it('defaults to mock mode with no environment at all', () => {
    const config = loadAiConfig({});
    expect(config.mode).toBe('mock');
    expect(config.backend).toBe('internal_gateway');
    expect(config.protocol).toBe('openai');
    expect(config.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
  });

  it('parses a complete gemini configuration', () => {
    const config = loadAiConfig(FULL_ENV);
    expect(config.mode).toBe('gemini');
    expect(config.model).toBe('gemini-2.5-pro');
    expect(config.gatewayBaseUrl).toBe('https://gateway.internal.example/v1');
  });

  it('strips a trailing slash from the gateway base url', () => {
    const config = loadAiConfig({ ...FULL_ENV, AI_GATEWAY_BASE_URL: 'https://gateway.internal.example/v1///' });
    expect(config.gatewayBaseUrl).toBe('https://gateway.internal.example/v1');
  });

  it('rejects an unsupported mode', () => {
    expect(() => loadAiConfig({ AI_MODE: 'openai_direct' })).toThrowError(AiServiceError);
  });

  it('rejects an unsupported backend, so the gateway cannot be bypassed', () => {
    expect(() => loadAiConfig({ AI_BACKEND: 'direct' })).toThrowError(AiServiceError);
  });

  it('rejects a non-numeric timeout', () => {
    expect(() => loadAiConfig({ AI_GATEWAY_TIMEOUT_MS: 'soon' })).toThrowError(AiServiceError);
  });

  it('requires every live value before a call may be attempted', () => {
    expect(() => assertLiveConfig(loadAiConfig({ ...FULL_ENV, AI_GATEWAY_API_KEY: '' }))).toThrowError(AiServiceError);
    expect(() => assertLiveConfig(loadAiConfig({ ...FULL_ENV, AI_GATEWAY_BASE_URL: '' }))).toThrowError(AiServiceError);
    expect(() => assertLiveConfig(loadAiConfig({ ...FULL_ENV, GEMINI_MODEL: '' }))).toThrowError(AiServiceError);
    expect(() => assertLiveConfig(loadAiConfig(FULL_ENV))).not.toThrow();
  });
});

describe('secrets are never serialised to the browser', () => {
  it('exposes only booleans and non-sensitive labels', () => {
    const publicConfig = toPublicAiConfig(loadAiConfig(FULL_ENV));
    expect(publicConfig).toEqual({
      mode: 'gemini',
      backend: 'internal_gateway',
      protocol: 'openai',
      gatewayConfigured: true,
      modelConfigured: true,
    });
  });

  it('omits the key and base url from the serialised payload', () => {
    const serialised = JSON.stringify(toPublicAiConfig(loadAiConfig(FULL_ENV)));
    expect(serialised).not.toContain('super-secret-key-value');
    expect(serialised).not.toContain('gateway.internal.example');
    expect(serialised).not.toMatch(/authorization/i);
    expect(serialised).not.toMatch(/bearer/i);
  });

  it('reports gatewayConfigured false when either half is missing', () => {
    expect(toPublicAiConfig(loadAiConfig({ ...FULL_ENV, AI_GATEWAY_API_KEY: '' })).gatewayConfigured).toBe(false);
    expect(toPublicAiConfig(loadAiConfig({ ...FULL_ENV, AI_GATEWAY_BASE_URL: '' })).gatewayConfigured).toBe(false);
  });
});
