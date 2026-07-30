---
topic: 2026-07-29-cli-and-agent-skill
date: 2026-07-29
phase: design
revision: 2
---

# Design: cli-and-agent-skill

## Current state

The pipeline is pure below extraction. Only `extractRecipe(doc: Document)`
(`src/core/extract.ts:311`) touches DOM interfaces, and jsdom satisfies them —
`tests/sites.test.ts:35` already runs the full chain over jsdom documents. The
one production caller is the content script: `src/content/index.ts:192-222`
runs extract → `inferTree` → optional Claude (`treeFromPlan`) → `flatTree`
fallback → `layout` → `renderTable`. The Claude tier itself is
storage-agnostic: `callClaude(settings, …)` (`src/llm/claude.ts:122`) takes a
`ClaudeSettings` object; `chrome.storage` reads live only in
`src/background.ts:34-52`. One wrinkle: `callClaude` always sends the
browser-only `anthropic-dangerous-direct-browser-access` header
(`claude.ts:136`).

Packaging offers no CLI surface today. `package.json` has no `bin`, `files`,
`exports`, `main`, or lifecycle scripts, is `"private": true`, and has zero
runtime `dependencies` — jsdom is dev-only. `tsc` never emits
(`noEmit: true`); runnable JS comes only from esbuild via the hardcoded
`builds` array in `build.mjs:33-40`. `dist/` is gitignored (`.gitignore:2`)
and `build.mjs:19` deletes the whole tree at the start of every build, so
build outputs never exist in a fresh clone. CI uploads all of `dist/` as an
artifact named `extension` (`.github/workflows/ci.yml:52-56`).
`tools/capture-fixtures.mjs:43-65` is the only code that fetches a page over
HTTP outside a browser: browser-mimicking headers, a 30 s `AbortController`
timeout, and per-URL result objects.

No agent-skill convention exists anywhere in the repo (research confirms:
the only manifest is Chrome's MV3 `src/manifest.json`). This design
establishes one.

## Desired end state

A new entry point `src/cli/index.ts` bundles to `dist/cli.mjs` through
`build.mjs`. `node dist/cli.mjs <url>` fetches the page, parses it with
jsdom, runs the existing pipeline, and prints a table. `--format text`
(default) prints a monospace box-drawing table from the `Grid` plus the
`confidenceNote` sentence; `--format json` prints the `Recipe`, `Grid`, and
note as JSON; `--format html` prints the existing `renderTable` fragment.
`--claude` opts in to the Claude tier using `ANTHROPIC_API_KEY`. A `bin`
entry (`"reduction": "dist/cli.mjs"`) plus a new `prepare` script (runs the
build on `npm install` and `npm link`) make `npm link` / `npx` work from a
fresh clone after install; the package stays private and unpublished.

A project-level Skill ships at `.claude/skills/reduction/SKILL.md` with
`name`/`description` frontmatter. Its reach is deliberately narrow: Claude
Code discovers it only in sessions rooted in this checkout; an agent working
in another project gets nothing until someone copies the directory, and
`npm install` never delivers it (private package, no `files` field). The
Skill contains no parsing logic: it tells the agent to build once if
`dist/cli.mjs` is missing, invoke the CLI, pick a format, and interpret exit
codes and known failure modes. The README gains a short CLI + Skill section
following its existing H2 / `sh`-block conventions, stating the
pipeline-parity claim, the bot-blocking limitation, and the copy-the-Skill
instruction for other agents. The extension's four existing bundles,
`src/manifest.json`, and all extension behavior are unchanged.

## Patterns to follow

- Pipeline order and fallback ladder: mirror `src/content/index.ts:192-222`
  exactly (heuristic → Claude when confidence < threshold → flat → error).
- Fetch shape: `tools/capture-fixtures.mjs:43-65` — `HEADERS`, 30 s
  `AbortController`, reason strings like `HTTP 403` / `timeout`.
- jsdom construction: `new JSDOM(html).window.document`
  (`tests/sites.test.ts:35`).
- Build entry: one more object in the `builds` array (`build.mjs:33-40`),
  with per-entry overrides spread after `shared`.
- Renderer as a pure string function, snapshot-testable without a browser:
  `renderTable` (`src/core/render.ts:21`); reuse `confidenceNote`
  (`render.ts:45`).
- Loud, typed extraction failure: `NoRecipeFound` (`src/core/extract.ts:18-23`).
- Script doc-comment showing the invocation line, as every `tools/*.mjs` and
  `build.mjs:1-8` do.
- Tests: vitest with explicit imports, files at `tests/core/<module>.test.ts`;
  API-client tests via `vi.stubGlobal('fetch', …)`
  (`tests/llm/claude.test.ts:18-22`).

## Decisions made

1. **Single-repo scope.** `repos.md` is absent and research shows no
   cross-repo signal, so all work lands in this repo.
2. **The CLI is a fifth esbuild entry, not a `tools/` script.**
   `src/cli/index.ts` → `dist/cli.mjs`; per-entry options `platform: 'node'`,
   `target: 'node22'`, `format: 'esm'`, a `#!/usr/bin/env node` banner, and
   `external: ['jsdom']`. Alternative: a standalone `tools/reduction.mjs` —
   rejected because plain Node cannot import the `.js`-suffixed `.ts` core
   modules (`noEmit`, bundler resolution); only esbuild can. Assumption —
   chosen without user review.
3. **jsdom moves from `devDependencies` to `dependencies` — the package's
   first runtime dependency.** The shipped `dist/cli.mjs` needs it at run
   time, so declaring it is the honest packaging. Extension bundles are
   unaffected: no extension entry imports jsdom, and esbuild bundles only
   what an entry imports. Alternatives: bundle jsdom into `cli.mjs` (jsdom's
   dynamic requires bundle badly); switch to a lighter parser like linkedom
   (new dependency, untested against the three extract strategies); keep
   dev-only (the built CLI would break outside a dev checkout — silent
   breakage). Assumption — chosen without user review.
4. **Add `"bin": {"reduction": "dist/cli.mjs"}` and
   `"prepare": "node build.mjs"`; keep `"private": true`.** The bin target
   does not exist in a fresh clone: `.gitignore:2` excludes `dist/` and
   `build.mjs:19` wipes it each build. `prepare` runs on both `npm install`
   and `npm link`, so the target exists before npm creates the symlink —
   this is what makes the primary acceptance signal (`task.md:33-35`) hold
   from a clean checkout. Trade-off: `npm ci` also runs `prepare`, so CI
   builds during install and again at its explicit build step
   (`ci.yml:37-38`) — redundant but idempotent and cheap (esbuild).
   Alternatives: document "run `npm run build` first" (leaves `npm link`
   broken by default on the primary acceptance path); npm script only (the
   signal names a runnable command). Assumption — chosen without user
   review.
5. **Three output formats; `text` is the default.** `text` comes from a new
   pure function `renderText(recipe, grid, width): string` in
   `src/core/render-text.ts`: box-drawing borders honoring `rowSpan`/
   `colSpan` from `Cell` (`src/core/types.ts:71-78`), word-wrap inside
   cells, the `confidenceNote` text appended after the table. The width is
   `process.stdout.columns` when stdout is a TTY, else 100 columns (piped
   output has no terminal width); the CLI passes it in, keeping `renderText`
   pure. `json` is `JSON.stringify` of `{recipe, grid, note}` — for agents
   and scripts. `html` is the existing `renderTable` fragment — parity with
   the extension, pipeable to a file. Alternatives: Markdown tables (cannot
   express rowspan — the format's defining feature); HTML-only (useless in a
   terminal, the named user's context). Assumption — chosen without user
   review.
6. **The Claude tier is opt-in via `--claude`, never automatic.** Developers
   commonly export `ANTHROPIC_API_KEY`; auto-escalating on its presence
   would spend API money silently — rejected for surprise cost. With the
   flag: key from `ANTHROPIC_API_KEY`, model/effort fixed at
   `DEFAULT_MODEL`/`DEFAULT_EFFORT` (`claude.ts:55,76`), escalation only
   when `recipe.confidence < 0.6` (strict `<`, `CLAUDE_THRESHOLD`,
   `src/content/index.ts:23,207`), and on any Claude failure the CLI warns
   on stderr and keeps the heuristic result — mirroring `askClaude`'s
   never-throw contract (`content/index.ts:171-190`). Assumption — chosen
   without user review.
7. **Gate the browser header behind a required `browser: boolean`.**
   `ClaudeSettings` gains `browser: boolean` — required, not optional;
   `callClaude` sends `anthropic-dangerous-direct-browser-access` only when
   it is `true`; `src/background.ts:48-52` (the sole production construction
   site) passes `browser: true`; the CLI passes `browser: false`. Required
   because `browser?: boolean` would let every existing caller keep
   compiling while the default silently flips to header-off on the shipped
   extension path; a required field turns a missed call site into a compile
   error, at the cost of one line in `background.ts` and the tests.
   Alternative: leave the header unconditional — it happens to be ignored
   server-side today, but sending a browser-only opt-in from Node is
   misleading and fragile. A test in `tests/llm/claude.test.ts` asserts
   header presence for `browser: true` and absence for `false`. Assumption —
   chosen without user review.
8. **Fetch mirrors `capture-fixtures.mjs`, minus its minimum-size check,
   plus a maximum.** Same `HEADERS` (`capture-fixtures.mjs:43-48`), same
   30 s `AbortController`. The CLI does **not** copy the under-5000-bytes
   `suspiciously small` rejection (`capture-fixtures.mjs:57`) — that check
   guards fixture quality; a short but valid recipe page must reach
   extraction and fail only as `NoRecipeFound` if truly empty. The CLI adds
   what the script lacks: bodies over 25 MiB are rejected with
   `too large (<n> bytes)`, exit 1, before jsdom parses them. The check runs
   after `res.text()`, so peak memory during download itself is not
   stream-bounded — accepted for a single-shot process. Pass `res.url` (the
   post-redirect URL) as `sourceUrl` to `inferTree`, matching what
   `location.href` gives the content script. Assumption — chosen without
   user review.
9. **Exit codes: 0 success, 1 operational failure, 2 usage error.** Exit 2
   covers everything detectable before work starts: bad flags, bad URL
   syntax, and `--claude` without `ANTHROPIC_API_KEY` — classed as usage
   rather than operational because the remedy is in the invocation
   environment and no network work has begun. Exit 1 covers failures during
   the run. Errors go to stderr; stdout carries only rendered output, so
   pipes stay clean. If stdout closes early (`… | head`), the resulting
   `EPIPE` is caught and the process exits 0 quietly — the consumer took
   what it wanted; crashing would contradict this contract.
   `NoRecipeFound.message` is printed verbatim — it already names each
   failed strategy (`extract.ts:311-329`). Assumption — chosen without user
   review.
10. **Argument surface is `<url> [--format text|json|html] [--claude]
    [--help]`, parsed by hand.** Repo precedent is
    `process.argv.includes('--watch')` (`build.mjs:17`); a parsing library is
    a new dependency for three flags. Parsing lives in a pure exported
    function so it unit-tests without spawning. Assumption — chosen without
    user review.
11. **The Skill lives at `.claude/skills/reduction/SKILL.md`.** Claude Code
    discovers project skills there with zero install; other agents get a
    README note to copy the directory. The Skill drives the CLI only — build
    if `dist/cli.mjs` is absent, run it, prefer `--format text` for showing a
    user and `--format json` for programmatic use, never pass `--claude`
    unless the user asks (it spends their API budget), and expect exit 1
    with an explanatory stderr line on bot-blocked or recipe-free pages.
    Because this tracks `.claude/` for the first time, add
    `.claude/worktrees/` to `.gitignore` so local worktrees stay invisible.
    Alternative: a repo-root `skills/` directory — no agent discovers it
    without extra wiring. Assumption — chosen without user review.

## Out of scope

- Publishing to npm; adding `files`/`exports`/`main`; removing `private`.
- Reading local HTML files or stdin — URL input only.
- A Playwright-rendered fetch fallback for bot-blocking sites (the
  extension already covers those in a real browser session).
- Markdown, SVG, or PNG output from the CLI (SVG/PNG export stays in the
  extension shell).
- Model/effort selection for the CLI's Claude tier (flags or env vars);
  defaults only.
- Automation that installs the Skill into `~/.claude/skills/`.
- Excluding `dist/cli.mjs` from the CI `extension` artifact (see Risks).
- CHANGELOG/version bump: this branch's base (`origin/main` @ `12d7df8`)
  lacks `CHANGELOG.md`, `tools/version.mjs`, and `docs/versioning.md`; they
  live on the unmerged `versioning-and-changelog` branch. Create none of
  them here.
- Terminal color output.

## Edge cases

- **Boundary values:** recipe extracted but no ingredient attaches to the
  tree (`recipe.root` null after `flatTree`) → exit 1 with the content
  script's message ("Found a recipe but no ingredients to lay out",
  `content/index.ts:217`). Single-ingredient, single-step recipe → 1×N grid
  renders without spans. Empty `title` → text/html output omits the caption
  line, as `renderTable` already does (`render.ts:37-39`). Very long cell
  text → wrapped at the renderer's width, never truncated. `--claude` on a
  page with confidence ≥ 0.6 → no Claude call (escalation is strict `<`,
  `content/index.ts:207`, so exactly 0.6 stays heuristic); one stderr note
  (`confidence 0.82 ≥ 0.6 — Claude not needed`) so the flag does not look
  ignored; exit 0.
- **Invalid inputs:** no URL argument, or a non-http(s) argument → usage
  text on stderr, exit 2. Unknown `--format` value or unknown flag → exit 2.
  A URL returning non-HTML (JSON, PDF bytes) → jsdom still parses; extract
  finds nothing; `NoRecipeFound` → exit 1.
- **Failure paths:** non-2xx response → `fetch failed: HTTP <status>`,
  exit 1. 30 s timeout → `timeout`, exit 1. DNS/network error → the error
  message, exit 1. `NoRecipeFound` → its message verbatim, exit 1. Stdout
  closed early by the consumer (`… | head`) → `EPIPE` caught, exit 0 with no
  error output (Decision 9). With `--claude`: API error, refusal, or
  unusable reply → one stderr warning, heuristic result printed, exit 0
  (matches the extension's plan-B ladder).
- **Concurrency:** the CLI is a stateless single-shot process; it writes no
  files and holds no locks, so parallel invocations are safe and idempotent.
- **Authorization:** paywalled or login-gated pages → HTTP 401/403 or
  `NoRecipeFound`, exit 1 — no credential support. `--claude` without
  `ANTHROPIC_API_KEY` → usage error, exit 2 (precheck failure; see
  Decision 9). Invalid key → Claude API 401 → warn and fall back, exit 0.
- **Resource limits:** response bodies over 25 MiB → `too large`, exit 1
  (Decision 8); the body is buffered before the check, so download-time
  memory is unbounded by design — accepted for a single-shot process, stated
  rather than hidden. jsdom never sees a body over the cap. Claude spend is
  bounded by the existing `max_tokens: 16000` (`claude.ts:140`) and the
  opt-in flag.

## Open questions (deferred)

- Whether a spawn-the-built-CLI smoke test earns its keep (it needs
  `npm run build` before vitest) — decide at structure phase; unit tests for
  `renderText` and the arg parser carry correctness either way.
- `renderText` width math treats every code point as width 1; double-width
  characters may misalign borders. Accept initially; revisit if real recipes
  hit it.
- An `npm run cli` convenience script — trivially addable later if typing
  `node dist/cli.mjs` grates.

## Risks

- **First runtime dependency.** jsdom (plus transitive deps) enters
  `dependencies`, ending the zero-dependency property. Extension output is
  provably unaffected (no extension entry imports it), but the install
  footprint grows.
- **`callClaude` signature change touches the extension path.** Rollout is
  atomic: the type, `background.ts`, the CLI, and the tests change in one
  commit, and the required field (Decision 7) makes a half-applied state
  uncompilable. Rollback is a single-commit revert; the `browser` flag is
  code-supplied at the call site and never persisted to `chrome.storage`,
  so no stored state migrates either way. Field detection: losing the
  header would be silent today (the API ignores it server-side, and
  `askClaude` never throws — a future enforcement would show as
  low-confidence pages quietly falling back to flat layout), so the guards
  are the header-presence/absence test pair in `tests/llm/claude.test.ts`
  and a manual check of the service worker's network panel.
- **Bot-blocking sites degrade the CLI below the extension.** Plain `fetch`
  gets 403s where the extension rides a real browsing session (the reason
  `tools/capture-fixtures-browser.mjs` exists). SKILL.md and README must
  state this limitation loudly.
- **`dist/cli.mjs` lands inside the unpacked-extension directory and in the
  existing CI artifact.** Chrome ignores files the manifest does not
  reference, so loading is unaffected — and CI already uploads all of
  `dist/` as the `extension` artifact (`.github/workflows/ci.yml:52-56`),
  which will now carry a Node CLI bundle. Accepted: the artifact is a
  manual-download convenience, not a store submission; no exclusion step is
  added (see Out of scope).
- **Base-branch constraint.** This branch predates the versioning tooling;
  merging after `versioning-and-changelog` will require a version bump and
  changelog entry at that point, not in this change.
- **Tracking `.claude/` for the first time** exposes local `.claude/`
  content to git status; the `.claude/worktrees/` ignore entry mitigates the
  known noise source.
