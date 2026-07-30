---
topic: 2026-07-29-cli-vector-formats
date: 2026-07-29
phase: structure
---

# Structure: `--format svg|png|pdf` for the CLI

Four slices, ordered by user value: SVG first (parity with the extension's
export, the demand signal), the 1180px sizing rule second (every later format
inherits it), PNG third (the other parity-backed format), PDF last (its demand
is an assumption — design problem statement). Each slice leaves the CLI in a
shippable, documented, changelogged state. Reviewer notes 1–9 from
`design-review-4.md` are assigned to slices below and must not be dropped.

## Slices

### Slice 1: `--format svg` end-to-end
**Goal:** A script or the agent Skill runs
`node dist/cli.mjs '<url>' --format svg > out.svg` and gets the extension's
diagram without a browser.
**Layers touched:** core (`src/core/font-metrics.ts`, `src/core/pixel-layout.ts`,
`src/core/render-svg.ts`), CLI (`src/cli/args.ts`, `src/cli/run.ts`), assets
(`assets/fonts/LiberationSans-Regular.ttf` + OFL 1.1 license), docs
(`README.md`, `.claude/skills/reduction/SKILL.md`, `CHANGELOG.md`).

Contents: the width table (95 ASCII + eleven non-ASCII entries, decision 3)
and `textWidth`; `layoutPixels` porting the `render-text.ts:67-148` pipeline —
natural widths, banner deficit distribution, floors (240/82, decision 9),
spanned content width, row heights, prefix sums, and the hard-breaking `wrap`
port (decision 14) — but **not** the 1180px target shrink (that is slice 2;
this slice renders at max(natural, floor) width). `renderSvg` emits the
`image.ts:117-146` grammar with the decision-12 font-family string. `args.ts`
adds `svg` to `FORMATS`, exports `FORMATS`, updates `USAGE`; `run()` gains the
svg arm; the confidence note goes to stderr (decision 15).

Fold in here: **note 2** (all widths stored in 1000-unit em space; `textWidth`
multiplies by `fontSize / 1000` — one comment pinning the unit), **note 4**
(decide accented Latin explicitly — add the ~556-unit entries for `é`-class
letters or record acceptance of the 1.0 em padding in a `font-metrics.ts`
comment; the repo's own verbs carry `sauté`/`purée` at `infer.ts:108,:111`),
**note 8** (`°` provenance comment: entity-decoded *and* synthesized at
`infer.ts:185-187`), the **one-time `hmtx` verification** (throwaway script
reads the shipped TTF's advances; compare **every** table entry — 95 ASCII and
the eleven non-ASCII alike, plus any note-4 additions; record the result in a
`font-metrics.ts` comment — decision 4), and the **eleven-vs-twelve check**
against `extract.ts:36-40` (`nbsp` decodes to plain ASCII space; eleven is
correct — cite in the same comment). The font ships now because the `hmtx`
check validates the table this slice's layout depends on.

**Tests:**
- `tests/core/pixel-layout.test.ts` — tiling invariants (boxes cover exactly
  `[0,W]×[0,H]`, shared borders align), column floors 240/82; empty grid and
  one-cell grid stay total (minimal framed artifact). Spanning-cell row growth
  is **not** testable here: this slice lays out at `max(natural, floor)`, so no
  cell ever wraps, and row growth needs a wrapped spanning cell. It moves to
  slice 2, where a post-shrink narrow column forces the wrap.
- `tests/core/render-svg.test.ts` — jsdom-parsed structure: background rect,
  one rect per cell, one text per wrapped line, outer frame; XML escaping of
  `& < > "`; root width/height equal the `PixelLayout`; the decision-12
  `font-family` string.
- `tests/cli/args.test.ts` / `run.test.ts` / `skill.test.ts` — `svg` parses
  and dispatches; SVG string reaches the fake sink; note on stderr; skill
  drift test asserts `SKILL.md:26` contains the exact
  `--format ${FORMATS.join('|')}` built from the exported `FORMATS`.

**Verification checkpoint:** `npm test` and `npm run typecheck` green;
`npm run build && node dist/cli.mjs '<recipe url>' --format svg > out.svg`
opens in a browser as the framed green-on-white diagram. Extension bundles and
`src/manifest.json` show no diff.
**Atomic commit message:** `feat: add --format svg to the CLI`

### Slice 2: shrink wide tables toward the 1180px target
**Goal:** A wide recipe's artifact reads like the overlay at its widest —
tables above 1180px shrink to it (never below the column floors), so users get
right-sized diagrams instead of banner-stretched ones.
**Layers touched:** core (`src/core/pixel-layout.ts` only).

Implements decisions 10 and 11: the re-derived floor-aware reverse water-fill
(not the ported `render-text.ts:87-91` loop), leveling above-floor columns to
one integer and handing leftover pixels back widest-first, lowest index first,
so the result exactly equals the per-pixel rule; floors win at 13+ columns
(sum `246 + 84×(cols−1)`). Fold in **note 5**: the derivation comment says
*undershooting the target* requires the target to be reachable (≤12 columns) —
not "shrinking only happens below the 13-column floor sum".

**Tests:**
- Shrink case (a): a ≤12-column fixture **whose natural width exceeds 1180px**
  (**note 7** — otherwise the assertion is vacuous), ingredient column at its
  240 floor, op columns above 82 — asserts final width exactly 1180 with the
  leftover handback (the ported loop fails this; the re-derived rule passes).
- Shrink case (b): a 13-column grid with every column at its floor — asserts
  width equals the 1254px floor sum, over target, and the computation
  terminates.
- Spanning-cell row growth: a wrapped op cell outgrowing its rows grows only
  the **last** spanned row (moved from slice 1, which never wraps — see the
  note in that slice's test list).
- Hard-break: a word wider than its post-shrink column content width
  hard-breaks instead of overflowing (decision 14 — first reachable here,
  since slice 1 never narrows a column below its natural width).

**Verification checkpoint:** the three tests pass; rerunning the slice-1
manual command on a long-banner recipe yields an SVG whose root width is 1180.
**Atomic commit message:**
`feat: shrink wide CLI diagrams toward the overlay's 1180px width`

### Slice 3: `--format png`
**Goal:** A script or the Skill produces the same shareable PNG the extension
exports: `node dist/cli.mjs '<url>' --format png > out.png`.
**Layers touched:** CLI (`src/cli/render-png.ts`, `run.ts`, `index.ts`,
`args.ts`), build (`build.mjs`, `package.json` + lockfile), docs (`README.md`,
`SKILL.md`, `CHANGELOG.md`).

Contents: `renderPng` rasterizes the slice-1 SVG string via lazily-imported
`@resvg/resvg-js` (`optionalDependency` at `^2.6.2`; `loadSystemFonts: false`
+ `fontFiles` resolving the shipped font via `import.meta.url` +
`defaultFontFamily`, decisions 5–6) at 2× under the 64 Mpx area clamp. The
binary plumbing lands here as the earliest binary slice: `Sink.write` widens
to `string | Uint8Array`, `RunDeps` gains `stdoutIsTTY`, TTY refusal exits 2
pre-fetch, and `run()` writes the one-line scaled-down advisory to stderr
(decisions 8, 13). Decision-7 failure split: missing module → exit 2 with the
remedy line (also added to `USAGE`); any other load failure → exit 1,
one stripped line plus reinstall hint. Docs gain png and the "png/pdf are
binary — always redirect to a file" instruction; the drift test gains its
redirect assertion.

Fold in here: **note 3** (the seam is a `loadResvg` injected through
`RunDeps`, `run.ts:60-70` — the `stdoutIsTTY` route; the lazy `await import()`
stays in `src/cli/render-png.ts` as its default), **notes 1 and 9** PNG half
(the area clamp is its own named rule, `s_png = min(2, sqrt(MAX_PIXELS/(w×h)))`,
justified by the RGBA-buffer memory bound; no lower floor, and no floor may be
added later), and **note 6** (place the resvg external so the `build.mjs`
comment block stays intact — the jsdom comment runs `:45-47`, config `:48-55`).

**Tests:**
- `tests/cli/render-png.test.ts` — PNG magic bytes; IHDR dimensions equal 2×
  the layout; the ink-count guard (a floor of dark pixels in a text band —
  the fail-silent font trap from research).
- `s_png` tested as a pure function at its boundaries (`w×h` under, at, and
  far over 64 Mpx) without rasterizing anything oversize; `run.test.ts`
  asserts the stderr advisory when the applied scale falls below 2.
- Failure and integration: stubbed `loadResvg` proves exit 2 + remedy
  (missing) and exit 1 + stripped hint (unloadable); TTY refusal exits 2
  pre-fetch; `smoke.test.ts` runs the built `dist/cli.mjs --format png`
  against the in-process server (`smoke.test.ts:74-88` pattern) — exit 0 and
  magic bytes, the only proof the external and the font URL resolve from the
  bundle.

**Verification checkpoint:** smoke test green from a fresh `npm run build`;
manually, `--format png > out.png` opens with visible text (not blank boxes),
and running `--format png` with stdout a TTY prints the refusal and exits 2.
**Atomic commit message:** `feat: add --format png to the CLI`

### Slice 4: `--format pdf`
**Goal:** A user gets a single-page, selectable-text PDF of the diagram —
`node dist/cli.mjs '<url>' --format pdf > out.pdf`.
**Layers touched:** core (`src/core/render-pdf.ts`), CLI (`args.ts`,
`run.ts` dispatch arm), docs (`README.md`, `SKILL.md`, `CHANGELOG.md`).

Contents: the hand-written, dependency-free writer research validated —
base-14 Helvetica, WinAnsi with `?` for code points outside it (decision 16),
`\( \) \\` string escaping, y-flip, xref table. Reuses slice 3's binary sink,
TTY refusal, and advisory plumbing unchanged. Fold in **notes 1 and 9** PDF
half: the page-scale rule is its own named rule, `s_pdf`, from the 14,400pt
page limit (at the input ceiling `14400/42246 ≈ 0.34`, text near 5px — the
memory-bound rationale belongs to `s_png` only); MediaBox equals the
post-scale geometry; no lower floor.

**Tests:**
- `tests/core/render-pdf.test.ts` — raw bytes: `%PDF-` header, `%%EOF`, every
  xref offset points at its object, MediaBox equals post-scale geometry, cell
  text findable in the bytes, string escaping, non-WinAnsi → `?`.
- Oversize path: a synthetic tall grid asserts the scaled MediaBox, reported
  `s_pdf < 1`, and (via `run.test.ts`) the stderr advisory.
- Coordinate cross-check (the one-engine proof): the same wrapped line
  selected **by text content** in SVG and PDF output satisfies
  `x_pdf = x_svg` and `y_pdf = H − y_svg` with `H` from the layout, plus
  exactly one hand-computed baseline anchor.

**Verification checkpoint:** tests green; manually, `out.pdf` opens in a
viewer, text is selectable/searchable, and a TTY invocation refuses with
exit 2.
**Atomic commit message:** `feat: add --format pdf to the CLI`

## Cross-slice concerns

- **`PixelLayout` and the geometry engine** — defined in slice 1, consumed by
  every renderer; slice 2 changes only widths, never the box/line shape.
- **Width table + shipped font** — slice 1; resvg consumes the font at
  runtime only in slice 3. The `hmtx` comparison covers any entries note 4
  adds.
- **Binary output plumbing** (`Sink` widening, `stdoutIsTTY`, TTY refusal,
  scale advisory) — lands in slice 3, reused verbatim by slice 4.
- **`FORMATS` export + skill drift test** — slice 1; the exact-string
  assertion forces `SKILL.md`/`USAGE` updates in slices 3 and 4.
- **`CHANGELOG.md`** — each slice adds its bullet under `[Unreleased]`;
  **never run `version:bump`** despite `CLAUDE.md` (design decision 17).
- **Purity boundary** — `src/core/*` stays DOM-free and dependency-free every
  slice; the native dependency touches only `src/cli/`.
- **Stacked branch** — this branch sits on `2026-07-29-cli-and-agent-skill`
  (PR #8); no slice redoes or reverts anything from it.

## Out of structure

Restated from the design's Out of scope — the planner must not include:
changes to `src/export/image.ts`, the four extension bundles, or
`src/manifest.json`; an `--out` flag or any file-writing path; font
embedding/subsetting in the PDF; parsing SVG to produce the PDF; paginating
oversize PDFs; new Playwright goldens for CLI formats; a macOS unit-CI
runner; resvg/font caching; Windows validation; a title caption on image
formats (deferred open question).
