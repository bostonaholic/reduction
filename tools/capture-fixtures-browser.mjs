/**
 * Capture the sites that block plain fetch, using a real browser.
 *
 *   node tools/capture-fixtures-browser.mjs
 *
 * Saves the *rendered* DOM rather than the raw response, which is what a
 * content script actually sees — including anything injected after hydration.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'tests', 'fixtures');

const SITES = [
  ['allrecipes', 'https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/'],
  ['seriouseats', 'https://www.seriouseats.com/the-best-chocolate-chip-cookies-recipe'],
  ['simplyrecipes', 'https://www.simplyrecipes.com/recipes/banana_bread/'],
  ['smittenkitchen', 'https://smittenkitchen.com/2020/03/ultimate-banana-bread/'],
  ['minimalistbaker', 'https://minimalistbaker.com/one-bowl-gluten-free-banana-bread/'],
  ['cookieandkate', 'https://cookieandkate.com/healthy-banana-bread-recipe/'],
  ['thekitchn', 'https://www.thekitchn.com/how-to-make-banana-bread-recipe-23032085'],
  ['food52', 'https://food52.com/recipes/81793-best-chocolate-chip-cookie-recipe'],
  ['tasteofhome', 'https://www.tasteofhome.com/recipes/best-ever-banana-bread/'],
  ['epicurious', 'https://www.epicurious.com/recipes/food/views/cocoa-brownies-with-browned-butter-and-walnuts-360836'],
];

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 900 },
  locale: 'en-US',
});

const captured = [];
for (const [name, url] of SITES) {
  const page = await context.newPage();
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const status = res?.status() ?? 0;
    if (status >= 400) {
      console.log(`FAIL  ${name.padEnd(18)} HTTP ${status}`);
      continue;
    }
    // Give client-rendered recipe modules a moment to attach.
    await page.waitForTimeout(2500);
    const html = await page.content();
    if (html.length < 5000) {
      console.log(`FAIL  ${name.padEnd(18)} suspiciously small`);
      continue;
    }
    await writeFile(join(outDir, `${name}.html`), html, 'utf8');
    captured.push([name, url]);
    console.log(`ok    ${name.padEnd(18)} ${(html.length / 1024).toFixed(0)} KB`);
  } catch (err) {
    console.log(`FAIL  ${name.padEnd(18)} ${err.message.split('\n')[0]}`);
  } finally {
    await page.close();
  }
}

await browser.close();

// Merge into the source manifest written by the fetch-based capture.
const manifestPath = join(outDir, 'sources.json');
let existing = {};
try {
  existing = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch {
  // First run — nothing to merge.
}
for (const [name, url] of captured) existing[name] = url;
await writeFile(manifestPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');

console.log(`\ncaptured ${captured.length}/${SITES.length}; manifest now lists ${Object.keys(existing).length} sites`);
