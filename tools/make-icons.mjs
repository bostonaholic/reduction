/**
 * Render the toolbar icons from one SVG.
 *
 *   node tools/make-icons.mjs
 *
 * The mark is the recipe table itself: an ingredient column on the left and
 * operation cells spanning it on the right.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'src', 'icons');

const SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="26" fill="#fffdf3"/>
  <g stroke="#3d8b40" stroke-width="7" fill="none">
    <rect x="16" y="16" width="96" height="96" rx="6"/>
    <path d="M16 40h96M16 64h60M16 88h60M76 40v72"/>
    <path d="M76 64h36"/>
  </g>
</svg>`;

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 128, height: 128 } });
await page.setContent(
  `<body style="margin:0;background:transparent">${SVG}</body>`,
  { waitUntil: 'load' },
);

for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.evaluate((s) => {
    const svg = document.querySelector('svg');
    if (svg) {
      svg.setAttribute('width', String(s));
      svg.setAttribute('height', String(s));
    }
  }, size);
  const buffer = await page.screenshot({ omitBackground: true });
  await writeFile(join(outDir, `icon-${size}.png`), buffer);
  console.log(`icon-${size}.png`);
}

await browser.close();
