---
topic: grader-runtime-escalation
date: 2026-07-29
phase: design
revision: 1
---

# Design: grader-runtime-escalation

## Current state

The escalation ladder lives in `run()` at `src/content/index.ts:192-222` and
reads exactly one signal: `Recipe.confidence`, a coverage metric
(`src/core/types.ts:64` — "Fraction of ingredients we managed to attach to a
step").

- **Trigger** (`src/content/index.ts:207`): a Claude pass runs only when
  `recipe.confidence < CLAUDE_THRESHOLD` (0.6, defined at `:23`).
- **Selection** (`src/content/index.ts:211`): the Claude candidate wins when
  `viaClaude.root && viaClaude.confidence >= recipe.confidence` — ties go to
  Claude.
- **Fallback** (`:215-218`): a rootless result becomes `flatTree`; still no
  root → error panel.

The grader (`src/core/grade.ts`) can already detect the class of bug coverage
misses — `gradeCard`/`gradeByTier` return `Finding[]` across tiers S
(structural/undrawable), F (faithfulness/untrue), L (legibility/cosmetic) —
but nothing in `src/` imports it; only `tests/core/grade.test.ts` and
`tests/sites.test.ts` do (research Q4). The shipped yogurt/raw-beef card
scored 0.79 confidence, above threshold, so it never escalated; F6
(`src/core/grade.ts:408-438`, "no heat above an ingredient the recipe never
heats") is the rule that would have flagged it.

The badge (`confidenceNote`, `src/core/render.ts:45-65`) reads only
`recipe.inference` and `recipe.confidence`; a card that fails F6 at 79%
coverage displays "moderate confidence".

## Desired end state

1. A local card with any S or F finding escalates to Claude even at ≥ 0.6
   confidence. L-only findings never trigger a call.
2. When two candidates exist, the one with fewer S findings wins; then fewer
   F findings; only then does the existing confidence rule decide. A truthful
   lower-coverage card beats a higher-coverage false one.
3. Still at most one Claude call per `run()`.
4. A shipped card with residual S/F findings shows a "low confidence" badge
   whose note names the first finding.
5. A grading crash degrades to today's confidence-only behaviour — the page
   never breaks.

## Patterns to follow

- **Null at the boundary.** `askClaude` (`src/content/index.ts:171-190`) is
  documented "Never throws — the caller has a plan B"; the background worker
  replies `{ ok: false }` rather than throwing (`src/background.ts:43-46`).
  Grading follows the same shape.
- **Core stays pure.** `src/core/*` is "plain data — no DOM, no browser"
  (`src/core/types.ts:7`, `README.md:61`); `grade.ts` imports only core
  modules (`src/core/grade.ts:21-24`). New decision logic goes in core so it
  is unit-testable in Node — `src/content/index.ts` has no unit tests.
- **Tiered gating is the intended API.** `gradeByTier` exists "for callers
  that gate the tiers differently" (`src/core/grade.ts:618`); S means INVALID,
  not low-scoring (`docs/recipe-card-rules.md:150`).
- **Test layout.** Vitest, `tests/core/<module>.test.ts` mirroring
  `src/core/<module>.ts`; violating case paired with a near-miss that must not
  trip (`tests/core/grade.test.ts:1-12`).

## Shape of the change

### New module: `src/core/escalate.ts`

The escalation *policy*, separated from the rulebook (`grade.ts`) and the
shell (`content/index.ts`). Three exports, no implementation shown here:

- `CLAUDE_THRESHOLD = 0.6` — moves here from `src/content/index.ts:23`,
  comment included; one definition, now importable by tests.
- `shouldEscalate(confidence: number, graded: Record<Tier, Finding[]> | null): boolean`
  — true when `confidence < CLAUDE_THRESHOLD`, or when `graded` is non-null
  and `graded.S.length + graded.F.length > 0`. A null `graded` (grading
  failed) reproduces today's confidence-only trigger exactly.
- `pickBetter(local: Recipe, localGraded: G | null, viaClaude: Recipe, claudeGraded: G | null): Recipe`
  (where `G = Record<Tier, Finding[]>`) — if either grade is null, apply
  today's rule (`viaClaude.confidence >= local.confidence`). Otherwise compare
  `(S.length, F.length)` lexicographically, fewer wins; on a full tie, fall
  through to today's confidence rule, `>=` still favouring Claude. L never
  participates.

These functions throw nothing themselves; they are total over their inputs.

### `src/content/index.ts` changes

- Add a private `tryGrade(recipe: Recipe, raw: RawRecipe): Record<Tier, Finding[]> | null`
  beside `askClaude`: wraps `gradeByTier(recipe, raw)` in try/catch → null,
  same "plan B" contract. `gradeCard` runs `layout()` internally
  (`src/core/grade.ts:221`) and the doc warns a non-tree could crash the
  deeper checks; the catch keeps that off the page. Core stays fail-fast; the
  boundary is where leniency lives.
- Rework `run()` (`:205-213`): grade the local candidate once
  (`localGraded = tryGrade(recipe, raw)`); gate the Claude call on
  `shouldEscalate(recipe.confidence, localGraded)`; keep the existing
  `viaClaude.root` guard, then grade the Claude candidate and assign
  `recipe = pickBetter(...)`. Track the winner's graded record for the badge.
  Delete the local `CLAUDE_THRESHOLD`; import from `escalate.js`.
- `showTable` (`:99`) gains a `findings: Finding[]` parameter (the winner's
  S + F findings, `[]` when grading failed or `flatTree` replaced the card)
  and passes it to `confidenceNote`. Finding details flow through the
  existing `escape(note.text)` at `:118`, so page-derived strings stay safe.

### `src/core/render.ts` changes

`confidenceNote(recipe: Recipe, findings: Finding[] = [])` — when `findings`
is non-empty: level forced to `'low'`, text appends a clause naming the count
and the first finding's `detail` (details already name the ingredient, per
`src/core/grade.ts:35-36`). Empty findings → behaviour is byte-identical to
today, so the default parameter keeps every other caller and snapshot valid.
`render.ts` imports `Finding` from `grade.js` — a core→core import, allowed.

### Documentation that must change with the behaviour

- `README.md:74` — "(only below 60% confidence…)" becomes false; reword to
  "when local parsing is uncertain — low confidence, or the self-check found
  a structural or faithfulness problem". `README.md:92-93` ("only when local
  parsing is uncertain") stays true as written.
- `docs/recipe-card-rules.md` §6 (`:180-183`) — grading now also runs in the
  extension, not only in tests.
- `CHANGELOG.md` — new entry (repo convention, see `CHANGELOG.md:20`).

## Decisions made

1. **Trigger gates on S ∪ F; the confidence trigger is kept, OR-ed.**
   *Assumption — chosen without user review* (task.md left tier participation
   open). Alternative: replace the confidence trigger with grading alone —
   rejected because sub-0.6 coverage means ≥40% of ingredients unattached,
   which grading does not fully re-detect (L7 orphan-rate is Tier L), and the
   documented posture ("heuristics are not trustworthy enough to show alone")
   would silently weaken.
2. **Selection orders by (S count, F count) lexicographically, then
   confidence.** *Assumption — chosen without user review.* Alternative:
   total S+F count — rejected because any-S means INVALID per
   `docs/recipe-card-rules.md:150`, and a valid card must beat an INVALID one
   regardless of F counts. Alternative: the §5 weighted score — rejected; §5
   itself says report rule IDs, never a bare number (`:159-160`), and the
   runtime needs an ordering, not a score.
3. **At most one Claude call per run, unchanged.** Alternative: retry when
   the Claude card also fails — rejected: same prompt, same model, user's own
   key (`src/llm/claude.ts:51-55` documents the cost posture); no evidence a
   second identical call converges.
4. **Badge reflects residual S/F findings (level → low, note names the first
   finding).** *Assumption — chosen without user review* (PRD required an
   explicit choice). Alternative: leave the badge coverage-only — rejected by
   PRD story 4 ("not overstate confidence"). Alternative: a new badge state —
   rejected; badge redesign is out of scope per the PRD.
5. **The `flatTree` fallback is not graded.** *Assumption — chosen without
   user review.* It is already forced to `low` (`src/core/render.ts:54`) and
   no decision remains for findings to change; grading it spends work to no
   effect.
6. **The Claude candidate is graded fresh**, even though `plan.ts` defends
   most S rules by construction — because those guards are "defended, not
   asserted" (`docs/recipe-card-rules.md:237-238`) and F rules are not
   defended at all.
7. **Policy lives in `src/core/escalate.ts`, not inline.** Alternative:
   inline in `content/index.ts` — rejected: untestable (no unit tests touch
   the content script). Alternative: extend `grade.ts` — rejected: the
   grader's header promises it shares no judgement with inference
   (`src/core/grade.ts:15-18`); escalation policy is a different concern.
8. **No `grid` reuse into `gradeCard`.** Grading re-runs `layout()` per
   candidate; a layout is a pure walk over a recipe-sized tree (tens of
   nodes), negligible next to one network call. Simplicity beats caching.

## Edge cases

- **Empty/missing input.** Local root null with ingredients present → S1
  fires → escalation (an improvement: today this only escalates below 0.6).
  Zero ingredient lines → S1 deliberately silent (`src/core/grade.ts:170-177`);
  the existing error path at `:216-218` is unchanged.
- **Boundary values.** Confidence exactly 0.6 with zero findings → no call
  (strict `<` preserved). 0.79 with an F6 → escalates (the shipped bug).
  Equal S, equal F, equal confidence → Claude wins (`>=` preserved).
- **Failure paths.** `gradeByTier` throws → `tryGrade` null → trigger and
  selection degrade to today's behaviour, badge unchanged from today.
  `askClaude` null (no key, `useClaudeFallback` off, network error) → local
  card ships, now with an honest low badge if it has S/F findings.
- **Ordering/state.** Grading is synchronous and runs before the single
  `await`; the second-click-closes contract (`:193`) is untouched.
- **Resource/cost.** Worst case stays one Claude call per run. Call frequency
  rises only for the target class — cards ≥ 0.6 with S/F findings; L-only
  cards never pay. Fixture evidence: all 15 site fixtures currently grade
  clean on S and F (`tests/sites.test.ts:79-90`), so typical pages add zero
  calls.
- **Adversarial/malformed input.** Finding details embed page-controlled
  ingredient text; they reach the DOM only through `escape()`
  (`src/content/index.ts:118`). A malformed Claude plan is already sanitised
  by `plan.ts` and now also graded before it can win.

## Testing

- `tests/core/escalate.test.ts` (new): `shouldEscalate` truth table (F-only
  above threshold → true; L-only → false; below threshold, no findings →
  true; null graded → confidence only). `pickBetter`: valid beats INVALID
  regardless of F counts; fewer F wins at lower confidence; full tie →
  Claude; null grade → today's rule. One case is the regression: a card
  failing F6 at 0.79 must escalate.
- `tests/core/render.test.ts` (new): `confidenceNote` with empty findings is
  unchanged for all three strategies; with an F finding, level is `low` and
  the text contains the finding's detail.
- `tests/sites.test.ts` untouched — it already gates S/F on the fixtures.

## Out of scope

Per the PRD: the S/F/L rules themselves, the Claude prompt and `Plan` schema,
any settings toggle, badge visual redesign, F8/F9 reference-card rules. Also
out: telemetry/counting of escalations (no demand signal for it yet — the
thinnest version ships the decision change and the honest badge only).

## Risks

- `pickBetter` can keep a *lower*-coverage card; if a grading rule
  over-fires on some site, users see sparser cards. Mitigation: F6 is tuned
  precision-over-recall with fixture-pinned carve-outs
  (`docs/recipe-card-rules.md:197-209`), and all 15 fixtures grade clean.
- The badge change makes previously "moderate" cards say "low" when findings
  persist after escalation — intended, but visible; the CHANGELOG entry
  should say so plainly.

## Open questions (deferred)

- Whether escalation outcomes should ever be surfaced beyond the badge
  (e.g. a "why did this call Claude?" affordance). No user demand yet;
  deferred rather than decided.
