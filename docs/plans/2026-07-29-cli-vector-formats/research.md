---
topic: 2026-07-29-cli-vector-formats
date: 2026-07-29
phase: research
---

# Research — `--format svg|png|pdf` for the CLI

Merged from two agents: one over this codebase, one evaluating Node libraries
empirically (real installs, measured weights, pixel counts).

## The governing constraint

`src/export/image.ts` contains **no layout algorithm**. `readGeometry`
(`image.ts:68-106`) reads `table.getBoundingClientRect()` and each `td`'s rect —
the browser computed every column width and row height. jsdom returns all-zero
rects and has no canvas, so `toSvg` cannot be reused from the CLI. The new
renderers must compute geometry themselves.

## What is portable from `src/export/image.ts`

Pure and reusable (currently module-private, would need exporting or porting):

- `wrap` (`:49-66`) — greedy word wrap; no hard-break of long words
- `escapeXml` (`:108-114`)
- The SVG string assembly and the vertical-centering / baseline math
- Constants: `BORDER = '#3d8b40'`, `TEXT = '#16211a'`, `PAD = 10` (`:13-15`)

Irreducibly browser-bound: `readGeometry`'s rect reads and `measurer`'s canvas
`measureText` (`:40-46`, fallback `text.length * 7`).

### The SVG `toSvg` emits (`image.ts:117-146`), in order

1. `<svg xmlns=… width height viewBox="0 0 W H">`
2. `<rect width="100%" height="100%" fill="#ffffff"/>`
3. per box: `<rect … fill="#ffffff" stroke="#3d8b40" stroke-width="2"/>`
4. per line: `<text x y text-anchor font-family font-size fill="#16211a">…</text>`
5. outer frame: `<rect x="1.5" y="1.5" width="W-3" height="H-3" fill="none" stroke="#3d8b40" stroke-width="3"/>`

Coordinates are `toFixed(1)`. Layout details: `lineHeight = fontSize * 1.35`;
`rd-ingredient` cells left-aligned at `x + PAD`, all others centered at
`x + w/2`; block baseline `top = y + (h - blockHeight)/2 + fontSize * 0.82`;
wrap width `max(cellWidth - PAD*2, 20)`.

`toPng` (`:150-183`) redraws the same geometry to a canvas at 2× and returns a
`Blob` — entirely browser-dependent. Note it insets rects (`strokeRect(x+1, y+1,
w-2, h-2)`) where the SVG does not.

## The reusable algorithm: `src/core/render-text.ts`

This already solves "geometry from a `Grid` without a browser", in character
units. The pipeline ports to pixels by swapping the measurer and the border terms:

- `columnWidths` (`:67-93`) — natural width per column from `colSpan === 1`
  cells; spanning cells distribute their deficit round-robin across their
  columns, capped at table width; then shrink the widest column until it fits,
  floor `MIN_COL_WIDTH`
- `contentWidth` (`:96-100`) — spanned column widths plus `colSpan-1` interior borders
- Row heights (`:125-137`) — `rowSpan === 1` cells set the floor; a spanning cell
  counts interior border lines as usable and grows only its **last** row
- Prefix sums give border-line coordinates (`:141-144`)

Text-specific and not portable: the `MAX_CANVAS_SLOTS` guard and junction drawing.

## Grid contract (`src/core/types.ts:74-91`)

`CellKind = 'banner' | 'ingredient' | 'op' | 'filler'`.
`Cell {text, row, col, rowSpan, colSpan, kind}`; `Grid {cells, rows, cols}`.

0-based; col 0 is ingredients; rows are DFS leaf order. A cell occupies
`[row, row+rowSpan)` × `[col, col+colSpan)`. Banners come first, one per row at
`col: 0, colSpan: totalCols` (`layout.ts:91-100`). `validateGrid`
(`layout.ts:196-221`) guarantees the grid exactly tiles its rectangle — no
overlaps, no holes. `cellsByRow` (`:184-189`) groups by starting row.

## The extension's exact look (`src/content/overlay.css:123-164`)

| Property | Value |
| --- | --- |
| Outer border | 3px solid `#3d8b40` |
| Cell border | 2px solid `#3d8b40` |
| Text | `#16211a`, 15px |
| Font stack | `"Helvetica Neue", Helvetica, Arial, sans-serif` (`overlay.css:18`) |
| Line height | 1.35 |
| Cell padding | 7px vertical, 10px horizontal |
| `.rd-banner` | centered, `font-weight: 500` |
| `.rd-ingredient` | left, `min-width: 220px` |
| `.rd-op` | centered, `font-weight: 500`, `min-width: 62px` |

Note the existing divergence: CSS uses 7px/10px padding while `image.ts` uses a
uniform `PAD = 10`, so the extension's SVG export already differs slightly from
its own overlay.

## Library findings (measured, not quoted)

Reference point: the existing `jsdom` dependency is **9 MB**.

### PNG rasterization

| | Install (macOS arm64) | Linux prebuilt | esbuild | License | Latest stable |
| --- | --- | --- | --- | --- | --- |
| **`@resvg/resvg-js`** | **4 MB**, 11 files | ✅ 4.2 MB | must be `external` | MPL-2.0 | 2.6.2 (2024-03-26) |
| `sharp` | 28 MB, 164 files | ✅ | bundles but crashes without a `createRequire` banner | Apache-2.0 | 0.35.3 (2026-07-01) |
| `@napi-rs/canvas` | 27 MB, 14 files | ✅ | must be `external` | MIT | 1.0.3 (2026-07-28) |
| `skia-canvas` | — | ⚠️ downloads binary at install | external | MIT | 3.0.8 (2025-09-25) |
| `canvas` | — | ⚠️ source-build fallback | external | MIT | 3.2.3 (2026-03-31) |

**The decisive measurement** — dark pixels in the text band of a rendered
`<text font-family="Helvetica, Arial, sans-serif">`:

| Config | Text pixels | Time |
| --- | --- | --- |
| resvg default (`loadSystemFonts: true`) | 326 ✅ | 1091–2026 ms |
| resvg, 2nd instance, same process | 326 ✅ | 1091 ms (**not cached**) |
| resvg `loadSystemFonts: false` | **0 — text silently vanishes** | 3 ms |
| resvg `fontFiles: [Arial.ttf]` + `defaultFontFamily` | 337 ✅ | **1.9 ms** |
| sharp | 329 ✅ | — |
| `@napi-rs/canvas` `loadImage(svg)` | 211 (different fallback font) | — |

Three consequences:

1. resvg rasterizes `<text>` faithfully — no text-to-path conversion needed.
2. The system-font scan costs ~1.1 s and is **not** cached across instances.
3. `loadSystemFonts: false` drops text **with no error** — a fail-silent trap.
   `fontFiles` + `defaultFontFamily` is correct, 570× faster, and deterministic
   across macOS and Linux.

Rejected: `skia-canvas` (network fetch at install, no offline story, 10 months
stale); `canvas` (source-build fallback needs cairo/pango headers);
pure-JS rasterizers (`canvg` needs a DOM; `svg2png-wasm` last published 2023).

**CI hazard is fonts, not binaries.** Prebuilts exist for `ubuntu-latest` (x64)
and `macos-latest` (arm64) for every surviving candidate. But macOS and Linux
font sets differ, so any golden PNG test diverges across OS unless a font file is
pinned — an argument for `fontFiles` regardless of engine.

**resvg staleness, stated plainly:** stable 2.6.2 is 28 months old. The repo was
pushed 2026-06-30, `2.7.0-alpha.2` shipped 2026-01-28, ~2M weekly downloads.
Stalled on releases, not dead. MPL-2.0 is file-level copyleft — consuming it
unmodified imposes nothing on MIT code.

### PDF generation

| | Install | Files | Deps | esbuild | Latest | Repo pushed |
| --- | --- | --- | --- | --- | --- | --- |
| **hand-written** | **0 MB** | 0 | 0 | trivial | — | — |
| `pdfkit` | 23 MB | 1195 | 6 | needs `createRequire` banner | 0.19.1 (2026-06-10) | 2026-07-26 ✅ |
| `pdf-lib` | 26 MB | 1643 | 4 | bundles cleanly | 1.17.1 (**2021-11-06**) | 2024-07-17 ⚠️ |
| `jspdf` | — | — | 3 | node export exists | 4.2.1 (2026-03-17) | 2026-07-24 ✅ |
| `svg-to-pdfkit` | — | — | pdfkit | CJS | 0.1.8 (**2019-11-24**) | 65 open issues ⚠️ |

**None consume SVG natively** — all require the drawing re-expressed in their own
API. That constraint is weak here: the geometry exists *before* it becomes an SVG
string, so re-expressing it is a direct mapping, not an SVG-parsing problem.

Base-14 metrics work with no embedded font, and the two libraries agree exactly:
`widthOfString('Butter, softened') @16pt` = **112.16** in both pdfkit and pdf-lib.
Output carries `/BaseFont /Helvetica`, `/Encoding /WinAnsiEncoding`, no
`FontFile`. Text stays selectable — the content stream is hex-encoded WinAnsi
(`427574746572` = `Butter`) which every reader extracts normally.

**A hand-written PDF was built and validated.** 40 lines (43 with comments), zero
dependencies, 930-byte output. Parsed independently by `pdf-lib` (1 page,
420×140), rendered by macOS Quick Look, and `Butter, softened` is a literal
searchable string in the raw bytes. Covers: the y-axis flip, `re`/`f`/`S`/`B` for
rects, `m`/`l`/`S` for lines, `BT`/`Tf`/`Tm`/`Tj`/`ET` for text, hex→RGB, string
escaping, the 6-object catalog/pages/page/contents/font structure, and the xref
table (byte offsets are the only fiddly part — one `reduce`).

**Text metrics cost ~10 more lines.** The Helvetica ASCII 32–126 width table is
95 integers, 380 characters as a comma-separated string. Verified against pdfkit:

| String | Hand-rolled | pdfkit | Delta |
| --- | --- | --- | --- |
| `Cream 3 min` | 91.57 | 91.57 | exact |
| `WWWiiillll` | 70.18 | 70.18 | exact |
| `Butter, softened` | 112.96 | 112.16 | 0.80 pt |
| `2 1/2 cups all-purpose flour` | 192.98 | 193.46 | 0.48 pt |

The deltas are kerning, not error (the stream's 50-unit adjustment × 16 pt ÷ 1000
= exactly 0.80 pt). Exact for unkerned advance width, within 0.7% of kerned —
invisible for column layout.

### Recommendation from research

**PNG: `@resvg/resvg-js`, marked `external`, with explicit `fontFiles`.
PDF: hand-written, no dependency.** Net new weight 4 MB, one dependency — under
half what `jsdom` already costs. Refinement: make resvg an `optionalDependency`
and `await import()` it only when `--format png` is passed, so SVG and PDF users
never pay for it.

Accepted tradeoff: a stable release 28 months old, taken because it is a thin
binding over Rust `resvg` doing a narrow job with prebuilts for both CI targets.
Fallback if unacceptable: `sharp` — maintained, 28 MB, more fontconfig-fragile on
Linux. Do **not** take `pdf-lib` (5 years stale) or `svg-to-pdfkit` (7 years stale).

## Integration points

- `src/cli/args.ts:53-58` — `OutputFormat` whitelist
- `src/cli/run.ts:211-213` — format dispatch
- `build.mjs:56` — `external: ['jsdom']`, the only externals escape hatch; a
  native dep needs adding here (no `.node`/`.wasm` loader is configured)
- Binary output: the current CLI writes a string to stdout; PNG and PDF are
  bytes, which the write path must handle

## Test infrastructure

`tests/e2e/golden.spec.ts` compares PNG exports via Playwright's built-in
screenshot diffing against committed, platform-suffixed references — it writes
the exported bytes into a page and calls `toHaveScreenshot`. That pattern is
reusable, but **there is no Node-side pixel-diff library in the repo**.
Structural assertions (`:117-154`) check rows/cols/banner counts independently of
pixels.

## Open questions for design

- Which font file to ship for resvg's `fontFiles`, given licensing. A
  metric-compatible libre face (Liberation Sans is metrically compatible with
  Arial, which shares Helvetica's metrics) would let **one** width table drive SVG
  layout, PNG rasterization, and PDF base-14 text consistently.
- Whether SVG/PNG/PDF go to stdout as bytes or require an output-file flag.
- Whether the golden e2e references need extending, given no Node-side pixel diff.
