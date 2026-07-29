/**
 * Capture the README screenshot: the overlay rendered in situ on the demo
 * recipe page, with dimmed page prose visible below the panel.
 *
 *   npm run build && npm run screenshot
 *   node tools/make-screenshot.mjs [fixture]   # fixture defaults to demo
 *
 * Regenerate on macOS: the committed image's font rasterization is
 * platform-specific (the same reason the golden references are `-darwin`
 * suffixed), so a Linux- or Windows-rendered replacement diffs everywhere.
 *
 * Before writing anything the tool measures, in CSS px, the overlay panel and
 * the page's #method list, and requires at least MIN_OVERLAP px of the method
 * prose to be visible below the panel inside the viewport. On failure it
 * prints every measured number and exits non-zero without touching the
 * committed image — it never overwrites a good screenshot with one that
 * breaks the in-situ rule.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const BUNDLE = join(ROOT, 'dist', 'content.js');

const slug = process.argv[2] ?? 'demo';
if (!/^[a-z0-9-]+$/.test(slug)) {
  console.error(`Fixture must be a bare slug (a-z, 0-9, -), got "${slug}".`);
  process.exit(1);
}
const PAGE = join(ROOT, 'tests', 'e2e', 'golden-pages', `${slug}.html`);
const OUT = join(ROOT, 'docs', 'screenshot.png');

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 1000;
const MIN_OVERLAP = 150;

let bundle;
try {
  bundle = await readFile(BUNDLE, 'utf8');
} catch {
  console.error(`Missing ${BUNDLE} — run \`npm run build\` first.`);
  process.exit(1);
}

let html;
try {
  html = await readFile(PAGE, 'utf8');
} catch {
  console.error(`Missing ${PAGE}.`);
  process.exit(1);
}

let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  console.error('Could not launch Chromium — run `npx playwright install chromium` first.');
  console.error(String(error));
  process.exit(1);
}

const page = await browser.newPage({
  viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
  deviceScaleFactor: 2,
});

// Serve the fixture from a synthetic origin, mirroring tests/e2e/golden.spec.ts:
// over file:// the page URL would carry the maintainer's home directory, and
// the extension renders the page URL on its export surfaces.
// Registered first so it loses precedence: Playwright checks the most
// recently added handler first. Anything not served below fails rather than
// reaching the network, keeping the capture offline and deterministic even if
// a fixture later gains a remote asset.
await page.route('**/*', (route) => route.abort());
await page.route('http://golden.local/*', (route) =>
  route.fulfill({ contentType: 'text/html', body: html }),
);

console.log(`Rendering ${PAGE}`);
await page.goto(`http://golden.local/${slug}.html`);
await page.evaluate(bundle);
await page.waitForFunction(() => {
  const host = document.getElementById('reduction-overlay-host');
  return !!host?.shadowRoot?.querySelector('.rd-table');
});
// Web fonts and layout settle before we measure anything.
await page.evaluate(() => document.fonts.ready);

const boxes = await page.evaluate(() => {
  const box = (el) => {
    const { top, bottom, left, width, height } = el.getBoundingClientRect();
    return { top, bottom, left, width, height };
  };
  const panel = document
    .getElementById('reduction-overlay-host')
    .shadowRoot.querySelector('.rd-panel');
  const method = document.getElementById('method');
  return { panel: box(panel), method: method && box(method) };
});

if (!boxes.method) {
  console.error(`No #method element in ${PAGE} — the in-situ overlap check needs it.`);
  await browser.close();
  process.exit(1);
}

const overlap =
  Math.min(boxes.method.bottom, VIEWPORT_HEIGHT) -
  Math.max(boxes.method.top, boxes.panel.bottom);

const round = (b) =>
  `top ${b.top.toFixed(1)}, bottom ${b.bottom.toFixed(1)}, height ${b.height.toFixed(1)}`;
console.log(`.rd-panel: ${round(boxes.panel)}`);
console.log(`#method:   ${round(boxes.method)}`);
console.log(`overlap:   ${overlap.toFixed(1)} CSS px (minimum ${MIN_OVERLAP})`);

if (overlap < MIN_OVERLAP) {
  console.error(
    `In-situ rule broken: only ${overlap.toFixed(1)}px of #method prose is visible ` +
      `below the panel inside the ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT} viewport ` +
      `(minimum ${MIN_OVERLAP}). Not writing ${OUT}.`,
  );
  await browser.close();
  process.exit(1);
}

const buffer = await page.screenshot({ animations: 'disabled', caret: 'hide' });
await writeFile(OUT, buffer);
console.log(`Wrote ${OUT}`);

await browser.close();
