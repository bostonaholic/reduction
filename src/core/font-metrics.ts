/**
 * Helvetica advance widths for the pixel layout engine.
 *
 * Every width in this file is stored in 1000-unit em space (the AFM
 * convention); textWidth sums per-code-point widths and multiplies by
 * fontSize / 1000. Nothing here is ever "at 15px".
 *
 * The table holds the 95 Helvetica AFM advances for ASCII 32-126 plus
 * exactly eleven non-ASCII entries — the full set the pipeline itself
 * emits. Entity decoding (extract.ts:36-40) admits the eleven and nothing
 * more: `nbsp` there decodes to a plain ASCII space, so there is no
 * twelfth entry. `°` is both entity-decoded and synthesized by the
 * Fahrenheit-to-Celsius annotation (infer.ts:185-187). Accented Latin
 * (the `é` class, ~556 units) is deliberately absent: the repo's own verb
 * lists carry `sauté`/`purée` (infer.ts:108, :111), and the 1.0 em
 * fallback over-measures such text — padding, never overflow — which is
 * accepted.
 *
 * One-time hmtx verification (plan slice 1 step 3), run 2026-07-29 against
 * the shipped assets/fonts/LiberationSans-Regular.ttf (Liberation fonts
 * release 2.1.5, unitsPerEm 2048): all 106 entries — the 95 ASCII advances
 * and the eleven non-ASCII ones alike — match the font's advances
 * normalized to 1000-unit em space within 1 unit (largest delta 0.2,
 * rounding). The throwaway comparison script was deleted after the run.
 */

/** The Helvetica AFM advances for ASCII 32-126, indexed by codePoint - 32. */
// prettier-ignore
const ASCII_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
  584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
  500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
  500, 334, 260, 334, 584,
];

/** The eleven non-ASCII code points the pipeline emits (see header). */
const NON_ASCII_WIDTHS = new Map<number, number>([
  [0x2013, 556], // – en dash
  [0x2014, 1000], // — em dash
  [0x2026, 1000], // … ellipsis (bannerText appends it, infer.ts:204-207)
  [0x2019, 222], // ’ right single quote
  [0x2018, 222], // ‘ left single quote
  [0x201c, 333], // “ left double quote
  [0x201d, 333], // ” right double quote
  [0x00b0, 400], // ° degree sign
  [0x00bd, 834], // ½
  [0x00bc, 834], // ¼
  [0x00be, 834], // ¾
]);

/**
 * Any code point outside the table measures 1.0 em. Per the AFM no WinAnsi
 * glyph exceeds 1000/1000, so the fallback never under-measures text the
 * PDF can encode; a wider glyph in the SVG/PNG rendering font (an emoji)
 * can overflow its box — accepted (design decision 3).
 */
const FALLBACK_WIDTH = 1000;

/** Width of `text` in pixels at `fontSize`, one advance per code point. */
export function textWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    units +=
      code >= 32 && code <= 126
        ? ASCII_WIDTHS[code - 32]
        : (NON_ASCII_WIDTHS.get(code) ?? FALLBACK_WIDTH);
  }
  return (units * fontSize) / 1000;
}
