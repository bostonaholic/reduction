---
topic: cli-and-agent-skill
date: 2026-07-29
phase: questions
---

# Research Questions: cli-and-agent-skill

## Codebase context
- Scope: `src/core/*` (extract, ingredient, units, infer, layout, plan,
  render, types), `src/content/index.ts`, `src/background.ts`,
  `src/llm/claude.ts`, `src/messages.ts`, `build.mjs`, `package.json`,
  `tsconfig.json`, `tools/*.mjs`, `tests/*`, top-level `docs/`, `README.md`.
- Vocabulary: "extraction" = pulling raw ingredient/step text off a parsed
  `Document` (`extractRecipe`); "inference" = turning that raw data into a
  tree with a confidence score (`inferTree`, `flatTree`); "layout" = turning
  a tree into a positioned `Grid` of cells (`layout`); "render" = turning a
  `Grid` into an HTML string (`renderTable`). A "strategy" is one of the
  named approaches each stage tries in order.

## Topology
- Which modules under `src/core/` take a browser `Document`/DOM API as input
  versus plain data, and which of those modules import anything from the
  `chrome.*` namespace or another browser-only global?
- Which modules currently import from `src/llm/claude.ts`, and what
  network/storage APIs does that module depend on (e.g. `fetch`,
  `chrome.storage`)?
- What entry points currently call `extractRecipe`, `inferTree`/`flatTree`,
  `layout`, and `renderTable` in sequence, and where do those call sites live
  (`src/content/index.ts`, `tests/sites.test.ts`, `tools/debug.test.ts`)?
- Where does this repo already fetch or read an external page's HTML and turn
  it into a `Document` (or DOM-like object) outside of a live browser tab —
  e.g. `tools/capture-fixtures.mjs`, `tools/capture-fixtures-browser.mjs`,
  `tests/sites.test.ts`?

## Conventions
- What test framework, file naming, and directory structure does this repo
  use for both `src/core/*` unit tests (`tests/core/*.test.ts`) and
  Node-script-style tests (`tools/*.test.ts`)?
- What npm scripts exist in `package.json` today, and does any of them invoke
  a Node script directly as a command-line tool (arguments, stdin/stdout,
  exit codes) rather than through a test runner?
- Does `package.json` declare a `bin` field, a `type` field, or any packaging
  metadata (`files`, `exports`) relevant to distributing a Node executable
  from this package, and what module format (`ESM`/`CJS`) does `tsconfig.json`
  and `build.mjs` target?
- What conventions does this repo use for top-level documentation files (e.g.
  `README.md`, files under `docs/`) — heading structure, code-block style,
  and how existing docs describe the `src/core/*` pipeline stages?
- How does `build.mjs` decide which `src/*` entry points to bundle, in what
  format (`iife` vs `esm`), and where output lands (`dist/`)?

## Constraints
- What TypeScript types define the boundary between stages — `RawRecipe`,
  `Recipe`, `RecipeNode`, `Grid`, `Cell` in `src/core/types.ts` — and which of
  those are produced or consumed by DOM-free code versus DOM-dependent code?
- What is declared in `dependencies` versus `devDependencies` in
  `package.json` today (e.g. is `jsdom` a runtime dependency or dev-only), and
  what does that imply for code that needs to parse arbitrary HTML outside a
  browser content script?
- How is the optional Claude-based inference tier configured and gated today
  (`src/llm/claude.ts`, `STORAGE_KEYS` in `src/messages.ts`) — what values
  does it require (API key, model, effort) and where are they currently
  sourced from (`chrome.storage`)?
- What error types and error-handling patterns exist for the extraction stage
  (e.g. `NoRecipeFound` in `src/core/extract.ts`) and how are they currently
  surfaced to a caller?

## Reference points
- What is the most representative existing script in this repo that fetches
  one or more URLs over HTTP and processes the result outside a browser
  context (e.g. `tools/capture-fixtures.mjs`), and how does it structure its
  network requests, headers, and error/skip handling?
- What is the most representative existing standalone Node script in
  `tools/` that parses command-line arguments or environment variables (e.g.
  `tools/debug.test.ts`'s use of `process.env.FIXTURE`, `tools/make-icons.mjs`),
  and what conventions does it follow for input/output?
- Does this repository, or its `.github/` workflows, contain any existing
  reference to an agent-invocable tool definition, manifest, or documentation
  format (search for terms like "skill", "agent", "manifest", "tool" outside
  `src/manifest.json`) that already establishes a convention to follow?
