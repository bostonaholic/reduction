/**
 * Golden tests over HTML captured from real recipe sites.
 *
 * Fixtures are generated locally by `npm run capture` and are not committed —
 * they are third-party page copies, and the manifest plus these assertions are
 * enough to reproduce them. When they are absent the suite skips rather than
 * fails, so a fresh clone still runs green.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { extractRecipe } from '../src/core/extract.js';
import { parseIngredient } from '../src/core/ingredient.js';
import { gradeByTier } from '../src/core/grade.js';
import { inferTree } from '../src/core/infer.js';
import { layout, validateGrid } from '../src/core/layout.js';
import { renderTable } from '../src/core/render.js';

const fixtureDir = join(import.meta.dirname, 'fixtures');
const names = existsSync(fixtureDir)
  ? readdirSync(fixtureDir)
      .filter((f) => f.endsWith('.html'))
      .map((f) => f.replace(/\.html$/, ''))
      .sort()
  : [];

describe.skipIf(names.length === 0)('real recipe sites', () => {
  it('has fixtures from at least a dozen sites', () => {
    expect(names.length).toBeGreaterThanOrEqual(12);
  });

  describe.each(names)('%s', (name) => {
    const html = readFileSync(join(fixtureDir, `${name}.html`), 'utf8');
    const doc = new JSDOM(html).window.document;
    const raw = extractRecipe(doc);

    it('extracts a title, ingredients and steps', () => {
      expect(raw.title.length).toBeGreaterThan(2);
      expect(raw.ingredientLines.length).toBeGreaterThanOrEqual(3);
      expect(raw.stepTexts.length).toBeGreaterThanOrEqual(2);
    });

    it('parses every ingredient line into a name', () => {
      for (const line of raw.ingredientLines) {
        const parsed = parseIngredient(line);
        expect(parsed.name.length).toBeGreaterThan(0);
      }
    });

    it('infers a tree that covers most ingredients', () => {
      const recipe = inferTree(raw, `https://example.test/${name}`);
      expect(recipe.root).not.toBeNull();
      expect(recipe.confidence).toBeGreaterThan(0);
    });

    it('lays out to a grid that tiles cleanly', () => {
      const recipe = inferTree(raw, `https://example.test/${name}`);
      const grid = layout(recipe);
      expect(validateGrid(grid)).toEqual([]);
      expect(grid.rows).toBeGreaterThan(0);
      expect(grid.cols).toBeGreaterThan(1);
    });

    it('renders to HTML with balanced markup', () => {
      const recipe = inferTree(raw, `https://example.test/${name}`);
      const html = renderTable(recipe, layout(recipe));
      const opens = (html.match(/<tr\b/g) ?? []).length;
      const closes = (html.match(/<\/tr>/g) ?? []).length;
      expect(opens).toBe(closes);
      expect(html).toContain('<table');
    });

    // The checks above prove the card can be drawn. These ask whether it is
    // true — see docs/recipe-card-rules.md. Every assertion before them would
    // still pass if the inference attached every operation to the wrong
    // ingredients, which is exactly the bug that once shipped.
    it('is structurally sound and faithful to the source recipe', () => {
      const recipe = inferTree(raw, `https://example.test/${name}`);
      const graded = gradeByTier(recipe, raw);
      expect(graded.S.map((f) => `${f.rule}: ${f.detail}`)).toEqual([]);
      expect(graded.F.map((f) => `${f.rule}: ${f.detail}`)).toEqual([]);
    });

    it('is legible', () => {
      const recipe = inferTree(raw, `https://example.test/${name}`);
      const graded = gradeByTier(recipe, raw);
      expect(graded.L.map((f) => `${f.rule}: ${f.detail}`)).toEqual([]);
    });
  });
});
