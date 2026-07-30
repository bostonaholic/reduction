---
topic: 2026-07-29-cli-vector-formats
date: 2026-07-29
phase: plan
---

# Plan: `--format svg|png|pdf` for the CLI

## Context

Add three CLI output formats sharing one pure pixel-geometry engine ported
from `src/core/render-text.ts`. Slices come from
`docs/plans/2026-07-29-cli-vector-formats/structure.md`; decisions from
`design.md` (revision 4, approved). Stacked on PR #8
(`2026-07-29-cli-and-agent-skill`) — nothing from it is redone. Every slice
adds a `CHANGELOG.md` bullet under `[Unreleased]` and **never runs
`npm run version:bump`**, overriding `CLAUDE.md` (decision 17).

## Slices

### Slice 1: `--format svg` end-to-end

**Acceptance tests** (from structure.md): `tests/core/pixel-layout.test.ts`,
`tests/core/render-svg.test.ts`, `tests/cli/args.test.ts`, `run.test.ts`,
`skill.test.ts` — all specified in step 8.

**Steps:**

1. `assets/fonts/LiberationSans-Regular.ttf` + `assets/fonts/OFL.txt` —
   [sequential] Liberation Sans Regular only (liberationfonts GitHub
   release) plus its OFL 1.1 license verbatim; confirm ~350 KB
   (decision 4). Ships now because step 3 validates the table against it.

2. `src/core/font-metrics.ts` — [sequential] New pure module: one width
   table + `textWidth(text: string, fontSize: number): number`.
   **The unit, pinned in one comment: every width is stored in 1000-unit
   em space (the AFM convention); `textWidth` sums per-code-point widths
   and multiplies by `fontSize / 1000`. Nothing in this file is ever
   "at 15px".** Contents: the 95 Helvetica AFM advances for ASCII
   32–126, plus exactly eleven non-ASCII entries: `–` 556, `—` 1000,
   `…` 1000, `’` 222, `‘` 222, `“` 333, `”` 333, `°` 400, `½` 834,
   `¼` 834, `¾` 834. Any other code point falls back to 1000 (1.0 em).
   Header comments (notes 2, 4, 8):
   `extract.ts:36-40` decodes `nbsp` to plain ASCII space, so exactly
   these eleven; `°` is entity-decoded *and* synthesized at
   `infer.ts:185-187`; accented Latin (`é`-class, ~556 units) is
   deliberately absent — the 1.0 em fallback over-measures it, padding,
   never overflow, accepted (`sauté`/`purée`, `infer.ts:108`, `:111`);
   and the step-3 result.

3. One-time `hmtx` verification — [sequential, after 1–2] Write
   `tools/check-font-metrics.mjs`, stdlib-only: parse `cmap`, `head`, and
   `hmtx` from the shipped TTF, map **every** table code point — all 95
   ASCII and all eleven non-ASCII alike — to its advance, normalize by
   `unitsPerEm` to 1000-unit em space, print table-vs-font per entry,
   fail on any delta ≥ 1 unit (sub-unit drift like the reviewer's `–`
   556.2 is rounding; a whole unit is a wrong entry — the comparison that
   would have caught the round-3 `½ ¼ ¾` 556-vs-834 bug). **Run once by
   hand — not in CI — record the result (date, font version, per-entry
   outcome) in the `font-metrics.ts` header, then delete the script
   before committing** (decision 4: a throwaway check).

4. `src/core/pixel-layout.ts` — [sequential] New pure module:
   `layoutPixels(grid: Grid): PixelLayout` with
   `PixelLayout { width, height, boxes }`, box
   `{ x, y, w, h, kind, lines }`, line `{ text, x, y, anchor }`. Port
   the `render-text.ts` pipeline with `textWidth` as the measurer:
   natural column widths with floors **240px (column 0) / 82px (others)**
   (decision 9); banner deficit distribution (`:77-84`); **no shrink in
   this slice** (`:87-91` is slice 2) — width is the natural/floor
   result; spanned content width (`:96-100`); hard-breaking `wrap` from
   `:27-64` in pixel widths, wrap width `max(contentWidth - PAD*2, 20)`
   (decision 14); row heights, spanning cells growing only their last
   row (`:125-137`), line height `15 * 1.35`; prefix sums to coordinates
   (`:141-148`) with 2px interior borders and a 3px frame each side.
   Text per `image.ts`: `PAD = 10`, baseline
   `top + (h - blockHeight)/2 + fontSize * 0.82`, ingredient cells
   left-anchored at `x + PAD`, others centered.

5. `src/core/render-svg.ts` — [sequential, after 4] Pure
   `renderSvg(grid: Grid): string` emitting the exact `image.ts:117-146`
   order: root, background rect, one rect per box, one `<text>` per
   wrapped line, outer 3px frame last; colors from `image.ts:13-15`;
   coordinates `toFixed(1)`; port `escapeXml` (`image.ts:108-114`);
   `font-family="Liberation Sans, Helvetica, Arial, sans-serif"`
   (decision 12).

6. `src/cli/args.ts` + `src/cli/run.ts` — [sequential, after 5] Add
   `'svg'` to `OutputFormat` and `FORMATS`; **change `const FORMATS`
   (`args.ts:14`) to `export const FORMATS`**; svg line in `USAGE`. The
   svg dispatch arm (`run.ts:210-215`): `renderSvg(grid)` plus trailing
   newline to stdout; `confidenceNote(recipe).text` to stderr — never
   the artifact (decision 15; precedent `run.ts:178-181`).

7. Docs — [parallel] `SKILL.md` invoke line (`:26`) becomes
   `[--format text|json|html|svg]`; svg bullet at `:36-41`. `README.md`
   formats paragraph (`:71-75`) gains svg. `CHANGELOG.md` `Added` bullet.

8. Tests — [parallel with 7]
   - `tests/core/pixel-layout.test.ts` (new): tiling invariants — boxes
     cover exactly `[0,W]×[0,H]`, shared borders align; floors 240/82;
     spanning-cell growth on the last row; empty and one-cell grids
     stay total.
   - `tests/core/render-svg.test.ts` (new): jsdom-parsed — background
     rect, one rect per cell, one text per wrapped line, outer frame;
     escaping of `& < > "`; root size equals `layoutPixels`; the exact
     decision-12 font-family string.
   - `tests/cli/args.test.ts`: `svg` parses; `FORMATS` exported.
     `tests/cli/run.test.ts`: SVG reaches the fake sink; note on stderr,
     not stdout. `tests/cli/skill.test.ts`: drift test asserting the
     `SKILL.md` invoke line contains the **exact** string
     `--format ${FORMATS.join('|')}` built from the imported `FORMATS`
     — per-member substrings pass vacuously.

**Verification:** `npm test` and `npm run typecheck` green.
`npm run build && node dist/cli.mjs '<url>' --format svg > out.svg` opens
in a browser as the framed green-on-white diagram. No extension-side
source changed (the Done Criteria list).

**Commit:** `feat: add --format svg to the CLI`

### Slice 2: shrink wide tables toward the 1180px target

**Acceptance tests** (all in `tests/core/pixel-layout.test.ts`):
- Shrink (a): a ≤12-column fixture **whose natural width exceeds 1180px**
  — assert that precondition so the case is never vacuous — ingredient
  column at its 240 floor, op columns above 82; final width exactly
  1180, leftover handback included (the ported loop fails this).
- Shrink (b): 13 columns, all at their floors — width equals the 1254px
  floor sum, over target, terminates.
- Hard-break: a word wider than its post-shrink column content width
  hard-breaks instead of overflowing (first reachable here — slice 1
  never narrows below natural width).

**Steps:**

1. `src/core/pixel-layout.ts` — [sequential] Implement decisions 10–11
   as the floor-aware reverse water-fill, not the ported
   `render-text.ts:87-91` loop (it quits when the single widest column
   hits its own floor). Level: find the one integer `L` where
   `width_i = max(floor_i, min(natural_i, L))` brings the total table
   width to the largest value ≤ the 1180px target (sort above-floor
   columns, level the widest down together; O(cols log cols), never
   per-pixel). Handback: leveling undershoots by up to one pixel per
   active column (≤ ~11px); hand leftovers back one each to the widest
   columns, **lowest index first** — the `render-text.ts:88`
   `indexOf(Math.max(...))` order — so the total equals 1180 exactly.
   When the floor sum `246 + 84×(cols−1)` exceeds 1180 (13+ columns),
   **the floors win** and the table stays over target. Derivation
   comment (note 5): *undershooting the target requires the target to
   be reachable, which needs ≤12 columns* — not "shrinking only happens
   below the 13-column floor sum".

2. `tests/core/pixel-layout.test.ts` — [sequential] The three tests above.

**Verification:** `npm test` green; the slice-1 manual command on a
long-banner recipe yields an SVG root width of exactly 1180.

**Commit:** `feat: shrink wide CLI diagrams toward the overlay's 1180px width`

### Slice 3: `--format png`

**Acceptance tests** (from structure.md): `tests/cli/render-png.test.ts`,
`run.test.ts`, `smoke.test.ts`, `skill.test.ts` — all specified in step 6.

**Steps:**

1. `package.json` + `build.mjs` — [sequential] `"@resvg/resvg-js":
   "^2.6.2"` under `optionalDependencies` (decision 6); `npm install`
   updates the lockfile; **no version bump**. Add `'@resvg/resvg-js'` to
   `external` at `build.mjs:55` beside `'jsdom'` — the CLI config is
   `build.mjs:48-55`, its jsdom comment `:45-47`; extend that comment
   without splitting the block (note 6).

2. `src/cli/render-png.ts` — [sequential] New module exporting:
   - `loadResvg(): Promise<ResvgModule>` — memoized lazy
     `await import('@resvg/resvg-js')`; the seam's default.
   - `pngScale(w, h): number` — the named pure rule
     `s_png = min(2, sqrt(MAX_PIXELS / (w × h)))` with
     `MAX_PIXELS = 64 * 2**20`, bounding the RGBA buffer at ~268 MB
     (notes 1/9); comment: **no lower floor, and none may be added
     later** — any floor reopens the unbounded-memory hole.
   - `renderPng(grid: Grid, load = loadResvg): Promise<{ bytes: Uint8Array; scale: number }>`
     — rasterizes the slice-1 SVG string at `pngScale(width, height)`
     with `loadSystemFonts: false` + `fontFiles` + `defaultFontFamily:
     'Liberation Sans'` (mandatory — without `fontFiles`, text vanishes
     silently). Font path via
     `new URL('../assets/fonts/LiberationSans-Regular.ttf', import.meta.url)`
     + `fileURLToPath` — resolves from `dist/cli.mjs`; the font stays out
     of `dist/` (decision 5).

3. `src/cli/run.ts` — [sequential, after 2] Binary plumbing (decisions
   7, 8, 13): widen `Sink.write` (`run.ts:56-58`) to
   `string | Uint8Array`; `RunDeps` (`run.ts:60-70`) gains
   `stdoutIsTTY: boolean` **and `loadResvg`** — the same injected route
   `stdoutIsTTY` uses, so tests stub it (note 3). Pre-fetch
   (`run.ts:76-81` position): binary format + TTY → "refusing to write
   PNG bytes to a terminal; redirect to a file", exit 2; then for png,
   `await deps.loadResvg()` — `ERR_MODULE_NOT_FOUND` naming the resvg
   specifier → exit 2 with the fixed remedy line; any other failure →
   exit 1, message through `stripControls` (`run.ts:124` pattern), one
   line, never a stack, plus a reinstall hint. Dispatch arm:
   `renderPng(grid, deps.loadResvg)`; bytes to stdout; stderr advisory
   naming the applied scale when below 2; confidence note to stderr.

4. `src/cli/index.ts` + `src/cli/args.ts` — [sequential] Bind real deps
   beside `index.ts:41`: `stdoutIsTTY: process.stdout.isTTY === true`,
   `loadResvg` from `render-png.ts`. `args.ts`: add `'png'`; `USAGE`
   gains the png line, the binary-redirect note, and the decision-7
   remedy line (exit 2 is documented contract, `args.ts:35`).

5. Docs — [parallel] `SKILL.md`: invoke line gains `png`; format bullet;
   explicit "png/pdf are binary — always redirect to a file, never show
   raw". `README.md` formats paragraph; `CHANGELOG.md` bullet.

6. Tests — [sequential, after 2–4]
   - `tests/cli/render-png.test.ts` (new): magic bytes; IHDR dimensions
     equal 2× `layoutPixels` for a small grid; ink-count guard — read
     resvg's raw bitmap, assert a floor of dark pixels in a known text
     band (the fail-silent font trap); `pngScale` with `w×h` just under,
     at, and far over 64 Mpx — 2, 2, and the computed sub-2 value —
     without rasterizing anything oversize.
   - `tests/cli/run.test.ts`: TTY refusal exits 2 with the fake fetch
     never called; stubbed `loadResvg` rejections prove exit 2 + remedy
     and exit 1 + stripped hint; a stub resolving a fake module proves
     bytes reach the fake sink intact and the advisory fires at scale < 2.
   - `tests/cli/smoke.test.ts`: `--format png` against the in-process
     server (`smoke.test.ts:74-88` pattern) — exit 0 + magic bytes; the
     only proof the external and font URL resolve from the bundle.
     `tests/cli/skill.test.ts`: add the redirect-instruction assertion.

**Verification:** fresh `npm run build`, then `npm test` and
`npm run typecheck` green. Manually: `--format png > out.png` opens with
visible text, not blank boxes; on a TTY it refuses, exit 2.

**Commit:** `feat: add --format png to the CLI`

### Slice 4: `--format pdf`

**Acceptance tests** (from structure.md): `tests/core/render-pdf.test.ts`
and `tests/cli/run.test.ts` — all specified in step 3.

**Steps:**

1. `src/core/render-pdf.ts` — [sequential] Pure, dependency-free
   `renderPdf(grid: Grid): { bytes: Uint8Array; scale: number }` — the
   ~40-line writer research validated, fed by `layoutPixels` at
   1px = 1pt: base-14 `/Helvetica` + `/WinAnsiEncoding`, no FontFile;
   code points outside WinAnsi become `?` (decision 16); `\( \) \\`
   escaping; rects via `re`/`S`, text via `BT`/`Tf`/`Tm`/`Tj`/`ET`;
   **y-flip**: a baseline at SVG `y_svg` lands at `y_pdf = H − y_svg`;
   catalog/pages/page/contents/font objects and the xref byte-offset
   table. Page scale is its own named rule, distinct from `s_png`
   (notes 1/9): `s_pdf = min(1, 14400 / max(w, h))` from the 14,400pt
   page limit — `14400/42246 ≈ 0.34` at the input ceiling, text near
   5px; the memory-bound rationale belongs to `s_png` only. Apply as one
   uniform `cm`; **MediaBox equals the post-scale geometry** (the
   invariant); return the applied scale; no lower floor.

2. `src/cli/args.ts` + `src/cli/run.ts` + docs — [sequential, after 1]
   Add `'pdf'`; `USAGE` pdf line; the binary-redirect note now names png
   and pdf. The pdf arm in `run()`: slice 3's TTY refusal covers pdf,
   `renderPdf(grid)` bytes to stdout, advisory when `scale < 1`,
   confidence note to stderr; no resvg check on this path. `SKILL.md`
   invoke line + pdf bullet; `README.md` formats; `CHANGELOG.md` bullet.

3. Tests — [sequential, after 1] `tests/core/render-pdf.test.ts` (new):
   starts `%PDF-`, ends `%%EOF`; every xref offset points at its
   `N 0 obj` header; MediaBox equals post-scale geometry; known cell
   text findable in the raw bytes; escaping; a non-WinAnsi code point
   (e.g. `⅓`) becomes `?`; a synthetic tall grid past 14,400pt yields a
   scaled MediaBox and `scale < 1`. Coordinate cross-check (the
   one-engine proof): one small fixed grid through both `renderSvg` and
   `renderPdf`; select the same wrapped line **by its text content** in
   both (never "the first `<text>`" — `image.ts:127-139` emits all rects
   before all texts, so position is an iteration accident); assert
   `x_pdf = x_svg` and `y_pdf = H − y_svg` as a computed relation, `H`
   from the layout, plus **exactly one** hand-computed anchor (that
   line's SVG `y` from the baseline math) — no other literal coordinates
   (`PAD`, 15px, 1.35, 0.82 all feed them; changing one is not a bug).
   `tests/cli/run.test.ts`: pdf bytes reach the fake sink; TTY refusal
   exits 2; oversize advisory on stderr.

**Verification:** `npm test` and `npm run typecheck` green. Manually:
`out.pdf` opens with selectable, searchable text; a TTY refuses, exit 2.

**Commit:** `feat: add --format pdf to the CLI`

## Done Criteria

- All acceptance tests for all four slices pass; no regressions;
  `npm run typecheck` clean.
- No change under `src/export/`, `src/content/`, `src/background.ts`,
  `src/options/`, `src/print/`, or `src/manifest.json`; `src/core/*`
  stays pure and DOM-free; `@resvg/resvg-js` is imported only from
  `src/cli/render-png.ts`.
- One `[Unreleased]` changelog bullet per slice; `package.json` version
  untouched (no `version:bump`). The `hmtx` result is recorded in
  `font-metrics.ts`; the throwaway script is not in the tree.
- The drift test binds `SKILL.md` to the exported `FORMATS`; the invoke
  line ends at `--format text|json|html|svg|png|pdf`.
