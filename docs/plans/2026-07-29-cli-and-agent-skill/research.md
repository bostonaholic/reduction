---
topic: 2026-07-29-cli-and-agent-skill
date: 2026-07-29
phase: research
---

# Research

Merged from two isolated agents (`file-finder`, `researcher`), each of which read
only `questions.md`.

## Base-branch caveat (read this first)

The worktree is branched off `origin/main` (`12d7df8`). The `file-finder` resolved
its paths against the **home checkout**, which carries uncommitted work plus a
local branch `versioning-and-changelog`. These files it reported **do not exist in
this worktree**:

- `CHANGELOG.md`
- `tools/version.mjs`
- `docs/versioning.md`
- `src/core/grade.ts` (and `tests/core/grade.test.ts`)
- the version-check job in `.github/workflows/ci.yml`

Everything else below was verified by the `researcher` directly in the worktree and
holds.

## Tech stack

TypeScript 7 (strict, `noEmit`), ESM (`"type": "module"`), target ES2022. esbuild
0.28 bundles (`build.mjs`); vitest 4 for unit tests; Playwright 1.62 for e2e; jsdom
29 (dev-only); Node 22 in CI. The Chrome MV3 extension is the only shipped artifact.

## Directory conventions

- `src/core/*` — pure pipeline
- `src/content/`, `src/background.ts`, `src/options/`, `src/print/`, `src/export/` — extension shell
- `src/llm/claude.ts` — API client
- `tools/*.mjs` — standalone Node scripts; `tools/*.test.ts` — vitest-run reports
- `tests/core/`, `tests/llm/`, `tests/sites.test.ts` — unit and golden tests
- `tests/e2e/` — Playwright specs
- Top-level docs: `README.md` only; `docs/` holds only `docs/plans/<id>/` artifacts

## Answers

### Topology

**DOM dependence is confined to one function.** Only `extract.ts` takes a
`Document` — `extractRecipe(doc: Document)` (`src/core/extract.ts:311`); every
strategy function takes `Document`. `types.ts`, `ingredient.ts`, `units.ts`,
`infer.ts`, `plan.ts`, `layout.ts`, `render.ts` are plain-data string/tree
functions. **No `src/core/` module references `chrome.*` or any browser global**
(grep-confirmed; `README.md:61` states this as a design rule). `extract.ts` uses
only DOM interface types (`Document`, `Element`), which jsdom satisfies.

**Importers of `src/llm/claude.ts`:** `src/background.ts:9`
(`callClaude`, `resolveModel`, `resolveEffort`), `src/options/options.ts:6`
(option lists), `tests/llm/claude.test.ts:11`. `claude.ts` itself depends only on
global `fetch` (`src/llm/claude.ts:129`) and imports `PLAN_SCHEMA`/`Plan` from
`src/core/plan.ts`. It does **not** touch `chrome.storage` — settings arrive as
`ClaudeSettings {apiKey, model, effort}` (`claude.ts:115-119`). The
`chrome.storage.local` reads happen in `src/background.ts:34-52`.

**Full-pipeline call sites** (extract → infer → layout → render):

| Call site | Chain |
| --- | --- |
| `src/content/index.ts:192-222` | `extractRecipe(document)` → `inferTree(raw, location.href)` → optional Claude via `treeFromPlan` → `flatTree` fallback → `layout(recipe)` → `renderTable` inside `showTable` |
| `tests/sites.test.ts:36-72` | same chain over jsdom fixtures |
| `tools/report.test.ts:16-18` | extract / infer / layout |
| `tools/debug.test.ts:19` | extract + ingredient parsing only |

**HTML → `Document` outside a live tab.** `tools/capture-fixtures.mjs:54` fetches
with `fetch()` and writes raw HTML; `tools/capture-fixtures-browser.mjs:45-53` uses
Playwright `page.content()` for the rendered DOM. Parsing to a `Document` is
`new JSDOM(html).window.document` in `tests/sites.test.ts:35`, `tools/debug.test.ts:18`,
and `tools/report.test.ts`.

### Conventions

**Tests.** vitest with explicit imports (`import { describe, expect, it } from 'vitest'`)
— no globals used despite `vitest/globals` in tsconfig types. Unit tests live at
`tests/core/<module>.test.ts`, `tests/llm/claude.test.ts`, `tests/sites.test.ts`;
the default config includes `tests/**/*.test.ts` (`vitest.config.ts:5`).
`tools/*.test.ts` run only under `vitest.report.config.ts` via `npm run report`.
Playwright specs are `.spec.ts` under `tests/e2e/`. Skip-if-absent is idiomatic:
`describe.skipIf(names.length === 0)` (`tests/sites.test.ts:28`), `it.skipIf(!name)`
(`tools/debug.test.ts:16`).

**npm scripts** (`package.json:7-19`): build, typecheck, test, test:watch, e2e,
e2e:golden, e2e:live, capture, icons, report, dev. `capture` and `icons` invoke Node
scripts directly (`node tools/*.mjs`); those scripts take no arguments, log status
lines to stdout, and never set a nonzero exit code for per-site failures
(`capture-fixtures.mjs` prints `FAIL name reason` and continues).

**Packaging metadata.** `package.json` has **no `bin`, `files`, `exports`, `main`, or
`dependencies` field**; it is `"private": true`, `"type": "module"`, and everything
sits in `devDependencies` (`package.json:20-29`). tsconfig sets `module: ESNext`,
`moduleResolution: bundler`, `allowImportingTsExtensions`, `noEmit: true` — TS is
never compiled to JS on disk; only esbuild bundles it. Imports carry `.js` suffixes
on `.ts` sources (e.g. `content/index.ts:9-17`).

**Docs.** A single `README.md`: H1 title, H2 sections (Install / How it works /
Privacy / Development / Current state), `sh` fenced blocks, an ASCII-art diagram, and
a pipeline table mapping stage → module → contract (`README.md:53-59`, e.g.
`extract | src/core/extract.ts | Document → RawRecipe`).

**build.mjs.** A hardcoded `builds` array (`build.mjs:33-40`): `src/content/index.ts`
→ `dist/content.js` as **iife** (Chrome forbids module content scripts);
`background.ts` / `options.ts` / `print.ts` → esm. Shared opts: `bundle: true`,
`target: 'chrome114'`, minify unless `--watch`, CSS loaded as text. Static files are
copied to `dist/`; output is always `dist/`.

### Constraints

**Type boundary** (`src/core/types.ts`): `RawRecipe` `{title, ingredientLines,
stepTexts, yield?, strategy}` (`:46`) is produced by the DOM-dependent
`extractRecipe`; everything downstream is DOM-free — `Recipe` `{title, banners,
root: RecipeNode|null, yield?, sourceUrl, extraction, inference, confidence}` (`:55`),
`RecipeNode` (`:35`), `Grid`/`Cell`/`CellKind` (`:68-85`). `inferTree(raw, sourceUrl)`
(`infer.ts:291`), `flatTree` (`:463`), `treeFromPlan(plan, raw, sourceUrl)`
(`plan.ts:74`), `layout(recipe): Grid` (`layout.ts:83`), `renderTable(recipe, grid): string`
(`render.ts:21`), `validateGrid` (`layout.ts:193`) all consume and produce plain data.
`renderTable` returns an HTML string using no DOM APIs.

**Dependencies.** Zero runtime `dependencies`. `jsdom`, `@types/jsdom`, esbuild,
vitest, playwright, and typescript are all `devDependencies`. Non-browser HTML
parsing today relies on dev-only jsdom, used exclusively in tests and tools.

**Claude tier config.** Stored in `chrome.storage.local` under `STORAGE_KEYS` =
`anthropicApiKey`, `useClaudeFallback`, `claudeModel`, `claudeEffort`
(`src/messages.ts:26-32`); read in `background.ts:34-52`, gated on
`enabled !== false && apiKey` (otherwise replies `{ok:false, error:'no-api-key'}`).
`resolveModel`/`resolveEffort` fall back to `DEFAULT_MODEL` (claude-opus-5) and
`DEFAULT_EFFORT` (`'low'`) for unknown values (`claude.ts:83-90`). The content script
escalates only when `recipe.confidence < 0.6` (`content/index.ts:23,207`). The request
is `POST https://api.anthropic.com/v1/messages` with headers `x-api-key`,
`anthropic-version: 2023-06-01`, and `anthropic-dangerous-direct-browser-access: true`;
structured output via `output_config.format.json_schema` = `PLAN_SCHEMA` (`plan.ts:28`);
effort is omitted for `supportsEffort: false` models (`claude.ts:146-149`).

**Error handling.** `NoRecipeFound extends Error` (`extract.ts:18-23`).
`extractRecipe` accumulates per-strategy failure reasons and throws
`NoRecipeFound('No recipe on this page (json-ld found nothing; …)')`
(`extract.ts:311-329`). The content script catches it and renders the message
(`content/index.ts:198-203`). `callClaude` throws a plain `Error` carrying status and
detail (`claude.ts:154-171`); the background converts it to `{ok:false, error}`;
`askClaude` in the content script never throws — it returns null
(`content/index.ts:171-190`).

### Reference points

**HTTP-fetching script.** `tools/capture-fixtures.mjs` — `SITES` as `[name, url]`
pairs (`:18-41`), browser-mimicking `HEADERS` (UA / Accept / Accept-Language, `:43-48`),
a per-request `AbortController` 30s timeout, result objects `{name, url, ok, reason|bytes}`,
a sequential loop, aligned `ok`/`FAIL` stdout lines, a written `tests/fixtures/sources.json`
manifest, and a final `captured N/M` summary. Failures never fail the process. The
Playwright variant is `tools/capture-fixtures-browser.mjs`.

**Argument and env conventions.** `build.mjs` checks `process.argv.includes('--watch')`
(`:17`) — the only argv parsing in the repo. `tools/debug.test.ts:14` reads
`process.env.FIXTURE` and skips without it, writing to `process.stdout`.
`tools/make-icons.mjs` and the capture scripts take no input. Every `.mjs` script opens
with a doc comment showing its invocation line.

**Agent/skill conventions: none exist.** The only manifest is Chrome's MV3
`src/manifest.json`; `.github/workflows/ci.yml:42-49` merely validates
`dist/manifest.json`. There are no SKILL, agent, or tool-definition files anywhere
outside `docs/plans/` artifacts.

## Patterns observed

- A staged "strategies tried in order" pattern with an explicit strategy tag on the
  output (the extract STRATEGIES table, `extract.ts:298`; the inference ladder
  heuristic → claude → flat, `content/index.ts:205-215`).
- Confidence propagated as data (`Recipe.confidence`, `confidenceNote` in
  `render.ts:45`) rather than thrown.
- Heavy doc comments at the top of each file explaining intent; `satisfies Message` /
  `satisfies ClaudeReply` for message typing.

## Test patterns

vitest `describe`/`it`/`expect`; `describe.each(names)` over fixture files; jsdom to
build Documents. Fixtures are uncommitted and suites self-skip (`sites.test.ts:5-8,28`).
`vi.stubGlobal('fetch', …)` tests the API client without network
(`tests/llm/claude.test.ts:18-22`). Report-style "tests" act as inspection tools under a
separate vitest config.

## Reusable components

The whole DOM-free pipeline: `inferTree`, `flatTree`, `treeFromPlan`, `layout`,
`validateGrid`, `renderTable`, `confidenceNote`, `parseIngredient` — plus the
DOM-generic `extractRecipe`, which works on any `Document`, jsdom included.
`plainText` / `splitProse` (`extract.ts:32,104`) are pure string utilities.
`resolveModel` / `resolveEffort` / `MODELS` / `EFFORTS` and `callClaude` are
storage-agnostic.

## Constraints summary

Hard:

- No runtime `dependencies` exist today.
- `tsc` never emits JS (`noEmit`) — any Node-executable output must go through esbuild
  or ship as `.mjs`.
- `.js`-suffixed TS imports require bundler-aware or `allowImportingTsExtensions`-aware tooling.
- The `Document` type comes from `lib: DOM`; at runtime only a real DOM or jsdom satisfies it.
- `callClaude` unconditionally sends the browser-only
  `anthropic-dangerous-direct-browser-access` header (`claude.ts:136`).

Soft:

- The strategy-ladder plus confidence-reporting idiom.
- Script doc-comment invocation headers.
- Aligned `ok`/`FAIL` console reporting.
- Fixtures are never committed.

## Suggested reading order

1. `src/core/types.ts`, `src/messages.ts` — contracts
2. `src/core/extract.ts` → `ingredient.ts` + `units.ts` → `infer.ts` → `plan.ts` →
   `layout.ts` → `render.ts` — the pipeline
3. `src/content/index.ts`, `src/background.ts`, `src/llm/claude.ts`,
   `tests/sites.test.ts` — integration points
4. `build.mjs`, `package.json`, `vitest.config.ts`, `tools/capture-fixtures.mjs`,
   `tools/debug.test.ts` — build and tooling patterns

## Open questions

None from the researcher — every question was answerable from the codebase. The
base-branch caveat at the top is an orchestrator-level finding, not a research gap.
