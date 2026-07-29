/**
 * Tests for text sanitization in extraction.
 *
 * Page text reaches terminals and agent transcripts verbatim, so plainText
 * must drop C0/C1 control characters — an ANSI escape sequence in a recipe
 * field could repaint the screen or forge output. Whitespace controls
 * (\t \n \r \v \f) are exercised too: they collapse to single spaces.
 */

import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { extractRecipe, plainText } from '../../src/core/extract.js';

const ESC = '\u001b';
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

describe('plainText control characters', () => {
  it('strips ANSI escape sequences', () => {
    expect(plainText(`mix ${ESC}[2J${ESC}[31mred${ESC}[0m dye`)).toBe('mix [2J[31mred[0m dye');
  });

  it('strips C0 controls, DEL, and C1 controls', () => {
    expect(plainText('a\u0000b\u0007c\u007Fd\u009Be')).toBe('abcde');
  });

  it('strips control characters smuggled in as numeric entities', () => {
    expect(plainText('safe &#27;[2J &#x1b;[0m text')).toBe('safe [2J [0m text');
  });

  it('collapses whitespace controls to single spaces', () => {
    expect(plainText('one\ttwo\r\nthree')).toBe('one two three');
  });

  it('keeps the word boundary at a VT or FF, rather than gluing words', () => {
    expect(plainText('1 cup\fsugar')).toBe('1 cup sugar');
    expect(plainText('mix\vwell')).toBe('mix well');
  });
});

describe('extractRecipe size caps', () => {
  it('caps ingredient and step counts so a hostile page cannot build an unbounded tree', () => {
    const html = [
      '<!doctype html><html><head><script type="application/ld+json">',
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Recipe',
        name: 'Bomb',
        recipeIngredient: Array.from({ length: 2000 }, (_, i) => `1 cup item${i}`),
        recipeInstructions: Array.from({ length: 2000 }, (_, i) => ({
          '@type': 'HowToStep',
          text: `Stir in the item${i}.`,
        })),
      }),
      '</script></head><body></body></html>',
    ].join('');
    const doc = new JSDOM(html).window.document;

    const raw = extractRecipe(doc);

    expect(raw.ingredientLines).toHaveLength(500);
    expect(raw.stepTexts).toHaveLength(500);
  });
});

describe('extractRecipe control characters', () => {
  it('never lets an escape sequence through any extracted field', () => {
    const html = [
      `<!doctype html><html><head><title>Backup ${ESC}[2J Title</title>`,
      '<script type="application/ld+json">',
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Recipe',
        name: `Evil ${ESC}]52;c;payload${ESC}\\ Brownies`,
        recipeIngredient: [`1 cup ${ESC}[8m hidden sugar`],
        recipeInstructions: [{ '@type': 'HowToStep', text: `Stir ${ESC}[31m well.` }],
      }),
      '</script></head><body></body></html>',
    ].join('');
    const doc = new JSDOM(html).window.document;

    const raw = extractRecipe(doc);

    const fields = [raw.title, ...raw.ingredientLines, ...raw.stepTexts];
    for (const field of fields) expect(field).not.toMatch(CONTROL);
    expect(raw.title).toBe('Evil ]52;c;payload\\ Brownies');
  });
});
