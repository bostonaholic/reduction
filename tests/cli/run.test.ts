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
import type { ResvgModule } from '../../src/cli/render-png.js';
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

  it('prints a box-drawing table at the injected width for the default text format', async () => {
    const fetchPage = vi.fn().mockResolvedValue(pageResponse(CONFIDENT_PAGE));
    const { deps, stdout, stderr } = makeDeps(fetchPage);

    const exit = await run({ url: PAGE_URL, format: 'text', claude: false }, deps);

    expect(exit).toBe(0);
    expect(stderr.text).toBe('');
    expect(stdout.text).toContain('Test Brownies');
    expect(stdout.text).toContain('│'); // A table, not JSON or HTML.
    expect(stdout.text).not.toContain('<table');

    // The rendering width comes from deps, not a hardcoded constant: the
    // same recipe squeezed into a narrower terminal wraps differently.
    const narrow = makeDeps(fetchPage);
    narrow.deps.width = 40;
    await run({ url: PAGE_URL, format: 'text', claude: false }, narrow.deps);
    expect(narrow.stdout.text).not.toBe(stdout.text);
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

  it('surfaces the cause code hidden inside a generic fetch failure', async () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), {
      code: 'ECONNREFUSED',
    });
    const fetchPage = vi.fn().mockRejectedValue(new Error('fetch failed', { cause }));
    const { deps, stdout, stderr } = makeDeps(fetchPage);

    const exit = await run({ url: PAGE_URL, format: 'json', claude: false }, deps);

    expect(exit).toBe(1);
    expect(stderr.text).toContain('fetch failed');
    expect(stderr.text).toContain('ECONNREFUSED');
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

  it('announces list truncation as banners rather than presenting a capped diagram as complete', async () => {
    const n = 600;
    const page = jsonLdPage({
      '@context': 'https://schema.org',
      '@type': 'Recipe',
      name: 'Endless Buffet',
      recipeIngredient: Array.from({ length: n }, (_, i) => `1 cup item${i}`),
      recipeInstructions: Array.from({ length: n }, (_, i) => ({
        '@type': 'HowToStep',
        text: `Stir in the item${i}.`,
      })),
    });
    const fetchPage = vi.fn().mockResolvedValue(pageResponse(page));
    const { deps, stdout } = makeDeps(fetchPage);

    const exit = await run({ url: PAGE_URL, format: 'json', claude: false }, deps);

    expect(exit).toBe(0);
    const { recipe } = JSON.parse(stdout.text);
    expect(recipe.banners).toContain('showing the first 500 of 600 ingredients');
    expect(recipe.banners).toContain('showing the first 500 of 600 steps');
  });

  // jsdom chews on the nesting for a while before overflowing; allow it.
  it('reports a page too deeply nested for jsdom as unparseable, without a stack trace', { timeout: 30_000 }, async () => {
    // jsdom recurses per ancestor while building the tree, so ~16,000 nested
    // divs (well under the byte cap) overflow the stack inside the JSDOM
    // constructor itself. That must surface as the one-line operational
    // failure, not an uncaught RangeError dumping paths to stderr.
    const n = 16_000;
    const page = `<!doctype html><html><body>${'<div>'.repeat(n)}x${'</div>'.repeat(n)}</body></html>`;
    const fetchPage = vi.fn().mockResolvedValue(pageResponse(page));
    const { deps, stdout, stderr } = makeDeps(fetchPage);

    const exit = await run({ url: PAGE_URL, format: 'json', claude: false }, deps);

    expect(exit).toBe(1);
    expect(stderr.text).toBe('could not parse the page\n');
    expect(stdout.text).toBe('');
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

// ————— vector formats: svg, png, pdf —————

/** Collects string and binary writes alike, standing in for process.stdout. */
function binarySink() {
  const chunks: (string | Uint8Array)[] = [];
  return {
    write(chunk: string | Uint8Array): boolean {
      chunks.push(chunk);
      return true;
    },
    get chunks() {
      return chunks;
    },
    get text() {
      return chunks
        .map((chunk) => (typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)))
        .join('');
    },
  };
}

function makeFormatDeps(
  fetch: (...args: any[]) => any,
  options: { tty?: boolean; loadResvg?: () => Promise<ResvgModule> } = {},
) {
  const stdout = binarySink();
  const stderr = sink();
  const deps = {
    fetch,
    stdout,
    stderr,
    env: {},
    width: 100,
    stdoutIsTTY: options.tty ?? false,
    loadResvg: options.loadResvg,
  };
  return { deps, stdout, stderr };
}

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** A stand-in @resvg/resvg-js module: fixed bytes, no native code. */
function fakeResvgModule() {
  class FakeResvg {
    constructor(_svg: string, _options?: unknown) {}
    render() {
      return { asPng: () => PNG_BYTES };
    }
  }
  return { Resvg: FakeResvg };
}

/** n chained steps, each consuming the last: column count grows with n. */
function chainPage(n: number): string {
  return jsonLdPage({
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: 'Chain Reaction',
    recipeIngredient: Array.from({ length: n }, (_, i) => `1 cup item${i}`),
    recipeInstructions: Array.from({ length: n }, (_, i) => ({
      '@type': 'HowToStep',
      text: `Stir in the item${i}.`,
    })),
  });
}

describe('run --format svg', () => {
  it('writes the SVG diagram to stdout with a trailing newline and the note to stderr only', async () => {
    const fetchPage = vi.fn().mockResolvedValue(pageResponse(CONFIDENT_PAGE));
    const { deps, stdout, stderr } = makeFormatDeps(fetchPage);

    const exit = await run({ url: PAGE_URL, format: 'svg', claude: false }, deps);

    expect(exit).toBe(0);
    expect(stdout.text).toMatch(/^<svg/);
    expect(stdout.text).toMatch(/<\/svg>\n$/);
    expect(stdout.text).toContain('butter');
    // The artifact is the table only — no title, no note.
    expect(stdout.text).not.toContain('Test Brownies');
    expect(stderr.text).toMatch(/ingredients matched a step|listed in order/);
    expect(stdout.text).not.toContain(stderr.text.trim());
  });
});

describe('run binary formats refuse a TTY', () => {
  it.each(['png', 'pdf'] as const)(
    'refuses --format %s on a TTY with exit 2 before fetching',
    async (format) => {
      const fetchPage = vi.fn().mockResolvedValue(pageResponse(CONFIDENT_PAGE));
      const { deps, stdout, stderr } = makeFormatDeps(fetchPage, {
        tty: true,
        loadResvg: async () => fakeResvgModule(),
      });

      const exit = await run({ url: PAGE_URL, format, claude: false }, deps);

      expect(exit).toBe(2);
      expect(fetchPage).not.toHaveBeenCalled();
      expect(stderr.text).toMatch(/refus/i);
      expect(stderr.text).toMatch(/redirect/i);
      expect(stdout.chunks).toHaveLength(0);
    },
  );
});

describe('run --format png through the loadResvg seam', () => {
  it('pipes the rasterized bytes to stdout intact when stdout is not a TTY', async () => {
    const fetchPage = vi.fn().mockResolvedValue(pageResponse(CONFIDENT_PAGE));
    const loadResvg = vi.fn(async () => fakeResvgModule());
    const { deps, stdout, stderr } = makeFormatDeps(fetchPage, { loadResvg });

    const exit = await run({ url: PAGE_URL, format: 'png', claude: false }, deps);

    expect(exit).toBe(0);
    const binary = stdout.chunks.find((c): c is Uint8Array => c instanceof Uint8Array);
    expect(binary, 'png bytes must reach the sink as a Uint8Array').toBeDefined();
    expect(Array.from(binary!)).toEqual(Array.from(PNG_BYTES));
    expect(stderr.text).toMatch(/ingredients matched a step|listed in order/);
  });

  it('exits 2 before the fetch with the reinstall remedy when resvg is not installed', async () => {
    const missing = Object.assign(new Error("Cannot find package '@resvg/resvg-js'"), {
      code: 'ERR_MODULE_NOT_FOUND',
    });
    const fetchPage = vi.fn().mockResolvedValue(pageResponse(CONFIDENT_PAGE));
    const { deps, stdout, stderr } = makeFormatDeps(fetchPage, {
      loadResvg: () => Promise.reject(missing),
    });

    const exit = await run({ url: PAGE_URL, format: 'png', claude: false }, deps);

    expect(exit).toBe(2);
    expect(fetchPage).not.toHaveBeenCalled();
    expect(stderr.text).toContain('npm install @resvg/resvg-js');
    expect(stderr.text).toMatch(/omit=optional/);
    expect(stdout.chunks).toHaveLength(0);
  });

  it('exits 2 with the path-free remedy when only the platform binding is missing', async () => {
    // The wrapper resolves but its per-platform package does not (a
    // node_modules copied across architectures, say): the inner require
    // rethrows MODULE_NOT_FOUND, dragging a Require stack of absolute local
    // paths into the message. Same remedy as the wrapper missing outright,
    // so the same usage-error class — and none of those paths may print.
    const missing = Object.assign(
      new Error(
        "Cannot find module '@resvg/resvg-js-darwin-arm64'\nRequire stack:\n- /home/someone/checkout/node_modules/@resvg/resvg-js/js-binding.js",
      ),
      { code: 'MODULE_NOT_FOUND' },
    );
    const fetchPage = vi.fn().mockResolvedValue(pageResponse(CONFIDENT_PAGE));
    const { deps, stdout, stderr } = makeFormatDeps(fetchPage, {
      loadResvg: () => Promise.reject(missing),
    });

    const exit = await run({ url: PAGE_URL, format: 'png', claude: false }, deps);

    expect(exit).toBe(2);
    expect(fetchPage).not.toHaveBeenCalled();
    expect(stderr.text).toContain('npm install @resvg/resvg-js');
    expect(stderr.text).not.toContain('/home/someone');
    expect(stderr.text).not.toContain('Require stack');
    expect(stdout.chunks).toHaveLength(0);
  });

  it('exits 1 with a stripped one-line reason and a reinstall hint when resvg cannot load', async () => {
    const ESCAPE = String.fromCharCode(27);
    const broken = new Error(
      `Failed to load native binding${ESCAPE}[31m at /home/someone/secret${ESCAPE}[0m`,
    );
    const fetchPage = vi.fn().mockResolvedValue(pageResponse(CONFIDENT_PAGE));
    const { deps, stdout, stderr } = makeFormatDeps(fetchPage, {
      loadResvg: () => Promise.reject(broken),
    });

    const exit = await run({ url: PAGE_URL, format: 'png', claude: false }, deps);

    expect(exit).toBe(1);
    expect(fetchPage).not.toHaveBeenCalled();
    expect(stderr.text).toContain('Failed to load native binding');
    expect(stderr.text).not.toContain(ESCAPE);
    expect(stderr.text).toMatch(/reinstall|npm install/i);
    expect(stderr.text).not.toMatch(/\n\s+at /); // one line, never a stack
    expect(stdout.chunks).toHaveLength(0);
  });

  it('advises on stderr when the area clamp pulls the scale below 2×', async () => {
    // 550 chained steps (capped at 500) build a ~500-column, ~500-row grid
    // whose 2× raster would blow the 64 Mpx bound: the applied scale drops
    // below 2 and run() must say so, naming the value.
    const fetchPage = vi.fn().mockResolvedValue(pageResponse(chainPage(550)));
    const loadResvg = vi.fn(async () => fakeResvgModule());
    const { deps, stdout, stderr } = makeFormatDeps(fetchPage, { loadResvg });

    const exit = await run({ url: PAGE_URL, format: 'png', claude: false }, deps);

    expect(exit).toBe(0);
    expect(stdout.chunks.some((c) => c instanceof Uint8Array)).toBe(true);
    expect(stderr.text).toMatch(/scal/i);
    expect(stderr.text).toMatch(/\b0\.\d+/);
  });
});

describe('run --format pdf', () => {
  it('pipes PDF bytes to stdout and the note to stderr when piped', async () => {
    const fetchPage = vi.fn().mockResolvedValue(pageResponse(CONFIDENT_PAGE));
    const { deps, stdout, stderr } = makeFormatDeps(fetchPage);

    const exit = await run({ url: PAGE_URL, format: 'pdf', claude: false }, deps);

    expect(exit).toBe(0);
    const binary = stdout.chunks.find((c): c is Uint8Array => c instanceof Uint8Array);
    expect(binary, 'pdf bytes must reach the sink as a Uint8Array').toBeDefined();
    const header = String.fromCharCode(...binary!.slice(0, 5));
    expect(header).toBe('%PDF-');
    expect(stderr.text).toMatch(/ingredients matched a step|listed in order/);
  });

  it('advises on stderr when the 14,400pt page limit scales the drawing down', async () => {
    const fetchPage = vi.fn().mockResolvedValue(pageResponse(chainPage(550)));
    const { deps, stdout, stderr } = makeFormatDeps(fetchPage);

    const exit = await run({ url: PAGE_URL, format: 'pdf', claude: false }, deps);

    expect(exit).toBe(0);
    expect(stdout.chunks.some((c) => c instanceof Uint8Array)).toBe(true);
    expect(stderr.text).toMatch(/scal/i);
    expect(stderr.text).toMatch(/\b0\.\d+/);
  });
});
