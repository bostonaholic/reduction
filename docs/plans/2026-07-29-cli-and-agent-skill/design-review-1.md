---
topic: 2026-07-29-cli-and-agent-skill
date: 2026-07-29
phase: design-review
verdict: REQUEST CHANGES
---

# Design review — round 1

Reviewer: fresh-context read-only `Explore` subagent. Findings verbatim.

---

## Review: `docs/plans/2026-07-29-cli-and-agent-skill/design.md`

**Citation audit first.** I spot-checked every file-and-line claim in the document
against the worktree. All of them are accurate: `extract.ts:18-23` and `:311-329`,
`content/index.ts:23`, `:171-190`, `:192-222`, `:217`, `claude.ts:55`, `:76`,
`:115-119`, `:122`, `:136`, `:140`, `background.ts:34-52`, `render.ts:21`, `:37-39`,
`:45`, `types.ts:71-78`, `build.mjs:1-8`, `:17`, `:33-40`,
`capture-fixtures.mjs:43-48`, `:50-65`, `tests/sites.test.ts:35`,
`tests/llm/claude.test.ts:18-22`, and the `package.json` / `tsconfig.json` claims. I
also confirmed no file under `src/` imports jsdom, so Decision 3's "extension bundles
are unaffected" claim holds. This is unusually well-grounded work.

All eight template sections are present. Edge cases walk all six required categories.
Most decisions name a real alternative and say what was given up. The findings below
are what I could not verify or where the reasoning has a hole.

---

**issue (blocking):** The `bin` target does not exist in a fresh clone, so the stated
install path does not work as written. `.gitignore:2` excludes `dist/`, and
`build.mjs:19` deletes the whole `dist/` tree at the start of every build. So
`dist/cli.mjs` only exists after someone runs `npm run build`. The design states the
bin entry "makes `npm link` / `npx` work from a checkout" as if that were automatic.
It is not. A developer who clones and runs `npm link` gets a broken command. The Skill
path is covered — line 50 tells the agent to build first — but the human path is not.
Please either add a `prepare` script (it runs on both `npm install` and `npm link`, so
it fixes this cleanly) or state plainly that a build must run first. This is the
primary acceptance signal in `task.md:33-35`, so it should not be left implicit.
file: docs/plans/2026-07-29-cli-and-agent-skill/design.md:44

**issue (non-blocking):** Making `browser` optional means the compiler cannot catch a
missed call site. Decision 7 adds `browser?: boolean` to `ClaudeSettings`. With the
`?`, every existing caller keeps compiling, but the default behavior flips: the header
stops being sent unless someone remembers to pass `browser: true`. That turns a
compile-time error into a silent runtime change on the shipped extension path. A
required `browser: boolean` costs one line at each of the two real call sites
(`src/background.ts:48-52` and the test) and makes the change impossible to get
half-done. The design already flags this as a risk on line 220 and asks for a test,
but a test only catches what someone thought to test. The type system catches
everything.
file: docs/plans/2026-07-29-cli-and-agent-skill/design.md:120

**issue (non-blocking):** The zip-packaging risk is described as future, but the
condition exists today. Risk 4 says "any future 'zip dist/' packaging step must
exclude it." There is already such a step: `.github/workflows/ci.yml:52-56` uploads
all of `dist/` as an artifact named `extension`. After this change, that artifact will
contain a Node CLI bundle. Nothing breaks, but the framing is wrong, and the reader
who trusts the word "future" will not go look. Please reword to name the existing
artifact upload.
file: docs/plans/2026-07-29-cli-and-agent-skill/design.md:228

**issue (non-blocking):** A time limit does not bound response size. The Resource
limits bullet says "oversized pages are bounded by the 30 s fetch timeout." A
30-second window still allows a very large body on a fast link. That body is read
fully into memory and then handed to jsdom. The comparison to the test suite does not
hold either: the test suite reads fixtures the author picked, while the CLI reads
whatever URL a user types. `tools/capture-fixtures.mjs:57` only checks for a *minimum*
size, so there is no upstream cap to inherit. Either add a max-bytes check or say
honestly that response size is unbounded and why that is acceptable.
file: docs/plans/2026-07-29-cli-and-agent-skill/design.md:198

**suggestion (non-blocking):** "Fetch mirrors `capture-fixtures.mjs`" leaves one
behavior undefined. That script also rejects any body under 5000 bytes with the reason
`suspiciously small` (`tools/capture-fixtures.mjs:57`). The design does not say whether
the CLI copies that check. It matters: a short but valid recipe page would be rejected
for the wrong reason. One sentence settles it for the implementer.
file: docs/plans/2026-07-29-cli-and-agent-skill/design.md:128

**suggestion (non-blocking):** The text renderer's width cap has no number. Decision 5
says text wraps "at a capped column width" but never says what the cap is, or whether
it reads `process.stdout.columns`. The design doc is the contract the implementer
builds against, so a bare "cap" leaves a magic number for someone else to invent. Name
the value, or say the width comes from the terminal with a stated fallback.
file: docs/plans/2026-07-29-cli-and-agent-skill/design.md:99

**suggestion (non-blocking):** Clean pipes are a stated goal, but the broken-pipe case
is not covered. Decision 9 says stdout carries only rendered output "so pipes stay
clean." Running `node dist/cli.mjs <url> | head` closes stdout early, and Node then
raises `EPIPE`. Without handling, the process dies with an unhandled error and a
nonzero exit — which contradicts the exit-code contract on the same line. This belongs
in the Failure paths list.
file: docs/plans/2026-07-29-cli-and-agent-skill/design.md:133

**suggestion (non-blocking):** The Skill only reaches sessions rooted in this checkout.
`.claude/skills/reduction/SKILL.md` is a project-level location. Claude Code finds it
when the working directory is this repo. A developer working in their own project gets
nothing, and `npm install` never delivers it because the package is private with no
`files` field. Decision 11 mentions a README note for other agents, and line 167 puts
`~/.claude/skills/` installation out of scope, so the choice is deliberate and
defensible. But the Desired end state reads as if the Skill is broadly available. State
the reach limit there, not only in Decisions.
file: docs/plans/2026-07-29-cli-and-agent-skill/design.md:48

**suggestion (non-blocking):** `--claude` with a high-confidence page is not
enumerated. Decision 6 says Claude runs only below the 0.6 threshold. So a user who
passes `--claude` on a page the heuristics already handle well gets no Claude call and
no message saying why. That is the right behavior, but it will read as a bug to the
user. One Edge cases line naming it — and saying whether a stderr note is printed —
closes the gap.
file: docs/plans/2026-07-29-cli-and-agent-skill/design.md:110

**suggestion (non-blocking):** There is no rollout or rollback discussion. The design
doc methodology asks for one when a change alters an existing contract. One change here
does: the `callClaude` signature edit ships inside the shipped extension. The Risks
section touches it, but nothing says what reverting looks like or how you would notice
the extension had lost the header in the field. Two or three sentences would cover it.
Everything else in this change is additive, so this is thin by nature — not a large
gap.
file: docs/plans/2026-07-29-cli-and-agent-skill/design.md:214

**nitpick (non-blocking):** Item 12 is a task, not a decision. Every other entry in
Decisions made names a rejected alternative and carries the "Assumption — chosen
without user review" tag. Item 12 has neither. Updating the README is obvious and has
no alternative worth recording. Moving it to Desired end state would keep the Decisions
list to things a future reader might second-guess.
file: docs/plans/2026-07-29-cli-and-agent-skill/design.md:154

**nitpick (non-blocking):** A missing env var is classed as a usage error. Decision 9
defines exit 2 as a usage error and exit 1 as an operational failure. `--claude`
without `ANTHROPIC_API_KEY` is not bad argument syntax — it is a missing piece of
environment. The doc gives a reason ("the user asked for something impossible"), so
this is a judgment call, not an error. Flagging only because a reader comparing the two
sections will pause on it.
file: docs/plans/2026-07-29-cli-and-agent-skill/design.md:196

---

**Scope check.** The design stays inside the single repo the predecessor artifacts
imply. Decision 7 does reach into shipped extension code, which sits in tension with
the `task.md:42-43` acceptance signal that extension behavior is unaffected. I am not
flagging it as scope creep: the reach is two lines, the design discloses it in both
Decisions and Risks, and the CLI genuinely should not send a browser-only header. The
optional-field finding above is the part that needs tightening, not the scope.

**REQUEST CHANGES**
