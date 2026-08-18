/**
 * Environment loader contract tests. Never loads secrets into assertions beyond presence.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadServerEnvFile } from '../../serverEnv';

describe('loadServerEnvFile', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    delete process.env.TEST_GATEWAY_ONLY_KEY;
    delete process.env.TEST_SHELL_WINS;
  });

  it('loads .env into process.env without overriding shell values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'barclays-env-'));
    dirs.push(dir);
    writeFileSync(
      join(dir, '.env'),
      ['TEST_GATEWAY_ONLY_KEY=from-file', 'TEST_SHELL_WINS=from-file', ''].join('\n'),
      'utf8'
    );

    process.env.TEST_SHELL_WINS = 'from-shell';
    loadServerEnvFile(dir);

    expect(process.env.TEST_GATEWAY_ONLY_KEY).toBe('from-file');
    expect(process.env.TEST_SHELL_WINS).toBe('from-shell');
  });
});
