/**
 * Bundle the extension and the CLI into dist/.
 *
 *   node build.mjs [--watch]
 *
 * esbuild only, no framework. Content scripts cannot be ES modules, so that
 * entry is bundled as an IIFE; everything else ships as a module.
 *
 * This script also runs as the package's `prepare` hook, so a broken build
 * fails `npm install` / `npm ci` as an install failure. CI's explicit build
 * step stays anyway — it is the readable signal of *what* broke, not a
 * redundancy to drop.
 */

import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const shared = {
  bundle: true,
  target: 'chrome114',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
  // The overlay's CSS is injected into a shadow root as a string, so it is
  // bundled as text rather than emitted as a stylesheet.
  loader: { '.css': 'text' },
};

const builds = [
  // The content script runs in the page; it must be a single self-contained
  // IIFE because Chrome will not load a module content script.
  { entryPoints: [join(root, 'src/content/index.ts')], outfile: join(dist, 'content.js'), format: 'iife' },
  { entryPoints: [join(root, 'src/background.ts')], outfile: join(dist, 'background.js'), format: 'esm' },
  { entryPoints: [join(root, 'src/options/options.ts')], outfile: join(dist, 'options.js'), format: 'esm' },
  { entryPoints: [join(root, 'src/print/print.ts')], outfile: join(dist, 'print.js'), format: 'esm' },
  // The CLI runs under Node, not Chrome; `target` overrides the shared
  // chrome114. jsdom stays external because its dynamic requires bundle
  // badly — it resolves from node_modules at run time instead.
  {
    entryPoints: [join(root, 'src/cli/index.ts')],
    outfile: join(dist, 'cli.mjs'),
    format: 'esm',
    platform: 'node',
    target: 'node22',
    banner: { js: '#!/usr/bin/env node' },
    external: ['jsdom'],
  },
];

const staticFiles = [
  ['src/manifest.json', 'manifest.json'],
  ['src/options/options.html', 'options.html'],
  ['src/print/print.html', 'print.html'],
  ['src/icons', 'icons'],
];

async function copyStatic() {
  for (const [from, to] of staticFiles) {
    await cp(join(root, from), join(dist, to), { recursive: true }).catch((err) => {
      if (err.code !== 'ENOENT') throw err;
      console.warn(`skipped missing ${from}`);
    });
  }
}

if (watch) {
  for (const options of builds) {
    const ctx = await esbuild.context({ ...shared, ...options });
    await ctx.watch();
  }
  await copyStatic();
  console.log('watching…');
} else {
  await Promise.all(builds.map((options) => esbuild.build({ ...shared, ...options })));
  await copyStatic();
  console.log('built dist/');
}
