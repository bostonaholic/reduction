---
topic: 2026-07-29-cli-and-agent-skill
date: 2026-07-29
phase: structure
---

# Structure: cli-and-agent-skill

Six slices, ordered by user value. Base-branch constraint (design, Out of
scope): `CHANGELOG.md`, `tools/version.mjs`, and `docs/versioning.md` do not
exist on this branch (base `12d7df8`) and MUST NOT be created — no version
bump or changelog entry in any slice.

## Slices

### Slice 1: Run the recipe pipeline from the command line (JSON and HTML)
**Goal:** `node dist/cli.mjs <url> --format json|html` fetches a page, runs
extract → infer → flat-fallback → layout, and prints JSON or the
`renderTable` fragment; usage errors exit 2, run failures exit 1.
**Layers touched:** build (`build.mjs` fifth entry: `platform: 'node'`,
`target: 'node22'`, esm, shebang banner, `external: ['jsdom']`), packaging
(jsdom `devDependencies` → `dependencies`, Design Decision 3), CLI arg
parsing + fetch + pipeline wiring (`src/cli/index.ts`), tests.
**Tests:**
- `tests/cli/args.test.ts` — pure parser: accepts `<url> [--format
  json|html] [--help]`; missing URL, non-http(s) URL, unknown flag, unknown
  format → usage error (exit-2 class); `--help` → help text on **stdout**,
  exit 0 (review finding 9; the error form stays stderr/exit 2).
- `tests/cli/run.test.ts` "happy path" — `vi.stubGlobal('fetch', …)` with
  fixture HTML: stdout carries `{recipe, grid, note}` JSON or the
  `renderTable` fragment, exit 0, stderr empty.
- `tests/cli/run.test.ts` "failure ladder" — HTTP 500 → `fetch failed:
  HTTP 500`, exit 1; `NoRecipeFound` message printed verbatim, exit 1;
  recipe with null root → "Found a recipe but no ingredients to lay out",
  exit 1 (design Edge cases, invalid inputs / failure paths).
**Verification checkpoint:** `npm run build` emits the four extension
bundles unchanged plus `dist/cli.mjs`; `node dist/cli.mjs <real-url>
--format json` prints JSON; `npm test` and `npm run typecheck` green.
**Atomic commit message:** `feat: run the recipe pipeline from the command line`

Notes: fetch here is the minimal `capture-fixtures.mjs` shape — `HEADERS`
plus status check; limits and interruption harden in slice 4. Default
format is temporarily `json` (flipped in slice 2 — see Cross-slice
concerns). Help text describes `html` as "the same markup the extension
renders" — never "parity" (review finding 10). CLI internals (`parseArgs`,
a run function with injectable fetch/streams) are pure exported functions
so tests never spawn a process (Design Decision 10).

### Slice 2: Box-drawing text table as the default output
**Goal:** `node dist/cli.mjs <url>` with no flags prints a monospace
box-drawing table plus the `confidenceNote` sentence.
**Layers touched:** core renderer (new pure `src/core/render-text.ts`),
CLI (default flip, width from `process.stdout.columns` when TTY else 100 —
passed in, keeping `renderText` pure; Design Decision 5), tests.
**Tests:**
- `tests/core/render-text.test.ts` "spans" — grid with `rowSpan`/`colSpan`
  renders aligned borders; `confidenceNote` appended after the table.
- `tests/core/render-text.test.ts` "wrapping" — very long cell text wraps
  at the given width, never truncated (design Edge cases, boundary values).
- `tests/core/render-text.test.ts` "degenerate grids" — single-ingredient
  1×N grid renders without spans; empty `title` omits the caption line.
**Verification checkpoint:** run on a real URL in a terminal — borders
aligned at terminal width; `… > out.txt` wraps at 100 columns.
**Atomic commit message:** `feat: render a box-drawing text table as the CLI default`

Notes: code-point width 1 is accepted (design Open questions — deferred,
not lost); no double-width handling in this change.

### Slice 3: Opt-in Claude escalation via `--claude`
**Goal:** on a low-confidence page, `--claude` with `ANTHROPIC_API_KEY`
improves the tree via the existing Claude tier; the browser-only header is
sent only from the extension.
**Layers touched:** LLM client (`ClaudeSettings` gains required
`browser: boolean`; header gated in `callClaude`), extension background
(`browser: true` at the sole construction site), CLI (`browser: false`,
env-key precheck, strict `< 0.6` threshold, never-throw fallback), tests.
**Tests:**
- `tests/llm/claude.test.ts` "browser header" — header present for
  `browser: true`, absent for `false` (the design's stated detection guard).
- `tests/cli/run.test.ts` "claude gating" — `--claude` without
  `ANTHROPIC_API_KEY` → usage error, exit 2; confidence ≥ 0.6 → no Claude
  call, one stderr note, exit 0 (design Edge cases, boundary values).
- `tests/cli/run.test.ts` "claude fallback" — API error/refusal/unusable
  reply → one stderr warning, heuristic result printed, exit 0.
**Verification checkpoint:** `npm run typecheck` proves no call site missed
the required field (Design Decision 7 makes a half-state uncompilable);
manual `--claude` run on a low-confidence page reaches the API.
**Atomic commit message:** `feat: gate the Claude tier behind --claude and a browser flag`

Notes: this commit is atomic by design (design Risks: type, `background.ts`,
CLI, tests together). It MUST also update the `ClaudeSettings` doc comment
at `src/llm/claude.ts:115` — "Everything the user chose in the options
page" becomes wrong the day `browser` lands (review finding 7).

### Slice 4: Bounded fetch and clean interruption
**Goal:** oversized pages, slow servers, and closed pipes fail fast with a
clear message instead of hanging, ballooning memory, or crashing.
**Layers touched:** CLI fetch (timeout, size cap, redirects), process exit
handling (EPIPE), tests.
**Tests:**
- `tests/cli/run.test.ts` "size cap" — `Content-Length` over 25 MiB →
  `too large (<n> bytes)`, exit 1, without reading the body (review
  finding 4); a body over the cap after `res.text()` → same message, exit 1.
- `tests/cli/run.test.ts` "timeout" — 30 s `AbortController` fires →
  `timeout`, exit 1 (fake timers; shape mirrors `capture-fixtures.mjs`).
- `tests/cli/run.test.ts` "redirect" — stubbed `res.url` differing from the
  input URL is what reaches `inferTree` as `sourceUrl` (Design Decision 8).
**Verification checkpoint:** `node dist/cli.mjs <url> | head -1` exits 0
with no error output (EPIPE contract, Design Decision 9 — verified
manually; portable unit-testing of EPIPE is not worth the scaffolding).
**Atomic commit message:** `feat: bound response size and handle timeouts and closed pipes in the CLI`

Notes the implementer must land in code comments / messages, not lose:
any throw during fetch or read — including a `RangeError` from
`res.text()` on an over-long body — exits 1; an out-of-memory kill exits
outside the 0/1/2 contract and is not caught (review finding 5). The
25 MiB constant gets a rationale comment comparing it to the largest
captured fixture (review finding 6). Redirects are followed (fetch
default) and the final URL becomes `sourceUrl`; localhost and
private-address URLs are in scope — the CLI fetches whatever URL it is
given with the invoking user's network access, stated rather than blocked
(review finding 8; documented for agents in slices 5–6).

### Slice 5: npm-link packaging and README
**Goal:** from a fresh clone, `npm install && npm link` puts a working
`reduction <url>` on PATH.
**Layers touched:** `package.json` (`"bin": {"reduction": "dist/cli.mjs"}`,
`"prepare": "node build.mjs"`), spawn smoke test, README CLI section.
**Tests:**
- `tests/cli/smoke.test.ts` — `describe.skipIf` when `dist/cli.mjs` is
  absent (repo's skip-if-absent idiom): spawn `node dist/cli.mjs --help` →
  usage on stdout, exit 0; spawn with no args → usage on stderr, exit 2.
  This settles the design's open question: the smoke test earns its keep —
  it is the only check of the shebang banner, esm format, and bundled
  artifact, and once `prepare` lands, `npm ci` builds during install
  (ci.yml:26) so the test never skips in CI despite tests running before
  the explicit build step (ci.yml:35 vs 37-38).
**Verification checkpoint:** clean checkout (`git clean -dfx` sandbox) →
`npm install && npm link && reduction --help` exits 0.
**Atomic commit message:** `feat: package the CLI for npm link`

Notes: the README section (existing H2 / `sh`-block conventions) documents
`npm link` as the entry path and never shows bare `npx reduction` — the
package is private/unpublished and npx would fall through to the public
registry (review finding 1). The `prepare` rationale is worded per review
finding 2: `npm install` must run first anyway (jsdom is a runtime
dependency), so the bin target exists by the time `npm link` symlinks —
not "prepare runs on npm link". Record the coupling cost (review
finding 3): a broken `build.mjs` now fails `npm install`/`npm ci` as an
install failure; keep the explicit build step at ci.yml:37-38 — do not
drop it as redundant. README also states the bot-blocking limitation,
describes `--format html` as the extension's markup, unstyled without
`overlay.css` (review finding 10), and notes the fetch scope from slice 4.

### Slice 6: Agent Skill
**Goal:** a Claude Code session rooted in this checkout discovers a Skill
that drives the CLI correctly without re-teaching the pipeline.
**Layers touched:** `.claude/skills/reduction/SKILL.md` (name/description
frontmatter + instructions), `.gitignore` (add `.claude/worktrees/`,
Design Decision 11), README copy-the-directory note for other agents, one
guard test.
**Tests:**
- `tests/cli/skill.test.ts` — `SKILL.md` exists, frontmatter carries
  `name` and `description` (the discovery contract), and the body never
  contains `npx reduction` (mechanical guard for review finding 1).
**Verification checkpoint:** a fresh Claude Code session in this checkout
discovers the Skill and uses it to render a real recipe URL end-to-end.
**Atomic commit message:** `feat: add an agent Skill that drives the CLI`

Notes — SKILL.md content (Design Decision 11 plus review findings): build
via `npm install` / `npm run build` if `dist/cli.mjs` is missing (never
bare `npx`); prefer `--format text` for showing a user, `--format json`
for programmatic use; never pass `--claude` unless the user asks (spends
their API budget); expect exit 1 with an explanatory stderr line on
bot-blocked or recipe-free pages; `html` output is unstyled markup; the
CLI fetches any URL it is handed, including private addresses (finding 8
— relevant because agents pass URLs they read off pages).

## Cross-slice concerns

- **Default format flip:** slice 1 defaults to `json`; slice 2 introduces
  `text` and flips the default inside its own commit. Every commit leaves
  the CLI coherent.
- **Pure CLI internals:** slice 1 establishes exported `parseArgs` and a
  run function with injectable fetch/streams; slices 2–4 extend them
  without new test scaffolding.
- **First runtime dependency:** jsdom moves to `dependencies` in slice 1
  (lockfile churn once); `bin`/`prepare` wait until slice 5 — before that,
  `node dist/cli.mjs` after `npm run build` is the documented invocation.
- **`ClaudeSettings.browser` contract:** defined and consumed entirely
  within slice 3; the required field makes a partial application fail to
  compile.
- **Standing checkpoint for every slice:** `npm run typecheck`, `npm test`,
  and `npm run build` still emitting the four extension bundles unchanged
  (task acceptance signal: extension behavior unaffected).
- **No versioning artifacts:** no slice touches or creates `CHANGELOG.md`,
  `tools/version.mjs`, or `docs/versioning.md` (absent on this branch).

## Out of structure

Restated from design Out of scope so the planner does not re-include them:
publishing to npm or adding `files`/`exports`/`main` / removing `private`;
local-file or stdin input; a Playwright-rendered fetch fallback for
bot-blocked sites; Markdown/SVG/PNG output; model/effort selection flags
for the CLI's Claude tier; automation installing the Skill into
`~/.claude/skills/`; excluding `dist/cli.mjs` from the CI `extension`
artifact; terminal color output; CHANGELOG/version bump (base-branch
constraint above); double-width character handling in `renderText`
(deferred open question).
