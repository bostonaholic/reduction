/**
 * Acceptance tests for the PNG rasterizer.
 *
 * pngScale is the named pure rule s_png = min(2, sqrt(MAX_PIXELS / (w × h)))
 * with MAX_PIXELS = 64 × 2²⁰, bounding the RGBA buffer for any shape; it is
 * tested at its boundaries without rasterizing anything oversize. renderPng
 * takes a `load` seam so tests run without @resvg/resvg-js installed; the
 * tests that need the real rasterizer (magic bytes, IHDR, the ink-count
 * guard against the fail-silent font trap) skip when it is absent — it is an
 * optionalDependency, and the failure paths are covered through the seam in
 * tests/cli/run.test.ts.
 */

import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { layout } from '../../src/core/layout.js';
import { layoutPixels } from '../../src/core/pixel-layout.js';
import { pngScale, renderPng } from '../../src/cli/render-png.js';
import type { Ingredient, Recipe, RecipeNode } from '../../src/core/types.js';

const MAX_PIXELS = 64 * 2 ** 20;

/** The shipped font, passed explicitly: renderPng's default path is
 * dist-relative and does not resolve from src/cli/ under the test runner. */
const FONT_FILE = fileURLToPath(
  new URL('../../assets/fonts/LiberationSans-Regular.ttf', import.meta.url),
);

// A variable specifier keeps the optional package out of static resolution:
// the package is optional, and these tests must skip, not error, when it is
// absent.
const RESVG_PACKAGE = '@resvg/resvg-js';
const resvgAvailable = await import(RESVG_PACKAGE).then(
  () => true,
  () => false,
);

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

/** Pixels in rows [y0, y1) whose r, g and b all sit under 100 — text ink. */
function countDarkPixels(
  bitmap: { pixels: Uint8Array; width: number },
  y0: number,
  y1: number,
): number {
  let dark = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      const at = (y * bitmap.width + x) * 4;
      const px = bitmap.pixels;
      if (px[at] < 100 && px[at + 1] < 100 && px[at + 2] < 100) dark++;
    }
  }
  return dark;
}

describe('pngScale area clamp', () => {
  it('keeps the 2× default up to the 64 Mpx output boundary', () => {
    // A typical diagram is far under the clamp.
    expect(pngScale(1180, 800)).toBe(2);
    // Just under the boundary: 4096 × 4095 at 2× stays below 64 Mpx.
    expect(pngScale(4096, 4095)).toBe(2);
    // Exactly at it: 4096 × 4096 × 2² = 64 Mpx, still exactly 2.
    expect(pngScale(4096, 4096)).toBe(2);
  });

  it('falls below 2 far over the boundary, pinning the output area at 64 Mpx with no lower floor', () => {
    // The design's input ceiling: ~42,246 × ~21,000 ≈ 887 Mpx.
    const w = 42_246;
    const h = 21_000;
    const s = pngScale(w, h);
    expect(s).toBeLessThan(1);
    expect(s).toBeGreaterThan(0); // shrunk, never refused — and no floor
    // The clamp is a memory bound: the output area lands exactly on 64 Mpx.
    expect(w * s * (h * s)).toBeCloseTo(MAX_PIXELS, 3);
  });
});

describe.skipIf(!resvgAvailable)('renderPng rasterization', () => {
  const grid = layout(recipeWith('Tiny Bake', op('bake', op('mix', ing('flour'), ing('sugar')))));

  it('produces PNG magic bytes with IHDR dimensions at 2× the layout', async () => {
    const { bytes, scale } = await renderPng(grid, undefined, FONT_FILE);
    expect(scale).toBe(2);
    expect(Array.from(bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    const p = layoutPixels(grid);
    expect(p.width).toBeGreaterThan(0);
    expect(Math.abs(width - 2 * p.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(height - 2 * p.height)).toBeLessThanOrEqual(1);
  });

  it('rasterizes visible text ink — the fail-silent font trap', async () => {
    // Without fontFiles + defaultFontFamily, resvg renders boxes with no
    // text and zero errors (research measured 0 text pixels). Wrap the real
    // Resvg through the seam so the raw bitmap renderPng configured is
    // inspectable, then demand a floor of dark pixels in the first line's
    // band. Text ink is #16211a; the green borders (#3d8b40) fail the cut.
    const real = (await import(RESVG_PACKAGE)) as { Resvg: new (...args: never[]) => unknown };
    let bitmap: { pixels: Uint8Array; width: number; height: number } | undefined;
    const Capturing = class extends (real.Resvg as new (...args: unknown[]) => {
      render(): { pixels: Uint8Array; width: number; height: number };
    }) {
      override render(): { pixels: Uint8Array; width: number; height: number } {
        const image = super.render();
        bitmap = image;
        return image;
      }
    };

    const { bytes } = await renderPng(grid, async () => ({ Resvg: Capturing }) as never, FONT_FILE);
    expect(bytes.length).toBeGreaterThan(8);
    expect(bitmap, 'renderPng must render through the injected module').toBeDefined();

    const p = layoutPixels(grid);
    const withText = p.boxes.find((box) => box.lines.length > 0);
    expect(withText).toBeDefined();
    const line = withText!.lines[0];
    const s = bitmap!.width / p.width;
    const y0 = Math.max(0, Math.floor((line.y - 15) * s));
    const y1 = Math.min(bitmap!.height, Math.ceil(line.y * s) + 1);
    expect(countDarkPixels(bitmap!, y0, y1), 'no text ink in the first line band').toBeGreaterThan(
      100,
    );
  });
});
