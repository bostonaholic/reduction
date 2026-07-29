/**
 * The CLI's run function: fetch a page, run the extension's pipeline over
 * jsdom, print the result in the requested format.
 *
 * Everything effectful — fetch, streams, env, terminal width — is injected,
 * so tests exercise the full run without spawning a process. Exit contract:
 * 0 success, 1 operational failure, 2 usage error; stdout carries only
 * rendered output, errors go to stderr.
 */

import { JSDOM } from 'jsdom';
import { NoRecipeFound, extractRecipe } from '../core/extract.js';
import { flatTree, inferTree } from '../core/infer.js';
import { layout } from '../core/layout.js';
import { treeFromPlan } from '../core/plan.js';
import { confidenceNote, renderTable } from '../core/render.js';
import { renderText } from '../core/render-text.js';
import { callClaude, resolveEffort, resolveModel } from '../llm/claude.js';
import type { OutputFormat } from './args.js';

/** Browser-mimicking request headers, the shape tools/capture-fixtures.mjs uses. */
/**
 * Below this the local heuristics are not trustworthy enough to show alone.
 * Mirrors CLAUDE_THRESHOLD in src/content/index.ts — strict `<`, so exactly
 * 0.6 stays heuristic there too.
 */
const CLAUDE_THRESHOLD = 0.6;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

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
  fetch(url: string, init?: { headers?: Record<string, string> }): Promise<CliResponse>;
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

  let res: CliResponse;
  try {
    res = await deps.fetch(args.url, { headers: HEADERS });
  } catch (err) {
    stderr.write(`${(err as Error).message ?? err}\n`);
    return 1;
  }
  if (!res.ok) {
    stderr.write(`fetch failed: HTTP ${res.status}\n`);
    return 1;
  }
  const html = await res.text();

  const doc = new JSDOM(html).window.document;
  let raw;
  try {
    raw = extractRecipe(doc);
  } catch (err) {
    stderr.write(`${err instanceof NoRecipeFound ? err.message : String(err)}\n`);
    return 1;
  }

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
        stderr.write(`Claude failed, keeping the local result: ${(err as Error).message}\n`);
      }
    }
  }

  if (!recipe.root) recipe = flatTree(raw, res.url);
  if (!recipe.root) {
    stderr.write('Found a recipe but no ingredients to lay out.\n');
    return 1;
  }

  const grid = layout(recipe);
  if (args.format === 'json') {
    stdout.write(`${JSON.stringify({ recipe, grid, note: confidenceNote(recipe) })}\n`);
  } else if (args.format === 'html') {
    stdout.write(`${renderTable(recipe, grid)}\n`);
  } else {
    stdout.write(renderText(recipe, grid, deps.width));
  }
  return 0;
}
