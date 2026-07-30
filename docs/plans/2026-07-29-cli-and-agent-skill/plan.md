---
topic: 2026-07-29-cli-and-agent-skill
date: 2026-07-29
phase: plan
---

# Plan: cli-and-agent-skill

## Context

Add a Node CLI (`dist/cli.mjs`, fifth esbuild entry) running the existing
extract → infer → layout pipeline over jsdom, plus an agent Skill that
drives it. Slices from `docs/plans/2026-07-29-cli-and-agent-skill/structure.md`,
decisions from `design.md` revision 2. Single repo, this worktree.

**Standing constraints for every slice:**

- Never create `CHANGELOG.md`, `tools/version.mjs`, or `docs/versioning.md`
  (absent on this branch by design); no version bump or changelog entry;
  never write `npx reduction` as an entry path anywhere.
- The four extension bundles in `build.mjs` and `src/manifest.json` stay
  untouched.
- Per-slice checkpoint: `npm run typecheck`, `npm test`, `npm run build`
  (content.js, background.js, options.js, print.js still emitted).
- Tests: vitest with explicit imports, under `tests/cli/` and `tests/core/`.

## Slices

### Slice 1: Run the recipe pipeline from the command line (JSON and HTML)

**Acceptance tests** (from structure.md): `tests/cli/args.test.ts` (parser
contract — four bad inputs → usage-error kind, `--help` → stdout exit 0);
`tests/cli/run.test.ts` "happy path" / "failure ladder" (steps 3 and 7).

**Steps:**

1. `package.json` — move `"jsdom": "^29.1.1"` from `devDependencies` to a
   new `dependencies` field (`@types/jsdom` stays dev); `npm install` to
   regenerate `package-lock.json`; commit both. No `bin` or `prepare` yet
   (slice 5). [sequential — first]

2. `src/cli/args.ts` — new. Pure exported `parseArgs(argv: string[])` →
   `{kind: 'run', url, format}` | `{kind: 'help'}` | `{kind: 'error',
   message}`; hand-rolled (Design Decision 10, precedent `build.mjs:17`);
   URL validated via `new URL` plus an http/https check. Formats: `json`
   (temporary default — flipped in slice 2), `html`. Export usage/help text
   calling `html` "the same markup the extension renders" — never "parity".
   [parallel with 3]

3. `src/cli/run.ts` — new. Exported `run(args, deps): Promise<number>` (exit
   code), injected `{fetch, stdout, stderr}` so tests never spawn (Design
   Decision 10). Fetch: `HEADERS` shaped like
   `tools/capture-fixtures.mjs:43-48`; `!res.ok` → stderr `fetch failed:
   HTTP <status>`, return 1; hardening waits for slice 4; never copy the
   `suspiciously small` check (Design Decision 8). Pipeline mirrors
   `src/content/index.ts:192-222` over `new JSDOM(html).window.document`
   (`tests/sites.test.ts:35`), with `res.url` (post-redirect) as `sourceUrl`;
   `NoRecipeFound` message verbatim to stderr, return 1; null root after
   `flatTree` → stderr "Found a recipe but no ingredients to lay out.",
   return 1. Output: `json` = `JSON.stringify({recipe, grid, note})`,
   `note` from `confidenceNote` (`src/core/render.ts:45`); `html` =
   `renderTable(recipe, grid)` (`render.ts:21`); errors to stderr only,
   stdout only rendered output. [parallel with 2]

4. `src/cli/index.ts` — new, the sole CLI esbuild entry; doc comment with
   the invocation line (`build.mjs:1-8` convention). Thin main routing
   `parseArgs(process.argv.slice(2))`: `help` → usage stdout exit 0; `error`
   → message + usage stderr exit 2; `run` → `process.exitCode = await
   run(args, {fetch, stdout, stderr})` from the real globals. [after 2, 3]

5. `build.mjs` — append a fifth object to `builds` (after line 39), spread
   after `shared` so overrides win (`build.mjs:60,66`):
   `{ entryPoints: [join(root, 'src/cli/index.ts')], outfile: join(dist,
   'cli.mjs'), format: 'esm', platform: 'node', target: 'node22',
   banner: { js: '#!/usr/bin/env node' }, external: ['jsdom'] }`.
   `target` overrides shared `chrome114`; `external: ['jsdom']` resolves
   jsdom from `node_modules` at run time (Design Decision 3 — it bundles
   badly). The watch loop picks the entry up automatically. [after 4]

6. `tests/cli/args.test.ts` — new; import from `../../src/cli/args.js`:
   valid url+format; missing URL / non-http(s) URL / unknown flag / unknown
   format → `error` kind; `--help` → `help` kind; default `json` this slice.
   [parallel with 7]

7. `tests/cli/run.test.ts` — new; import `run` from `../../src/cli/run.js`;
   deps are a fake `fetch` (resolving `{ok, status, url, text()}`) and
   stream stubs — no `vi.stubGlobal`, no spawn. Happy path: inline HTML
   embedding a minimal JSON-LD recipe (`tests/fixtures/` is uncommitted — do
   not depend on it). Failure ladder: HTTP 500; recipe-free HTML; recipe
   with no attached ingredients (null root). [parallel with 6]

**Verification:** `npm run build` emits the four extension bundles plus
`dist/cli.mjs`; `node dist/cli.mjs <real-url> --format json` prints JSON.

**Commit:** `feat: run the recipe pipeline from the command line`

### Slice 2: Box-drawing text table as the default output

**Acceptance tests** (from structure.md), all in
`tests/core/render-text.test.ts`: "spans" (aligned borders under spans;
`confidenceNote` follows the table), "wrapping" (wraps at the given width,
never truncated), "degenerate grids" (1×N grid; empty `title` omits the
caption line).

**Steps:**

1. `src/core/render-text.ts` — new, pure, DOM-free (the `src/core/` rule).
   `renderText(recipe: Recipe, grid: Grid, width: number): string`:
   box-drawing borders honoring `rowSpan`/`colSpan` from `Cell`
   (`src/core/types.ts:71-78`); word-wrap inside cells; caption omitted when
   `title` is empty (mirror `render.ts:37-39`); `confidenceNote(recipe)`
   appended after the table; code-point width 1, with a comment that
   double-width characters are accepted for now. [sequential]

2. `src/cli/args.ts` + `src/cli/run.ts` + `src/cli/index.ts` — add `text`
   to the format set, flip the default to `text`, update usage; `run` deps
   gain `width`, computed only in index.ts: `process.stdout.columns` when
   `isTTY`, else 100 (Design Decision 5). [after 1]

3. `tests/core/render-text.test.ts` — new: the three groups with hand-built
   `Recipe`/`Grid` literals. Update the default-format assertion in
   `tests/cli/args.test.ts` to `text`. No other new tests — the structure is
   the scope fence. [after 2]

**Verification:** real URL in a terminal → borders aligned at terminal width;
`node dist/cli.mjs <url> > out.txt` wraps at 100 columns.

**Commit:** `feat: render a box-drawing text table as the CLI default`

### Slice 3: Opt-in Claude escalation via `--claude`

Atomic: type, `background.ts`, CLI, and tests in one commit — the required
field makes any half-state uncompilable (Design Decision 7).
**Acceptance tests** (from structure.md): `tests/llm/claude.test.ts`
"browser header" (present for `browser: true`, absent for `false`);
`tests/cli/run.test.ts` "claude gating" (missing key → exit 2; ≥ 0.6 → no
call, one stderr note, exit 0) and "claude fallback" (warn, fall back,
exit 0).

**Steps:**

1. `src/llm/claude.ts` — `ClaudeSettings` (line 115) gains required
   `browser: boolean`. Rewrite the doc comment at line 114 — "Everything the
   user chose in the options page…" becomes false (finding 7); cover the
   options-page choices plus the caller-supplied browser fact. In
   `callClaude`, send `anthropic-dangerous-direct-browser-access` (line 136)
   only when `browser` is `true`, with a comment. [sequential — first]

2. `src/background.ts` — the settings literal at lines 48-52 (sole
   production construction site) gains `browser: true`. [parallel with 3, 4]

3. `tests/llm/claude.test.ts` — helper literal at lines 24-29 gains
   `browser: true`. New "browser header" describe with its own
   `vi.stubGlobal('fetch', …)` stub (pattern lines 18-22) reading
   `fetchMock.mock.calls[0][1].headers` for both values. [parallel with 2, 4]

4. `src/cli/args.ts` + `src/cli/run.ts` — `parseArgs` accepts `--claude`;
   `run` deps gain an injectable `env`. Missing `env.ANTHROPIC_API_KEY` →
   usage error, exit 2, before any network work (Design Decision 9); the
   usage text says `--claude` spends the user's API budget. Escalate when
   `recipe.confidence < 0.6` — strict `<`, local constant with a comment
   naming `CLAUDE_THRESHOLD` (`src/content/index.ts:23`); at or above, one
   stderr note `confidence 0.82 ≥ 0.6 — Claude not needed`, no call, exit 0.
   Escalation: `callClaude({apiKey, model: resolveModel(undefined),
   effort: resolveEffort(undefined), browser: false}, …)` →
   `treeFromPlan(plan, raw, sourceUrl)`, accepted only with a root and
   confidence ≥ the heuristic's; any Claude failure → one stderr warning,
   heuristic result printed, exit 0 (mirror `content/index.ts:171-213`).
   [parallel with 2, 3]

5. `tests/cli/run.test.ts` — "claude gating" and "claude fallback" via the
   injected `env` and a fake `fetch` dispatching by URL; assert no Claude
   request occurs in the ≥ 0.6 case. [after 4]

**Verification:** `npm run typecheck` proves no call site missed the required
field; manual `--claude` run on a low-confidence page reaches the API.

**Commit:** `feat: gate the Claude tier behind --claude and a browser flag`

### Slice 4: Bounded fetch and clean interruption

**Acceptance tests** (from structure.md), all in `tests/cli/run.test.ts`:
"size cap" (`Content-Length` over 25 MiB → `too large (<n> bytes)`, exit 1,
body never read; oversized body after `res.text()` → same message), "timeout"
(30 s abort → `timeout`, exit 1), "redirect" (stubbed `res.url` ≠ input URL
reaches `inferTree` as `sourceUrl`).

**Steps:**

1. `src/cli/run.ts` — harden the fetch. 30 s `AbortController` mirroring
   `tools/capture-fixtures.mjs:51-52,61-63` (`clearTimeout` in `finally`;
   abort → `timeout`, exit 1). 25 MiB cap constant with a rationale comment
   comparing it to the largest captured fixture (finding 6): check
   `Content-Length` before reading — over the cap → `too large (<n> bytes)`,
   exit 1, body unread (finding 4); after `res.text()`, same check/message
   on actual length. Any throw during fetch/read (including a `RangeError`
   from `res.text()`) exits 1; comments must state: an out-of-memory kill
   exits outside the 0/1/2 contract, uncaught
   (finding 5); redirects followed (fetch default), final `res.url` is
   `sourceUrl` (wired in slice 1); localhost/private addresses in scope —
   the CLI fetches whatever URL it is given (finding 8). [sequential]

2. `src/cli/index.ts` — EPIPE contract (Design Decision 9): stdout closed
   early (`… | head`) → catch the `EPIPE` write error (plus a stdout `error`
   listener for the async case), exit 0 with no error output. [parallel]

3. `tests/cli/run.test.ts` — the three groups. Size cap: over-cap
   `headers.get('content-length')` with a `text()` spy asserted un-called;
   then no/small `Content-Length` but oversized `text()`. Timeout:
   `vi.useFakeTimers`, fake fetch rejecting `AbortError`-named when its
   signal fires, advance 30 s. Redirect: JSON output's `recipe.sourceUrl`
   equals `res.url`. No EPIPE unit test — manual. [after 1, 2]

**Verification:** `node dist/cli.mjs <url> | head -1` exits 0, no error output (manual).

**Commit:** `feat: bound response size and handle timeouts and closed pipes in the CLI`

### Slice 5: npm-link packaging and README

**Acceptance tests** (from structure.md): `tests/cli/smoke.test.ts` — spawn
`node dist/cli.mjs --help` → usage stdout exit 0; no args → usage stderr
exit 2 (skipped when `dist/cli.mjs` is absent).

**Steps:**

1. `package.json` — add `"bin": {"reduction": "dist/cli.mjs"}` and, in
   `scripts`, `"prepare": "node build.mjs"`. Keep `"private": true`; run
   `npm install` once to confirm `prepare` fires. [sequential]

2. `build.mjs` — extend the top doc comment with the coupling cost
   (finding 3): the script now runs via `prepare`, so a broken build fails
   `npm install`/`npm ci` as an install failure; the explicit CI build step
   at `ci.yml:37-38` stays — do not drop it as redundant. [parallel]

3. `tests/cli/smoke.test.ts` — new. `describe.skipIf(...)` on the absence of
   `dist/cli.mjs` (idiom: `tests/sites.test.ts:28`); `spawnSync` from
   `node:child_process`. The only check of the shebang banner, esm format,
   and bundled artifact; once `prepare` lands, `npm ci` (ci.yml:26) builds
   during install, so it never skips in CI. [parallel]

4. `README.md` — new H2 section (existing H2 / `sh`-block conventions).
   Entry path: `npm install && npm link`, then `reduction <url>` — never
   bare `npx reduction` (unpublished; npx falls through to the public
   registry — finding 1). `prepare` rationale per finding 2: `npm install`
   must run first anyway (jsdom is a runtime dependency), so the bin target
   exists when `npm link` symlinks. State the bot-blocking
   limitation; `--format html` as "the same markup the extension renders",
   unstyled without `overlay.css` (finding 10); the slice-4 fetch scope.
   [parallel]

**Verification:** clean-checkout sandbox (a scratch clone, not this worktree)
→ `npm install && npm link && reduction --help` exits 0.

**Commit:** `feat: package the CLI for npm link`

### Slice 6: Agent Skill

**Acceptance tests** (from structure.md): `tests/cli/skill.test.ts` —
SKILL.md exists; frontmatter has `name`/`description`; no `npx reduction`.

**Steps:**

1. `.claude/skills/reduction/SKILL.md` — new; YAML frontmatter with `name`
   and `description` (the discovery contract); body per Design Decision 11,
   no parsing logic: build via `npm install` / `npm run build` if
   `dist/cli.mjs` is missing — never bare `npx`; `--format text` to show a
   user, `--format json` for programs; never pass `--claude` unless the
   user asks (spends their API budget); exit 1 + stderr explanation on
   bot-blocked or recipe-free pages; `html` is unstyled markup; it fetches
   any URL, private addresses included (finding 8). [parallel]

2. `.gitignore` + `README.md` — add `.claude/worktrees/` to the ignore file
   (Design Decision 11: `.claude/` is tracked for the first time; keep local
   worktrees invisible); README note for other agents: copy
   `.claude/skills/reduction/` into their own skill location — the Skill
   reaches only sessions rooted in this checkout. [parallel]

3. `tests/cli/skill.test.ts` — new. Read the SKILL.md from the repo root: it
   exists, the frontmatter contains `name:` and `description:`, and the full
   text never contains `npx reduction` (mechanical guard, finding 1).
   [after 1]

**Verification:** a fresh Claude Code session in this checkout discovers the
Skill and renders a real recipe URL end-to-end.

**Commit:** `feat: add an agent Skill that drives the CLI`

## Done Criteria

- All acceptance tests for all six slices pass; `npm test` and
  `npm run typecheck` green after every slice; `npm run build` still emits
  the four extension bundles unchanged plus `dist/cli.mjs`.
- Fresh-clone path works: `npm install && npm link && reduction --help`
  exits 0; `reduction <url>` prints a box-drawing table by default.
- Exit-code contract holds: 0 success (including EPIPE), 1 operational
  failure, 2 usage error; stdout carries only rendered output.
- No `CHANGELOG.md`, `tools/version.mjs`, or `docs/versioning.md` created;
  no `npx reduction` anywhere in docs, help text, or the Skill; six atomic
  commits, one per slice, with the subjects listed above.
