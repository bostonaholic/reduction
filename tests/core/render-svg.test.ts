/**
 * Acceptance tests for the pure SVG renderer.
 *
 * renderSvg(grid) is pure — Grid in, one SVG string out — and emits the
 * extension's export grammar (src/export/image.ts:117-146): background rect,
 * one rect per cell, one <text> per wrapped line, outer 3px frame last, with
 * the metric-compatible font stack. Structure is asserted on the jsdom-parsed
 * document; sizes are asserted as relations to layoutPixels, never literals.
 */

import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { layout } from '../../src/core/layout.js';
import { layoutPixels } from '../../src/core/pixel-layout.js';
import { renderSvg } from '../../src/core/render-svg.js';
import type { Ingredient, Recipe, RecipeNode } from '../../src/core/types.js';

const BORDER = '#3d8b40';
const TEXT = '#16211a';

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

function parseSvg(markup: string): SVGElement | null {
  const dom = new JSDOM(`<!doctype html><html><body>${markup}</body></html>`);
  return dom.window.document.querySelector('svg');
}

describe('renderSvg structure', () => {
  const grid = layout(recipeWith('Tiny Bake', op('bake', op('mix', ing('flour'), ing('sugar')))));

  it('sizes the root to the pixel layout', () => {
    const root = parseSvg(renderSvg(grid));
    expect(root, 'renderSvg must emit an <svg> root').not.toBeNull();
    const p = layoutPixels(grid);
    expect(p.width).toBeGreaterThan(0); // guard the relation against 0 === 0
    expect(Number(root!.getAttribute('width'))).toBe(Math.ceil(p.width));
    expect(Number(root!.getAttribute('height'))).toBe(Math.ceil(p.height));
  });

  it('draws a background rect, one rect per cell, and the outer 3px frame last', () => {
    const root = parseSvg(renderSvg(grid));
    expect(root).not.toBeNull();
    const rects = [...root!.querySelectorAll('rect')];
    expect(rects).toHaveLength(grid.cells.length + 2);

    const background = rects[0];
    expect(background.getAttribute('width')).toBe('100%');
    expect(background.getAttribute('fill')).toBe('#ffffff');

    for (const rect of rects.slice(1, -1)) {
      expect(rect.getAttribute('stroke')).toBe(BORDER);
      expect(rect.getAttribute('stroke-width')).toBe('2');
    }

    const frame = rects[rects.length - 1];
    expect(frame.getAttribute('fill')).toBe('none');
    expect(frame.getAttribute('stroke')).toBe(BORDER);
    expect(frame.getAttribute('stroke-width')).toBe('3');
  });

  it('emits one text element per wrapped line, between the cell rects and the frame', () => {
    const root = parseSvg(renderSvg(grid));
    expect(root).not.toBeNull();
    const expectedLines = layoutPixels(grid).boxes.flatMap((box) => box.lines.map((l) => l.text));
    expect(expectedLines.length).toBeGreaterThan(0);

    const texts = [...root!.querySelectorAll('text')];
    expect(texts.map((t) => t.textContent)).toEqual(expectedLines);

    // The image.ts element order: background, cell rects, texts, frame.
    const tags = [...root!.children].map((el) => el.tagName.toLowerCase());
    expect(tags).toEqual([
      'rect',
      ...grid.cells.map(() => 'rect'),
      ...expectedLines.map(() => 'text'),
      'rect',
    ]);
  });

  it('stamps the metric-compatible font stack on every text element', () => {
    const root = parseSvg(renderSvg(grid));
    expect(root).not.toBeNull();
    const texts = [...root!.querySelectorAll('text')];
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      expect(text.getAttribute('font-family')).toBe('Liberation Sans, Helvetica, Arial, sans-serif');
      expect(text.getAttribute('font-size')).toBe('15');
      expect(text.getAttribute('fill')).toBe(TEXT);
    }
  });
});

describe('renderSvg escaping', () => {
  it('XML-escapes & < > " in cell text and round-trips it through a parser', () => {
    const nasty = 'Bob\'s "hot & spicy" <peppers>';
    const markup = renderSvg(layout(recipeWith('Escape', op('mix', ing(nasty)))));
    expect(markup).toContain('&quot;hot &amp; spicy&quot; &lt;peppers&gt;');

    const root = parseSvg(markup);
    expect(root).not.toBeNull();
    const texts = [...root!.querySelectorAll('text')].map((t) => t.textContent);
    expect(texts).toContain(nasty);
  });
});
