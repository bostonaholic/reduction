---
topic: 2026-07-29-cli-and-agent-skill
date: 2026-07-29
phase: design-review
verdict: COMMENT
---

# Design review — round 2

Reviewer: fresh-context read-only `Explore` subagent. Findings verbatim.

---

I read `design.md`, `design-review-1.md`, `task.md`, `questions.md`, and
`research.md`, then checked every file-and-line claim against the worktree.

## Status of the twelve round-1 findings

1. **Fresh-clone `bin` target** — **resolved.** Decision 4 (`design.md:106-118`) adds
   `"prepare": "node build.mjs"`, and I confirmed `npm install` runs the root `prepare`
   after dependencies land, so esbuild is present and `dist/cli.mjs` exists before
   `npm link` runs. One wording caveat below.
2. **`browser` should be required** — **resolved.** Decision 7 (`design.md:142-155`)
   now says required, and I checked both construction sites (`src/background.ts:48-52`,
   an untyped object literal, and the helper at `tests/llm/claude.test.ts:24-29`) — a
   required field makes both fail to compile until fixed. No third site exists;
   `ClaudeSettings` appears only at `src/llm/claude.ts:115` and `:123`.
3. **CI artifact framed as "future"** — **resolved.** The risk now names the existing
   upload at `.github/workflows/ci.yml:52-56`, which I verified says `name: extension`,
   `path: dist/`.
4. **Time limit does not bound size** — **resolved.** A 25 MiB cap is added
   (`design.md:162`) and the doc states plainly that download memory stays unbounded. A
   residual gap is noted below.
5. **`suspiciously small` check undefined** — **resolved.** Decision 8 says the CLI does
   not copy it, and `tools/capture-fixtures.mjs:57` is exactly that check.
6. **Width cap had no number** — **resolved.** Decision 5 names `process.stdout.columns`
   with a 100-column fallback.
7. **Broken pipe not covered** — **resolved.** Decision 9 and the Failure paths bullet
   both handle `EPIPE` with exit 0.
8. **Skill reach limit** — **resolved.** Desired end state (`design.md:53-57`) now
   states the narrow reach in plain words.
9. **`--claude` on a high-confidence page** — **resolved.** Boundary values now covers
   it, including the stderr note, and `src/content/index.ts:207` confirms the strict `<`.
10. **No rollout or rollback** — **resolved.** The second Risks bullet covers atomic
    rollout, single-commit revert, no stored state, and how a lost header would be
    detected.
11. **Item 12 was a task, not a decision** — **resolved.** The README work moved into
    Desired end state; the Decisions list is now 11 entries.
12. **Missing env var as a usage error** — **resolved.** Decision 9 now gives the
    reason: the remedy is in the environment and no network work has begun.

**Citation audit.** I re-checked every claim, old and new. All accurate: `package.json`
(no `bin`, no `prepare`, no `dependencies`, `"private": true`, jsdom dev-only),
`.gitignore:2` (`dist/`), `build.mjs:19` (`rm(dist, …)`), `:17`, `:33-40` (four
entries), `.github/workflows/ci.yml:37-38` and `:52-56`,
`tools/capture-fixtures.mjs:43-48`, `:57`, `src/content/index.ts:23`, `:171-190`,
`:192-222`, `:207`, `:217`, `src/background.ts:34-52` and the settings literal at
`:48-52`, `src/llm/claude.ts:55`, `:76`, `:122`, `:136`, `:140`,
`src/core/extract.ts:18-23`, `:311`, `:311-329`, `src/core/render.ts:21`, `:37-39`,
`:45`, `src/core/types.ts:71-78`, `tests/sites.test.ts:35`,
`tests/llm/claude.test.ts:18-22`, `task.md:33-35`, and base commit `12d7df8`.
`.claude/` is untracked today, so Decision 11's premise holds. One phrase is over-broad
— see the nitpick below.

**Scope check.** The change stays in one repo. It reaches shipped extension code twice
(the `ClaudeSettings` field and one line in `background.ts`) and changes install
behavior for everyone through `prepare`. Both are disclosed in Decisions and Risks, and
both serve a stated acceptance signal. That is not scope creep.

---

## Findings

**issue (non-blocking):** `npx reduction` will not resolve until after `npm link`, and
the fallback is risky. The package is private and unpublished. Run inside the repo,
`npx reduction` does not find the bin, because npm does not link a package's own bin
into its own `node_modules/.bin`. npx then falls through to the public registry. If a
package named `reduction` exists there — now or later — npx downloads and runs a
stranger's code. The doc should say `npm link` first, and the README section it plans
(`design.md:60`) should not show a bare `npx` line as the entry path.
file: docs/plans/2026-07-29-cli-and-agent-skill/design.md:50

**suggestion (non-blocking):** The `npm link` half of the `prepare` claim is not
supported by npm's documentation. npm lists `prepare` as running on a local
`npm install` with no arguments, and on pack and publish. It does not list `npm link`.
The good news is that the fix does not need it: `npm install` must run first anyway,
because jsdom is now a runtime dependency (Decision 3) and `npm link` alone installs
nothing. Rewording to "the build runs during `npm install`, so the bin target already
exists when `npm link` makes the symlink" is both simpler and true on every npm version.
file: docs/plans/2026-07-29-cli-and-agent-skill/design.md:109

**suggestion (non-blocking):** The `prepare` trade-off names cost but not the coupling.
Once `prepare` runs the build, a broken `build.mjs` makes `npm install` and `npm ci`
fail outright. A contributor then cannot install dependencies to debug the very build
that is failing, and CI reports it as an install failure rather than a build failure.
That is a fair price, but it belongs next to "redundant but idempotent and cheap." It is
also the reason to keep the explicit build step at `ci.yml:37-38` rather than drop it as
duplicate.
file: docs/plans/2026-07-29-cli-and-agent-skill/design.md:112

**suggestion (non-blocking):** The 25 MiB cap sits under "Resource limits" but does not
limit the resource. The check runs after `res.text()`, so the whole body is already a
string in memory when the cap is applied. It stops jsdom from parsing a huge page, which
is the harm Decision 8 names, and the doc is honest about the rest. Still, a
`Content-Length` check before reading the body would reject the common case for free and
costs one line. Worth naming the reason it was not done, or doing it.
file: docs/plans/2026-07-29-cli-and-agent-skill/design.md:163

**suggestion (non-blocking):** Two failure paths past the cap have no stated exit code.
`res.text()` throws a `RangeError` when the body is longer than V8's maximum string
length, and a body large enough to exhaust memory kills the process outright. Neither
produces `too large`, and the second exits outside the 0/1/2 contract that Decision 9
promises. One sentence — "any throw during fetch or read exits 1; an out-of-memory kill
is not caught" — closes it.
file: docs/plans/2026-07-29-cli-and-agent-skill/design.md:248

**suggestion (non-blocking):** 25 MiB has no rationale, so a later reader cannot tell
whether it is tunable. Every other constant in this doc carries its reason (0.6 from
`CLAUDE_THRESHOLD`, 30 s from the capture script, 100 columns as the non-TTY fallback).
One clause — how it compares to the largest captured fixture, for example — makes the
number reviewable instead of arbitrary.
file: docs/plans/2026-07-29-cli-and-agent-skill/design.md:162

**suggestion (non-blocking):** `browser` puts a runtime fact inside a user-settings
type. `ClaudeSettings` is documented at `src/llm/claude.ts:115` as "Everything the user
chose in the options page that shapes the request." Whether the caller is a browser is
not a user choice, and folding it in makes that doc comment wrong on the day it lands.
Decision 7 weighs required against optional, and gated against unconditional, but never
weighs a second parameter on `callClaude` against a new field on the settings object.
Naming that alternative — even to reject it as more churn at the call sites — would let
a future reader reconstruct the choice. Either way, plan to update the doc comment.
file: docs/plans/2026-07-29-cli-and-agent-skill/design.md:143

**suggestion (non-blocking):** Redirect behavior is implied but never stated. Passing
`res.url` as `sourceUrl` tells me redirects are followed, but the doc never says so
directly, never sets a hop limit, and never says whether a URL pointing at localhost or
a private address range is in scope. This matters more here than in a normal CLI: the
Skill lets an agent pass a URL it read off a page, so the URL is not always typed by a
person. Two sentences in Edge cases under Authorization would settle it.
file: docs/plans/2026-07-29-cli-and-agent-skill/design.md:165

**suggestion (non-blocking):** `--help` has no stated exit code or output stream.
Decision 10 lists `--help` in the argument surface. Decision 9 covers only the *error*
form — usage text on stderr, exit 2. Help that a user asked for by name conventionally
prints to stdout and exits 0. Since "stdout carries only rendered output" is a stated
contract on the same line, saying which way `--help` goes prevents the implementer from
guessing.
file: docs/plans/2026-07-29-cli-and-agent-skill/design.md:181

**nitpick (non-blocking):** The word "only" in the `chrome.storage` sentence is too
strong. `src/options/options.ts:38` and `src/print/print.ts:15` also read
`chrome.storage.local`, and options.ts reads the same four Claude keys. The point being
made is still correct — I verified that `background.ts:48-52` is the sole place a
`ClaudeSettings` object is built — so this changes no decision. Narrowing the sentence
to "the only place Claude settings are read for a `callClaude` call" keeps it accurate.
file: docs/plans/2026-07-29-cli-and-agent-skill/design.md:20

**nitpick (non-blocking):** Calling `--format html` "parity with the extension"
oversells it slightly. `renderTable` (`src/core/render.ts:21-42`) emits a bare `<table>`
with `rd-` class names and no stylesheet; the extension pairs it with `overlay.css`
inside a shadow root. Piped to a file, it opens unstyled. The spans still read
correctly, so the choice is right — "the same markup the extension renders" is just a
more honest phrase.
file: docs/plans/2026-07-29-cli-and-agent-skill/design.md:47

---

All eight template sections are present and none is thin. Edge cases walk all six
required categories, and every deferred case appears in Out of scope or Open questions
rather than vanishing. Ten of eleven decisions name a real alternative and say what was
given up; the eleventh is the single-repo preamble, which has no alternative worth
recording. Every round-1 finding was fixed in substance, not just acknowledged. The
findings above are refinements, not gates.

**COMMENT**
