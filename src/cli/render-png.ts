/**
 * Grid -> PNG bytes, for the CLI.
 *
 * Rasterizes renderSvg's output with @resvg/resvg-js — the one module
 * allowed to touch that native optional dependency, imported lazily so
 * text/json/html/svg runs never pay for it. `loadResvg` and `fontFile` are
 * the injection seams: run() passes both through RunDeps, so tests stub the
 * module and the failure paths without the native package installed, and
 * supply the font from the source layout the test runner executes in.
 *
 * The shipped Liberation Sans face is mandatory: with loadSystemFonts off
 * and no fontFiles, resvg renders boxes with no text and zero errors
 * (research measured 0 text pixels).
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { layoutPixels } from '../core/pixel-layout.js';
import { renderSvg } from '../core/render-svg.js';
import type { Grid } from '../core/types.js';

/** The slice of the @resvg/resvg-js module renderPng consumes. */
export interface ResvgModule {
  Resvg: new (
    svg: string,
    options?: unknown,
  ) => { render(): { asPng(): Uint8Array } };
}

/**
 * The area clamp bounds the RGBA buffer at MAX_PIXELS × 4 B ≈ 268 MB for
 * any shape — a per-side bound would not be a memory bound.
 */
const MAX_PIXELS = 64 * 2 ** 20;

/**
 * The named area-clamp rule s_png = min(2, sqrt(MAX_PIXELS / (w × h))):
 * the extension's 2× export scale until the output area would pass 64 Mpx,
 * then exactly the scale that pins it there. Deliberately no lower floor —
 * and none may be added later: any floor silently reopens the
 * unbounded-memory hole this clamp exists to close.
 */
export function pngScale(w: number, h: number): number {
  return Math.min(2, Math.sqrt(MAX_PIXELS / (w * h)));
}

let resvgModule: Promise<ResvgModule> | undefined;

/** Memoized lazy import of @resvg/resvg-js; the seam's default. */
export function loadResvg(): Promise<ResvgModule> {
  resvgModule ??= import('@resvg/resvg-js') as Promise<ResvgModule>;
  return resvgModule;
}

/**
 * The shipped font, resolved relative to the built bundle: from dist/cli.mjs
 * the asset sits one level up (the font stays out of dist/). Deliberately
 * the only path probed — a fallback candidate resolved from other layouts
 * would land on a sibling of the checkout, where anyone able to write next
 * to the repo could plant a TTF. Callers running off the dist layout (the
 * test runner executes this module from src/cli/) pass their own path via
 * renderPng's fontFile parameter instead. Missing (a bundle copied out of
 * its checkout) throws with the path named — absolute, because the reader's
 * problem is finding what was probed on their disk — which the guarded
 * render block in run() turns into exit 1.
 */
function defaultFontPath(): string {
  const path = fileURLToPath(
    new URL('../assets/fonts/LiberationSans-Regular.ttf', import.meta.url),
  );
  if (!existsSync(path)) {
    throw new Error(`font not found at ${path} (is the bundle outside its repo checkout?)`);
  }
  return path;
}

/** Rasterize the diagram; `scale` is the applied s_png (2 unless clamped). */
export async function renderPng(
  grid: Grid,
  load: () => Promise<ResvgModule> = loadResvg,
  fontFile: string = defaultFontPath(),
): Promise<{ bytes: Uint8Array; scale: number }> {
  const { Resvg } = await load();
  const geo = layoutPixels(grid);
  const scale = pngScale(Math.ceil(geo.width), Math.ceil(geo.height));
  const renderer = new Resvg(renderSvg(grid, geo), {
    fitTo: { mode: 'zoom', value: scale },
    font: {
      loadSystemFonts: false,
      fontFiles: [fontFile],
      defaultFontFamily: 'Liberation Sans',
    },
  });
  return { bytes: renderer.render().asPng(), scale };
}
