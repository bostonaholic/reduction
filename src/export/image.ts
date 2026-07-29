/**
 * SVG and PNG export.
 *
 * Rather than re-implementing table layout, we read the geometry the browser
 * already computed for the rendered table and redraw it. Text is re-wrapped
 * with canvas measurements against each cell's real content width, which keeps
 * the export faithful without needing a layout engine of our own.
 *
 * No external libraries: Manifest V3 forbids remote code, and an SVG with a
 * foreignObject taints a canvas, so neither shortcut is available.
 */

const BORDER = '#3d8b40';
const TEXT = '#16211a';
const PAD = 10;

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

/** A standalone SVG of the table — scalable, tiny, and text stays selectable. */
export function toSvg(table: HTMLTableElement): string {
  const geo = readGeometry(table);
  const style = getComputedStyle(table);
  const family = escapeXml(style.fontFamily);

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(geo.width)}" height="${Math.ceil(geo.height)}" viewBox="0 0 ${Math.ceil(geo.width)} ${Math.ceil(geo.height)}">`,
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
  parts.push('</svg>');
  return parts.join('\n');
}

/** A 2x PNG for pasting into places that will not take an SVG. */
export async function toPng(table: HTMLTableElement, scale = 2): Promise<Blob | null> {
  const geo = readGeometry(table);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(geo.width * scale);
  canvas.height = Math.ceil(geo.height * scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, geo.width, geo.height);

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

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
