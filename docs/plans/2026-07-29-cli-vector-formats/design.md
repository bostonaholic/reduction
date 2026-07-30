---
topic: 2026-07-29-cli-vector-formats
date: 2026-07-29
phase: design
revision: 4
---

# Design: `--format svg|png|pdf` for the CLI

The extension exports the diagram as SVG and PNG from the browser. The CLI
stops at text, JSON, and raw HTML — so its real users, shell scripts and
the agent Skill (`.claude/skills/reduction/SKILL.md`), cannot produce the
shareable diagram artifact at all without a browser. Parity with the
extension's export is the demand signal for SVG and PNG. PDF has no
extension precedent; its demand is an assumption standing in for
validation, accepted because the same geometry pays for it in ~40
dependency-free lines (research validated the writer).

## Current state

The CLI accepts `--format text|json|html` through the `FORMATS` whitelist in
`src/cli/args.ts:12-14`. `run()` dispatches on the format at
`src/cli/run.ts:210-215` and writes one string to stdout through the `Sink`
interface (`run.ts:56-58`, `write(chunk: string)`). The entry point
`src/cli/index.ts` handles EPIPE (`:19-23`) and passes a terminal width
(`:41`). Exit contract: 0 success, 1 operational failure, 2 usage error.

The extension's image export (`src/export/image.ts`) cannot run here.
`readGeometry` (`image.ts:68-106`) reads browser-computed rects, and jsdom
returns all zeros with no canvas (established by `research.md`). What is
portable is its output grammar — the SVG element order (`image.ts:117-146`),
`lineHeight = fontSize * 1.35` (`:74`), the baseline math (`:88-99`), and
the constants `BORDER`, `TEXT`, `PAD` (`:13-15`).

The repo already solves "geometry from a `Grid` without a browser" once, in
character units: `src/core/render-text.ts`. Its pipeline — natural column
widths with round-robin deficit distribution (`:67-93`), spanned content
width (`:96-100`), row heights where a spanning cell grows only its last row
(`:125-137`), prefix sums to coordinates (`:141-148`) — is the algorithm
template. The `Grid` contract (`src/core/types.ts:74-91`) guarantees an
exact tiling (`layout.ts:196-221`), so geometry needs no overlap handling.

## Desired end state

Three new formats share one pure geometry engine. `layoutPixels(grid)` in a
new `src/core/pixel-layout.ts` ports the `render-text.ts` pipeline to
pixels: the character counter becomes `textWidth()` from a new
`src/core/font-metrics.ts` (decision 3), and the `+1` border terms become
real border widths (2px interior, 3px frame). It returns
`PixelLayout { width, height, boxes }` where each box carries
`{ x, y, w, h, kind, lines }` and each line carries
`{ text, x, y, anchor }` — the same shape `image.ts` builds, so the SVG
assembly ports directly.

Three renderers consume it. `src/core/render-svg.ts`: pure,
`renderSvg(grid): string`, emits the element order of `image.ts:117-146`.
`src/core/render-pdf.ts`: pure, `renderPdf(grid): { bytes, scale }`, the
hand-written writer research built and validated (base-14 Helvetica,
WinAnsi, y-flip, xref). `src/cli/render-png.ts`: async,
`renderPng(grid): Promise<{ bytes: Uint8Array; scale: number }>`, lazily
imports `@resvg/resvg-js`, rasterizes the SVG string at 2× (area-clamped,
decision 13) with an explicit `fontFiles` entry for a Liberation Sans face
shipped in the repo. All of `src/core/*` stays pure and DOM-free; the
native dependency touches only `src/cli/`.

`args.ts` gains the three formats and updated `USAGE`; the resvg remedy
line from decision 7 is part of that `USAGE` update, so `--help` documents
the exit-2 path. `args.ts` also exports `FORMATS` — today it is
module-private (`const FORMATS`, `args.ts:14`) — so the skill-drift test
can import it. `run()` gains the dispatch arms, writes `Uint8Array` for
png/pdf, refuses binary output when stdout is a TTY, and writes one
advisory line to stderr when an oversize artifact was scaled down
(decision 13). `build.mjs:55` gains `'@resvg/resvg-js'` as a second
external.

Two user-facing documents change with the code, because both list the
format set and both feed decision 8: `.claude/skills/reduction/SKILL.md`
(invoke line `:26`, format descriptions `:36-41`) gains the three formats
and an explicit instruction that png and pdf are binary and must be
redirected to a file, never shown raw; `README.md`'s "Command line" formats
paragraph (`:71-75`) gains the same. The extension bundles and
`src/manifest.json` do not change.

## Patterns to follow

- Sizing pipeline: `src/core/render-text.ts:67-148` — port it, except the
  shrink loop (`:87-91`), which decision 10 re-derives for per-column
  floors.
- Hard-breaking word wrap: `render-text.ts:27-64` (`wrap` + `chunk`).
- SVG grammar: `src/export/image.ts:117-146` element order;
  `lineHeight = fontSize * 1.35` (`:74`); block baseline
  `top + fontSize * 0.82` (`:88-99`); `escapeXml` (`:108-114`); colors and
  `PAD` (`:13-15`).
- Format whitelist and dispatch: `src/cli/args.ts:12-14`, `run.ts:210-215`.
- Pre-fetch environment check with exit 2: `run.ts:76-81` (the `--claude`
  key check) — the model for the resvg and TTY refusals.
- Untrusted stderr text goes through `stripControls`: `run.ts:124`, `:161`,
  `:197`, `:217`; never a stack trace (`run.ts:141-147`).
- External runtime dependency: jsdom in `build.mjs:46-55` and
  `package.json` — the model for resvg.
- Injected deps for tests: `run.ts:60-70`; fake sinks in
  `tests/cli/run.test.ts`.
- Advisory writes to stderr: `run.ts:178-181`.
- In-process test HTTP server for the built CLI: `tests/cli/smoke.test.ts:74-88`.

## Decisions made

1. **One shared geometry engine in `src/core/pixel-layout.ts`.** All three
   renderers read the same `PixelLayout`. Alternative: per-renderer
   geometry, rejected — three copies of the sizing pipeline would drift.
   Assumption — chosen without user review (module name and placement).
2. **`layoutPixels` imports `textWidth` directly; no injected measurer.**
   Alternative: inject the measure function, rejected — single caller,
   single font (Karpathy: no abstraction for single-use code). Assumption —
   chosen without user review.
3. **One width table drives all three formats.** `font-metrics.ts` holds
   the Helvetica AFM widths for ASCII 32–126 (95 integers, exact against
   pdfkit per research) at 15px, plus real AFM widths for every non-ASCII
   code point the pipeline itself emits: `…` and `—` at 1000/1000
   em-units, `½` `¼` `¾` at 834, `–` at 556, `“` `”` at 333, `’` `‘` at
   222, `°` at 400 — the full set entity decoding admits
   (`extract.ts:36-40`), plus
   the `…` that `bannerText` (`infer.ts:204-207`) appends to any banner
   label over 90 characters; its reachable callers are `infer.ts:311`,
   `:369` (inferTree's prep and note paths) and `:494` (flatTree's prep
   path). `’` matters most: it is the most common non-ASCII character in
   recipe text ("don't", "chef's"), and a 1.0 em fallback would
   over-measure its 222-unit width 4.5× (~11.7px of phantom width per
   apostrophe), padding columns and pushing extra work onto the shrink
   loop. Everything outside the table measures a 1.0 em fallback: per the
   AFM, no non-ASCII WinAnsi glyph exceeds 1000/1000 (`™`, `‰`, `Æ`, `Œ`
   sit exactly there), so the fallback never under-measures text the PDF
   can encode — but the guarantee stops at the PDF. SVG and PNG carry full
   Unicode (decision 16), where a glyph — an emoji, say — can exceed 1 em
   in the rendering font and overflow its box; accepted, listed in Edge
   cases. Alternatives: keep the previous 0.6 em fallback, rejected — it
   under-measures `…` by 40% on a common path; parse widths from the
   shipped TTF at runtime, rejected — a font parser for a fixed set of
   known integers. Assumption — chosen without user review (fallback value
   and table contents).
4. **Ship `assets/fonts/LiberationSans-Regular.ttf` plus its OFL 1.1
   license file.** Liberation Sans is metrically compatible with Arial,
   which shares Helvetica's advance widths — but only the Helvetica→Arial
   half of that chain is measured (research: exact agreement with pdfkit's
   AFM). The Arial→Liberation half is inherited belief; it is recorded
   here as an assumption, and implementation carries a one-time task:
   read `hmtx` from the shipped TTF once (throwaway script, not a runtime
   parser), compare **every** table entry — the 95 ASCII advances and the
   eleven non-ASCII ones alike; an ASCII-only check cannot catch a bad
   non-ASCII entry — and record the result in a comment in
   `font-metrics.ts`. OFL 1.1 permits
   redistribution beside MIT code with the license file kept. Size ~350 KB
   (verify at implementation). Regular weight only: the extension's own
   SVG export emits no `font-weight` (`image.ts:136`). Alternative: system
   fonts in resvg, rejected — ~1.1 s uncached scan and nondeterministic
   output across OSes (research measured both). Assumption — chosen
   without user review.
5. **The font stays out of `dist/`.** resvg resolves it via
   `new URL('../assets/fonts/…', import.meta.url)` from `dist/cli.mjs`.
   `dist/` doubles as the unpacked extension directory; copying the font in
   would fatten the extension artifact. Trade-off: `dist/cli.mjs` copied
   out of the repo loses PNG support — acceptable, the package is private
   and unpublished (`README.md:54-57`). Assumption — chosen without user
   review.
6. **Take `@resvg/resvg-js` as an `optionalDependency` at the caret range
   `^2.6.2`** (a range, not a pin — it admits a 2.7.x stable automatically
   when one ships), marked `external` in `build.mjs:55`, imported with
   `await import()` only on the png path. Config is
   `loadSystemFonts: false` + `fontFiles` +
   `defaultFontFamily: 'Liberation Sans'` — mandatory, because
   `loadSystemFonts: false` alone drops text silently (research measured 0
   text pixels). The 28-month-old stable is accepted: thin binding, narrow
   job, prebuilts for both CI targets, ~2M weekly downloads; fallback is
   `sharp`. License: MPL-2.0 is file-level copyleft — consuming it
   unmodified imposes nothing on MIT code (`research.md:140`). Alternative:
   no PNG format, rejected — the extension exports PNG; parity is the
   feature.
7. **resvg import failure splits by cause, checked before the fetch.**
   Module not found (`ERR_MODULE_NOT_FOUND` naming the resvg specifier —
   the `--omit=optional` install) → exit 2 with a fixed remedy line
   ("reinstall without `--omit=optional`, or
   `npm install @resvg/resvg-js`"), the `run.ts:76-81` precedent: the
   remedy is in the invocation environment, no work begun. That remedy
   line is also part of the `USAGE` text in `args.ts` (see Desired end
   state), because `args.ts:35` and `run.ts:6-8` define exit 2 as "usage
   error" and the documented contract should cover this pre-flight case.
   Any other load failure (wrong-ABI binary, interrupted install) →
   exit 1: that is an operational failure of the environment, not a usage
   error the caller fixes by changing the command. The exit-1 line
   includes the underlying error message passed through `stripControls`
   (the `run.ts:124` pattern) — one line, never a stack, because a native
   load error carries absolute paths and arbitrary loader text — followed
   by a short reinstall hint. The hint is there because the realistic
   exit-1 cause is `npm ci` against a lockfile built on another OS: the
   platform binary package is missing while `@resvg/resvg-js` is present,
   its loader throws a bare "Failed to load native binding", and a
   reinstall cures exactly that. Alternative: one exit code for both,
   rejected — it prescribes a reinstall remedy as the *primary* message
   for failures a reinstall does not fix; the hint on exit 1 is
   subordinate to the real error, not a diagnosis. Assumption — chosen
   without user review.
8. **Binary bytes go to stdout; a TTY refuses them; no `--out` flag.**
   `Sink.write` widens to `string | Uint8Array` (`process.stdout` already
   satisfies it). For png/pdf with stdout a TTY, `run()` exits 2 before
   the fetch: "refusing to write PNG bytes to a terminal; redirect to a
   file". `RunDeps` gains `stdoutIsTTY: boolean`, set in `index.ts` beside
   `:41`. Alternative: an `--out <file>` flag, rejected — shell redirection
   already serves the real users (scripts and the agent Skill — which this
   change teaches to redirect, see Desired end state), and a path-writing
   flag adds validation and partial-write handling for no new capability.
   SVG is text and prints anywhere. Preserves "stdout carries only rendered
   output" (`run.ts:7`). Assumption — chosen without user review.
9. **Fidelity target: the extension's SVG export, not the CSS overlay.**
   Uniform `PAD = 10`, colors, 15px, line-height 1.35, regular weight —
   `image.ts`'s grammar, which already diverges from the overlay's 7px/10px
   padding. Column floors come from the overlay where they shape the look —
   but the overlay's `min-width: 220px` / `62px` (`overlay.css:150-159`)
   are *content* widths under `content-box` (`:host { all: initial }`,
   `overlay.css:4-6`), so the rendered browser cell is 24px wider: 20px of
   padding (`padding: 7px 10px`) plus 4px of border (`border: 2px solid`,
   `overlay.css:139`). Our model keeps borders as separate terms the way
   `render-text.ts:86` does, so only the padding folds into the column
   floor: **240px** (ingredient, col 0, 220+20) and **82px** (all others,
   62+20). A narrow table keeps its natural width rather than stretching
   to fill as the browser's `width: 100%` does. Output is the same visual
   grammar, not pixel-identical. Assumption — chosen without user review.
10. **The shrink loop is re-derived for per-column floors, not ported.**
    `render-text.ts:87-91` stops when the single widest column reaches the
    floor — safe only because `MIN_COL_WIDTH` is one global number. With a
    240px floor on column 0 and 82px elsewhere, the widest column can sit
    at its own floor while others still have room, and the ported loop
    would quit early — the main path for real recipes, since banner
    deficit distribution (`render-text.ts:77-84`) widens every column. New
    rule (the specification): shrink the widest column *still above its
    own floor* by 1px; stop when the table meets the 1180px target or no
    column is above its floor — at which point decision 11's floors-win
    case applies. The rule terminates: each step drops one column by 1px,
    total width strictly falls, and the above-floor set never grows. The
    implementation computes that fixpoint arithmetically — sort the
    above-floor columns and level the widest down together, floor-aware
    (reverse water-fill), O(cols log cols) — rather than looping once per
    pixel of overshoot. One more step makes the two rules identical:
    leveling every active column to one integer `L` lands *under* the
    target by up to one pixel per active column (≤ ~11px — shrinking only
    happens below the 13-column floor sum), where the per-pixel rule stops
    exactly on it with some columns at `L+1`. The leftover pixels are
    handed back to the widest columns, lowest index first (the
    `render-text.ts:88` order), so the final width equals the target
    exactly. Per-pixel looping is still rejected: the naive loop
    recomputes `Math.max(...widths)`
    every pass and overshoot is unbounded short of the 25 MiB input cap,
    so per-pixel iteration degrades exactly on wide grids. Alternative:
    one global floor (drop the ingredient minimum), rejected — it abandons
    the overlay's most visible layout trait. Assumption — chosen without
    user review.
11. **Table width targets 1180px; when the target and the floors conflict,
    the floors win.** The browser has no table cap: `.rd-panel` caps the
    *dialog* at `min(1180px, 100%)` (`overlay.css:26`), `.rd-scroll`
    scrolls overflow (`:116-119`), and `.rd-table` is `width: 100%`
    (`:123-127`) — wider content scrolls sideways. An artifact cannot
    scroll, so the CLI shrinks toward 1180px (chosen so output reads like
    the overlay at its widest) but never below a column's floor
    (decision 10). The floor sum is `246 + 84×(cols−1)` — 240 + 82 per
    further column of content, 2px interior borders, a 3px frame each
    side: 1170px at 12 columns, **1254px at 13**. Thirteen columns is
    ordinary, not hostile: `layout.ts:7` sets column = depth from the
    ingredient leaves and `flatTree` wraps one op per step
    (`infer.ts:501`), so a 12-step recipe reaches it, and the
    `extract.ts:26` 500-step cap puts the ceiling near 501 columns —
    ~42,246px. So 1180px is a target, not a guarantee; an over-target
    table keeps legible floor-width columns, and the physical bounds live
    in decision 13 (PDF page scale, PNG area clamp), each with a stderr
    advisory. Alternative: enforce 1180px by shrinking below the floors,
    rejected — a 501-column table crushed into 1180px leaves ~2px per
    column, an illegible artifact; wide-but-legible beats
    narrow-but-unreadable. Assumption — chosen without user review.
12. **`renderSvg` emits
    `font-family="Liberation Sans, Helvetica, Arial, sans-serif"`.**
    Resolution per path: resvg → the shipped TTF exactly
    (`defaultFontFamily` + `fontFiles`); Linux desktop viewers →
    Liberation Sans (commonly installed); macOS → Helvetica; Windows →
    Arial — all metric-compatible with the width table. Alternative: copy
    the overlay's stack (`overlay.css:18`, Helvetica Neue first), rejected
    — a Linux viewer without Helvetica falls back to DejaVu Sans, which is
    wider and overflows the boxes the layout drew. Residual risk (Linux
    without Liberation → DejaVu) is in Risks. Assumption — chosen without
    user review.
13. **PNG renders at 2× like `toPng` (`image.ts:150`), with the scale
    clamped by total pixel count, not per dimension:
    `s = min(2, sqrt(MAX_PIXELS / (w × h)))` with `MAX_PIXELS = 64 × 2²⁰`
    (~67.1 Mpx), bounding the RGBA buffer at ~268 MB for any shape.**
    Alternative: clamp each dimension at 16,384px, rejected — a per-side
    bound is not a memory bound (16,384² × 4 B = 1.07 GB), and decision 11
    shows width alone can reach ~42,000px, so the two-dimension worst case
    is reachable, not theoretical. PDF maps 1px to 1pt; when a dimension
    exceeds the 14,400pt page limit, a uniform scale `s` in the content
    stream shrinks the drawing and the MediaBox is set to the *scaled*
    geometry — the invariant is "MediaBox equals the post-scale geometry",
    and the writer returns the applied scale. `s` has deliberately **no
    lower floor**: at the input ceiling (~42,246px wide × ~21,000px tall
    ≈ 887 Mpx) `s ≈ 0.28` and 15px text lands near 4px — a smudge, but an
    honest one, since the advisory reports the applied scale. The
    alternatives are refusing to render (worse for the scripts that are
    the real users) or letting the buffer break the memory bound; an
    implementer must not add a floor later, because any floor silently
    reopens the unbounded-memory hole the clamp exists to close. Alternative for oversize
    PDFs: paginate, rejected — page breaks must split row-spanning cells
    (an ingredient cell can span the whole table height), which multiplies
    the ~40-line writer's complexity for a format whose demand is itself
    an assumption (see the problem statement); one scaled page with an
    advisory is the thinnest honest artifact, and pagination is listed in
    Out of scope. Neither path is silent: `renderPdf` and `renderPng`
    report the applied scale to `run()`, which writes one advisory line to
    stderr whenever it fell below the default (`run.ts:178-181` precedent)
    — a 500-row capped recipe (~21,000px tall: a single-line row is ~42px
    once `lineHeight = 15 × 1.35`, `PAD × 2`, and the 2px border are
    counted, and 82px-floor op columns wrap most labels onto more lines)
    lands here and the user is told. Assumption — chosen without user
    review (the 2× default and the 64 Mpx bound).
14. **Wrap hard-breaks long words** (port `render-text.ts:27-64` with pixel
    widths), diverging from `image.ts:49-66` which lets long words overflow
    their box. Correct output beats replicating a defect.
15. **Output is the table only — no title, no confidence note in the
    artifact.** Matches the extension export exactly. The note still
    reaches the user on stderr for svg/png/pdf (advisory precedent
    `run.ts:178-181`), so a bad parse stays visible. Assumption — chosen
    without user review.
16. **PDF text encodes WinAnsi; code points outside it become `?`.** The
    exposure is real but narrow: `normalizeText` runs only on ingredient
    lines (`ingredient.ts:83`), so `⅓ ⅔ ⅛` and friends survive into banner
    and op cells and become `?` there (`½ ¼ ¾` are CP1252 and survive
    everywhere). A visible `?` is honest; a silently dropped byte is not.
    SVG and PNG carry full Unicode. Assumption — chosen without user
    review.
17. **Changelog entry under `[Unreleased]`, no version bump.** The bump
    tooling is not on main; the implementer must not run `version:bump`
    despite `CLAUDE.md`. Constraint from dispatch, recorded so it is not
    "fixed" at implementation time.

## Out of scope

- Any change to `src/export/image.ts`, the four extension bundles, or
  `src/manifest.json`.
- An `--out` flag or any file-writing path in the CLI.
- Embedding or subsetting a font inside the PDF — base-14 Helvetica only.
- Parsing SVG to produce the PDF — the PDF renders from `PixelLayout`.
- Paginating oversize PDFs — one page with a uniform scale and a stderr
  advisory instead (decision 13); pagination waits for evidence anyone
  wants a multi-page artifact.
- New Playwright golden screenshots for CLI formats; `tests/e2e/` stays
  extension-only.
- Adding a macOS runner to the `unit` CI job (`.github/workflows/ci.yml:17`
  is ubuntu-only; see Risks).
- Caching resvg or fonts across invocations — one-shot CLI, ~2 ms typical
  render.
- Windows support validation.
- A title caption on image formats (deferred; see open questions).

## Edge cases

- **Boundary values:** empty grid (unreachable via `run()` —
  `run.ts:203-207` guarantees a root — but the renderers stay total: zero
  boxes, a minimal framed artifact). One-cell grid renders a single box
  plus frame. Thirteen columns (an ordinary 12-step recipe): the floor sum
  `246 + 84×(cols−1)` first passes the 1180px target — the floors win and
  the table goes over target (decision 11), up to ~42,246px at the
  501-column extraction ceiling; the physical artifact is then bounded by
  the PDF page scale and PNG area clamp with advisories (decision 13). A
  word wider than the final column content width hard-breaks
  (decision 14). A banner ending in `…` measures at the glyph's real width
  (decision 3).
- **Invalid inputs:** cell text with `& < > "` is XML-escaped in SVG
  (`image.ts:108-114`) and string-escaped (`\( \) \\`) in the PDF writer.
  Non-WinAnsi code points in PDF become `?` (decision 16); glyphs missing
  from Liberation Sans render as `.notdef` boxes in PNG — visible,
  accepted. A code point wider than 1 em in the rendering font (an emoji)
  can overflow its box in SVG and PNG — the 1.0 em ceiling is a PDF-only
  guarantee (decision 3); accepted. Unknown `--format` values still exit 2
  via the whitelist.
- **Failure paths:** resvg not installed → exit 2 pre-fetch; resvg present
  but unloadable → exit 1 with a stripped one-line reason plus a reinstall
  hint (decision 7). Missing font file → the png arm throws, caught by the
  guarded render block (`run.ts:173-219`), exit 1 with the path named. A
  resvg panic/throw during render → same block, exit 1. EPIPE on a binary
  write → exit 0 via `index.ts:19-23`.
- **Concurrency:** none — one process, one render, no shared state, no
  temp files. Idempotent by construction.
- **Authorization:** n/a — no new credentials or network calls.
- **Resource limits:** input is bounded upstream (25 MiB body cap,
  500-item extraction cap), which bounds columns near 501 and the floor
  width near ~42,246px (decision 11). `layoutPixels` allocates
  O(cells + wrapped lines) — no character canvas. Physical outputs are
  bounded, never silently: the PNG RGBA buffer stays ≤ ~268 MB via the
  64 Mpx area clamp — the real worst case, not a per-side figure — and PDF
  pages stay ≤ 14,400pt via uniform scale, each with a stderr advisory
  (decision 13). SVG has no physical clamp: it is text, O(cells) bytes,
  and viewers scale it; its nominal width tops out at the input ceiling
  above.

## Testing strategy

No new test dependencies; each format asserts what it can prove cheaply.

- **Geometry** (`tests/core/pixel-layout.test.ts`): tiling invariants in
  pixel space — boxes cover exactly `[0,W]×[0,H]`, shared borders align;
  column floors (240/82); spanning-cell growth. Plus the two shrink cases
  decisions 10 and 11 exist for: (a) a ≤12-column grid whose ingredient
  column sits at its 240 floor while op columns are still above 82 —
  assert the table shrinks to exactly 1180px, the leftover pixels handed
  back per decision 10 (the ported loop fails this; the re-derived one
  passes); (b) a 13-column grid with every column at its
  floor — assert width equals the 1254px floor sum, over target, and the
  computation terminates.
- **Coordinates** (the y-flip and one-engine proof): for one small fixed
  grid, select the same wrapped line in both outputs *by its text content*
  — `image.ts:127-139` emits all rects before all texts, so "the first
  `<text>`" is an iteration accident, not a contract — then assert the
  flip as a computed relation: `x_pdf = x_svg` and `y_pdf = H − y_svg`
  with `H` read from the layout, plus exactly one hand-computed anchor
  (that line's SVG `y` from the baseline math) to pin absolute placement.
  Full literal coordinate assertions are rejected as change-detectors:
  `PAD`, the 15px size, the 1.35 line height, and the 0.82 baseline factor
  all feed those numbers, and changing any one is not a bug.
- **SVG** (`tests/core/render-svg.test.ts`): parse with jsdom and assert
  structure — one rect per cell plus background and frame, one text per
  wrapped line, XML escaping, root width/height equal to `PixelLayout`,
  and the decision-12 `font-family` string.
- **PDF** (`tests/core/render-pdf.test.ts`): raw-byte assertions —
  `%PDF-` header, `%%EOF`, every xref offset points at its object,
  MediaBox equals the post-scale geometry, cell text findable in the
  bytes. Oversize path: a synthetic tall grid asserts the scaled MediaBox
  and that `renderPdf` reports `scale < 1`.
- **PNG** (`tests/cli/render-png.test.ts`): magic bytes and IHDR
  dimensions equal 2× the layout. The fail-silent font trap gets
  research's ink-count guard — read resvg's raw bitmap and assert a floor
  of dark pixels in a text band. The area clamp is a pure function tested
  at its boundaries (`w × h` just under, at, and far over 64 Mpx) without
  rasterizing anything oversize; the missing-resvg and unloadable-resvg
  messages are unit-tested by stubbing a `loadResvg()` indirection.
  Determinism note: `fontFiles` pins the face by construction, but CI's
  unit job runs `ubuntu-latest` only (`ci.yml:15-17`), so cross-OS
  determinism is never exercised — claimed by construction, recorded in
  Risks.
- **CLI** (`tests/cli/args.test.ts`, `run.test.ts`, `smoke.test.ts`): new
  formats parse; TTY refusal exits 2 pre-fetch; bytes reach the fake sink
  intact; the confidence note and oversize advisory land on stderr. The
  smoke test runs the built `dist/cli.mjs` with `--format png` against the
  in-process test server (`smoke.test.ts:74-88` pattern) and asserts exit
  0 plus PNG magic bytes on stdout — the only test that proves the resvg
  external and the `import.meta.url` font path resolve *from the bundle*.
  A `--format svg` smoke stays as the cheap dispatch check.
- **Skill drift** (`tests/cli/skill.test.ts`): assert the Skill's invoke
  line (`SKILL.md:26`) contains the exact `--format ${FORMATS.join('|')}`
  string built from `FORMATS` (imported from `src/cli/args.ts`) — an
  exact-string assertion, because per-member substring matching passes
  vacuously (`text` already appears in the Skill's prose) — and that the
  Skill tells the agent to redirect png/pdf to a file.

## Open questions (deferred)

- Stretch columns to fill 1180px, matching the overlay's `width: 100%`,
  once someone compares outputs side by side.
- Add the recipe title (and note) as a caption across svg/png/pdf and the
  extension export together, as one coherent change.

## Risks

- resvg's stable release is 28 months old (research: stalled, not dead).
  Caret range `^2.6.2` admits a 2.7.x stable automatically; `sharp` is the
  named fallback if a Node/ABI break lands.
- `optionalDependency` failures are silent at install time by design; the
  loud pre-fetch check (decision 7) is the compensating control.
- A ~350 KB binary font lands in the repo. One-time cost, no growth.
- Arial→Liberation advance-width equality is unmeasured until the one-time
  `hmtx` check (decision 4) runs at implementation.
- Metric compatibility is advance-width, not kerning (research: ≤0.8pt
  kerned drift; `PAD = 10` absorbs it). A PDF viewer substituting a
  non-metric-compatible face, or an SVG viewer on a Linux box without
  Liberation Sans falling back to DejaVu Sans (wider), can wrap or
  overflow differently than the boxes assume — accepted, inherent to
  unembedded fonts.
- Cross-OS PNG determinism is by construction only: the `unit` CI job runs
  `ubuntu-latest` alone (`ci.yml:15-17`), and the macOS `golden` job does
  not run the unit suite.
- `dist/cli.mjs` depends on the repo checkout for the font (decision 5); a
  standalone copy of the bundle loses `--format png` with a clear error.
- An over-target table (13+ columns) produces a wide artifact by design
  (decision 11); the PDF and PNG arms scale it down with an advisory, but
  a very wide SVG is delivered at its nominal width.
- This branch is stacked on `2026-07-29-cli-and-agent-skill` (PR #8, open);
  it must land first, and nothing from it is redone here.
