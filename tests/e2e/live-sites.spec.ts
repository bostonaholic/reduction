/**
 * The real test: run the built content script against live recipe sites.
 *
 * The bundle is executed through CDP rather than injected with a script tag,
 * which is both closer to how Chrome runs a content script and immune to the
 * host page's CSP. Every assertion is about structure — how many rows, how many
 * operation columns, whether the grid tiles — never about recipe text.
 *
 * Sites go down, get rewritten, and block robots, so the bar is "at least a
 * dozen render correctly" rather than "every single one".
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const ROOT = join(import.meta.dirname, '..', '..');
const BUNDLE = join(ROOT, 'dist', 'content.js');
const SHOTS = join(ROOT, 'tests', 'e2e', 'screenshots');

const SITES: Array<[string, string]> = [
  ['allrecipes', 'https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/'],
  ['bbcgoodfood', 'https://www.bbcgoodfood.com/recipes/classic-victoria-sandwich-recipe'],
  ['bonappetit', 'https://www.bonappetit.com/recipe/bas-best-chocolate-chip-cookies'],
  ['budgetbytes', 'https://www.budgetbytes.com/slow-cooker-chicken-tortilla-soup/'],
  ['cookieandkate', 'https://cookieandkate.com/healthy-banana-bread-recipe/'],
  ['delish', 'https://www.delish.com/cooking/recipe-ideas/a19636089/best-chocolate-chip-cookies-recipe/'],
  ['foodnetwork', 'https://www.foodnetwork.com/recipes/alton-brown/the-chewy-recipe-1909046'],
  ['kingarthur', 'https://www.kingarthurbaking.com/recipes/classic-birthday-cake-recipe'],
  ['loveandlemons', 'https://www.loveandlemons.com/banana-bread/'],
  ['minimalistbaker', 'https://minimalistbaker.com/one-bowl-gluten-free-banana-bread/'],
  ['recipetineats', 'https://www.recipetineats.com/chocolate-cake/'],
  ['sallysbaking', 'https://sallysbakingaddiction.com/chewy-chocolate-chip-cookies/'],
  ['simplyrecipes', 'https://www.simplyrecipes.com/recipes/banana_bread/'],
  ['tasteofhome', 'https://www.tasteofhome.com/recipes/best-ever-banana-bread/'],
  ['tasty', 'https://tasty.co/recipe/the-best-chewy-chocolate-chip-cookies'],
];

interface Rendered {
  ok: boolean;
  reason?: string;
  title?: string;
  confidence?: string;
  rows?: number;
  cols?: number;
  ingredients?: number;
  ops?: number;
  banners?: number;
  /** Every grid position covered exactly once — the layout invariant. */
  tiles?: boolean;
}

/** Run the bundle in the page, then measure the table it produced. */
async function renderAndMeasure(page: Page, bundle: string): Promise<Rendered> {
  await page.evaluate(bundle);

  try {
    await page.waitForFunction(
      () => {
        const host = document.getElementById('recipart-overlay-host');
        return !!host?.shadowRoot?.querySelector('.rp-table, .rp-error');
      },
      { timeout: 20_000 },
    );
  } catch {
    return { ok: false, reason: 'overlay never appeared' };
  }

  return page.evaluate(() => {
    const shadow = document.getElementById('recipart-overlay-host')!.shadowRoot!;
    if (shadow.querySelector('.rp-error')) return { ok: false, reason: 'no recipe found' };

    const table = shadow.querySelector('.rp-table') as HTMLTableElement;
    const rows = Array.from(table.rows);

    // Re-derive the occupancy grid from the rendered DOM: this checks the
    // browser agrees with our rowspan/colspan arithmetic.
    const cols = Math.max(
      ...rows.map((r) =>
        Array.from(r.cells).reduce((n, c) => n + c.colSpan, 0),
      ),
    );
    const grid: number[][] = Array.from({ length: rows.length }, () =>
      new Array(cols).fill(0),
    );

    rows.forEach((row, rowIndex) => {
      let col = 0;
      for (const cell of Array.from(row.cells)) {
        while (col < cols && grid[rowIndex][col]) col++;
        for (let r = rowIndex; r < rowIndex + cell.rowSpan && r < rows.length; r++) {
          for (let c = col; c < col + cell.colSpan && c < cols; c++) grid[r][c] += 1;
        }
        col += cell.colSpan;
      }
    });

    const tiles = grid.every((row) => row.every((n) => n === 1));

    return {
      ok: true,
      title: (shadow.querySelector('.rp-title')?.textContent ?? '').slice(0, 60),
      confidence: shadow.querySelector('.rp-badge')?.textContent?.split(' ')[0],
      rows: rows.length,
      cols,
      ingredients: table.querySelectorAll('.rp-ingredient').length,
      ops: table.querySelectorAll('.rp-op').length,
      banners: table.querySelectorAll('.rp-banner').length,
      tiles,
    };
  });
}

test('renders a Cooking For Engineers table on popular recipe sites', async ({ browser }) => {
  const bundle = await readFile(BUNDLE, 'utf8');
  await mkdir(SHOTS, { recursive: true });

  const results: Array<{ name: string } & Rendered> = [];

  for (const [name, url] of SITES) {
    const page = await browser.newPage();
    let result: Rendered;

    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const status = response?.status() ?? 0;
      if (status >= 400) {
        result = { ok: false, reason: `HTTP ${status}` };
      } else {
        await page.waitForTimeout(2500); // Let client-rendered recipe modules attach.
        result = await renderAndMeasure(page, bundle);
        if (result.ok) {
          const host = page.locator('#recipart-overlay-host');
          await host
            .locator('.rp-panel')
            .screenshot({ path: join(SHOTS, `${name}.png`) })
            .catch(() => undefined);
        }
      }
    } catch (err) {
      result = { ok: false, reason: (err as Error).message.split('\n')[0].slice(0, 70) };
    } finally {
      await page.close();
    }

    results.push({ name, ...result });
    process.stdout.write(
      result.ok
        ? `  ok    ${name.padEnd(16)} ${String(result.rows).padStart(2)}x${result.cols}  ` +
            `ing ${String(result.ingredients).padStart(2)}  ops ${String(result.ops).padStart(2)}  ` +
            `banners ${result.banners}  ${result.confidence}  ${result.tiles ? 'tiles' : 'BROKEN GRID'}\n`
        : `  FAIL  ${name.padEnd(16)} ${result.reason}\n`,
    );
  }

  const rendered = results.filter((r) => r.ok);
  await writeFile(join(SHOTS, 'results.json'), JSON.stringify(results, null, 2) + '\n', 'utf8');
  process.stdout.write(`\n  ${rendered.length}/${SITES.length} sites rendered a table\n`);

  // The bar the product has to clear.
  expect(rendered.length).toBeGreaterThanOrEqual(12);

  for (const result of rendered) {
    expect(result.tiles, `${result.name}: rowspans must tile the grid exactly`).toBe(true);
    expect(result.ingredients, `${result.name}: needs ingredient rows`).toBeGreaterThanOrEqual(3);
    expect(result.ops, `${result.name}: needs operation cells`).toBeGreaterThanOrEqual(1);
    expect(result.cols, `${result.name}: needs at least one operation column`).toBeGreaterThan(1);
  }
});
