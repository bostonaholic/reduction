/**
 * Grid -> single-page PDF bytes, for the CLI.
 *
 * Pure, dependency-free, and byte-exact: geometry comes from layoutPixels
 * at 1px = 1pt, text is base-14 /Helvetica with /WinAnsiEncoding (no font
 * file embedded — the width table matches Helvetica's advances, so viewer
 * text lands where the boxes expect), and the writer emits the catalog,
 * pages, page, contents, and font objects with a byte-offset xref table by
 * hand. Code points outside WinAnsi become a visible `?`; a
 * silently dropped byte would not be honest.
 *
 * PDF's origin is bottom-left, so every SVG-space baseline y-flips:
 * y_pdf = H − y_svg.
 */

import { textWidth } from './font-metrics.js';
import { layoutPixels } from './pixel-layout.js';
import type { PixelLayout } from './pixel-layout.js';
import type { Grid } from './types.js';

const FONT_SIZE = 15;
/** Border green #3d8b40 and text ink #16211a as PDF rgb triples. */
const BORDER_RGB = '0.24 0.55 0.25';
const TEXT_RGB = '0.09 0.13 0.10';

/**
 * The page-scale rule s_pdf = min(1, 14400 / max(w, h)), from the 14,400pt
 * PDF page limit — its own rule, distinct from the PNG area clamp s_png,
 * whose memory-bound rationale does not apply here. At the input ceiling
 * (~42,246px wide) s_pdf ≈ 0.34 and 15px text lands near 5px — a smudge,
 * but an honest one: the caller reports the applied scale. Deliberately no
 * lower floor. The invariant: the MediaBox equals the post-scale geometry.
 * One edge of that: the short side scales with the drawing, so a hostile
 * table with a past-4800:1 aspect ratio (~9M characters in one cell) puts
 * it under the 3pt minimum page size strict viewers enforce — accepted;
 * a floor would break the invariant, and the artifact is already
 * unreadable at that shape.
 */
const MAX_PAGE_POINTS = 14_400;

/**
 * CP1252's C1 block: the non-Latin-1 code points WinAnsi can encode.
 * Latin-1 (U+00A0-U+00FF) passes through byte-identical.
 */
const CP1252 = new Map<number, number>([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

/** One coordinate, serialized at one decimal like the SVG side. */
function n1(value: number): string {
  return value.toFixed(1);
}

/**
 * `(text)` as a WinAnsi string literal: one byte per code point, `\( \) \\`
 * escaped, anything WinAnsi cannot encode as `?`. Each char of the result
 * is one byte (latin1 convention), so string indexes stay byte offsets.
 */
function literal(text: string): string {
  let out = '(';
  for (const char of text) {
    const code = char.codePointAt(0)!;
    const byte =
      (code >= 32 && code <= 126) || (code >= 0xa0 && code <= 0xff)
        ? code
        : (CP1252.get(code) ?? 0x3f);
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += '\\';
    out += String.fromCharCode(byte);
  }
  return `${out})`;
}

/** The drawing ops in the SVG's element order: cell rects, text, frame. */
function contentStream(geo: PixelLayout, scale: number): string {
  const H = geo.height;
  const parts: string[] = [];
  // One uniform transform; everything after draws in layout units.
  if (scale !== 1) parts.push(`${scale.toFixed(6)} 0 0 ${scale.toFixed(6)} 0 0 cm`);

  parts.push(`${BORDER_RGB} RG`, '2 w');
  for (const box of geo.boxes) {
    parts.push(`${n1(box.x)} ${n1(H - box.y - box.h)} ${n1(box.w)} ${n1(box.h)} re S`);
  }

  parts.push(`${TEXT_RGB} rg`, 'BT', `/F1 ${FONT_SIZE} Tf`);
  for (const box of geo.boxes) {
    for (const line of box.lines) {
      // PDF has no text-anchor: a centered line starts half its width left
      // of the SVG anchor point. The width table is Helvetica's advances,
      // so the arithmetic is the viewer's.
      const x =
        line.anchor === 'middle' ? line.x - textWidth(line.text, FONT_SIZE) / 2 : line.x;
      parts.push(`1 0 0 1 ${n1(x)} ${n1(H - line.y)} Tm ${literal(line.text)} Tj`);
    }
  }
  parts.push('ET');

  parts.push('3 w', `1.5 1.5 ${n1(geo.width - 3)} ${n1(geo.height - 3)} re S`);
  return parts.join('\n');
}

export function renderPdf(grid: Grid): { bytes: Uint8Array; scale: number } {
  const geo = layoutPixels(grid);
  const scale = Math.min(1, MAX_PAGE_POINTS / Math.max(geo.width, geo.height));
  const content = contentStream(geo, scale);

  // The invariant: the MediaBox equals the post-scale geometry.
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${(geo.width * scale).toFixed(2)} ${(geo.height * scale).toFixed(2)}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  // One char = one byte throughout (latin1 convention), so the string's
  // indexes are the xref's byte offsets.
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return { bytes, scale };
}
