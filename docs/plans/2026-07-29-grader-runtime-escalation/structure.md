---
topic: grader-runtime-escalation
date: 2026-07-29
phase: structure
---

# Structure: grader-runtime-escalation

Three vertical slices. The seam the design draws is respected: the pure
policy (`src/core/escalate.ts`) lands with its full pinned-scenario suite
before any wiring, and `src/content/index.ts` — which has no unit tests —
changes only in slices whose verification is end-to-end (Playwright golden
harness) or structural. Slice 1 ships user-visible value on its own: the
badge stops overstating confidence for cards with known S/F findings — the
exact harm the yogurt/raw-beef card shipped with.

## Assumptions (resolved autonomously)

1. **The three review nitpicks are folded into slice 2's code artifacts**
   (doc comments + one pinned test), not into `design.md`. The design is a
   gated, approved artifact; the nitpicks' natural implementation home is
   `RETAIN_RATIO`'s doc comment (which the design already requires to carry
   the bounds argument) and the `pickBetter` test file.
2. **Badge honesty ships before escalation.** For one commit, the badge is
   findings-aware while trigger/selection remain confidence-only. Strictly
   more honest at every point; the CHANGELOG entry lands in the same commit.
3. **Slice 1 upholds the badge-names-the-shown-card invariant under the old
   selection rule**: whichever candidate wins, `recipe` and `graded` are
   reassigned together (`graded = tryGrade(winner, raw)`), so slice 3 only
   swaps the decision functions, never the lifecycle shape.
4. **No docs-only slice.** README/rules/CHANGELOG edits ride the slice that
   makes their claims true or false (systems lens: co-changing surfaces).
5. **`CLAUDE_THRESHOLD` moves in slice 2**, and the one-line import swap in
   `src/content/index.ts` rides the same commit — the constant never exists
   in two places.

## Slice 1 — Honest badge: S/F findings force "low" and name the problem

**User value:** a card like the shipped yogurt/beef one (0.79 coverage, F6)
immediately reads "low confidence" with the finding named, instead of
"moderate". PRD story 4.

**Scope:**
- `src/core/render.ts`: `confidenceNote(recipe, findings: Finding[] = [])`.
  Findings check runs **first, before the `flat` early-return at `:54`**;
  non-empty findings force `'low'` and append a clause naming the count and
  the first finding's `detail`, truncated to 120 chars with an ellipsis.
  Empty findings → byte-identical to today. `Finding` via `import type`
  (`src/export/print.ts` imports `render.ts`; keep the grader out of that
  bundle).
- `src/content/index.ts`: private `tryGrade(recipe, raw): Graded | null`
  beside `askClaude` — `gradeByTier(recipe, raw)` with **no options**,
  try/catch → null. `run()`: `let graded = tryGrade(recipe, raw)` after
  `inferTree`; when Claude wins under the *existing* rule, reassign
  `recipe` and `graded = tryGrade(viaClaude, raw)` together; `flatTree`
  path resets `graded` to null; `showTable` gains `findings: Finding[]`
  (`graded ? [...graded.S, ...graded.F] : []`) passed to `confidenceNote`.
  Details reach the DOM only through the existing `escape(note.text)`.
- `CHANGELOG.md`: new entry — some previously "moderate" badges now read
  "low" and name the finding.

**Acceptance tests:**
1. `tests/core/render.test.ts` (new): byte-identical output for all three
   strategies with empty findings; F finding → `low` + detail in text;
   truncation at the 120-char cap; findings precede the flat early-return.
2. E2E (`tests/e2e/golden.spec.ts`): badge element renders on existing
   fixtures (no-finding path); `.rd-table` snapshots unchanged.
3. E2E: **one new golden fixture tripping an F rule** → low badge naming
   the finding in a real DOM.

**Edge cases:** `gradeByTier` throws → `tryGrade` null → badge identical to
today (grading crash degrades, page never breaks); flat card → `graded`
null, flat message unchanged; finding details embed page-controlled text —
truncated and escaped.

## Slice 2 — Escalation policy: `src/core/escalate.ts`, pure, fully pinned

**Value:** the decision rule five review rounds produced exists as total,
unit-tested pure functions; every pinned scenario becomes a regression test
now, not later.

**Scope:**
- `src/core/grade.ts`: export `UNUSABLE_RULES: readonly RuleId[] =
  ['S1', 'S2']`; edit the inline predicate at `:610` to reference it.
  Behaviour-preserving; the existing grade suite is the regression net.
- `src/core/escalate.ts` (new): `CLAUDE_THRESHOLD = 0.6` (moved from
  `src/content/index.ts:23`, comment included — and the content script's
  local constant deleted / import swapped in this same commit, assumption
  5); `RETAIN_RATIO = 0.75`; `EPSILON = 1e-9`;
  `shouldEscalate(confidence, graded)` — two arms, doc comment stating the
  zero-ingredient dependency on the confidence arm;
  `pickBetter(local, localGraded, viaClaude, claudeGraded) →
  { recipe, graded }` — the seven-step rule, first decisive step wins.
  Module doc comment states the **options-free grading contract**. Neither
  function throws; both total.
- **Nitpicks folded here:** `RETAIN_RATIO`'s doc comment attributes the
  binding must-block constraint to 0.30-vs-0.20 (ratio > 0.6667), noting
  hole B (0.61) is true but not binding; states the *real-card*
  insensitivity range [0.68, 0.76] and warns that retuning the constant
  requires recomputing the dyadic boundary fixtures; a sentence (and a
  pinned test) covers rival-at-zero — the guard always fires there, benign
  because displacing a zero-coverage card costs nothing; both-zero → the
  clean card wins.

**Acceptance tests** (`tests/core/escalate.test.ts`, new):
1. `shouldEscalate` truth table: F6-at-0.79 → true; L-only → false;
   exactly 0.6 with zero findings → false (strict `<`); null graded →
   confidence-only; zero-ingredient case asserting **which arm** fires
   (grading arm false, confidence arm true).
2. `pickBetter`, one test per step plus the full pinned table: root
   combinations incl. both-rootless; round-1 (`{S1}` vs `{S4,F3,F5,F6}` →
   Claude); both-unusable → confidence; no-S beats any-S at any
   confidence (deliberate); the 12 verified step-6 pairs — yogurt
   0.79/0.70 → Claude; mirrors 0.80/0.30, 0.59/0.30, 0.95/0.61, hole A
   0.55/0.05, hole B 1.00/0.61, round-4 0.20/0.01 and 0.25/0.05 → local;
   0.30/0.25 → truthful, 0.30/0.20 → local; both-weak 0.65/0.50 →
   truthful; hole D 0.61 `{F1..F7}`/0.59 → truthful.
3. Comparator + boundary pins: rulebook pair ({F7,F7,F7} vs {F3,F6} →
   local, agreeing with §5); magnitude inversion ({F3×30,F6×30} vs
   {F3,F5,F6} → two-rule card, pinned deliberate); dyadic-exact boundary
   (0.75-vs-1.0 decisive inclusive; 0.5-vs-0.75 not); rival-at-zero; full
   tie → Claude (`>=`); null grade → today's rule.

**Edge cases:** both unusable → confidence rule; equal distinct F counts
fall through; decimal pairs (0.79/0.59) explicitly **not** used as boundary
pins.

## Slice 3 — Wire the policy into `run()`; docs follow the behaviour

**User value:** the yogurt class actually escalates and, when Claude
produces a cleaner card, gets fixed. PRD stories 1–3.

**Scope:**
- `src/content/index.ts` `run()`: trigger becomes
  `shouldEscalate(recipe.confidence, graded)`; selection becomes
  `({ recipe, graded } = pickBetter(recipe, localGraded, viaClaude,
  tryGrade(viaClaude, raw)))` — always reassigned together; the outer
  `viaClaude.root` guard at `:211` is dropped (step 1 is the single
  authority; `treeFromPlan` still runs only when a plan exists). The
  design's `graded` lifecycle table is now fully in force; `askClaude`
  null → `localGraded` stands (the no-key/offline honest-badge promise).
- `README.md:74` reworded ("only below 60% confidence" is now false);
  `:92-93` reviewed together with it; `docs/recipe-card-rules.md` §6
  (grading now runs in the extension); `CHANGELOG.md` entry extended with
  the trigger/selection change.

**Acceptance tests:**
1. All unit suites green unchanged (policy and render untouched here).
2. E2E: the slice-1 F-rule fixture now traverses `shouldEscalate` true →
   `askClaude` null (`chrome` undefined in the harness) → local ships with
   `localGraded`; snapshot and badge byte-identical to slice 1 — pinning
   the null-Claude path end-to-end.
3. E2E: existing no-finding fixtures unchanged (no call attempted at
   ≥ 0.6 clean; flat/error paths at `:215-218` untouched).

**Edge cases:** at most one call per run, per click — preserved by code
shape; grading synchronous, before the single `await`; second-click-closes
untouched. **Accepted untested** (per design): the Claude-success branch of
`run()` — mitigation is structural, `recipe`/`graded` reassigned together
from `pickBetter`'s return.

## Out of structure

Per the design: the S/F/L rules, the Claude prompt and `Plan` schema,
settings toggles, badge redesign, F8/F9, escalation telemetry, cross-run
verdict caching, a `chrome.*` mock harness. Also out: re-editing
`design.md` for the review nitpicks (assumption 1 — resolved in slice 2's
code artifacts instead).
