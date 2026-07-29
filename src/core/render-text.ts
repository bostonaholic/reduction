/**
 * Grid -> monospace box-drawing text, for terminals.
 *
 * Pure and DOM-free like the rest of src/core/: recipe and grid in, one
 * string out — except that a grid whose canvas would exceed MAX_CANVAS_SLOTS
 * throws a RangeError rather than allocating it. The caller supplies the
 * width (the CLI passes the terminal's). Width math counts every code point
 * as width 1; double-width characters are accepted for now and may misalign
 * borders (deferred open question).
 */

import type { Cell, Grid, Recipe } from './types.js';
import { confidenceNote } from './render.js';

/** Columns never shrink below this, so even squeezed cells stay readable. */
const MIN_COL_WIDTH = 3;

/**
 * The canvas is one slot per character; refuse to allocate an absurd one.
 * A real recipe is a few thousand slots — this is a guard against a hostile
 * page amplifying a large body into gigabytes of canvas, not a limit any
 * legitimate table approaches.
 */
const MAX_CANVAS_SLOTS = 4_000_000;

/** Word-wrap to `width`, hard-breaking words longer than a whole line. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  let lineWidth = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    for (const piece of chunk(word, width)) {
      const pieceWidth = [...piece].length;
      if (line === '') {
        line = piece;
        lineWidth = pieceWidth;
      } else if (lineWidth + 1 + pieceWidth <= width) {
        line += ` ${piece}`;
        lineWidth += 1 + pieceWidth;
      } else {
        lines.push(line);
        line = piece;
        lineWidth = pieceWidth;
      }
    }
  }
  if (line !== '') lines.push(line);
  return lines.length > 0 ? lines : [''];
}

function chunk(word: string, size: number): string[] {
  const points = [...word];
  if (points.length <= size) return [word];
  const pieces: string[] = [];
  for (let i = 0; i < points.length; i += size) pieces.push(points.slice(i, i + size).join(''));
  return pieces;
}

/** Natural column widths, then shrink the widest until the table fits. */
function columnWidths(grid: Grid, width: number): number[] {
  const widths = new Array<number>(grid.cols).fill(1);
  for (const cell of grid.cells) {
    if (cell.colSpan === 1) {
      widths[cell.col] = Math.max(widths[cell.col], [...cell.text].length);
    }
  }
  // A spanning cell (a banner, typically) whose text outgrows its columns
  // widens them round-robin. Growth is capped at the table width — anything
  // past it the shrink loop below would only take back.
  for (const cell of grid.cells) {
    if (cell.colSpan === 1) continue;
    let deficit = Math.min([...cell.text].length, width) - contentWidth(cell, widths);
    for (let c = cell.col; deficit > 0; deficit--) {
      widths[c]++;
      c = c + 1 < cell.col + cell.colSpan ? c + 1 : cell.col;
    }
  }
  // Table width = content + one border line per column boundary and edge.
  const total = (): number => widths.reduce((sum, w) => sum + w, 0) + grid.cols + 1;
  while (total() > width) {
    const widest = widths.indexOf(Math.max(...widths));
    if (widths[widest] <= MIN_COL_WIDTH) break; // Nothing left to squeeze.
    widths[widest]--;
  }
  return widths;
}

/** The content width a cell spans: its columns plus the borders between them. */
function contentWidth(cell: Cell, widths: number[]): number {
  let sum = cell.colSpan - 1;
  for (let c = cell.col; c < cell.col + cell.colSpan; c++) sum += widths[c];
  return sum;
}

export function renderText(recipe: Recipe, grid: Grid, width: number): string {
  const note = confidenceNote(recipe).text;
  if (grid.cells.length === 0) return recipe.title ? `${recipe.title}\n${note}\n` : `${note}\n`;

  const widths = columnWidths(grid, width);
  const wrapped = new Map<Cell, string[]>(
    grid.cells.map((cell) => [cell, wrap(cell.text, contentWidth(cell, widths))]),
  );

  // Row heights: single-row cells set the floor; a row-spanning cell may use
  // the border lines inside its rectangle, so it only grows its last row when
  // the combined space still falls short.
  const heights = new Array<number>(grid.rows).fill(1);
  for (const cell of grid.cells) {
    if (cell.rowSpan === 1) {
      heights[cell.row] = Math.max(heights[cell.row], wrapped.get(cell)!.length);
    }
  }
  for (const cell of grid.cells) {
    if (cell.rowSpan === 1) continue;
    let available = cell.rowSpan - 1;
    for (let r = cell.row; r < cell.row + cell.rowSpan; r++) available += heights[r];
    const deficit = wrapped.get(cell)!.length - available;
    if (deficit > 0) heights[cell.row + cell.rowSpan - 1] += deficit;
  }

  // Canvas coordinates: border line c sits at xs[c], column c's content just
  // after it; likewise ys for rows.
  const xs = [0];
  for (const w of widths) xs.push(xs[xs.length - 1] + w + 1);
  const ys = [0];
  for (const h of heights) ys.push(ys[ys.length - 1] + h + 1);
  const canvasWidth = xs[grid.cols];
  const canvasHeight = ys[grid.rows];
  if ((canvasHeight + 1) * (canvasWidth + 1) > MAX_CANVAS_SLOTS) {
    throw new RangeError(`table too large to render (${canvasHeight + 1} lines)`);
  }

  const text: string[][] = Array.from({ length: canvasHeight + 1 }, () =>
    new Array<string>(canvasWidth + 1).fill(' '),
  );
  const horizontal = Array.from({ length: canvasHeight + 1 }, () =>
    new Array<boolean>(canvasWidth + 1).fill(false),
  );
  const vertical = Array.from({ length: canvasHeight + 1 }, () =>
    new Array<boolean>(canvasWidth + 1).fill(false),
  );

  for (const cell of grid.cells) {
    const left = xs[cell.col];
    const right = xs[cell.col + cell.colSpan];
    const top = ys[cell.row];
    const bottom = ys[cell.row + cell.rowSpan];
    for (let x = left; x <= right; x++) {
      horizontal[top][x] = true;
      horizontal[bottom][x] = true;
    }
    for (let y = top; y <= bottom; y++) {
      vertical[y][left] = true;
      vertical[y][right] = true;
    }
    const lines = wrapped.get(cell)!;
    for (let i = 0; i < lines.length; i++) {
      const points = [...lines[i]];
      for (let j = 0; j < points.length; j++) text[top + 1 + i][left + 1 + j] = points[j];
    }
  }

  // Pick each border character from which neighbours it connects to, so
  // junctions come out as ├ ┤ ┬ ┴ ┼ without tracking them cell by cell.
  for (let y = 0; y <= canvasHeight; y++) {
    for (let x = 0; x <= canvasWidth; x++) {
      if (!horizontal[y][x] && !vertical[y][x]) continue;
      const up = vertical[y][x] && y > 0 && vertical[y - 1][x];
      const down = vertical[y][x] && y < canvasHeight && vertical[y + 1][x];
      const leftward = horizontal[y][x] && x > 0 && horizontal[y][x - 1];
      const rightward = horizontal[y][x] && x < canvasWidth && horizontal[y][x + 1];
      text[y][x] = junction(up, down, leftward, rightward);
    }
  }

  const table = text
    .slice(0, canvasHeight + 1)
    .map((row) => row.slice(0, canvasWidth + 1).join(''))
    .join('\n');
  const caption = recipe.title ? `${recipe.title}\n` : '';
  return `${caption}${table}\n${note}\n`;
}

function junction(up: boolean, down: boolean, left: boolean, right: boolean): string {
  if (up && down) {
    if (left && right) return '┼';
    if (left) return '┤';
    if (right) return '├';
    return '│';
  }
  if (left && right) {
    if (down) return '┬';
    if (up) return '┴';
    return '─';
  }
  if (down) return right ? '┌' : '┐';
  if (up) return right ? '└' : '┘';
  return left || right ? '─' : '│';
}
