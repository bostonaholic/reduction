/**
 * Acceptance tests for the packaged CLI.
 *
 * The only tests that spawn the built artifact: they are what checks the
 * shebang banner, the esm format, and the bundle itself. Skipped when
 * dist/cli.mjs is absent (the repo's skip-if-absent idiom) — but `prepare`
 * builds during `npm ci`, so they never skip in CI.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const cliPath = join(import.meta.dirname, '..', '..', 'dist', 'cli.mjs');

/** As spawnSync, but async, so an in-process test server can answer the child. */
function spawnCli(args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [cliPath, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

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

  // Must spawn the real binary: jsdom's default virtual console writes to the
  // process's real stderr, which in-process tests with injected sinks never
  // see. Regression test for the silent VirtualConsole in src/cli/run.ts.
  it('keeps page-derived jsdom noise, including escape sequences, off real stderr', { timeout: 15_000 }, async () => {
    const ESC = '\u001b';
    const BEL = '\u0007';
    // A relative @import cannot resolve against the default about:blank base,
    // and jsdom's error message quotes the href verbatim — so any control
    // characters in it would reach the terminal raw.
    // \u202e is an RLO bidi override: it makes "gnp.exe" display as "exe.png".
    const hostileImport = `${ESC}]0;PWNED-TITLE${BEL}${ESC}[2K${ESC}[1;31mFORGED\u202egnp.exe${ESC}[0m.css`;
    const recipe = {
      '@context': 'https://schema.org',
      '@type': 'Recipe',
      name: 'Escape Brownies',
      recipeIngredient: ['4 oz unsalted butter', '1 cup sugar'],
      recipeInstructions: [
        { '@type': 'HowToStep', text: 'Melt the butter.' },
        { '@type': 'HowToStep', text: 'Mix in the sugar.' },
      ],
    };
    const page = [
      '<!doctype html><html><head><title>Fixture</title>',
      `<style>@import "${hostileImport}";</style>`,
      `<script type="application/ld+json">${JSON.stringify(recipe)}</script>`,
      '</head><body><p>Recipe page</p></body></html>',
    ].join('');

    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(page);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    try {
      const result = await spawnCli([`http://127.0.0.1:${port}/`, '--format', 'json']);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).recipe.title).toBe('Escape Brownies');
      expect(result.stderr).not.toContain(ESC);
      expect(result.stderr).toBe('');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

// ————— vector formats: svg, png, pdf —————

// A variable specifier keeps the optional package out of static resolution:
// @resvg/resvg-js is an optional dependency, and the png smoke test must
// skip, not error, when it is absent.
const RESVG_PACKAGE = '@resvg/resvg-js';
const resvgAvailable = await import(RESVG_PACKAGE).then(
  () => true,
  () => false,
);

/** As spawnCli, but keeps stdout binary — PNG bytes die in a utf8 decode. */
function spawnCliBytes(
  args: string[],
): Promise<{ status: number | null; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [cliPath, ...args]);
    const stdout: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout: Buffer.concat(stdout), stderr }));
  });
}

const VECTOR_RECIPE_PAGE = [
  '<!doctype html><html><head><title>Fixture</title>',
  `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: 'Vector Brownies',
    recipeIngredient: ['4 oz unsalted butter', '1 cup sugar'],
    recipeInstructions: [
      { '@type': 'HowToStep', text: 'Melt the butter.' },
      { '@type': 'HowToStep', text: 'Mix in the sugar.' },
    ],
  })}</script>`,
  '</head><body><p>Recipe page</p></body></html>',
].join('');

async function withRecipeServer<T>(body: (origin: string) => Promise<T>): Promise<T> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(VECTOR_RECIPE_PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  try {
    return await body(`http://127.0.0.1:${port}/`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe.skipIf(!existsSync(cliPath))('the built CLI vector formats', () => {
  it('renders an SVG diagram end-to-end for --format svg', { timeout: 15_000 }, async () => {
    await withRecipeServer(async (origin) => {
      const result = await spawnCli([origin, '--format', 'svg']);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/^<svg/);
      expect(result.stdout).toContain('butter');
      // The confidence note reaches the user on stderr, never the artifact.
      expect(result.stderr).toMatch(/ingredients matched a step|listed in order/);
      expect(result.stdout).not.toContain(result.stderr.trim());
    });
  });

  // The only proof that the resvg external and the import.meta.url font path
  // resolve from the built bundle, not just from source under vitest.
  it.skipIf(!resvgAvailable)(
    'exits 0 with PNG magic bytes for --format png from the built bundle',
    { timeout: 20_000 },
    async () => {
      await withRecipeServer(async (origin) => {
        const result = await spawnCliBytes([origin, '--format', 'png']);
        expect(result.status, result.stderr).toBe(0);
        expect(Array.from(result.stdout.subarray(0, 8))).toEqual([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]);
      });
    },
  );
});
