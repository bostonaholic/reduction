/**
 * Grid -> standalone SVG, for the CLI.
 *
 * Pure and DOM-free: geometry comes from layoutPixels and the markup follows
 * the extension export's grammar (src/export/image.ts:117-146) — background
 * rect, one rect per cell, one <text> per wrapped line, outer 3px frame
 * last. The font stack (decision 12) leads with Liberation Sans so resvg and
 * Linux viewers hit the shipped metrics-compatible face; macOS falls back to
 * Helvetica and Windows to Arial, both metric-compatible with the width
 * table.
 */

import { layoutPixels } from './pixel-layout.js';
import type { Grid } from './types.js';

const BORDER = '#3d8b40';
const TEXT = '#16211a';
const FONT_FAMILY = 'Liberation Sans, Helvetica, Arial, sans-serif';
const FONT_SIZE = 15;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderSvg(grid: Grid): string {
  const geo = layoutPixels(grid);
  const width = Math.ceil(geo.width);
  const height = Math.ceil(geo.height);

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
  ];

  for (const box of geo.boxes) {
    parts.push(
      `<rect x="${box.x.toFixed(1)}" y="${box.y.toFixed(1)}" width="${box.w.toFixed(1)}" height="${box.h.toFixed(1)}" fill="#ffffff" stroke="${BORDER}" stroke-width="2"/>`,
    );
  }

  for (const box of geo.boxes) {
    for (const line of box.lines) {
      parts.push(
        `<text x="${line.x.toFixed(1)}" y="${line.y.toFixed(1)}" text-anchor="${line.anchor}" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE}" fill="${TEXT}">${escapeXml(line.text)}</text>`,
      );
    }
  }

  // A frame matching the table's own outer border.
  parts.push(
    `<rect x="1.5" y="1.5" width="${(geo.width - 3).toFixed(1)}" height="${(geo.height - 3).toFixed(1)}" fill="none" stroke="${BORDER}" stroke-width="3"/>`,
  );
  parts.push('</svg>');
  return parts.join('\n');
}
