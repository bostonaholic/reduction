import { describe, expect, it } from 'vitest';
import {
  cellsByRow,
  column,
  formatQuantity,
  layout,
  leafCount,
  validateGrid,
} from '../../src/core/layout.js';
import type { Cell, Ingredient, Recipe, RecipeNode } from '../../src/core/types.js';

function ing(name: string, quantity?: number, unit?: string, metric?: string): RecipeNode {
  const ingredient: Ingredient = { raw: name, name, quantity, unit, metric };
  return { kind: 'ingredient', ingredient };
}

function op(label: string, ...children: RecipeNode[]): RecipeNode {
  return { kind: 'op', label, children, sourceStep: 0 };
}

/**
 * The brownie recipe from the reference Cooking For Engineers table. This is
 * the ground truth for the whole layout engine — if this test passes, the
 * renderer reproduces a real CfE diagram.
 */
function brownies(): Recipe {
  const butter = ing('unsalted butter', 4, 'oz', '115 g');
  const sugar = ing('sugar', 1, 'cup', '200 g');
  const vanilla = ing('vanilla extract', 0.25, 'tsp.', '2.5 mL');
  const espresso = ing('fresh brewed espresso', 1, 'shot', '60 mL');
  const eggs = ing('eggs', 2, 'large', '100 g');
  const flour = ing('all-purpose flour', 0.5, 'cup', '80 g');
  const cocoa = ing("Hershey's cocoa powder", 1 / 3, 'cup', '80 g');
  const soda = ing('baking soda', 0.25, 'tsp.', '1.3 g');
  const salt = ing('table salt', 0.25, 'tsp.', '1.5 g');

  const root = op(
    'bake 350°F (170°C) 30 to 40 min',
    op(
      'fold in',
      op('mix', op('mix', op('melt', butter), sugar, vanilla, espresso), eggs),
      flour,
      cocoa,
      soda,
      salt,
    ),
  );

  return {
    title: 'Espresso Brownies',
    banners: ['Butter and flour an 8x8-in pan', 'Preheat oven to 350°F (170°C)'],
    root,
    sourceUrl: 'https://example.test/brownies',
    extraction: 'json-ld',
    inference: 'heuristic',
    confidence: 1,
  };
}

function at(cells: Cell[], row: number, col: number): Cell | undefined {
  return cells.find((c) => c.row === row && c.col === col);
}

describe('column and leafCount', () => {
  it('places ingredients in column 0 and counts each as one row', () => {
    const butter = ing('butter');
    expect(column(butter)).toBe(0);
    expect(leafCount(butter)).toBe(1);
  });

  it('gives an operation the depth of its deepest child plus one', () => {
    const tree = op('bake', op('mix', op('melt', ing('butter')), ing('sugar')));
    expect(column(tree)).toBe(3);
    expect(leafCount(tree)).toBe(2);
  });

  it('survives an operation with no inputs', () => {
    const lonely = op('rest');
    expect(column(lonely)).toBe(1);
    expect(leafCount(lonely)).toBe(1);
  });
});

describe('formatQuantity', () => {
  it('writes fractions the way a cook reads them', () => {
    expect(formatQuantity(0.5)).toBe('1/2');
    expect(formatQuantity(0.25)).toBe('1/4');
    expect(formatQuantity(1 / 3)).toBe('1/3');
    expect(formatQuantity(1.25)).toBe('1 1/4');
    expect(formatQuantity(2)).toBe('2');
    expect(formatQuantity(undefined)).toBe('');
  });
});

describe('layout of the reference brownie table', () => {
  const grid = layout(brownies());

  it('tiles its rectangle with no overlaps and no holes', () => {
    expect(validateGrid(grid)).toEqual([]);
  });

  it('is 11 rows by 6 columns: 2 banners, 9 ingredients, 5 operation depths', () => {
    expect(grid.rows).toBe(11);
    expect(grid.cols).toBe(6);
  });

  it('puts the two prep steps in full-width banner rows at the top', () => {
    const first = at(grid.cells, 0, 0)!;
    const second = at(grid.cells, 1, 0)!;
    expect(first.kind).toBe('banner');
    expect(first.colSpan).toBe(6);
    expect(first.text).toBe('Butter and flour an 8x8-in pan');
    expect(second.text).toBe('Preheat oven to 350°F (170°C)');
  });

  it('lists ingredients in tree order, not source order, so spans stay contiguous', () => {
    const names = grid.cells
      .filter((c) => c.kind === 'ingredient')
      .sort((a, b) => a.row - b.row)
      .map((c) => c.text);

    expect(names).toEqual([
      '4 oz (115 g) unsalted butter',
      '1 cup (200 g) sugar',
      '1/4 tsp. (2.5 mL) vanilla extract',
      '1 shot (60 mL) fresh brewed espresso',
      '2 large (100 g) eggs',
      '1/2 cup (80 g) all-purpose flour',
      "1/3 cup (80 g) Hershey's cocoa powder",
      '1/4 tsp. (1.3 g) baking soda',
      '1/4 tsp. (1.5 g) table salt',
    ]);
  });

  it('spans each operation over exactly the rows it consumes', () => {
    // melt touches butter alone.
    expect(at(grid.cells, 2, 1)).toMatchObject({ text: 'melt', rowSpan: 1, kind: 'op' });
    // The first mix takes the melted butter plus sugar, vanilla and espresso.
    expect(at(grid.cells, 2, 2)).toMatchObject({ text: 'mix', rowSpan: 4 });
    // The second mix folds the eggs into that.
    expect(at(grid.cells, 2, 3)).toMatchObject({ text: 'mix', rowSpan: 5 });
    // Fold in reaches the four dry ingredients as well.
    expect(at(grid.cells, 2, 4)).toMatchObject({ text: 'fold in', rowSpan: 9 });
    // Baking consumes everything.
    expect(at(grid.cells, 2, 5)).toMatchObject({
      text: 'bake 350°F (170°C) 30 to 40 min',
      rowSpan: 9,
    });
  });

  it('bridges gaps with merged filler cells rather than a grid of empty boxes', () => {
    // Sugar, vanilla and espresso share one filler under "melt".
    expect(at(grid.cells, 3, 1)).toMatchObject({ kind: 'filler', rowSpan: 3, colSpan: 1 });
    // The eggs row bridges two columns.
    expect(at(grid.cells, 6, 1)).toMatchObject({ kind: 'filler', rowSpan: 1, colSpan: 2 });
    // The four dry ingredients share one wide filler.
    expect(at(grid.cells, 7, 1)).toMatchObject({ kind: 'filler', rowSpan: 4, colSpan: 3 });

    // Three fillers, not eight.
    expect(grid.cells.filter((c) => c.kind === 'filler')).toHaveLength(3);
  });

  it('emits rows a table renderer can walk directly', () => {
    const rows = cellsByRow(grid);
    expect(rows).toHaveLength(11);
    // Row 2 opens every operation column at once.
    expect(rows[2].map((c) => c.col)).toEqual([0, 1, 2, 3, 4, 5]);
    // Row 3 only needs the ingredient cell and one filler.
    expect(rows[3].map((c) => c.col)).toEqual([0, 1]);
  });
});

describe('layout edge cases', () => {
  it('handles a recipe with no tree at all', () => {
    const empty: Recipe = {
      title: 'Nothing',
      banners: [],
      root: null,
      sourceUrl: 'https://example.test',
      extraction: 'heuristic',
      inference: 'flat',
      confidence: 0,
    };
    const grid = layout(empty);
    expect(grid.rows).toBe(0);
    expect(grid.cells).toEqual([]);
  });

  it('handles banners with no ingredients', () => {
    const bannersOnly: Recipe = {
      title: 'Prep only',
      banners: ['Preheat oven to 400°F'],
      root: null,
      sourceUrl: 'https://example.test',
      extraction: 'heuristic',
      inference: 'flat',
      confidence: 0,
    };
    const grid = layout(bannersOnly);
    expect(validateGrid(grid)).toEqual([]);
    expect(grid.rows).toBe(1);
    expect(grid.cols).toBe(1);
  });

  it('handles a single ingredient with no operations', () => {
    const solo: Recipe = {
      title: 'Water',
      banners: [],
      root: ing('water', 1, 'cup'),
      sourceUrl: 'https://example.test',
      extraction: 'heuristic',
      inference: 'flat',
      confidence: 1,
    };
    const grid = layout(solo);
    expect(validateGrid(grid)).toEqual([]);
    expect(grid.rows).toBe(1);
    expect(grid.cols).toBe(1);
  });

  it('keeps deeply lopsided trees valid', () => {
    let node: RecipeNode = ing('a');
    for (let i = 0; i < 12; i++) node = op(`step ${i}`, node, ing(`ing ${i}`));
    const deep: Recipe = {
      title: 'Lopsided',
      banners: [],
      root: node,
      sourceUrl: 'https://example.test',
      extraction: 'heuristic',
      inference: 'heuristic',
      confidence: 1,
    };
    const grid = layout(deep);
    expect(validateGrid(grid)).toEqual([]);
    expect(grid.rows).toBe(13);
    expect(grid.cols).toBe(13);
  });
});
