/**
 * Acceptance tests for the Helvetica width table (slice 1).
 *
 * The contract (design decision 3, review note 2): every width is stored in
 * 1000-unit em space — the AFM convention — and textWidth(text, fontSize)
 * sums per-code-point widths and multiplies by fontSize / 1000. Nothing in
 * the module is "at 15px". Asserting the unit directly is what catches a
 * 15× or 1/15 scaling bug before it reaches every renderer.
 */

import { describe, expect, it } from 'vitest';
import { textWidth } from '../../src/core/font-metrics.js';

/**
 * The exactly-eleven non-ASCII entries the pipeline emits (plan slice 1
 * step 2), in 1000-unit em space. `nbsp` decodes to a plain ASCII space
 * (extract.ts:36-40), so there is no twelfth entry.
 */
const NON_ASCII: ReadonlyArray<[string, number]> = [
  ['–', 556],
  ['—', 1000],
  ['…', 1000],
  ['’', 222],
  ['‘', 222],
  ['“', 333],
  ['”', 333],
  ['°', 400],
  ['½', 834],
  ['¼', 834],
  ['¾', 834],
];

describe('textWidth unit convention (slice 1)', () => {
  it('stores every width in 1000-unit em space: at fontSize 1000 the result is the raw table entry', () => {
    for (const [char, units] of NON_ASCII) {
      expect(textWidth(char, 1000), `width of ${char}`).toBe(units);
    }
  });

  it('scales by fontSize / 1000, so 1000 em-units render as exactly fontSize pixels', () => {
    // 15px — not 15,000 (units × fontSize) and not 0.015 (divided twice).
    expect(textWidth('—', 15)).toBe(15);
    expect(textWidth('–', 15)).toBeCloseTo((556 * 15) / 1000, 9);
    // Doubling the font size doubles the width; nothing is baked in at 15px.
    expect(textWidth('–', 30)).toBeCloseTo(2 * textWidth('–', 15), 9);
  });
});

describe('textWidth ASCII advances (slice 1)', () => {
  it('carries the Helvetica AFM advances for ASCII 32–126', () => {
    // Spot checks across the width range; the one-time hmtx comparison in
    // plan slice 1 step 3 covers all 95 entries against the shipped TTF.
    expect(textWidth(' ', 1000)).toBe(278);
    expect(textWidth('i', 1000)).toBe(222);
    expect(textWidth('a', 1000)).toBe(556);
    expect(textWidth('0', 1000)).toBe(556);
    expect(textWidth('M', 1000)).toBe(833);
    expect(textWidth('W', 1000)).toBe(944);
  });

  it('sums per-code-point widths across a string', () => {
    expect(textWidth('Mi', 1000)).toBe(833 + 222);
    // ½(834) space(278) c(500) u(556) p(556), scaled to 15px.
    expect(textWidth('½ cup', 15)).toBeCloseTo(((834 + 278 + 500 + 556 + 556) * 15) / 1000, 9);
  });
});

describe('textWidth fallback (slice 1)', () => {
  it('measures any code point outside the table at 1.0 em', () => {
    // ⅓ survives into banner and op cells (normalizeText runs only on
    // ingredient lines), and é-class accented Latin is deliberately absent
    // from the table (note 4): both fall back to 1.0 em — padding, never
    // overflow.
    expect(textWidth('⅓', 15)).toBe(15);
    expect(textWidth('é', 15)).toBe(15);
  });

  it('counts an astral code point once, not per UTF-16 unit', () => {
    expect(textWidth('🍰', 15)).toBe(15);
  });
});
