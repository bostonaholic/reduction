/**
 * Acceptance tests for the CLI argument parser.
 *
 * parseArgs is pure — argv in, a discriminated result out — so nothing here
 * spawns a process or touches process.argv. Usage errors are the exit-2
 * class; the caller (src/cli/index.ts) maps `error` to stderr + exit 2 and
 * `help` to stdout + exit 0.
 */

import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../src/cli/args.js';

describe('parseArgs', () => {
  it('accepts a URL with an explicit format', () => {
    expect(parseArgs(['https://example.test/brownies', '--format', 'html'])).toMatchObject({
      kind: 'run',
      url: 'https://example.test/brownies',
      format: 'html',
    });
  });

  it('accepts --format json', () => {
    expect(parseArgs(['https://example.test/brownies', '--format', 'json'])).toMatchObject({
      kind: 'run',
      format: 'json',
    });
  });

  it('defaults the format to text', () => {
    expect(parseArgs(['https://example.test/brownies'])).toMatchObject({
      kind: 'run',
      format: 'text',
    });
  });

  it('rejects a missing URL as a usage error', () => {
    expect(parseArgs([]).kind).toBe('error');
  });

  it('rejects a non-http(s) URL as a usage error', () => {
    expect(parseArgs(['ftp://example.test/brownies']).kind).toBe('error');
  });

  it('rejects a URL with embedded credentials without echoing them', () => {
    const result = parseArgs(['https://user:token@example.test/brownies']);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).not.toContain('token');
      expect(result.message).toMatch(/credentials/i);
    }
  });

  it('rejects an unknown flag as a usage error', () => {
    expect(parseArgs(['https://example.test/brownies', '--frobnicate']).kind).toBe('error');
  });

  it('rejects an unknown format as a usage error', () => {
    expect(parseArgs(['https://example.test/brownies', '--format', 'yaml']).kind).toBe('error');
  });

  it('returns help for --help', () => {
    expect(parseArgs(['--help']).kind).toBe('help');
  });
});
