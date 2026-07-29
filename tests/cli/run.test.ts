/**
 * Acceptance tests for the CLI run function.
 *
 * `run(args, deps)` takes injected `{fetch, stdout, stderr, env, width}` and
 * returns the exit code, so nothing here spawns a process. Exit contract:
 * 0 success, 1 operational failure, 2 usage error; stdout carries only
 * rendered output.
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

/** No step names any ingredient — confidence < 0.6, so --claude escalates. */
const LOW_CONFIDENCE_PAGE = jsonLdPage({
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Mystery Stew',
  recipeIngredient: ['1 cup quinoa', '2 cups vegetable broth', '1 lemon'],
  recipeInstructions: [
    { '@type': 'HowToStep', text: 'Combine everything in the pot.' },
    { '@type': 'HowToStep', text: 'Simmer for 15 minutes.' },
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

function urlsRequestedBy(mock: ReturnType<typeof vi.fn>): string[] {
  return mock.mock.calls.map((call) => String(call[0]));
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

  it('hints that a 403 is likely bot-blocking rather than a bad URL', async () => {
    const fetchPage = vi.fn().mockResolvedValue(pageResponse('', { ok: false, status: 403 }));
    const { deps, stdout, stderr } = makeDeps(fetchPage);

    const exit = await run({ url: PAGE_URL, format: 'json', claude: false }, deps);

    expect(exit).toBe(1);
    expect(stderr.text).toContain('HTTP 403');
    expect(stderr.text).toMatch(/blocking scripted requests/);
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

describe('run claude gating', () => {
  it('treats --claude without ANTHROPIC_API_KEY as a usage error before any network work', async () => {
    const fetchPage = vi.fn().mockResolvedValue(pageResponse(LOW_CONFIDENCE_PAGE));
    const { deps, stderr } = makeDeps(fetchPage, {});

    const exit = await run({ url: PAGE_URL, format: 'json', claude: true }, deps);

    expect(exit).toBe(2);
    expect(stderr.text).toContain('ANTHROPIC_API_KEY');
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('skips the Claude call at confidence ≥ 0.6, noting why on stderr, and exits 0', async () => {
    const dispatch = vi.fn(async (input: unknown) =>
      pageResponse(String(input).includes('api.anthropic.com') ? '' : CONFIDENT_PAGE),
    );
    vi.stubGlobal('fetch', dispatch);
    const { deps, stdout, stderr } = makeDeps(dispatch, { ANTHROPIC_API_KEY: 'sk-ant-test' });

    const exit = await run({ url: PAGE_URL, format: 'json', claude: true }, deps);

    expect(exit).toBe(0);
    expect(urlsRequestedBy(dispatch).filter((url) => url.includes('api.anthropic.com'))).toEqual(
      [],
    );
    expect(stderr.text).toContain('Claude not needed');
    expect(JSON.parse(stdout.text).recipe.title).toBe('Test Brownies');
  });
});

describe('run claude fallback', () => {
  it('warns once on stderr, prints the heuristic result, and exits 0 when the API errors', async () => {
    const dispatch = vi.fn(async (input: unknown) =>
      String(input).includes('api.anthropic.com')
        ? { ok: false, status: 500, text: async (): Promise<string> => 'server exploded' }
        : pageResponse(LOW_CONFIDENCE_PAGE),
    );
    vi.stubGlobal('fetch', dispatch);
    const { deps, stdout, stderr } = makeDeps(dispatch, { ANTHROPIC_API_KEY: 'sk-ant-test' });

    const exit = await run({ url: PAGE_URL, format: 'json', claude: true }, deps);

    expect(exit).toBe(0);
    expect(JSON.parse(stdout.text).recipe.title).toBe('Mystery Stew');
    const warnings = stderr.text.trim().split('\n');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/claude/i);
  });

  it('warns once, falls back, and exits 0 when Claude returns no usable content', async () => {
    const dispatch = vi.fn(async (input: unknown) =>
      String(input).includes('api.anthropic.com')
        ? { ok: true, status: 200, json: async () => ({ content: [] }) }
        : pageResponse(LOW_CONFIDENCE_PAGE),
    );
    vi.stubGlobal('fetch', dispatch);
    const { deps, stdout, stderr } = makeDeps(dispatch, { ANTHROPIC_API_KEY: 'sk-ant-test' });

    const exit = await run({ url: PAGE_URL, format: 'json', claude: true }, deps);

    expect(exit).toBe(0);
    expect(JSON.parse(stdout.text).recipe.title).toBe('Mystery Stew');
    const warnings = stderr.text.trim().split('\n');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/claude/i);
  });
});

describe('run size cap', () => {
  it('rejects an over-25 MiB Content-Length without reading the body and exits 1', async () => {
    const body = vi.fn(async () => '');
    const fetchPage = vi.fn().mockResolvedValue(
      pageResponse('', {
        headers: new Headers({ 'content-length': String(26 * 1024 * 1024) }),
        text: body,
      }),
    );
    const { deps, stdout, stderr } = makeDeps(fetchPage);

    const exit = await run({ url: PAGE_URL, format: 'json', claude: false }, deps);

    expect(exit).toBe(1);
    expect(stderr.text).toMatch(/too large \(\d+ bytes\)/);
    expect(body).not.toHaveBeenCalled();
    expect(stdout.text).toBe('');
  });

  it('rejects a body over 25 MiB when no Content-Length warned of it and exits 1', async () => {
    const fetchPage = vi.fn().mockResolvedValue(
      pageResponse('', {
        headers: new Headers(),
        text: async () => 'x'.repeat(26 * 1024 * 1024),
      }),
    );
    const { deps, stdout, stderr } = makeDeps(fetchPage);

    const exit = await run({ url: PAGE_URL, format: 'json', claude: false }, deps);

    expect(exit).toBe(1);
    expect(stderr.text).toMatch(/too large \(\d+ bytes\)/);
    expect(stdout.text).toBe('');
  });
});

describe('run hostile page bounds', () => {
  it('renders a deeply-chained recipe without a stack overflow', async () => {
    // Each step consumes the previous step's output, so the tree is as deep
    // as the step list. Uncapped, 2000 chained steps overflowed the stack in
    // the recursive passes over the tree; the extraction caps bound the
    // depth, and the pipeline guard turns any residual throw into exit 1.
    const n = 2000;
    const page = jsonLdPage({
      '@context': 'https://schema.org',
      '@type': 'Recipe',
      name: 'Chain Bomb',
      recipeIngredient: Array.from({ length: n }, (_, i) => `1 cup item${i}`),
      recipeInstructions: Array.from({ length: n }, (_, i) => ({
        '@type': 'HowToStep',
        text: `Stir in the item${i}.`,
      })),
    });
    const fetchPage = vi.fn().mockResolvedValue(pageResponse(page));
    const { deps, stdout, stderr } = makeDeps(fetchPage);

    const exit = await run({ url: PAGE_URL, format: 'json', claude: false }, deps);

    expect(exit).toBe(0);
    expect(stderr.text).toBe('');
    expect(JSON.parse(stdout.text).recipe.title).toBe('Chain Bomb');
  });
});

describe('run timeout', () => {
  it('aborts after 30 s, reports timeout, and exits 1', async () => {
    vi.useFakeTimers();
    const hangingFetch = vi.fn(
      (_input: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })),
          );
        }),
    );
    const { deps, stdout, stderr } = makeDeps(hangingFetch);

    const pending = run({ url: PAGE_URL, format: 'json', claude: false }, deps);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(await pending).toBe(1);
    expect(stderr.text).toContain('timeout');
    expect(stdout.text).toBe('');
  });
});

describe('run redirect', () => {
  it('uses the post-redirect res.url as the recipe sourceUrl', async () => {
    const finalUrl = 'https://example.test/brownies-moved';
    const fetchPage = vi
      .fn()
      .mockResolvedValue(pageResponse(CONFIDENT_PAGE, { url: finalUrl }));
    const { deps, stdout } = makeDeps(fetchPage);

    const exit = await run({ url: PAGE_URL, format: 'json', claude: false }, deps);

    expect(exit).toBe(0);
    expect(JSON.parse(stdout.text).recipe.sourceUrl).toBe(finalUrl);
  });
});
