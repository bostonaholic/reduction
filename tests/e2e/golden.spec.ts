/**
 * Golden master suite.
 *
 * Renders a fixed set of recipes and compares the resulting diagram, pixel for
 * pixel, against a committed reference image. Any change to the layout
 * algorithm, the operation labels, the ingredient formatting, or the stylesheet
 * moves pixels and fails the test.
 *
 * Two images are checked per recipe, because they come from two different
 * renderers and either can regress independently:
 *
 *   1. the on-screen table, laid out by the browser from our rowspan/colspan
 *   2. the exported PNG, drawn by our own canvas code in src/export/image.ts
 *
 * The fixtures are hand-written recipes rather than captured pages, so the
 * inputs never drift: a failure always means our code changed, never that a
 * publisher edited their site. Between them they cover all three extraction
 * strategies and the tree shapes that exercise the interesting layout paths.
 *
 * Reference images are platform-suffixed by Playwright (fonts rasterize
 * differently per OS). To adopt a deliberate change:
 *
 *     npx playwright test tests/e2e/golden.spec.ts --update-snapshots
 *
 * and review the resulting image diff before committing it.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const ROOT = join(import.meta.dirname, '..', '..');
const BUNDLE = join(ROOT, 'dist', 'content.js');
const PAGES = join(import.meta.dirname, 'golden-pages');

interface Fixture {
  /** Fixture file and snapshot basename. */
  name: string;
  /** What this recipe is here to pin down. */
  covers: string;
}

const FIXTURES: Fixture[] = [
  { name: 'brownies', covers: 'deep nesting, two banner rows, merged fillers at three widths' },
  { name: 'parallel', covers: 'two independent branches merged by a later step' },
  { name: 'banners', covers: 'three prep steps and a shallow tree' },
  { name: 'orphans', covers: 'garnishes no step mentions, attached to the final operation' },
  { name: 'microdata', covers: 'the microdata extraction path' },
  { name: 'heuristic', covers: 'the headings-and-lists extraction path, no structured data' },
];

/** Load the fixture, run the real content-script bundle, wait for the table. */
async function render(page: Page, bundle: string, name: string): Promise<void> {
  // A routed http origin keeps location.href — and everything derived from
  // it, like the export attribution — identical on every machine. The
  // handler reads the fixture from the request path, so re-registering it
  // for the same page just stacks equivalent handlers.
  await page.route('http://golden.local/*', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    await route.fulfill({
      contentType: 'text/html',
      body: await readFile(join(PAGES, pathname), 'utf8'),
    });
  });
  await page.goto(`http://golden.local/${name}.html`);
  expect(page.url()).toBe(`http://golden.local/${name}.html`);
  await page.evaluate(bundle);
  await page.waitForFunction(() => {
    const host = document.getElementById('reduction-overlay-host');
    return !!host?.shadowRoot?.querySelector('.rd-table');
  });
  // Web fonts and layout settle before we measure anything.
  await page.evaluate(() => document.fonts.ready);
}

test.describe('golden master', () => {
  for (const fixture of FIXTURES) {
    test(`${fixture.name} renders the expected diagram — ${fixture.covers}`, async ({ page }) => {
      const bundle = await readFile(BUNDLE, 'utf8');
      await render(page, bundle, fixture.name);

      const table = page.locator('#reduction-overlay-host .rd-table');
      await expect(table).toBeVisible();
      await expect(table).toHaveScreenshot(`${fixture.name}-table.png`);
    });

    test(`${fixture.name} exports a PNG matching its reference`, async ({ page, context }) => {
      const bundle = await readFile(BUNDLE, 'utf8');
      await render(page, bundle, fixture.name);

      // Go through the real button, so the export path is tested end to end.
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#reduction-overlay-host [data-act="png"]').click(),
      ]);

      const path = await download.path();
      expect(path, 'PNG export produced no file').toBeTruthy();
      const png = await readFile(path!);
      expect(png.length, 'exported PNG is empty').toBeGreaterThan(1000);
      // PNG magic number — proves we wrote an image, not an error page.
      expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      // Display it at its true CSS size (the export renders at 2x) and compare.
      const viewer = await context.newPage();
      await viewer.setContent(
        `<body style="margin:0;background:#fff">
           <img id="shot" src="data:image/png;base64,${png.toString('base64')}" />
         </body>`,
      );
      const img = viewer.locator('#shot');
      await img.evaluate((node: HTMLImageElement) => node.decode());
      await img.evaluate((node: HTMLImageElement) => {
        node.style.display = 'block';
        node.style.width = `${node.naturalWidth / 2}px`;
      });

      await expect(img).toHaveScreenshot(`${fixture.name}-export.png`);
      await viewer.close();
    });
  }
});

/**
 * The SVG export feeds no screenshot, so its one behavioral promise — the
 * attribution band links back to the source page — is pinned by content.
 */
test('brownies SVG export links back to the source page', async ({ page }) => {
  const bundle = await readFile(BUNDLE, 'utf8');
  await render(page, bundle, 'brownies');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#reduction-overlay-host [data-act="svg"]').click(),
  ]);

  const path = await download.path();
  expect(path, 'SVG export produced no file').toBeTruthy();
  const svg = await readFile(path!, 'utf8');

  const url = 'http://golden.local/brownies.html';
  expect(svg).toContain(`href="${url}"`);
  // Once in the href, once as the visible band text.
  expect(svg.split(url).length - 1).toBe(2);
});

/**
 * Structural assertions alongside the pixels. When a golden fails, these say
 * whether the diagram is genuinely wrong or merely moved.
 */
test('golden fixtures produce the expected table structure', async ({ page }) => {
  const bundle = await readFile(BUNDLE, 'utf8');

  const expected: Record<string, { rows: number; cols: number; banners: number }> = {
    brownies: { rows: 11, cols: 6, banners: 2 },
    parallel: { rows: 7, cols: 4, banners: 0 },
    banners: { rows: 7, cols: 3, banners: 3 },
    orphans: { rows: 8, cols: 4, banners: 0 },
    microdata: { rows: 5, cols: 4, banners: 1 },
    // toss(slice(cucumbers), whisk(vinegar, sugar, oil, salt)) — depth 2.
    heuristic: { rows: 5, cols: 3, banners: 0 },
  };

  const actual: Record<string, { rows: number; cols: number; banners: number }> = {};

  for (const name of Object.keys(expected)) {
    await render(page, bundle, name);

    actual[name] = await page.evaluate(() => {
      const table = document
        .getElementById('reduction-overlay-host')!
        .shadowRoot!.querySelector('.rd-table') as HTMLTableElement;
      const rows = Array.from(table.rows);
      const cols = Math.max(
        ...rows.map((r) => Array.from(r.cells).reduce((n, c) => n + c.colSpan, 0)),
      );
      return {
        rows: rows.length,
        cols,
        banners: table.querySelectorAll('.rd-banner').length,
      };
    });
  }

  // Compared in one shot so a single run reports every drift, not just the
  // first fixture that moved.
  expect(actual).toEqual(expected);
});
