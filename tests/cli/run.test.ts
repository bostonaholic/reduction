/**
 * Acceptance tests for the CLI run function (slices 1, 3 and 4 of
 * docs/plans/2026-07-29-cli-and-agent-skill).
 *
 * `run(args, deps)` takes injected `{fetch, stdout, stderr, env, width}` and
 * returns the exit code, so nothing here spawns a process (Design
 * Decision 10). Exit contract: 0 success, 1 operational failure, 2 usage
 * error; stdout carries only rendered output.
 *
 * Page HTML is inline JSON-LD — tests/fixtures/ is uncommitted and must not
 * be depended on. The Claude tier reaches the network through the global
 * fetch (src/llm/claude.ts), so Claude tests stub the global with the same
 * URL dispatcher they inject, and assert on both.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { run } from '../../src/cli/run.js';

const PAGE_URL = 'https://example.test/brownies';

function jsonLdPage(recipe: object): string {
  return [
    '<!doctype html><html><head><title>Fixture</title>',
    `<script type="application/ld+json">${JSON.stringify(recipe)}</script>`,
    '</head><body><p>Recipe page</p></body></html>',
  ].join('');
}

/** Heuristics attach all four ingredients — confidence ≥ 0.6, no Claude needed. */
const CONFIDENT_PAGE = jsonLdPage({
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Test Brownies',
  recipeIngredient: [
    '4 oz unsalted butter',
    '1 cup sugar',
    '2 large eggs',
    '1/2 cup all-purpose flour',
  ],
  recipeInstructions: [
    { '@type': 'HowToStep', text: 'Melt the butter.' },
    { '@type': 'HowToStep', text: 'Mix in the sugar and eggs.' },
    { '@type': 'HowToStep', text: 'Fold in the flour.' },
    { '@type': 'HowToStep', text: 'Bake at 350°F for 30 minutes.' },
  ],
});

/** Extraction succeeds (steps only) but no tree can be built: null root. */
const NO_INGREDIENT_PAGE = jsonLdPage({
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Oven Prep',
  recipeIngredient: [],
  recipeInstructions: [{ '@type': 'HowToStep', text: 'Preheat the oven to 350°F.' }],
});

const RECIPE_FREE_PAGE =
  '<!doctype html><html><head><title>Nothing</title></head><body><p>No recipe here.</p></body></html>';

function pageResponse(html: string, overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    url: PAGE_URL,
    headers: new Headers({ 'content-length': String(html.length) }),
    text: async (): Promise<string> => html,
    ...overrides,
  };
}

/** Collects everything run writes, standing in for process.stdout/stderr. */
function sink() {
  let text = '';
  return {
    write(chunk: string): boolean {
      text += chunk;
      return true;
    },
    get text() {
      return text;
    },
  };
}

function makeDeps(fetch: (...args: any[]) => any, env: Record<string, string> = {}) {
  const stdout = sink();
  const stderr = sink();
  return { deps: { fetch, stdout, stderr, env, width: 100 }, stdout, stderr };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('run happy path', () => {
  it('prints {recipe, grid, note} JSON on stdout and exits 0', async () => {
    const fetchPage = vi.fn().mockResolvedValue(pageResponse(CONFIDENT_PAGE));
    const { deps, stdout, stderr } = makeDeps(fetchPage);

    const exit = await run({ url: PAGE_URL, format: 'json', claude: false }, deps);

    expect(exit).toBe(0);
    expect(stderr.text).toBe('');
    const parsed = JSON.parse(stdout.text);
    expect(parsed.recipe.title).toBe('Test Brownies');
    expect(parsed.recipe.sourceUrl).toBe(PAGE_URL);
    expect(parsed.grid.cells.length).toBeGreaterThan(0);
    expect(parsed.note.level).toMatch(/^(high|moderate|low)$/);
    expect(typeof parsed.note.text).toBe('string');
  });

  it('prints the renderTable fragment for --format html and exits 0', async () => {
    const fetchPage = vi.fn().mockResolvedValue(pageResponse(CONFIDENT_PAGE));
    const { deps, stdout, stderr } = makeDeps(fetchPage);

    const exit = await run({ url: PAGE_URL, format: 'html', claude: false }, deps);

    expect(exit).toBe(0);
    expect(stderr.text).toBe('');
    expect(stdout.text).toContain('<table class="rd-table"');
    expect(stdout.text).toContain('Test Brownies');
  });
});

describe('run failure ladder', () => {
  it('reports a non-2xx response as fetch failed: HTTP <status> and exits 1', async () => {
    const fetchPage = vi.fn().mockResolvedValue(
      pageResponse('', { ok: false, status: 500 }),
    );
    const { deps, stdout, stderr } = makeDeps(fetchPage);

    const exit = await run({ url: PAGE_URL, format: 'json', claude: false }, deps);

    expect(exit).toBe(1);
    expect(stderr.text).toContain('fetch failed: HTTP 500');
    expect(stdout.text).toBe('');
  });

  it('prints the NoRecipeFound message verbatim for a recipe-free page and exits 1', async () => {
    const fetchPage = vi.fn().mockResolvedValue(pageResponse(RECIPE_FREE_PAGE));
    const { deps, stdout, stderr } = makeDeps(fetchPage);

    const exit = await run({ url: PAGE_URL, format: 'json', claude: false }, deps);

    expect(exit).toBe(1);
    // The message extractRecipe throws names every failed strategy.
    expect(stderr.text).toContain('No recipe on this page');
    expect(stderr.text).toContain('json-ld found nothing');
    expect(stdout.text).toBe('');
  });

  it('reports a recipe with no ingredients to lay out and exits 1', async () => {
    const fetchPage = vi.fn().mockResolvedValue(pageResponse(NO_INGREDIENT_PAGE));
    const { deps, stdout, stderr } = makeDeps(fetchPage);

    const exit = await run({ url: PAGE_URL, format: 'json', claude: false }, deps);

    expect(exit).toBe(1);
    expect(stderr.text).toContain('Found a recipe but no ingredients to lay out');
    expect(stdout.text).toBe('');
  });
});
