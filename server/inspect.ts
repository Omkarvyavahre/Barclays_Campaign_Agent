/**
 * Offline configuration inspector.
 *
 * Prints the same safe view the health endpoint exposes, without contacting the
 * gateway, so configuration can be checked before anyone attempts a live call.
 * Secrets are reported as booleans only.
 */

import { loadDotEnv } from './env.ts';
import { loadAiConfig, toPublicAiConfig } from './ai/config.ts';
import { AiServiceError } from './ai/errors.ts';

export function describeConfig(env: Record<string, string | undefined> = process.env): string {
  try {
    const config = loadAiConfig(env);
    const publicConfig = toPublicAiConfig(config);
    const lines = [
      'Barclays AI service configuration (no network call made)',
      `  mode              : ${publicConfig.mode}`,
      `  backend           : ${publicConfig.backend}`,
      `  protocol          : ${publicConfig.protocol}`,
      `  gateway configured: ${publicConfig.gatewayConfigured}`,
      `  model configured  : ${publicConfig.modelConfigured}`,
      `  timeout (ms)      : ${config.timeoutMs}`,
    ];
    if (publicConfig.mode === 'gemini' && !(publicConfig.gatewayConfigured && publicConfig.modelConfigured)) {
      lines.push('  WARNING: gemini mode selected but gateway/model values are incomplete.');
    }
    return lines.join('\n');
  } catch (error) {
    const safe = error instanceof AiServiceError ? error : new AiServiceError('configuration_error');
    return `Configuration problem (${safe.category}): ${safe.internalDetail ?? safe.message}`;
  }
}

// Executed directly via `npm run ai:inspect`.
if (process.argv[1] && process.argv[1].endsWith('inspect.ts')) {
  const status = loadDotEnv();
  console.log(`  .env file        : ${status.found ? (status.loaded ? 'loaded' : 'found but unreadable') : 'not present'}`);
  console.log(describeConfig());
}
