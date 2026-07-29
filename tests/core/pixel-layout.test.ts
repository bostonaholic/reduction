/**
 * Acceptance tests for the pixel geometry engine (slices 1 and 2).
 *
 * layoutPixels(grid) is pure — Grid in, PixelLayout out. Slice 1: tiling
 * invariants, the 240px/82px column floors (decision 9), and totality on
 * degenerate grids. Slice 2: the floor-aware shrink toward the 1180px target
 * (decisions 10–11) and the hard-breaking wrap (decision 14).
 *
 * The frame is 3px each side and interior borders are 2px, so a table of
 * floor-width columns is 246 + 84×(cols−1) pixels wide — the design's floor
 * sum. Tests assert that formula and geometric relations between boxes, not
 * literal coordinates (PAD, 15px, 1.35 and 0.82 all feed those; changing one
 * is not a bug — the single hand-computed anchor lives in render-pdf.test.ts).
 */

import { describe, expect, it } from 'vitest';
import { textWidth } from '../../src/core/font-metrics.js';
import { layout } from '../../src/core/layout.js';
import { layoutPixels } from '../../src/core/pixel-layout.js';
import type { Grid, Ingredient, Recipe, RecipeNode } from '../../src/core/types.js';

type Layout = ReturnType<typeof layoutPixels>;
type Box = Layout['boxes'][number];

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

/** A one-row grid: column 0 an ingredient, every other column an op. */
function rowGrid(texts: string[]): Grid {
  return {
    cells: texts.map((text, col) => ({
      text,
      row: 0,
      col,
      rowSpan: 1,
      colSpan: 1,
      kind: col === 0 ? ('ingredient' as const) : ('op' as const),
    })),
    rows: 1,
    cols: texts.length,
  };
}

/** The box whose wrapped lines contain `text`. */
function boxWithText(p: Layout, text: string): Box | undefined {
  return p.boxes.find((box) => box.lines.some((line) => line.text.includes(text)));
}

/** The box one of whose wrapped lines is exactly `text` — for short labels. */
function boxWithLine(p: Layout, text: string): Box | undefined {
  return p.boxes.find((box) => box.lines.some((line) => line.text === text));
}

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return Math.max(w, 0) * Math.max(h, 0);
}

/** Table width when every column sits at its floor: 240/82 content + borders. */
function floorSum(cols: number): number {
  return 246 + 84 * (cols - 1);
}

describe('layoutPixels tiling (slice 1)', () => {
  // mix spans both ingredient rows and bake spans mix: a 2×3 grid with
  // rowSpan-2 cells in columns 1 and 2, built by the real layout engine.
  const grid = layout(recipeWith('Tiny Bake', op('bake', op('mix', ing('flour'), ing('sugar')))));

  it('tiles exactly [0,W]×[0,H]: one box per cell, disjoint, no holes', () => {
    const p = layoutPixels(grid);
    expect(p.boxes).toHaveLength(grid.cells.length);
    expect(p.width).toBeGreaterThan(0);
    expect(p.height).toBeGreaterThan(0);

    for (const box of p.boxes) {
      expect(box.w).toBeGreaterThan(0);
      expect(box.h).toBeGreaterThan(0);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(p.width + 1e-6);
      expect(box.y + box.h).toBeLessThanOrEqual(p.height + 1e-6);
    }

    expect(Math.min(...p.boxes.map((b) => b.x))).toBeCloseTo(0, 6);
    expect(Math.min(...p.boxes.map((b) => b.y))).toBeCloseTo(0, 6);
    expect(Math.max(...p.boxes.map((b) => b.x + b.w))).toBeCloseTo(p.width, 6);
    expect(Math.max(...p.boxes.map((b) => b.y + b.h))).toBeCloseTo(p.height, 6);

    for (let i = 0; i < p.boxes.length; i++) {
      for (let j = i + 1; j < p.boxes.length; j++) {
        expect(overlapArea(p.boxes[i], p.boxes[j]), `boxes ${i} and ${j} overlap`).toBeCloseTo(0, 6);
      }
    }
    const covered = p.boxes.reduce((sum, b) => sum + b.w * b.h, 0);
    expect(covered).toBeCloseTo(p.width * p.height, 4);
  });

  it('aligns shared borders across row-spanning cells', () => {
    const p = layoutPixels(grid);
    const flour = boxWithText(p, 'flour');
    const sugar = boxWithText(p, 'sugar');
    const mix = boxWithText(p, 'mix');
    const bake = boxWithText(p, 'bake');
    expect(flour).toBeDefined();
    expect(sugar).toBeDefined();
    expect(mix).toBeDefined();
    expect(bake).toBeDefined();

    // The ingredient column: same left edge, same width.
    expect(sugar!.x).toBeCloseTo(flour!.x, 6);
    expect(sugar!.w).toBeCloseTo(flour!.w, 6);
    // mix spans exactly the two ingredient rows.
    expect(mix!.y).toBeCloseTo(flour!.y, 6);
    expect(mix!.y + mix!.h).toBeCloseTo(sugar!.y + sugar!.h, 6);
    // bake spans the full mix column height and abuts it.
    expect(bake!.y).toBeCloseTo(mix!.y, 6);
    expect(bake!.h).toBeCloseTo(mix!.h, 6);
    expect(bake!.x).toBeCloseTo(mix!.x + mix!.w, 6);
  });
});

describe('layoutPixels column floors (slice 1)', () => {
  it('floors the ingredient column at 240px and op columns at 82px', () => {
    // Every text is far narrower than its floor, so the whole width is
    // floors plus borders: 246 + 84 + 84.
    const grid = layout(recipeWith('Tiny Bake', op('bake', op('mix', ing('flour'), ing('sugar')))));
    expect(layoutPixels(grid).width).toBe(floorSum(3));
  });

  it('keeps a one-cell grid total: one framed box at the 240 floor', () => {
    const grid = layout(recipeWith('', ing('flour')));
    const p = layoutPixels(grid);
    expect(p.width).toBe(floorSum(1));
    expect(p.boxes).toHaveLength(1);
    const [box] = p.boxes;
    expect(box.x).toBeCloseTo(0, 6);
    expect(box.y).toBeCloseTo(0, 6);
    expect(box.x + box.w).toBeCloseTo(p.width, 6);
    expect(box.y + box.h).toBeCloseTo(p.height, 6);
    expect(box.lines.map((line) => line.text)).toEqual(['flour']);
  });

  it('stays total on the empty grid: no boxes, a minimal framed artifact', () => {
    const p = layoutPixels({ cells: [], rows: 0, cols: 0 });
    expect(p.boxes).toHaveLength(0);
    // Nothing but the 3px frame on each side.
    expect(p.width).toBeGreaterThanOrEqual(6);
    expect(p.height).toBeGreaterThanOrEqual(6);
  });
});

describe('layoutPixels shrink toward the 1180px target (slice 2)', () => {
  it('shrinks a 12-column table whose natural width exceeds 1180px to exactly 1180', () => {
    // Ingredient column at its 240 floor, op columns well above their 82
    // floor — the fixture decisions 10–11 exist for. The ported
    // render-text.ts:87-91 loop quits when the single widest column reaches
    // its own floor; the re-derived reverse water-fill levels the op columns
    // and hands the leftover pixels back so the total is exact.
    const opText = 'measure and whisk together until smooth';
    const grid = rowGrid(['a', ...Array.from({ length: 11 }, () => opText)]);

    // Precondition (review note 7): the natural width must exceed the
    // target, or the shrink assertion is vacuous. 6px frame + 22px interior
    // borders + 240px floor + 11 op columns no narrower than their text.
    const naturalAtLeast = 6 + 2 * 11 + 240 + 11 * textWidth(opText, 15);
    expect(naturalAtLeast).toBeGreaterThan(1180);

    const p = layoutPixels(grid);
    expect(p.width).toBe(1180);
    // No column may be squeezed below its floor to get there.
    const ingredientBox = p.boxes.find((box) => box.kind === 'ingredient');
    expect(ingredientBox).toBeDefined();
    expect(ingredientBox!.w).toBeGreaterThanOrEqual(240);
    for (const box of p.boxes.filter((b) => b.kind === 'op')) {
      expect(box.w).toBeGreaterThanOrEqual(82);
    }
  });

  it('lets the floors win at 13 columns: the width is the 1254px floor sum and the shrink terminates', () => {
    const grid = rowGrid(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm']);
    const p = layoutPixels(grid);
    expect(p.width).toBe(floorSum(13));
    expect(p.width).toBe(1254);
    expect(p.width).toBeGreaterThan(1180);
  });

  it('hard-breaks a word wider than its post-shrink column instead of overflowing', () => {
    // One unbreakable 220-character word: naturally ~1650px wide, far past
    // the target, so the op column shrinks and the word must break
    // (decision 14) — first reachable here, because slice 1 never narrows a
    // column below its natural width.
    const word = 'x'.repeat(220);
    expect(textWidth(word, 15)).toBeGreaterThan(1180);

    const p = layoutPixels(rowGrid(['a', word]));
    expect(p.width).toBe(1180);
    const box = p.boxes.find((b) => b.lines.some((line) => line.text.startsWith('xx')));
    expect(box).toBeDefined();
    expect(box!.lines.length).toBeGreaterThanOrEqual(2);
    for (const line of box!.lines) {
      expect(textWidth(line.text, 15), `line "${line.text.slice(0, 12)}…" overflows its box`).toBeLessThanOrEqual(box!.w);
    }
  });
});

// structure.md lists spanning-cell growth under slice 1, but growth requires
// a wrapped cell, and slice 1 never narrows a column below its natural width
// — nothing wraps until the slice-2 shrink exists. Flagged to the
// orchestrator as a structure defect; the test itself is unchanged in
// intent, exercised through a post-shrink narrow column.
describe('layoutPixels spanning-cell growth (slice 2)', () => {
  it('grows only the last spanned row when a wrapped op outgrows its rows', () => {
    // A rowSpan-2 op whose label wraps to many lines after the shrink: rows
    // aa and bb are spanned, row cc is the unspanned control. Only bb — the
    // last row of the span — absorbs the deficit (render-text.ts:125-137).
    const longLabel = 'gently reduce the sauce, stirring all the while, '.repeat(15).trim();
    expect(6 + 2 + 240 + textWidth(longLabel, 15)).toBeGreaterThan(1180);

    const grid: Grid = {
      cells: [
        { text: 'aa', row: 0, col: 0, rowSpan: 1, colSpan: 1, kind: 'ingredient' },
        { text: 'bb', row: 1, col: 0, rowSpan: 1, colSpan: 1, kind: 'ingredient' },
        { text: 'cc', row: 2, col: 0, rowSpan: 1, colSpan: 1, kind: 'ingredient' },
        { text: longLabel, row: 0, col: 1, rowSpan: 2, colSpan: 1, kind: 'op' },
        { text: 'zz', row: 2, col: 1, rowSpan: 1, colSpan: 1, kind: 'op' },
      ],
      rows: 3,
      cols: 2,
    };

    const p = layoutPixels(grid);
    const aa = boxWithLine(p, 'aa');
    const bb = boxWithLine(p, 'bb');
    const cc = boxWithLine(p, 'cc');
    const spanning = boxWithText(p, 'gently reduce');
    expect(aa).toBeDefined();
    expect(bb).toBeDefined();
    expect(cc).toBeDefined();
    expect(spanning).toBeDefined();

    // The spanning cell wrapped: growth is real, not vacuous.
    expect(spanning!.lines.length).toBeGreaterThanOrEqual(2);
    // Unspanned rows keep the minimal height; only the last spanned row grew.
    expect(cc!.h).toBeCloseTo(aa!.h, 6);
    expect(bb!.h).toBeGreaterThan(aa!.h);
    // The span still tiles: it opens with aa's row and closes with bb's.
    expect(spanning!.y).toBeCloseTo(aa!.y, 6);
    expect(spanning!.y + spanning!.h).toBeCloseTo(bb!.y + bb!.h, 6);
  });
});
