import { describe, expect, it } from 'vitest';
import { layout } from '../../src/core/layout.js';
import { printableDocument } from '../../src/export/print.js';
import type { Ingredient, Recipe, RecipeNode } from '../../src/core/types.js';

function ing(name: string, quantity?: number, unit?: string, metric?: string): RecipeNode {
  const ingredient: Ingredient = { raw: name, name, quantity, unit, metric };
  return { kind: 'ingredient', ingredient };
}

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    title: 'Espresso Brownies',
    banners: [],
    root: ing('water', 1, 'cup'),
    yield: '12 brownies',
    sourceUrl: 'https://example.test/brownies',
    extraction: 'json-ld',
    inference: 'heuristic',
    confidence: 1,
    ...overrides,
  };
}

function build(r: Recipe): string {
  return printableDocument(r, layout(r), '');
}

/** The inner markup of the document's single meta paragraph. */
function metaLine(html: string): string {
  const match = html.match(/<p class="rd-doc-meta">(.*?)<\/p>/);
  if (!match) throw new Error('document has no <p class="rd-doc-meta"> paragraph');
  return match[1];
}

describe('printableDocument meta line', () => {
  it('links to the full source url, escaped in both the href and the text', () => {
    const escaped = 'https://example.test/r?a=1&amp;b=&quot;x&quot;';
    const meta = metaLine(build(recipe({ sourceUrl: 'https://example.test/r?a=1&b="x"' })));
    expect(meta).toBe(
      `<a href="${escaped}" target="_blank" rel="noreferrer noopener">${escaped}</a> · 12 brownies`,
    );
  });

  it('drops credential-shaped query parameters but keeps identity ones', () => {
    const meta = metaLine(
      build(recipe({ sourceUrl: 'https://example.test/r?p=123&access_token=abc&recipeId=9' })),
    );
    const escaped = 'https://example.test/r?p=123&amp;recipeId=9';
    expect(meta).toBe(
      `<a href="${escaped}" target="_blank" rel="noreferrer noopener">${escaped}</a> · 12 brownies`,
    );
  });

  it('strips the #fragment but keeps the query, in both the href and the text', () => {
    const meta = metaLine(
      build(recipe({ sourceUrl: 'https://example.test/r?p=1#access_token=abc' })),
    );
    const clean = 'https://example.test/r?p=1';
    expect(meta).toBe(
      `<a href="${clean}" target="_blank" rel="noreferrer noopener">${clean}</a> · 12 brownies`,
    );
  });

  it('shows a javascript: source as plain text with no anchor', () => {
    const meta = metaLine(build(recipe({ sourceUrl: 'javascript:alert(1)' })));
    expect(meta).toBe('javascript:alert(1) · 12 brownies');
  });

  it('shows an unparsable source as plain text without throwing', () => {
    const r = recipe({ sourceUrl: 'not a url' });
    expect(() => build(r)).not.toThrow();
    expect(metaLine(build(r))).toBe('not a url · 12 brownies');
  });

  it('omits the url segment and its separator when the source url is blank', () => {
    const r = recipe({ sourceUrl: '   ' });
    expect(() => build(r)).not.toThrow();
    expect(metaLine(build(r))).toBe('12 brownies');
  });

  it('shows the url anchor alone when the recipe has no yield', () => {
    const meta = metaLine(build(recipe({ yield: undefined })));
    expect(meta).toBe(
      '<a href="https://example.test/brownies" target="_blank" rel="noreferrer noopener">https://example.test/brownies</a>',
    );
  });
});
