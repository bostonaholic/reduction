/**
 * Capture real recipe pages as HTML fixtures so the parser is tested against
 * what sites actually ship, not against what we wish they shipped.
 *
 *   node tools/capture-fixtures.mjs
 *
 * Pages that block scripted requests are reported and skipped; run
 * tools/capture-fixtures-browser.mjs to pick those up with a real browser.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'tests', 'fixtures');

export const SITES = [
  ['allrecipes', 'https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/'],
  ['seriouseats', 'https://www.seriouseats.com/the-best-chocolate-chip-cookies-recipe'],
  ['bonappetit', 'https://www.bonappetit.com/recipe/bas-best-chocolate-chip-cookies'],
  ['foodnetwork', 'https://www.foodnetwork.com/recipes/alton-brown/the-chewy-recipe-1909046'],
  ['bbcgoodfood', 'https://www.bbcgoodfood.com/recipes/classic-victoria-sandwich-recipe'],
  ['smittenkitchen', 'https://smittenkitchen.com/2008/07/best-birthday-cake/'],
  ['budgetbytes', 'https://www.budgetbytes.com/slow-cooker-chicken-tortilla-soup/'],
  ['kingarthur', 'https://www.kingarthurbaking.com/recipes/classic-birthday-cake-recipe'],
  ['simplyrecipes', 'https://www.simplyrecipes.com/recipes/banana_bread/'],
  ['delish', 'https://www.delish.com/cooking/recipe-ideas/a19636089/best-chocolate-chip-cookies-recipe/'],
  ['sallysbaking', 'https://sallysbakingaddiction.com/chewy-chocolate-chip-cookies/'],
  ['epicurious', 'https://www.epicurious.com/recipes/food/views/classic-brownies-51125610'],
  ['tasty', 'https://tasty.co/recipe/the-best-chewy-chocolate-chip-cookies'],
  ['loveandlemons', 'https://www.loveandlemons.com/banana-bread/'],
  ['minimalistbaker', 'https://minimalistbaker.com/1-bowl-vegan-banana-bread/'],
  ['recipetineats', 'https://www.recipetineats.com/chocolate-cake/'],
  ['cookieandkate', 'https://cookieandkate.com/best-banana-bread-recipe/'],
  ['tasteofhome', 'https://www.tasteofhome.com/recipes/chocolate-chip-cookies/'],
  ['food52', 'https://food52.com/recipes/81793-best-chocolate-chip-cookie-recipe'],
  ['nytcooking', 'https://cooking.nytimes.com/recipes/1017937-chocolate-chip-cookies'],
  ['thekitchn', 'https://www.thekitchn.com/how-to-make-banana-bread-recipe-23032085'],
  ['halfbakedharvest', 'https://www.halfbakedharvest.com/brown-butter-chocolate-chip-cookies/'],
];

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function capture(name, url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: controller.signal });
    if (!res.ok) return { name, url, ok: false, reason: `HTTP ${res.status}` };
    const html = await res.text();
    if (html.length < 5000) return { name, url, ok: false, reason: 'suspiciously small' };
    await writeFile(join(outDir, `${name}.html`), html, 'utf8');
    return { name, url, ok: true, bytes: html.length };
  } catch (err) {
    return { name, url, ok: false, reason: err.name === 'AbortError' ? 'timeout' : String(err.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

await mkdir(outDir, { recursive: true });

const results = [];
for (const [name, url] of SITES) {
  const result = await capture(name, url);
  results.push(result);
  console.log(
    result.ok
      ? `ok    ${name.padEnd(18)} ${(result.bytes / 1024).toFixed(0)} KB`
      : `FAIL  ${name.padEnd(18)} ${result.reason}`,
  );
}

const ok = results.filter((r) => r.ok);
await writeFile(
  join(outDir, 'sources.json'),
  JSON.stringify(Object.fromEntries(ok.map((r) => [r.name, r.url])), null, 2) + '\n',
  'utf8',
);
console.log(`\ncaptured ${ok.length}/${results.length}`);
