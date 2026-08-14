/**
 * Image provider configuration parsing, and the guarantee that the public shape
 * carries no credential.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ADOBE_IMS_BASE_URL,
  DEFAULT_FIREFLY_API_BASE_URL,
  DEFAULT_FIREFLY_SCOPE,
  DEFAULT_IMAGE_TIMEOUT_MS,
  assertLiveImageConfig,
  loadImageConfig,
  toPublicImageConfig,
} from './config.ts';
import { ImageServiceError } from './errors.ts';

describe('loadImageConfig', () => {
  it('defaults to mock with the documented Adobe endpoints and scope', () => {
    const config = loadImageConfig({});
    expect(config.provider).toBe('mock');
    expect(config.apiBaseUrl).toBe(DEFAULT_FIREFLY_API_BASE_URL);
    expect(config.imsBaseUrl).toBe(DEFAULT_ADOBE_IMS_BASE_URL);
    expect(config.scope).toBe(DEFAULT_FIREFLY_SCOPE);
    expect(config.timeoutMs).toBe(DEFAULT_IMAGE_TIMEOUT_MS);
    expect(config.clientId).toBe('');
    expect(config.clientSecret).toBe('');
  });

  it('reads the provider and credentials from the environment', () => {
    const config = loadImageConfig({
      IMAGE_GENERATION_PROVIDER: 'firefly',
      ADOBE_FIREFLY_CLIENT_ID: ' id ',
      ADOBE_FIREFLY_CLIENT_SECRET: ' secret ',
      IMAGE_GENERATION_TIMEOUT_MS: '15000',
    });
    expect(config.provider).toBe('firefly');
    expect(config.clientId).toBe('id');
    expect(config.clientSecret).toBe('secret');
    expect(config.timeoutMs).toBe(15_000);
  });

  it('trims a trailing slash from an override base URL', () => {
    const config = loadImageConfig({ ADOBE_FIREFLY_API_BASE_URL: 'https://firefly.example/' });
    expect(config.apiBaseUrl).toBe('https://firefly.example');
  });

  it.each([
    ['IMAGE_GENERATION_PROVIDER', { IMAGE_GENERATION_PROVIDER: 'dalle' }],
    ['IMAGE_GENERATION_TIMEOUT_MS', { IMAGE_GENERATION_TIMEOUT_MS: '-1' }],
    ['a non-https base URL', { ADOBE_FIREFLY_API_BASE_URL: 'http://firefly.example' }],
  ])('rejects %s', (_label, env) => {
    try {
      loadImageConfig(env);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ImageServiceError).category).toBe('configuration_error');
    }
  });
});

describe('toPublicImageConfig', () => {
  it('reports booleans only, never a credential', () => {
    const config = loadImageConfig({
      IMAGE_GENERATION_PROVIDER: 'firefly',
      ADOBE_FIREFLY_CLIENT_ID: 'super-secret-id',
      ADOBE_FIREFLY_CLIENT_SECRET: 'super-secret-value',
    });
    const publicConfig = toPublicImageConfig(config, true);

    expect(publicConfig).toEqual({ provider: 'firefly', credentialsConfigured: true, referencesAvailable: true });
    const serialised = JSON.stringify(publicConfig);
    expect(serialised).not.toContain('super-secret-id');
    expect(serialised).not.toContain('super-secret-value');
    expect(serialised).not.toContain('adobe');
    expect(serialised).not.toContain('firefly-api');
  });

  it('reports unconfigured credentials as false', () => {
    expect(toPublicImageConfig(loadImageConfig({}), false)).toEqual({
      provider: 'mock',
      credentialsConfigured: false,
      referencesAvailable: false,
    });
  });
});

describe('assertLiveImageConfig', () => {
  it('accepts a complete firefly configuration', () => {
    const config = loadImageConfig({
      IMAGE_GENERATION_PROVIDER: 'firefly',
      ADOBE_FIREFLY_CLIENT_ID: 'id',
      ADOBE_FIREFLY_CLIENT_SECRET: 'secret',
    });
    expect(() => assertLiveImageConfig(config)).not.toThrow();
  });

  it.each([
    ['mock mode', {}],
    ['a missing client id', { IMAGE_GENERATION_PROVIDER: 'firefly', ADOBE_FIREFLY_CLIENT_SECRET: 'secret' }],
    ['a missing client secret', { IMAGE_GENERATION_PROVIDER: 'firefly', ADOBE_FIREFLY_CLIENT_ID: 'id' }],
  ])('rejects %s', (_label, env) => {
    expect(() => assertLiveImageConfig(loadImageConfig(env))).toThrow(ImageServiceError);
  });
});
