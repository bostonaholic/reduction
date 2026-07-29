/**
 * Not a test — a quality report. Run it to see how the pipeline actually does
 * on every captured site:
 *
 *   npx vitest run --config vitest.report.config.ts
 *
 * Pass/fail tests tell you nothing broke; this tells you whether the output is
 * any good. It prints structure only (counts, shapes, operation labels), never
 * the recipe text itself.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { it } from 'vitest';
import { extractRecipe } from '../src/core/extract.js';
import { inferTree } from '../src/core/infer.js';
import { column, layout, validateGrid } from '../src/core/layout.js';
import type { RecipeNode } from '../src/core/types.js';

const fixtureDir = join(import.meta.dirname, '..', 'tests', 'fixtures');

function opLabels(node: RecipeNode | null, out: string[] = []): string[] {
  if (!node || node.kind !== 'op') return out;
  out.push(node.label);
  for (const child of node.children) opLabels(child, out);
  return out;
}

it('reports pipeline quality across every captured site', () => {
  if (!existsSync(fixtureDir)) return;
  const names = readdirSync(fixtureDir)
    .filter((f) => f.endsWith('.html'))
    .map((f) => f.replace(/\.html$/, ''))
    .sort();

  const rows: string[] = [];
  let totalConfidence = 0;
  let depthSum = 0;

  for (const name of names) {
    const doc = new JSDOM(readFileSync(join(fixtureDir, `${name}.html`), 'utf8')).window.document;
    let line: string;
    try {
      const raw = extractRecipe(doc);
      const recipe = inferTree(raw, `https://example.test/${name}`);
      const grid = layout(recipe);
      const problems = validateGrid(grid);
      const depth = recipe.root ? column(recipe.root) : 0;
      totalConfidence += recipe.confidence;
      depthSum += depth;

      line = [
        name.padEnd(16),
        raw.strategy.padEnd(10),
        `ing ${String(raw.ingredientLines.length).padStart(2)}`,
        `steps ${String(raw.stepTexts.length).padStart(2)}`,
        `banners ${String(recipe.banners.length).padStart(2)}`,
        `depth ${String(depth).padStart(2)}`,
        `${String(grid.rows).padStart(2)}x${grid.cols}`,
        `conf ${(recipe.confidence * 100).toFixed(0).padStart(3)}%`,
        problems.length ? `BROKEN ${problems[0]}` : 'ok',
      ].join('  ');

      const labels = opLabels(recipe.root);
      line += `\n${' '.repeat(18)}ops: ${labels.slice(0, 12).join(' | ')}`;
    } catch (err) {
      line = `${name.padEnd(16)}  EXTRACTION FAILED: ${(err as Error).message.slice(0, 90)}`;
    }
    rows.push(line);
  }

  process.stdout.write(`\n${'='.repeat(100)}\nREDUCTION PIPELINE REPORT — ${names.length} sites\n${'='.repeat(100)}\n`);
  process.stdout.write(rows.join("\n") + "\n");
  process.stdout.write(
    `\nmean confidence ${((totalConfidence / names.length) * 100).toFixed(0)}%   ` +
      `mean tree depth ${(depthSum / names.length).toFixed(1)}`,
  );
});
