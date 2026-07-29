/**
 * Acceptance tests for the packaged CLI.
 *
 * The only tests that spawn the built artifact: they are what checks the
 * shebang banner, the esm format, and the bundle itself. Skipped when
 * dist/cli.mjs is absent (the repo's skip-if-absent idiom) — but `prepare`
 * builds during `npm ci`, so they never skip in CI.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const cliPath = join(import.meta.dirname, '..', '..', 'dist', 'cli.mjs');

describe.skipIf(!existsSync(cliPath))('the built CLI', () => {
  it('prints usage on stdout and exits 0 for --help', () => {
    const result = spawnSync('node', [cliPath, '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: reduction');
    expect(result.stderr).toBe('');
  });

  it('prints usage on stderr and exits 2 with no arguments', () => {
    const result = spawnSync('node', [cliPath], { encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage: reduction');
    expect(result.stdout).toBe('');
  });
});
