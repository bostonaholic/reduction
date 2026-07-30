/**
 * The CLI's run function: fetch a page, run the extension's pipeline over
 * jsdom, print the result in the requested format.
 *
 * Everything effectful — fetch, streams, env, terminal width — is injected,
 * so tests exercise the full run without spawning a process. Exit contract:
 * 0 success, 1 operational failure, 2 usage error; stdout carries only
 * rendered output, errors go to stderr.
 */

import { JSDOM, VirtualConsole } from 'jsdom';
import { NoRecipeFound, extractRecipe } from '../core/extract.js';
import { CLAUDE_THRESHOLD } from '../core/escalate.js';
import { flatTree, inferTree } from '../core/infer.js';
import { layout } from '../core/layout.js';
import { treeFromPlan } from '../core/plan.js';
import { confidenceNote, renderTable } from '../core/render.js';
import { renderText } from '../core/render-text.js';
import { callClaude, resolveEffort, resolveModel } from '../llm/claude.js';
import type { OutputFormat } from './args.js';
import { stripControls } from './sanitize.js';

/** Browser-mimicking request headers, the shape tools/capture-fixtures.mjs uses. */
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

/** Give slow servers a fair chance, then fail rather than hang. */
const FETCH_TIMEOUT_MS = 30_000;

/**
 * The largest page captured by tools/capture-fixtures.mjs is under 2 MiB, so
 * 25 MiB is more than ten times the biggest real recipe page we have seen —
 * anything over it is not worth parsing, and jsdom never sees it.
 */
const MAX_BODY_BYTES = 25 * 1024 * 1024;

export interface RunArgs {
  url: string;
  format: OutputFormat;
  claude: boolean;
}

/** The subset of a fetch Response the run needs — easy to fake in tests. */
export interface CliResponse {
  ok: boolean;
  status: number;
  /** The final URL after redirects; becomes the recipe's sourceUrl. */
  url: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

interface Sink {
  write(chunk: string): unknown;
}

export interface RunDeps {
  fetch(
    url: string,
    init?: { headers?: Record<string, string>; signal?: AbortSignal },
  ): Promise<CliResponse>;
  stdout: Sink;
  stderr: Sink;
  env: Record<string, string | undefined>;
  /** Rendering width in columns; computed by the entry point, never here. */
  width: number;
}

export async function run(args: RunArgs, deps: RunDeps): Promise<number> {
  const { stdout, stderr } = deps;

  // A usage error, not an operational one: the remedy is in the invocation
  // environment, and no network work has begun.
  const apiKey = deps.env.ANTHROPIC_API_KEY;
  if (args.claude && !apiKey) {
    stderr.write('--claude requires ANTHROPIC_API_KEY in the environment\n');
    return 2;
  }

  // Redirects are followed (the fetch default); the final res.url becomes the
  // recipe's sourceUrl. The CLI fetches whatever URL it is given with the
  // invoking user's network access — localhost and private addresses are in
  // scope, stated rather than blocked.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: CliResponse;
  let html: string;
  try {
    res = await deps.fetch(args.url, { headers: HEADERS, signal: controller.signal });
    if (!res.ok) {
      // A 403 to a plain fetch is almost always bot-blocking, not a bad URL;
      // say so rather than sending the user off to recheck their link.
      stderr.write(
        res.status === 403
          ? 'fetch failed: HTTP 403 — the site is likely blocking scripted requests; the same page usually works in a real browser\n'
          : `fetch failed: HTTP ${res.status}\n`,
      );
      return 1;
    }
    // An honest Content-Length lets us refuse the body without reading it.
    const declared = Number(res.headers.get('content-length'));
    if (declared > MAX_BODY_BYTES) {
      stderr.write(`too large (${declared} bytes)\n`);
      return 1;
    }
    html = await res.text();
  } catch (err) {
    // Any throw during fetch or read exits 1 — including a RangeError from
    // res.text() on an over-long body. An out-of-memory kill exits outside
    // the 0/1/2 contract, uncaught; nothing here can intercept it.
    // undici's generic "fetch failed" hides the useful part (ECONNREFUSED,
    // ENOTFOUND) in err.cause; append it so the reason reaches the user.
    // Today's undici messages are fixed strings, but deps.fetch is an
    // injection seam and message text is no cross-version contract — strip
    // it like every other untrusted stderr write in this file.
    const error = err as Error & { cause?: { code?: string } };
    const code = error.cause?.code;
    stderr.write(
      error.name === 'AbortError'
        ? 'timeout\n'
        : `${stripControls(`${error.message ?? err}${code ? ` (${code})` : ''}`)}\n`,
    );
    return 1;
  } finally {
    clearTimeout(timer);
  }

  // Servers may omit or understate Content-Length, so re-check what arrived.
  const actual = Buffer.byteLength(html);
  if (actual > MAX_BODY_BYTES) {
    stderr.write(`too large (${actual} bytes)\n`);
    return 1;
  }

  // jsdom's tree construction recurses per ancestor, so a hostile page of
  // deeply nested elements — far under the byte cap — overflows the stack
  // here. An uncaught throw would dump a stack trace carrying local paths;
  // catch it and surface the same one-line operational failure as the rest.
  // jsdom's default virtual console forwards jsdomError events to the real
  // global console — outside deps.stderr and every sanitizer. Those messages
  // quote raw page text (a CSS @import URL, verbatim), so a hostile page
  // could write ANSI escape sequences straight to the terminal; an
  // unhandled-exception event would dump a stack with local paths. A bare
  // VirtualConsole forwards nowhere and swallows error events by design.
  let doc: Document;
  try {
    doc = new JSDOM(html, { virtualConsole: new VirtualConsole() }).window.document;
  } catch {
    stderr.write('could not parse the page\n');
    return 1;
  }
  let raw;
  try {
    raw = extractRecipe(doc);
  } catch (err) {
    // NoRecipeFound can interpolate a strategy's raw throw message, so the
    // text is not guaranteed page-free; strip it like any untrusted text.
    stderr.write(`${stripControls(err instanceof NoRecipeFound ? err.message : String(err))}\n`);
    return 1;
  }

  // Inference through rendering is guarded as one unit: any throw out of a
  // hostile tree (a RangeError from renderText's canvas refusal, a stack
  // overflow the extraction caps failed to prevent) is an operational
  // failure, same class as an oversized body, and must surface as a one-line
  // reason rather than an uncaught stack trace. Rendering lands in a local
  // and is written after the try, so a synchronous EPIPE from stdout is not
  // misread as a pipeline failure — index.ts maps that to exit 0.
  let output: string;
  try {
    // The post-redirect URL, matching what location.href gives the extension.
    let recipe = inferTree(raw, res.url);

    if (args.claude && apiKey) {
      if (recipe.confidence >= CLAUDE_THRESHOLD) {
        stderr.write(
          `confidence ${recipe.confidence.toFixed(2)} ≥ ${CLAUDE_THRESHOLD} — Claude not needed\n`,
        );
      } else {
        // Mirror the extension's plan B: any Claude failure warns once and
        // keeps the heuristic result.
        try {
          const plan = await callClaude(
            { apiKey, model: resolveModel(undefined), effort: resolveEffort(undefined), browser: false },
            raw.title,
            raw.ingredientLines,
            raw.stepTexts,
          );
          const viaClaude = treeFromPlan(plan, raw, res.url);
          if (viaClaude.root && viaClaude.confidence >= recipe.confidence) recipe = viaClaude;
        } catch (err) {
          // The message can carry a slice of the API response body; strip it
          // like any other remote text before it reaches the terminal.
          const reason = stripControls((err as Error).message ?? String(err));
          stderr.write(`Claude failed, keeping the local result: ${reason}\n`);
        }
      }
    }

    if (!recipe.root) recipe = flatTree(raw, res.url);
    if (!recipe.root) {
      stderr.write('Found a recipe but no ingredients to lay out.\n');
      return 1;
    }

    const grid = layout(recipe);
    output =
      args.format === 'json'
        ? `${JSON.stringify({ recipe, grid, note: confidenceNote(recipe) })}\n`
        : args.format === 'html'
          ? `${renderTable(recipe, grid)}\n`
          : renderText(recipe, grid, deps.width);
  } catch (err) {
    stderr.write(`${stripControls((err as Error).message ?? String(err))}\n`);
    return 1;
  }
  stdout.write(output);
  return 0;
}
