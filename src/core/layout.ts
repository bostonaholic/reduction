/**
 * Tree -> table layout.
 *
 * The Cooking For Engineers table is a left-to-right rendering of the recipe
 * tree. Three rules produce it:
 *
 *   column(node)    = depth from the ingredient leaves
 *   rowSpan(node)   = number of leaves in its subtree
 *   row order       = depth-first traversal of the leaves
 *
 * The DFS row order is what makes the table possible at all: it guarantees
 * every operation's inputs occupy a *contiguous* block of rows, which is
 * exactly what a rowspan can cover.
 *
 * A fourth rule handles the gaps. When a child sits shallower than
 * `parent.column - 1` there is empty space between them; we bridge it with a
 * filler cell. Consecutive siblings needing the same bridge merge into one
 * cell, which is what produces the clean unbroken empty regions you see in a
 * real Cooking For Engineers table rather than a grid of tiny empty boxes.
 */

import { pluralizeUnit } from './units.js';
import type { Cell, Grid, Recipe, RecipeNode } from './types.js';

/** Depth from the leaves. Ingredients live in column 0. */
export function column(node: RecipeNode): number {
  if (node.kind === 'ingredient') return 0;
  let deepest = 0;
  for (const child of node.children) {
    const c = column(child);
    if (c > deepest) deepest = c;
  }
  return deepest + 1;
}

/** Number of ingredient rows this subtree occupies. */
export function leafCount(node: RecipeNode): number {
  if (node.kind === 'ingredient') return 1;
  let total = 0;
  for (const child of node.children) total += leafCount(child);
  // An operation with no inputs still needs a row to live on.
  return total === 0 ? 1 : total;
}

/** Render an ingredient the way Cooking For Engineers writes it. */
export function formatIngredient(node: RecipeNode): string {
  if (node.kind !== 'ingredient') return '';
  const { quantity, unit, metric, name, note, raw } = node.ingredient;

  if (quantity === undefined && !unit) {
    // Nothing parsed cleanly — the original line is better than a guess.
    return note ? `${name}, ${note}` : raw;
  }

  const amount = [formatQuantity(quantity), unit && pluralizeUnit(unit, quantity)]
    .filter(Boolean)
    .join(' ');
  const withMetric = metric ? `${amount} (${metric})` : amount;
  const head = [withMetric, name].filter(Boolean).join(' ');
  return note ? `${head}, ${note}` : head;
}

/** 0.5 -> "1/2", 1.25 -> "1 1/4", 2 -> "2". Cooks read fractions, not decimals. */
export function formatQuantity(value: number | undefined): string {
  if (value === undefined) return '';
  const whole = Math.floor(value);
  const frac = value - whole;
  if (frac < 0.01) return String(whole);

  const denominators = [2, 3, 4, 8, 16];
  for (const d of denominators) {
    const n = Math.round(frac * d);
    if (n > 0 && n < d && Math.abs(frac - n / d) < 0.02) {
      return whole > 0 ? `${whole} ${n}/${d}` : `${n}/${d}`;
    }
  }
  return String(Math.round(value * 100) / 100);
}

/**
 * Lay a recipe out into positioned cells.
 *
 * Pure and total: any tree in, a valid grid out. Callers never have to
 * check for a partial result.
 */
export function layout(recipe: Recipe): Grid {
  const cells: Cell[] = [];
  const totalCols = recipe.root ? column(recipe.root) + 1 : 1;
  let row = 0;

  for (const banner of recipe.banners) {
    cells.push({
      text: banner,
      row: row++,
      col: 0,
      rowSpan: 1,
      colSpan: totalCols,
      kind: 'banner',
    });
  }

  /** Places a subtree and returns the [first, last] rows it occupies. */
  function place(node: RecipeNode): [number, number] {
    if (node.kind === 'ingredient') {
      const here = row++;
      cells.push({
        text: formatIngredient(node),
        row: here,
        col: 0,
        rowSpan: 1,
        colSpan: 1,
        kind: 'ingredient',
      });
      return [here, here];
    }

    const opCol = column(node);

    if (node.children.length === 0) {
      const here = row++;
      cells.push({
        text: node.label,
        row: here,
        col: opCol,
        rowSpan: 1,
        colSpan: 1,
        kind: 'op',
      });
      return [here, here];
    }

    const spans = node.children.map(place);
    const first = spans[0][0];
    const last = spans[spans.length - 1][1];

    cells.push({
      text: node.label,
      row: first,
      col: opCol,
      rowSpan: last - first + 1,
      colSpan: 1,
      kind: 'op',
    });

    // Bridge children that stop short of this operation's column, merging
    // consecutive siblings that need an identical bridge.
    let i = 0;
    while (i < node.children.length) {
      const childCol = column(node.children[i]);
      let j = i;
      while (
        j + 1 < node.children.length &&
        column(node.children[j + 1]) === childCol
      ) {
        j++;
      }
      const gapStart = childCol + 1;
      if (gapStart <= opCol - 1) {
        cells.push({
          text: '',
          row: spans[i][0],
          col: gapStart,
          rowSpan: spans[j][1] - spans[i][0] + 1,
          colSpan: opCol - gapStart,
          kind: 'filler',
        });
      }
      i = j + 1;
    }

    return [first, last];
  }

  if (recipe.root) place(recipe.root);

  return { cells, rows: row, cols: totalCols };
}

/**
 * Group cells into rows, ordered left to right, for a renderer that emits
 * `<tr>`/`<td>`. Cells covered by a rowspan from above simply do not appear,
 * which is exactly what HTML wants.
 */
export function cellsByRow(grid: Grid): Cell[][] {
  const rows: Cell[][] = Array.from({ length: grid.rows }, () => []);
  for (const cell of grid.cells) rows[cell.row].push(cell);
  for (const r of rows) r.sort((a, b) => a.col - b.col);
  return rows;
}

/**
 * Verify a grid actually tiles its rectangle: every position covered exactly
 * once, no overlaps, no holes. Cheap enough to run in tests and in dev, and it
 * turns a subtle layout bug into a loud one.
 */
export function validateGrid(grid: Grid): string[] {
  const problems: string[] = [];
  const seen = new Uint8Array(grid.rows * grid.cols);

  for (const cell of grid.cells) {
    for (let r = cell.row; r < cell.row + cell.rowSpan; r++) {
      for (let c = cell.col; c < cell.col + cell.colSpan; c++) {
        if (r >= grid.rows || c >= grid.cols) {
          problems.push(`cell "${cell.text}" spills outside the grid at ${r},${c}`);
          continue;
        }
        const at = r * grid.cols + c;
        if (seen[at]) problems.push(`overlap at row ${r}, col ${c}`);
        seen[at] = 1;
      }
    }
  }

  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (!seen[r * grid.cols + c]) problems.push(`hole at row ${r}, col ${c}`);
    }
  }

  return problems;
}
