# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Reduction is a Chrome MV3 extension that turns a recipe page into a Cooking For
Engineers style table — ingredients as rows, operations spanning the rows they
consume. No framework, no runtime dependencies; esbuild bundles TypeScript into
`dist/`.

## Commands

```sh
npm run build          # bundle into dist/
npm run dev            # esbuild watch
npm run typecheck      # tsc --noEmit
npm test               # vitest, unit + fixture suites
npm run e2e:golden     # install check + golden master (the e2e you usually want)
npm run e2e            # ALSO hits live recipe sites — network, 180s timeouts
npm run report         # per-site quality report (confidence, tree depth, shape)
npm run capture        # regenerate the local HTML fixtures
```

Running a single test:

```sh
npx vitest run tests/core/layout.test.ts
npx vitest run -t "merges consecutive fillers"        # by test name
npx playwright test tests/e2e/golden.spec.ts -g brownies
```

Two things that bite:

- **`npm run e2e` is not the fast path.** `playwright.config.ts` sets
  `testDir: './tests/e2e'` with no filter, so it also runs
  `live-sites.spec.ts` against real publishers. Use `npm run e2e:golden`
  (which already includes `install.spec.ts`) unless you specifically want the
  live check.
- **Build before any e2e run.** `tests/e2e/golden.spec.ts` reads
  `dist/content.js` and evaluates it in the page, so a stale `dist/` silently
  tests old code.

## Architecture

### The core is browser-free

Everything under `src/core/` is plain data in, plain data out — no `chrome.*`,
no globals. `extract.ts` takes a `Document` as an argument rather than reaching
for one, which is why the whole pipeline runs under jsdom in Node. Keep it that
way: the extension shell is a thin adapter, and anything that needs a browser
belongs in `src/content/`, `src/export/`, or `src/background.ts`.

```
extract    src/core/extract.ts     Document → RawRecipe   (JSON-LD → microdata → DOM heuristics)
normalize  src/core/ingredient.ts  lines → quantities, units, metric equivalents
           src/core/units.ts
infer      src/core/infer.ts       flat steps → tree + confidence
layout     src/core/layout.ts      tree → positioned cells with spans
render     src/core/render.ts      cells → HTML string
```

### The layout invariant

The table is a left-to-right rendering of a tree:

```
column(node)  = depth from the ingredient leaves
rowSpan(node) = leaf count of its subtree
row order     = depth-first traversal of the leaves
```

The DFS row order is load-bearing — it is what guarantees an operation's inputs
occupy a *contiguous* block of rows, which is the only thing a `rowspan` can
cover. A fourth rule bridges gaps with merged filler cells.

`validateGrid()` in `layout.ts` proves a grid tiles its rectangle exactly (no
holes, no overlaps). Reach for it when a layout change looks suspicious.

### Inference is a three-tier ladder

1. **Local heuristics** (`infer.ts`) — always, free, offline. Ingredients match
   steps by their most distinctive phrase, longest first.
2. **Claude** — only when confidence < 0.6 (`CLAUDE_THRESHOLD` in
   `src/content/index.ts`) and only with a user-supplied key. Structured
   outputs cannot express a recursive schema, so the model returns a **flat**
   plan referencing ingredients and earlier steps by index; `src/core/plan.ts`
   builds the tree from it. That keeps the entire Claude path testable with no
   network call.
3. **Flat table** (`flatTree`) — always works, never claims to understand.

The overlay labels its own confidence, so a bad parse is visible rather than
quietly wrong.

### Extension shell

`background.ts` (service worker) exists for the two things a content script
cannot do: call `api.anthropic.com` cross-origin, and open an extension page for
printing. The message contract is the whole of `src/messages.ts` — keep it
there.

Build constraints worth knowing before you touch `build.mjs`:

- The content script is bundled as an **IIFE**; Chrome will not load a module
  content script.
- `overlay.css` is bundled with the `text` loader because it is injected as a
  string into a shadow root, not emitted as a stylesheet.

### Card correctness

`layout.ts` proves a card can be *drawn*. `src/core/grade.ts` asks whether it is
*true* — a tree can tile perfectly and still tell you to cook the yogurt. The
rules are numbered in `docs/recipe-card-rules.md` across three tiers: **S**
structural, **F** faithfulness, **L** legibility. The F rules work from the
source text, never from what the tree decided, so the grader cannot just agree
with the inference. F8 and F9 need a human-authored reference card and are
deliberately absent rather than faked.

### Export surfaces

`toSvg`/`toPng` in `src/export/image.ts` receive an `HTMLTableElement`, **not** a
`Recipe` — they redraw the table from measured DOM geometry
(`table.querySelectorAll('td')`) rather than reimplementing layout. Anything
that must appear in an exported image either lives in a `td` or needs explicit
new drawing plus a signature change.

Each surface owns its own escaper on purpose — `escapeHtml` (`core/render.ts`),
`escapeXml` (`export/image.ts`), and a stricter `escape` in
`content/index.ts` that also handles single quotes. Use the one belonging to the
surface you are editing; do not consolidate them. URL *policy* is shared
(`src/export/source-url.ts`); URL *encoding* is not.

## Tests

`tests/` mirrors `src/`. Notable suites:

- `tests/core/layout.test.ts` pins the layout engine against a reference
  brownie diagram — exact rowspans, column indices, filler merging, row order.
- `tests/sites.test.ts` runs the pipeline over HTML captured from 15 real sites.
  The fixtures are third-party page copies, so they are **not committed** —
  generate them with `npm run capture`; the suite skips when they are absent.
- `tests/e2e/golden.spec.ts` is the golden master.

### Golden master

Six hand-written recipes in `tests/e2e/golden-pages/` render to committed
reference images. Two images per recipe, because they come from renderers that
regress independently: the on-screen table (browser layout from our
rowspan/colspan) and the exported PNG (our own canvas code). A seventh page
there, `demo.html`, is the README screenshot subject — it has no reference
image and appears in no test, so adding it to `FIXTURES` would demand
snapshots that do not exist.

```sh
npx playwright test tests/e2e/golden.spec.ts --update-snapshots
```

- References are platform-suffixed (`-darwin.png`) because fonts rasterize
  differently per OS. Regenerate on the platform you test on and review the
  diff Playwright writes to `test-results/` before committing.
- The suite also asserts each fixture's row, column, and banner counts, with the
  expected numbers hard-coded. When a golden fails, those tell you whether the
  diagram is genuinely wrong or merely moved — and a change to grid shape means
  updating them deliberately.
- Fixtures load over a routed `http://golden.local/` origin, not `file://`, so
  `location.href` stays deterministic across machines.

## CI

`.github/workflows/ci.yml` runs two jobs: a fast `unit` gate (typecheck, unit
tests, build, manifest sanity check) on Linux, and `golden` on **macOS** —
required, because the reference images are `-darwin`. Live sites run on a
weekly schedule in a separate workflow with `continue-on-error: true`; a failure
there is a signal to look, not a reason to block a PR.
