/**
 * SVG and PNG export.
 *
 * Rather than re-implementing table layout, we read the geometry the browser
 * already computed for the rendered table and redraw it. Text is re-wrapped
 * with canvas measurements against each cell's real content width, which keeps
 * the export faithful without needing a layout engine of our own. Below the
 * table, both renderers draw an attribution band carrying the recipe's source
 * URL, truncated to the table's width.
 *
 * No external libraries: Manifest V3 forbids remote code, and an SVG with a
 * foreignObject taints a canvas, so neither shortcut is available.
 */

import { isHttpUrl, sanitizeSourceUrl } from './source-url.js';

const BORDER = '#3d8b40';
const TEXT = '#16211a';
const PAD = 10;

// The attribution band below the frame: the source URL in muted small text.
const BAND_FONT = 12;
const BAND_COLOR = '#6b7268';
// Cap on the characters fed to truncateToWidth, which measures O(n) prefixes:
// a page-controlled URL of unbounded length (history.pushState) could
// otherwise hang the export click. A band wide enough to fit this many
// characters would show a cut that looks complete, so the cut carries its
// own ellipsis (clampBandText below).
const BAND_TEXT_MAX = 300;

interface Line {
  text: string;
  x: number;
  y: number;
  anchor: 'start' | 'middle';
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  lines: Line[];
}

interface Geometry {
  width: number;
  height: number;
  font: string;
  fontSize: number;
  boxes: Box[];
}

function measurer(font: string): (text: string) => number {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return (text) => text.length * 7;
  ctx.font = font;
  return (text) => ctx.measureText(text).width;
}

/** Greedy word wrap — the same algorithm the browser uses for simple text. */
function wrap(text: string, maxWidth: number, width: (s: string) => number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let line = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = `${line} ${words[i]}`;
    if (width(candidate) <= maxWidth) {
      line = candidate;
    } else {
      lines.push(line);
      line = words[i];
    }
  }
  lines.push(line);
  return lines;
}

/**
 * Trim text to fit maxWidth, appending an ellipsis when anything was cut.
 * The width function is injected (the real one needs a canvas) so this
 * stays testable without a DOM — same style as wrap() above.
 */
export function truncateToWidth(
  text: string,
  maxWidth: number,
  width: (s: string) => number,
): string {
  if (!text) return '';
  if (width(text) <= maxWidth) return text;

  for (let end = text.length - 1; end > 0; end--) {
    const candidate = `${text.slice(0, end)}…`;
    if (width(candidate) <= maxWidth) return candidate;
  }
  return '…';
}

/** Bound the band text before it is measured; a real cut is never silent. */
function clampBandText(url: string): string {
  return url.length > BAND_TEXT_MAX ? `${url.slice(0, BAND_TEXT_MAX)}…` : url;
}

function readGeometry(table: HTMLTableElement): Geometry {
  const tableRect = table.getBoundingClientRect();
  const style = getComputedStyle(table);
  const fontSize = parseFloat(style.fontSize) || 15;
  const font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
  const width = measurer(font);
  const lineHeight = fontSize * 1.35;

  const boxes: Box[] = [];

  for (const cell of Array.from(table.querySelectorAll('td'))) {
    const rect = cell.getBoundingClientRect();
    const x = rect.left - tableRect.left;
    const y = rect.top - tableRect.top;
    const centered = !cell.classList.contains('rd-ingredient');
    const content = (cell.textContent ?? '').trim();

    const box: Box = { x, y, w: rect.width, h: rect.height, lines: [] };

    if (content) {
      const wrapped = wrap(content, Math.max(rect.width - PAD * 2, 20), width);
      const blockHeight = wrapped.length * lineHeight;
      const top = y + (rect.height - blockHeight) / 2 + fontSize * 0.82;

      wrapped.forEach((text, index) => {
        box.lines.push({
          text,
          x: centered ? x + rect.width / 2 : x + PAD,
          y: top + index * lineHeight,
          anchor: centered ? 'middle' : 'start',
        });
      });
    }

    boxes.push(box);
  }

  return { width: tableRect.width, height: tableRect.height, font, fontSize, boxes };
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A standalone SVG of the table — scalable, tiny, and text stays selectable.
 * A non-blank sourceUrl is drawn in an attribution band below the table and,
 * when it is an http(s) URL, wrapped in a link.
 */
export function toSvg(table: HTMLTableElement, sourceUrl: string): string {
  const geo = readGeometry(table);
  const style = getComputedStyle(table);
  const family = escapeXml(style.fontFamily);
  const url = sanitizeSourceUrl(sourceUrl);
  // The attribution band extends the output below the frame; the frame
  // itself keeps the table's own height.
  const bandHeight = url ? BAND_FONT + PAD * 2 : 0;
  const outputHeight = Math.ceil(geo.height + bandHeight);

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(geo.width)}" height="${outputHeight}" viewBox="0 0 ${Math.ceil(geo.width)} ${outputHeight}">`,
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
        `<text x="${line.x.toFixed(1)}" y="${line.y.toFixed(1)}" text-anchor="${line.anchor}" font-family="${family}" font-size="${geo.fontSize}" fill="${TEXT}">${escapeXml(line.text)}</text>`,
      );
    }
  }

  // A frame matching the table's own outer border.
  parts.push(
    `<rect x="1.5" y="1.5" width="${(geo.width - 3).toFixed(1)}" height="${(geo.height - 3).toFixed(1)}" fill="none" stroke="${BORDER}" stroke-width="3"/>`,
  );

  if (bandHeight > 0) {
    const truncated = truncateToWidth(
      clampBandText(url),
      Math.max(geo.width - PAD * 2, 20),
      measurer(`${BAND_FONT}px ${style.fontFamily}`),
    );
    const text = `<text x="${(geo.width / 2).toFixed(1)}" y="${(geo.height + PAD + BAND_FONT * 0.82).toFixed(1)}" text-anchor="middle" font-family="${family}" font-size="${BAND_FONT}" fill="${BAND_COLOR}">${escapeXml(truncated)}</text>`;
    // The href carries the full untruncated URL even when the visible band
    // text is ellipsised — truncation is presentation, not redaction.
    parts.push(isHttpUrl(url) ? `<a href="${escapeXml(url)}" rel="noreferrer">${text}</a>` : text);
  }

  parts.push('</svg>');
  return parts.join('\n');
}

/**
 * A 2x PNG for pasting into places that will not take an SVG. A non-blank
 * sourceUrl is drawn in an attribution band below the table — raster output,
 * so text only, no link.
 */
export async function toPng(
  table: HTMLTableElement,
  sourceUrl: string,
  scale = 2,
): Promise<Blob | null> {
  const geo = readGeometry(table);
  const url = sanitizeSourceUrl(sourceUrl);
  // The attribution band extends the output below the frame; the frame
  // itself keeps the table's own height.
  const bandHeight = url ? BAND_FONT + PAD * 2 : 0;
  const outputHeight = geo.height + bandHeight;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(geo.width * scale);
  canvas.height = Math.ceil(outputHeight * scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, geo.width, outputHeight);

  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 2;
  for (const box of geo.boxes) {
    ctx.strokeRect(box.x + 1, box.y + 1, box.w - 2, box.h - 2);
  }

  ctx.fillStyle = TEXT;
  ctx.font = geo.font;
  ctx.textBaseline = 'alphabetic';
  for (const box of geo.boxes) {
    for (const line of box.lines) {
      ctx.textAlign = line.anchor === 'middle' ? 'center' : 'left';
      ctx.fillText(line.text, line.x, line.y);
    }
  }

  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, geo.width - 3, geo.height - 3);

  if (bandHeight > 0) {
    const bandFont = `${BAND_FONT}px ${getComputedStyle(table).fontFamily}`;
    ctx.fillStyle = BAND_COLOR;
    ctx.font = bandFont;
    ctx.textAlign = 'center';
    ctx.fillText(
      truncateToWidth(clampBandText(url), Math.max(geo.width - PAD * 2, 20), measurer(bandFont)),
      geo.width / 2,
      geo.height + PAD + BAND_FONT * 0.82,
    );
  }

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
