/**
 * Grid -> pixel geometry, for the SVG, PNG, and PDF renderers.
 *
 * Pure and DOM-free: the render-text.ts sizing pipeline ported to pixels,
 * with textWidth() as the measurer and real border widths (2px interior,
 * 3px frame) instead of one-character border lines. All three renderers
 * read the same PixelLayout, so their geometry cannot drift apart.
 *
 * The visual grammar is the extension's image export (src/export/image.ts):
 * 15px text, line-height 1.35, PAD = 10, baseline at
 * top + (h - blockHeight) / 2 + fontSize * 0.82, ingredient cells
 * left-anchored and everything else centered.
 */

import { textWidth } from './font-metrics.js';
import type { Cell, CellKind, Grid } from './types.js';

const FONT_SIZE = 15;
const LINE_HEIGHT = FONT_SIZE * 1.35;
const PAD = 10;
/** The outer frame, drawn 3px on every side. */
const FRAME = 3;
/** Interior borders between cells, matching the overlay's 2px solid. */
const BORDER = 2;
/**
 * Column floors from the overlay (decision 9): its min-widths are content
 * widths under content-box, so only the 7px/10px padding folds in — 220 + 20
 * for the ingredient column, 62 + 20 for every other column. Borders stay
 * separate terms, the way render-text.ts keeps them.
 */
const INGREDIENT_FLOOR = 240;
const OP_FLOOR = 82;
/**
 * Tables shrink toward the overlay panel's widest rendering (decision 11):
 * an artifact cannot scroll the way the overlay does, so width past the
 * target is taken back — but never below a column's floor, so a 13+ column
 * table stays over target at legible floor widths.
 */
const TARGET_WIDTH = 1180;
/** Never wrap to a sliver narrower than this (image.ts:88 precedent). */
const MIN_WRAP_WIDTH = 20;

export interface PixelLine {
  text: string;
  x: number;
  y: number;
  anchor: 'start' | 'middle';
}

export interface PixelBox {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: CellKind;
  lines: PixelLine[];
}

export interface PixelLayout {
  width: number;
  height: number;
  boxes: PixelBox[];
}

function columnFloor(col: number): number {
  return col === 0 ? INGREDIENT_FLOOR : OP_FLOOR;
}

/** A column wide enough to hold `text` unwrapped: glyphs plus padding. */
function naturalWidth(text: string): number {
  return Math.ceil(textWidth(text, FONT_SIZE)) + 2 * PAD;
}

/** The content width a cell spans: its columns plus the borders between them. */
function contentWidth(cell: Cell, widths: number[]): number {
  let sum = BORDER * (cell.colSpan - 1);
  for (let c = cell.col; c < cell.col + cell.colSpan; c++) sum += widths[c];
  return sum;
}

/** Split a too-wide word into pieces that each fit `maxWidth`. */
function chunk(word: string, maxWidth: number): string[] {
  if (textWidth(word, FONT_SIZE) <= maxWidth) return [word];
  const pieces: string[] = [];
  let piece = '';
  let pieceWidth = 0;
  for (const char of word) {
    const charWidth = textWidth(char, FONT_SIZE);
    // A non-empty piece always makes progress, even when one glyph alone
    // exceeds maxWidth — that glyph becomes its own piece.
    if (piece !== '' && pieceWidth + charWidth > maxWidth) {
      pieces.push(piece);
      piece = '';
      pieceWidth = 0;
    }
    piece += char;
    pieceWidth += charWidth;
  }
  if (piece !== '') pieces.push(piece);
  return pieces;
}

/** Word-wrap to `maxWidth` pixels, hard-breaking oversized words. */
function wrap(text: string, maxWidth: number): string[] {
  const spaceWidth = textWidth(' ', FONT_SIZE);
  const lines: string[] = [];
  let line = '';
  let lineWidth = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    for (const piece of chunk(word, maxWidth)) {
      const pieceWidth = textWidth(piece, FONT_SIZE);
      if (line === '') {
        line = piece;
        lineWidth = pieceWidth;
      } else if (lineWidth + spaceWidth + pieceWidth <= maxWidth) {
        line += ` ${piece}`;
        lineWidth += spaceWidth + pieceWidth;
      } else {
        lines.push(line);
        line = piece;
        lineWidth = pieceWidth;
      }
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

/** Natural column widths over the per-column floors. */
function columnWidths(grid: Grid): number[] {
  const widths = Array.from({ length: grid.cols }, (_, c) => columnFloor(c));
  for (const cell of grid.cells) {
    if (cell.colSpan === 1) {
      widths[cell.col] = Math.max(widths[cell.col], naturalWidth(cell.text));
    }
  }
  // A spanning cell (a banner, typically) whose text outgrows its columns
  // widens them round-robin. Growth is capped at the width target — anything
  // past it would only wrap anyway once the table shrinks toward it.
  for (const cell of grid.cells) {
    if (cell.colSpan === 1) continue;
    let deficit = Math.min(naturalWidth(cell.text), TARGET_WIDTH) - contentWidth(cell, widths);
    for (let c = cell.col; deficit > 0; deficit--) {
      widths[c]++;
      c = c + 1 < cell.col + cell.colSpan ? c + 1 : cell.col;
    }
  }
  shrinkToTarget(widths);
  return widths;
}

/**
 * Shrink `widths` in place toward TARGET_WIDTH, never below a column's
 * floor.
 *
 * The specification is per-pixel: shrink the widest column still above its
 * own floor by 1px, ties broken lowest index first (the render-text.ts:88
 * indexOf(Math.max(...)) order); stop when the table meets the target or no
 * column is above its floor. This computes the same fixpoint arithmetically:
 * find the one integer level L where clamping every column to
 * max(floor, min(natural, L)) brings the total to the largest value <= the
 * target, then hand the undershoot back one pixel each to the columns
 * clamped at exactly L, highest index first, so the total equals the target
 * exactly. Highest index first because the per-pixel loop takes the final
 * round's pixels from tied columns in index order and stops mid-round: the
 * columns it never reached — the highest-indexed — are the ones left one
 * pixel above the level. Columns pinned by their floor or natural width
 * take nothing back; the rule never leaves them off their pin. Leveling
 * undershoots by less than one pixel per level-clamped column (<= ~11px):
 * undershooting the target requires the target to be reachable, which
 * needs <= 12 columns. When the floor sum 246 + 84×(cols−1) exceeds the
 * target (13+ columns), the floors win and the table stays over target.
 * tests/core/pixel-layout.test.ts holds this arithmetic form to the
 * per-pixel rule over randomized grids.
 */
function shrinkToTarget(widths: number[]): void {
  const cols = widths.length;
  if (cols === 0) return;
  // The non-content pixels: the frame plus one interior border per boundary.
  const chrome = 2 * FRAME + BORDER * (cols - 1);
  const totalAt = (level: number): number =>
    widths.reduce((sum, w, c) => sum + Math.max(columnFloor(c), Math.min(w, level)), chrome);

  if (widths.reduce((sum, w) => sum + w, chrome) <= TARGET_WIDTH) return;
  if (totalAt(0) >= TARGET_WIDTH) {
    // The floors win: no level meets the target, so everything shrinks to
    // its floor and the table stays over (or exactly at) the target.
    for (let c = 0; c < cols; c++) widths[c] = columnFloor(c);
    return;
  }

  // Binary search the largest integer level whose total is <= the target;
  // totalAt is non-decreasing in the level, so the invariant
  // totalAt(lo) <= TARGET_WIDTH < totalAt(hi + 1) pins the fixpoint.
  let lo = 0;
  let hi = Math.max(...widths);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (totalAt(mid) <= TARGET_WIDTH) lo = mid;
    else hi = mid - 1;
  }
  const level = lo;

  const shrunk = widths.map((w, c) => Math.max(columnFloor(c), Math.min(w, level)));
  let leftover = TARGET_WIDTH - shrunk.reduce((sum, w) => sum + w, chrome);
  // Hand the undershoot back one pixel each, highest index first, only to
  // columns sitting exactly at the level with natural width to spare — a
  // floor-pinned column stays at its floor, and no column ever exceeds its
  // natural width (see the header comment for why this order is the
  // per-pixel rule's).
  const clamped = shrunk
    .map((_, c) => c)
    .filter((c) => shrunk[c] === level && level < widths[c]);
  for (let i = clamped.length - 1; i >= 0 && leftover > 0; i--) {
    shrunk[clamped[i]]++;
    leftover--;
  }
  for (let c = 0; c < cols; c++) widths[c] = shrunk[c];
}

export function layoutPixels(grid: Grid): PixelLayout {
  const widths = columnWidths(grid);
  const wrapped = new Map<Cell, string[]>(
    grid.cells.map((cell) => [
      cell,
      wrap(cell.text, Math.max(contentWidth(cell, widths) - PAD * 2, MIN_WRAP_WIDTH)),
    ]),
  );

  // Row heights: single-row cells set the floor; a row-spanning cell may use
  // the border pixels inside its rectangle, so it only grows its last row
  // when the combined space still falls short (render-text.ts:125-137).
  const needed = (cell: Cell): number =>
    Math.max(wrapped.get(cell)!.length, 1) * LINE_HEIGHT + 2 * PAD;
  const heights = new Array<number>(grid.rows).fill(LINE_HEIGHT + 2 * PAD);
  for (const cell of grid.cells) {
    if (cell.rowSpan === 1) heights[cell.row] = Math.max(heights[cell.row], needed(cell));
  }
  for (const cell of grid.cells) {
    if (cell.rowSpan === 1) continue;
    let available = BORDER * (cell.rowSpan - 1);
    for (let r = cell.row; r < cell.row + cell.rowSpan; r++) available += heights[r];
    const deficit = needed(cell) - available;
    if (deficit > 0) heights[cell.row + cell.rowSpan - 1] += deficit;
  }

  // Grid lines as box edges: boxes tile [0,W]×[0,H] exactly, so each edge
  // sits mid-border between neighbours and the outer boxes absorb the frame.
  const xs = edges(widths);
  const ys = edges(heights);
  const width = xs[xs.length - 1];
  const height = ys[ys.length - 1];

  const boxes: PixelBox[] = grid.cells.map((cell) => {
    const x = xs[cell.col];
    const y = ys[cell.row];
    const box: PixelBox = {
      x,
      y,
      w: xs[cell.col + cell.colSpan] - x,
      h: ys[cell.row + cell.rowSpan] - y,
      kind: cell.kind,
      lines: [],
    };
    const lines = wrapped.get(cell)!;
    if (lines.length > 0) {
      const centered = cell.kind !== 'ingredient';
      const blockHeight = lines.length * LINE_HEIGHT;
      const top = box.y + (box.h - blockHeight) / 2 + FONT_SIZE * 0.82;
      lines.forEach((text, index) => {
        box.lines.push({
          text,
          x: centered ? box.x + box.w / 2 : box.x + PAD,
          y: top + index * LINE_HEIGHT,
          anchor: centered ? 'middle' : 'start',
        });
      });
    }
    return box;
  });

  return { width, height, boxes };
}

/**
 * Edge positions for `sizes` content spans: edge 0 at 0, interior edges at
 * the centre of each 2px border, the last edge past the closing frame. An
 * empty grid degenerates to the bare 6px frame.
 */
function edges(sizes: number[]): number[] {
  const line = [0];
  let at = FRAME;
  for (let i = 0; i < sizes.length; i++) {
    at += sizes[i];
    if (i < sizes.length - 1) {
      line.push(at + BORDER / 2);
      at += BORDER;
    } else {
      line.push(at + FRAME);
    }
  }
  if (sizes.length === 0) line.push(2 * FRAME);
  return line;
}
