---
topic: grader-runtime-escalation
date: 2026-07-29
phase: design-review
verdict: REQUEST CHANGES
---

# Design review — round 1

Two read-only `Explore` reviewers ran independently against `design.md`
revision 1, each with fresh context. Both returned **REQUEST CHANGES**, and
both independently identified the same blocking defect. Their findings are
recorded verbatim below.

(An earlier `review-gate-halt.md` recorded this gate as having produced no
verdict. Both reviewers were slow, not dead; the halt is superseded by this
record and has been removed. It remains in git history at commit 5b46201.)

## The blocking finding — found independently by both reviewers

`pickBetter` compares `F.length` across two cards, but `gradeCard` does not
always compute F. When S1 or S2 fires, `src/core/grade.ts:610-613` returns
early and the rest of the grade is `[]`. So `F.length === 0` means either
"this card is faithful" or "we never checked", and the design treats them the
same.

Failure scenario: the local card comes back rootless with ingredients present,
so S1 fires and it grades `{S:[S1], F:[], L:[]}`. Claude returns a rooted card
grading `{S:[S4], F:[F3,F5,F6]}`. The `viaClaude.root` guard passes, so
`pickBetter` runs. S counts tie 1-1. F counts are 0 versus 3, so the
**rootless local card wins**, and `src/content/index.ts:215` drops it to
`flatTree`. Today that page ships Claude's card, because local confidence is 0
and `viaClaude.confidence >= 0`. That is a regression.

Swapping S-count for S-presence does not fix it — 1 S versus 1 S still ties
and still falls through to the same bad F comparison.

`research.md:34` already recorded the short-circuit; the design never picked
it up.

---

## Reviewer A — full findings

**Citation spot-check — all verified, none skipped.** Read and confirmed:
`src/content/index.ts:23, :99, :118, :171-190, :193, :205-213, :207, :211,
:215-218`; `src/core/grade.ts:15-18, :21-24, :35-36, :170-177, :221, :408,
:618`; `src/core/render.ts:45-65, :54`; `src/core/types.ts:7, :64`;
`docs/recipe-card-rules.md:150, :159-160, :180-183, :197-209, :237-238`;
`README.md:61, :74, :92-93`; `CHANGELOG.md:20`; `src/background.ts:43-46`;
`src/llm/claude.ts:51-55`; `tests/sites.test.ts:79-90`;
`tests/core/grade.test.ts:1-12`. Every citation exists and says what the doc
claims. `src/core/escalate.ts` and `tests/core/render.test.ts` are correctly
labelled new — neither exists. Citation accuracy is not a blocking problem.

- **issue (blocking):** the `pickBetter` / suppressed-F defect above.
  `design.md:83`
- **issue:** Decision 2's rationale ("any-S means INVALID … a valid card must
  beat an INVALID one regardless of F counts") argues for a boolean has-S
  check, but the rule chosen is `S.length`, a count. The doc calls INVALID a
  state with "no score", so ranking one INVALID card above another by count
  needs its own reason. A future reader cannot reconstruct why count won over
  presence. `design.md:137`
- **issue:** `pickBetter` returns a bare `Recipe`, but line 102 requires the
  caller to "Track the winner's graded record for the badge". The return type
  does not carry it. The implementer must recover it by reference identity
  (`recipe === viaClaude ? claudeGraded : localGraded`), which the design never
  states. Widen the return, or state identity comparison as the contract.
  `design.md:81`
- **suggestion:** grading now runs on every card and nothing measures that. The
  Resource/cost bullet counts only Claude calls. Decision 8 asserts a layout
  walk is "negligible" but names no measurement, and the F checks walk every
  leaf path against every step text — more than a layout walk. `design.md:167`
- **suggestion:** say `import type { Finding }`. `src/core/render.ts` is also
  imported by `src/export/print.ts:11`; a value import pulls the whole grader
  into the print and export bundles for a type that erases at compile time.
  `design.md:116`
- **suggestion:** decisions state why alternatives lost but not what the chosen
  path costs. The costs exist — Decision 1's extra calls in Edge cases,
  Decision 4's badge change in Risks — but a reader working the decision list
  will not find them there. `design.md:128`
- **nitpick:** "keeps every other caller and snapshot valid" overstates the
  evidence — there is exactly one other caller (`src/content/index.ts:100`) and
  no render snapshots exist. `design.md:115`
- **nitpick:** Decisions 5 and 6 never name the alternative they beat, unlike
  every other decision. `design.md:153`
- **nitpick:** the open question has no owner and no reopen trigger.
  `design.md:227`
- **nitpick:** the F6 range `408-438` stops mid-`findings.push`; the block runs
  to 444. `design.md:31`
- **nitpick:** calling `README.md:92-93` "true as written" is disputable when
  line 74 is being reworded precisely because "uncertain" no longer means "low
  confidence". `design.md:122`

**Structure and scope:** all seven required sections present. Edge cases
genuinely walk boundary values, invalid inputs, failure paths, ordering,
resource limits and adversarial input — not happy-path-only. Deferred work is
named in Out of scope and traced to the PRD. Scope maps cleanly to the PRD,
including the badge (`prd.md:68-69`). No scope creep found.

VERDICT: REQUEST CHANGES

---

## Reviewer B — full findings

**Citations — spot-checked, all true.** Every prioritised location plus a dozen
more. No false citations. **Not spot-checked:** the `src/core/plan.ts`
construction guards behind Decision 6, `src/core/infer.ts`, and
`src/options/options.ts`.

- **issue:** `design.md:167-168` (Decision 8) — the cost baseline is the wrong
  one. "A layout is a pure walk … negligible next to one network call" measures
  against the escalating path, but grading now runs on *every* card, and the
  design's own evidence (`design.md:187-189`) is that the common case makes
  **no** network call at all. On that path there is nothing for it to be
  negligible against: `layout()` runs inside `gradeCard`
  (`src/core/grade.ts:221`) and again at `src/content/index.ts:221`, and
  `gradeByTier` computes the whole L tier that neither `shouldEscalate` nor
  `pickBetter` reads. The `skip` option will not help — it is a post-filter
  (`src/core/grade.ts:602-616`), so it saves no work; `grid` reuse is the only
  real lever. The decision may still be correct; the justification does not
  cover the case it governs.
- **issue:** `design.md:187-189` and `:219-220` — the same evidence props up
  both the cost bound and the risk mitigation, and it is circular. "All 15 site
  fixtures currently grade clean on S and F" is load-bearing twice, but
  `docs/recipe-card-rules.md:206-209` states the F6 carve-outs "were found by
  running the check against the captured fixtures, not by reasoning". The
  fixtures are the grader's tuning set. That they grade clean is close to
  tautological and says little about pages the grader has never seen — exactly
  the population whose call volume the design is bounding.
- **issue:** `design.md:81-86`, `:102` — `pickBetter`'s contract does not
  deliver what `run()` needs (same as Reviewer A). If the identity invariant
  ever breaks, the badge silently names findings from the losing card — a
  wrong-and-quiet failure in a feature whose whole point is honesty.
- **suggestion:** `design.md:186-189` — the sticky-cost case is missing.
  Worst case is bounded per *run*, but nothing bounds repeats *across* runs: a
  page whose card carries a finding Claude also cannot fix pays a Claude call
  every time the user opens it, forever. Probably acceptable, but name it.
- **suggestion:** `design.md:195-206` — the wiring ships untested at every
  level. All three listed suites are pure-core unit tests, but the PRD's
  acceptance criteria are about `run()`. The design itself notes
  `src/content/index.ts` has no unit tests (`design.md:60`), so `tryGrade`, the
  reworked `run()` and `showTable`'s new parameter get no coverage.
  `tests/e2e/golden.spec.ts` executes the real content script but snapshots
  `.rd-table` only (`:71`) — it will never see the badge.
- **suggestion:** `design.md:110-115` — unspecified interaction with the flat
  early-return. `confidenceNote` returns at `src/core/render.ts:54` before the
  confidence bands when `inference === 'flat'`. The design does not say whether
  the forced `'low'` and the appended clause sit before or after that.
- **nitpick:** `design.md:56` — `README.md:61` does not contain the quoted
  phrase. "Plain data — no DOM, no browser" is `src/core/types.ts:7`.
- **nitpick:** `design.md:146-147` — `src/llm/claude.ts:51-55` documents why
  Opus 5 is the default on per-recipe cost, not the user's-own-key posture the
  sentence attaches it to.
- **nitpick:** `design.md:114-115` — "keeps every other caller and snapshot
  valid" oversells the risk it retires.
- **nitpick:** `design.md:225-229` — Open questions carries no live
  uncertainty; if nothing remains open, saying so outright is stronger.

**Sections:** all seven present, edge cases genuinely strong. **Scope:** clean,
nothing wanders.

VERDICT: REQUEST CHANGES
