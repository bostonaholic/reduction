/**
 * Acceptance tests for the dependency-free PDF writer (slice 4).
 *
 * renderPdf(grid) is pure — Grid in, { bytes, scale } out — and hand-writes
 * a single-page PDF: %PDF- header, xref byte-offset table, base-14 Helvetica
 * with WinAnsi encoding, and a y-flip from SVG's top-left origin to PDF's
 * bottom-left one. The coordinate cross-check is the one-engine proof: the
 * same wrapped line, selected by its text content in both formats, satisfies
 * x_pdf = x_svg and y_pdf = H − y_svg — plus exactly one hand-computed
 * anchor. (Selecting "the first <text>" would be an iteration accident:
 * image.ts:127-139 emits all rects before all texts.)
 */

import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { layout } from '../../src/core/layout.js';
import { layoutPixels } from '../../src/core/pixel-layout.js';
import { renderPdf } from '../../src/core/render-pdf.js';
import { renderSvg } from '../../src/core/render-svg.js';
import type { Grid, Ingredient, Recipe, RecipeNode } from '../../src/core/types.js';

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

/** PDF bytes as a string where one char is one byte, so indexes are offsets. */
function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

/** The four MediaBox numbers, or null when none is present. */
function mediaBox(pdf: string): number[] | null {
  const m = pdf.match(/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
  return m && [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}

const tinyBake = layout(
  recipeWith('Tiny Bake', op('bake', op('mix', ing('flour'), ing('sugar')))),
);

describe('renderPdf document structure (slice 4)', () => {
  it('starts with %PDF- and ends with %%EOF', () => {
    const pdf = latin1(renderPdf(tinyBake).bytes);
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('points every xref offset at its object header', () => {
    const pdf = latin1(renderPdf(tinyBake).bytes);
    const table = pdf.match(/xref\r?\n0 (\d+)\r?\n([\s\S]*?)trailer/);
    expect(table, 'the PDF must contain an xref table').not.toBeNull();
    const count = Number(table![1]);
    expect(count).toBeGreaterThan(1);
    const entries = table![2].trim().split(/\r?\n/);
    expect(entries).toHaveLength(count);
    // Entry 0 is the free-list head; every real object's offset must land
    // exactly on its "N 0 obj" header.
    for (let index = 1; index < entries.length; index++) {
      const offset = Number(entries[index].slice(0, 10));
      const header = `${index} 0 obj`;
      expect(pdf.slice(offset, offset + header.length), `xref entry ${index}`).toBe(header);
    }
  });

  it('sets MediaBox to the geometry at scale 1 for a small grid', () => {
    const { bytes, scale } = renderPdf(tinyBake);
    expect(scale).toBe(1);
    const p = layoutPixels(tinyBake);
    expect(p.width).toBeGreaterThan(0);
    const box = mediaBox(latin1(bytes));
    expect(box, 'the PDF must declare a MediaBox').not.toBeNull();
    expect(box![0]).toBe(0);
    expect(box![1]).toBe(0);
    expect(Math.abs(box![2] - p.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(box![3] - p.height)).toBeLessThanOrEqual(1);
  });

  it('keeps cell text findable in the raw bytes', () => {
    const pdf = latin1(renderPdf(tinyBake).bytes);
    expect(pdf).toContain('flour');
    expect(pdf).toContain('sugar');
    expect(pdf).toContain('mix');
    expect(pdf).toContain('bake');
  });
});

describe('renderPdf text encoding (slice 4)', () => {
  it('escapes ( ) \\ in string literals', () => {
    const grid = layout(
      recipeWith('Escapes', op('mix (gently) with \\ care', ing('flour'))),
    );
    const pdf = latin1(renderPdf(grid).bytes);
    expect(pdf).toContain(String.raw`\(gently\)`);
    expect(pdf).toContain(String.raw`with \\ care`);
  });

  it('encodes WinAnsi: in-set code points survive, out-of-set ones become ?', () => {
    const grid = layout(recipeWith('Fractions', op('mix', ing('⅓ cup milk'), ing('½ cup cream'))));
    const pdf = latin1(renderPdf(grid).bytes);
    // ⅓ is outside WinAnsi (decision 16): a visible ?, not a dropped byte.
    expect(pdf).toContain('? cup milk');
    // ½ is CP1252 0xBD and must survive as itself.
    expect(pdf).toContain('½ cup cream');
  });
});

describe('renderPdf oversize page (slice 4)', () => {
  // 400 single-line ingredient rows: ~40px each plus borders, far past the
  // 14,400pt page limit in height while staying one floor-width column wide.
  const tall: Grid = {
    cells: Array.from({ length: 400 }, (_, i) => ({
      text: `item ${i}`,
      row: i,
      col: 0,
      rowSpan: 1,
      colSpan: 1,
      kind: 'ingredient' as const,
    })),
    rows: 400,
    cols: 1,
  };

  it('scales the drawing down to the 14,400pt page limit and reports scale < 1', () => {
    const p = layoutPixels(tall);
    expect(p.height).toBeGreaterThan(14_400); // precondition: genuinely oversize
    const { bytes, scale } = renderPdf(tall);
    expect(scale).toBeLessThan(1);
    expect(scale).toBeGreaterThan(0); // s_pdf has no lower floor, but never hits zero
    expect(scale).toBeCloseTo(14_400 / p.height, 6);

    // The invariant: MediaBox equals the post-scale geometry.
    const box = mediaBox(latin1(bytes));
    expect(box).not.toBeNull();
    expect(Math.abs(box![3] - 14_400)).toBeLessThanOrEqual(1);
    expect(Math.abs(box![2] - p.width * scale)).toBeLessThanOrEqual(1);
  });
});

describe('renderPdf and renderSvg share one geometry engine (slice 4)', () => {
  const grid = layout(recipeWith('', ing('flour')));

  /** The SVG <text> holding exactly `content`, selected by content. */
  function svgLine(content: string): { x: number; y: number } | null {
    const dom = new JSDOM(`<!doctype html><html><body>${renderSvg(grid)}</body></html>`);
    const el = [...dom.window.document.querySelectorAll('svg text')].find(
      (t) => t.textContent === content,
    );
    if (!el) return null;
    return { x: Number(el.getAttribute('x')), y: Number(el.getAttribute('y')) };
  }

  /** The PDF text-showing op for `(content)`, selected by content. */
  function pdfLine(pdf: string, content: string): { x: number; y: number } | null {
    const m = pdf.match(
      new RegExp(String.raw`([\d.]+)\s+([\d.]+)\s+T[md]\s*\(${content}\)\s*Tj`),
    );
    return m && { x: Number(m[1]), y: Number(m[2]) };
  }

  it('places the same wrapped line at x_pdf = x_svg and y_pdf = H − y_svg', () => {
    const svg = svgLine('flour');
    expect(svg, 'the SVG must contain a <text> whose content is "flour"').not.toBeNull();

    const { bytes, scale } = renderPdf(grid);
    expect(scale).toBe(1);
    const pdf = pdfLine(latin1(bytes), 'flour');
    expect(pdf, 'the PDF must show (flour) with Tm/Td coordinates').not.toBeNull();

    const H = layoutPixels(grid).height;
    expect(H).toBeGreaterThan(0);
    // Both sides serialize at one decimal, so allow two roundings of drift.
    expect(Math.abs(pdf!.x - svg!.x)).toBeLessThan(0.11);
    expect(Math.abs(pdf!.y - (H - svg!.y))).toBeLessThan(0.11);
  });

  it('pins the baseline with the one hand-computed anchor', () => {
    // The single hand-computed anchor (plan slice 4 step 3) — no other
    // literal coordinate appears in these tests. Derivation for the one-cell
    // 'flour' grid: column 0 floors at 240 content px, frame 3px each side,
    // so W = 246. One wrapped line: lineHeight = 15 × 1.35 = 20.25; row
    // content = 20.25 + 2 × PAD(10) = 40.25; H = 3 + 40.25 + 3 = 46.25.
    // Baseline y = top + (h − blockHeight)/2 + 15 × 0.82
    //            = 0 + (46.25 − 20.25)/2 + 12.3 = 25.3.
    // (Centering is symmetric, so measuring from the full framed box or the
    // 40.25px content row gives the same 25.3.)
    const svg = svgLine('flour');
    expect(svg, 'the SVG must contain a <text> whose content is "flour"').not.toBeNull();
    expect(svg!.y).toBeCloseTo(25.3, 3);
  });
});
