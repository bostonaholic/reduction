/**
 * Acceptance tests for the box-drawing text renderer (slice 2 of
 * docs/plans/2026-07-29-cli-and-agent-skill).
 *
 * renderText(recipe, grid, width) is pure — string in, string out — and
 * treats every code point as width 1 (double-width handling is a deferred
 * open question). Grids come from the real layout engine over hand-built
 * trees, the same way tests/core/layout.test.ts builds them.
 */

import { describe, expect, it } from 'vitest';
import { layout } from '../../src/core/layout.js';
import { renderText } from '../../src/core/render-text.js';
import { confidenceNote } from '../../src/core/render.js';
import type { Ingredient, Recipe, RecipeNode } from '../../src/core/types.js';

function ing(name: string): RecipeNode {
  const ingredient: Ingredient = { raw: name, name };
  return { kind: 'ingredient', ingredient };
}

function op(label: string, ...children: RecipeNode[]): RecipeNode {
  return { kind: 'op', label, children, sourceStep: 0 };
}

function recipeWith(title: string, root: RecipeNode | null): Recipe {
  return {
    title,
    banners: [],
    root,
    sourceUrl: 'https://example.test/recipe',
    extraction: 'json-ld',
    inference: 'heuristic',
    confidence: 1,
  };
}

const HORIZONTAL_BORDER = /[─═]/;

/** The bordered table rows, excluding the caption and the confidence note. */
function tableLines(output: string): string[] {
  return output.split('\n').filter((line) => /[─═│║]/.test(line));
}

describe('renderText spans', () => {
  // mix spans both ingredient rows, bake spans them too: a 2×3 grid with
  // rowSpan 2 cells in columns 1 and 2.
  const recipe = recipeWith('Tiny Bake', op('bake', op('mix', ing('flour'), ing('sugar'))));
  const grid = layout(recipe);

  it('renders every cell text under a title caption', () => {
    const out = renderText(recipe, grid, 80);
    expect(out).toContain('Tiny Bake');
    expect(out).toContain('flour');
    expect(out).toContain('sugar');
    expect(out).toContain('mix');
    expect(out).toContain('bake');
  });

  it('keeps borders aligned across row-spanning cells', () => {
    const out = renderText(recipe, grid, 80);
    const lines = tableLines(out);
    expect(lines.length).toBeGreaterThan(2);
    const widths = new Set(lines.map((line) => [...line].length));
    expect([...widths]).toHaveLength(1);
  });

  it('appends the confidence note after the table', () => {
    const out = renderText(recipe, grid, 80);
    const note = confidenceNote(recipe).text;
    expect(out).toContain(note);
    expect(out.indexOf(note)).toBeGreaterThan(out.lastIndexOf('─'));
  });
});

describe('renderText wrapping', () => {
  const label =
    'simmer gently over the lowest possible heat until reduced by half and thick enough to coat the back of a spoon';
  const recipe = recipeWith('Reduction Sauce', op(label, ing('cream')));
  const grid = layout(recipe);

  it('wraps long cell text at the given width instead of truncating it', () => {
    const out = renderText(recipe, grid, 40);
    expect(out).toContain('simmer');
    expect(out).toContain('reduced');
    expect(out).toContain('spoon');
    expect(out).not.toMatch(/…|\.\.\./);
    // The structure fences cell wrapping only, so measure the table lines,
    // not the appended confidence note.
    const widths = tableLines(out).map((line) => [...line].length);
    expect(widths.length).toBeGreaterThan(0);
    expect(Math.max(...widths)).toBeLessThanOrEqual(40);
  });
});

describe('renderText degenerate grids', () => {
  it('renders a single-ingredient grid without spans', () => {
    const recipe = recipeWith('Hydration Guide', ing('water'));
    const out = renderText(recipe, layout(recipe), 80);
    expect(out).toContain('water');
    const lines = tableLines(out);
    expect(lines.length).toBeGreaterThan(0);
    const widths = new Set(lines.map((line) => [...line].length));
    expect([...widths]).toHaveLength(1);
  });

  it('omits the caption line when the title is empty', () => {
    const recipe = recipeWith('', ing('water'));
    const out = renderText(recipe, layout(recipe), 80);
    // No caption: the output opens directly with the table's top border.
    expect(out.split('\n')[0]).toMatch(HORIZONTAL_BORDER);
  });
});
