---
topic: grader-runtime-escalation
date: 2026-07-29
phase: plan
---

# Plan: grader-runtime-escalation

Three slices, in order, each independently shippable. Every numeric
scenario below comes from `design.md`'s Testing section and the verified
table in `design-review-5.md` — the authority on expected winners; do not
substitute, drop, or "simplify" any pinned pair. Per-slice gates:
`npm run typecheck && npm test`, then `npm run build && npm run
e2e:golden` (the golden suite evaluates `dist/content.js`, so build first).

## Assumptions (resolved autonomously)

1. **`Graded` alias lives in `src/core/escalate.ts`**:
   `export type Graded = Record<Tier, Finding[]>` (`import type` from
   `grade.js`) — the design's `grade.ts` change list is exhaustive. Slice
   1 types `tryGrade` with the inline record type; slice 3 uses `Graded`.
2. **One PR carries all three slices**; the CHANGELOG `(#N)` is that PR's
   number, filled when opened. Slice 1 creates the entry; slice 3 extends it.
3. **The new golden fixture is `parked.html`**, modeled on F6's signature
   (parked early, later heated as an unnamed passenger). Any F rule is
   acceptable if F6 won't trip via local inference; hard requirements:
   `inferTree` confidence ≥ 0.6 **and** ≥ 1 F finding (step 1.6 verifies).
4. **Badge-note wording is the implementer's choice**; tests pin the
   contract, not prose (level, count, detail, truncation, byte-identity).
5. **`parked` joins `FIXTURES` and the structural `expected` table** —
   slice 3 proves byte-identity with the existing screenshot machinery;
   references generated once, in slice 1.
6. **`confidenceNote` keeps a default `findings: Finding[] = []`** — its
   only call site (`src/content/index.ts:100`, research Q5) updates in the
   same slice; `print.ts` imports only `escapeHtml`/`renderTable`.

## Slice 1 — Honest badge: S/F findings force "low", name the problem

### Step 1.1 — `src/core/render.ts`

- `confidenceNote(recipe: Recipe, findings: Finding[] = [])`, same return
  type. `import type { Finding } from './grade.js'` — **type-only**, or
  the grader lands in the print/export bundles via `print.ts`.
- The findings check runs **first, before the `flat` early-return at
  `:54`**: non-empty findings force `'low'` and append a clause naming
  `findings.length` and `findings[0].detail`, the detail truncated to 120
  chars with an ellipsis appended when longer. Empty findings →
  byte-identical output to today on every path.

### Step 1.2 — `src/content/index.ts`: `tryGrade` + `graded` lifecycle

- Private `tryGrade(recipe: Recipe, raw: RawRecipe): Record<Tier, Finding[]> | null`
  beside `askClaude`: `gradeByTier(recipe, raw)` — **no options** — in
  try/catch → null. Import `gradeByTier` (value), `Tier`/`Finding` (type).
- In `run()`: after `:205`, `let graded = tryGrade(recipe, raw)`. When
  Claude wins under the **existing, unchanged** rule at `:211`, reassign
  together: `recipe = viaClaude; graded = tryGrade(viaClaude, raw)`. On
  the `flatTree` swap at `:215`, reset `graded` to null (Decision 5).
  Trigger `:207` and the selection predicate are NOT touched here.
- `showTable` (`:99`) gains `findings: Finding[]`, passed to
  `confidenceNote` at `:100`; the call site computes
  `graded ? [...graded.S, ...graded.F] : []` — L excluded. Details reach
  the DOM only through the existing `escape(note.text)` at `:118`.

### Step 1.3 — `tests/core/render.test.ts` (new)

House style per `tests/core/grade.test.ts`: `describe`/`it`/`expect`,
small fixture builders, violating case paired with a near-miss.

1. **Byte-identity, empty findings** — exact level+text assertions:
   `flat`; `heuristic` at 0.9/0.7/0.5; `claude` at 0.7; called with `[]`
   and with the argument omitted (pins the default).
2. **F finding forces low** — heuristic at 0.79 + one F6 finding →
   `'low'`, text contains the detail. Near-miss: no findings → `'moderate'`.
3. **Findings precede flat** — flat recipe + one finding → the finding
   clause, not the bare flat message.
4. **Truncation** — detail > 120 chars → first 120 chars + `…`, full
   detail absent. Near-miss: exactly 120 chars → whole, no ellipsis.
5. **Count** — two findings → text names `2` and only the first detail.

### Step 1.4 — `CHANGELOG.md`

New `### Changed` section under `[Unreleased]`: badges for cards whose
self-check finds a structural or faithfulness problem now read "low" and
name the finding. Keep a Changelog format, `(#N)` per assumption 2.

### Step 1.5 — E2E: badge renders on existing fixtures

Extend the per-fixture "renders the expected diagram" test in
`tests/e2e/golden.spec.ts`: assert `.rd-badge` is visible; run
**without** `--update-snapshots` — all existing screenshots must pass
(the no-regression gate).

### Step 1.6 — E2E: the `parked` fixture

- Author `tests/e2e/golden-pages/parked.html` in `heuristic.html`'s style,
  modeled on the pita-wraps fixture (`tests/core/grade.test.ts:33-49`): a
  sauce refrigerated in step 1, later steps heating a named subject while
  the parked ingredient rides along.
- **Verify before wiring** (throwaway script or temp test): extraction
  yields `inferTree` confidence ≥ 0.6 and ≥ 1 F finding from options-free
  `gradeByTier`; iterate the HTML until both hold (fallback: another F
  rule, assumption 3), then delete the throwaway.
- Add `parked` to `FIXTURES` and a measured row to the `expected` table.
  New test: render `parked`; badge text is `low confidence`; `.rd-note`
  contains a stable fragment of the finding detail.
- Generate references for the new fixture only
  (`npx playwright test tests/e2e/golden.spec.ts --update-snapshots -g parked`);
  `git status` must show only **added** snapshots. Review, commit.

**Slice gate:** unit + e2e green; only new snapshots added. Commit.

## Slice 2 — Escalation policy: `src/core/escalate.ts`, pure, fully pinned

### Step 2.1 — `src/core/grade.ts`

Export `const UNUSABLE_RULES: readonly RuleId[] = ['S1', 'S2']`; edit the
inline predicate at `:610` to reference it. Behaviour-preserving — the
existing grade suite must pass with zero assertion changes.

### Step 2.2 — `src/core/escalate.ts` (new)

Pure — no DOM, no `chrome.*`, imports only from core. **Module doc
comment states the options-free contract**: graded records must come from
an options-free `gradeByTier` call — the `skip` filter runs after the
short-circuit check (`:610` vs `:615`), so a skipped S1/S2 reads clean
and defeats step 3. Neither function throws; exports:

- `type Graded = Record<Tier, Finding[]>`; `CLAUDE_THRESHOLD = 0.6` —
  moved from `src/content/index.ts:23`, its comment carried over.
- `RETAIN_RATIO = 0.75` — doc comment must state: chosen, not borrowed
  from `CLAUDE_THRESHOLD`; a ratio, not a difference (an absolute gap
  degenerates at low coverage, where F-clean near-flat cards live); bounds
  — binding must-block is 0.30-vs-0.20 (> 0.6667; hole B's 0.61 is true
  but **not** binding), binding must-fire is both-weak 0.65-vs-0.50
  (≤ 0.7692); every value in [0.68, 0.76] picks the same winner in every
  pinned **real-card** scenario; **retuning requires recomputing the
  dyadic boundary fixtures**; rival-at-zero: the guard always fires,
  benign (displacing a zero-coverage card costs nothing).
- `EPSILON = 1e-9` — boundary slack only; both confidences share
  denominator `raw.ingredientLines.length`, so any non-tie gap is
  ≥ `1/(4n)`, orders of magnitude above the slack.
- `shouldEscalate(confidence: number, graded: Graded | null): boolean` —
  true when `confidence < CLAUDE_THRESHOLD` (strict) OR `graded` non-null
  with `S.length + F.length > 0`. Doc comment pins the zero-ingredient
  dependency: that case grades vacuously clean and escalates on the
  confidence arm alone (`infer.ts:403`) — remove that arm and it silently
  stops escalating.
- `pickBetter(local: Recipe, localGraded: Graded | null, viaClaude: Recipe, claudeGraded: Graded | null): { recipe: Recipe; graded: Graded | null }`
  — returns the winner **and the winner's own graded record**. Seven steps,
  first decisive wins ("confidence rule" = `viaClaude.confidence >=
  local.confidence`, ties to Claude):
  1. Exactly one non-null `root` → it wins; both rootless → confidence rule.
  2. Either grade null → confidence rule.
  3. Exactly one unusable (any `UNUSABLE_RULES` id in `graded.S`) → the
     other wins; 4. both unusable → confidence rule.
  5. Exactly one has any S finding → the S-free card wins (presence,
     unconditional).
  6. Fewer distinct failed F rules (`new Set(F.map(f => f.rule)).size`)
     is favoured; decisive iff
     `favoured.confidence >= other.confidence * RETAIN_RATIO - EPSILON`;
     equal counts or guard unmet → fall through. 7. Confidence rule.

### Step 2.3 — `tests/core/escalate.test.ts` (new)

Helpers: `rec(confidence, root)` — minimal `Recipe` (pickBetter reads
only `root` nullness and `confidence`); `graded(rules: RuleId[])`;
`CLEAN = graded([])`.

**`shouldEscalate` truth table** (one `it` per row):

| confidence | graded | expect | pins |
| --- | --- | --- | --- |
| 0.79 | `{F6}` | true | the yogurt trigger — regression vs today |
| 0.9 | `{L1}` only | false | L-only never calls |
| 0.9 | `{S1}` | true | S arm |
| 0.6 | CLEAN | false | strict `<` at the boundary |
| 0.59 | CLEAN | true | confidence arm |
| 0.6 / 0.59 | null | false / true | null grade = today's trigger |
| 0 / 0.6 | same vacuous CLEAN | true / false | zero-ingredient: **confidence arm fires, grading arm is blind** — the pinned dependency |

**`pickBetter` — one test per step:**

- Step 1: rooted local 0.1 `{S4}` beats rootless Claude 0.9 CLEAN, and
  vice versa; both rootless → confidence rule (0.4 vs 0.5 → local; tie →
  Claude).
- Step 2: local grade null, 0.8 vs graded Claude 0.7 → local; tie →
  Claude; both null → today's rule exactly.
- Step 3 (round-1): local `{S: [S1]}` vs Claude `{S: [S4], F: [F3, F5, F6]}`
  → Claude — unusable loses even to a card carrying S and F findings.
  Step 4: both unusable (`{S1}` vs `{S2}`) → confidence rule.
- Step 5: local `{S4}` 0.95 vs S-clean Claude 0.30 → Claude — no-S beats
  any-S at any confidence, **pinned deliberate**.
- Step 7: full tie, both CLEAN → Claude (`>=`).

**The 12 pinned step-6 pairs** — the core of the feature. Local carries
the F findings; Claude is F-clean (row 12: 7 distinct rules); winners per
`design-review-5.md`. Rows 9–12 are new (today keeps local in all 12):

| # | local | Claude | ratio | winner | name |
| --- | --- | --- | --- | --- | --- |
| 1 | 0.20 `{F6}` | 0.01 clean | 0.0500 | local | round-4 low-coverage |
| 2 | 0.55 `{F6}` | 0.05 clean | 0.0909 | local | hole A |
| 3 | 0.25 `{F6}` | 0.05 clean | 0.2000 | local | round-4 low-coverage |
| 4 | 0.80 `{F6}` | 0.30 clean | 0.3750 | local | round-2 mirror |
| 5 | 0.59 `{F6}` | 0.30 clean | 0.5085 | local | round-3 mirror |
| 6 | 1.00 `{F6}` | 0.61 clean | 0.6100 | local | hole B |
| 7 | 0.95 `{F6}` | 0.61 clean | 0.6421 | local | round-3 mirror |
| 8 | 0.30 `{F6}` | 0.20 clean | 0.6667 | local | guard skips |
| 9 | 0.65 `{F6}` | 0.50 clean | 0.7692 | Claude | both-weak, deliberate |
| 10 | 0.30 `{F6}` | 0.25 clean | 0.8333 | Claude | guard fires |
| 11 | 0.79 `{F6}` | 0.70 clean | 0.8861 | Claude | **the yogurt fix** |
| 12 | 0.61 `{F1..F7}` | 0.59 clean | 0.9672 | Claude | hole D, straddles old threshold |

**Comparator and boundary pins:**

- Rulebook pair: `{F7, F7, F7}` (1 distinct) vs `{F3, F6}` (2 distinct),
  equal confidence → the F7×3 card wins, agreeing with §5.
- Magnitude inversion: `{F3×30, F6×30}` (2 distinct) vs `{F3, F5, F6}`
  (3 distinct), in-ratio → the two-rule card wins, **pinned deliberate**.
- **Dyadic boundary — the only legitimate boundary fixtures.** Favoured
  (F-clean) 0.75 vs rival `{F6}` 1.0 → boundary exactly 0.75, decisive:
  favoured wins despite lower confidence (inclusive `>=`). Favoured 0.5
  vs rival `{F6}` 0.75 → boundary 0.5625, not decisive → step 7 → the
  0.75 card wins. All values dyadic; both products exact in IEEE 754.
  **Decimal pairs (e.g. 0.79/0.59) must NOT be used as boundary pins** —
  IEEE 754 decides their side (round-4 finding); the design disowns them.
- Rival-at-zero: favoured clean 0.05 vs rival `{F6}` 0.0 → favoured wins.
  Both-zero: local `{F6}` 0.0 vs Claude clean 0.0 → Claude — clean wins;
  pinned as an improvement. Totality: no input combination throws.

### Step 2.4 — `src/content/index.ts`: the import swap

Delete local `CLAUDE_THRESHOLD` (`:22-23`); import it from
`../core/escalate.js`. **Same commit as 2.2** — the constant never exists
in two places; no other content-script change in this slice.

**Slice gate:** unit green, grade suite unchanged; e2e green. Commit.

## Slice 3 — Wire the policy into `run()`; docs follow the behaviour

### Step 3.1 — `src/content/index.ts`

- Import `shouldEscalate`, `pickBetter`, `type Graded` from
  `../core/escalate.js`; drop the `CLAUDE_THRESHOLD` import (nothing in
  the file references it after this step). Retype `tryGrade` → `Graded | null`.
- Trigger `:207` becomes `shouldEscalate(recipe.confidence, graded)`.
- Selection: keep the `if (plan)` guard (`treeFromPlan` runs only when a
  plan exists); **drop the outer `viaClaude.root` check** at `:211` —
  pickBetter step 1 is the single root authority; the assignment becomes
  `({ recipe, graded } = pickBetter(recipe, graded, viaClaude, tryGrade(viaClaude, raw)))`
  — recipe and graded always reassigned together.
- Everything else stays: `askClaude` null → `graded` still holds the local
  grade (the honest-badge promise offline/no-key); flat/error paths
  `:215-218` and the slice-1 `graded = null` reset untouched; grading
  synchronous, before the single `await`; at most one call per run, per
  click; second-click-closes untouched by code shape.

### Step 3.2 — Docs the behaviour change makes true or false

- `README.md:74`: "(only below 60% confidence…)" is now false → "when
  local parsing is uncertain — low confidence, or the self-check found a
  structural or faithfulness problem — only with a key you supply";
  review `:92-93` with it (its meaning is redefined by the reword).
- `docs/recipe-card-rules.md` §6 (`:180-183`): grading now also runs in
  the extension at overlay time — gating escalation, selecting
  candidates, feeding the badge.
- `CHANGELOG.md`: extend slice 1's entry — self-check failures now
  escalate to Claude even above 60% confidence; the more truthful
  candidate can win at lower coverage.

### Step 3.3 — E2E verification (no new fixtures)

1. `npm run typecheck && npm test` — all unit suites green **unchanged**
   (policy and render untouched here; a unit diff means the wiring is wrong).
2. `npm run build && npm run e2e:golden` **without** `--update-snapshots`:
   `parked` now traverses `shouldEscalate` true (grading arm) →
   `askClaude` null (`chrome` undefined in the harness) → local ships with
   `localGraded`; screenshot, badge level, and note text **byte-identical
   to slice 1** — pinning the null-Claude path end-to-end. Existing
   no-finding fixtures unchanged: ≥ 0.6 clean attempts no call; below 0.6
   degrades as today; flat/error paths untouched.

**Slice gate:** both commands green, zero snapshot churn. Commit.

## Coverage map

- **S/F above threshold escalates** — `shouldEscalate` table (unit) +
  `parked` traversal (e2e, null-Claude path). **L-only adds no call** —
  L-only row. **Fewer/no S-F candidate wins** — `pickBetter` step tests,
  12-pair table, comparator/boundary pins (unit). **Flat fallback
  preserved** — `:215-218` untouched + goldens green. **Badge names the
  problem** — `render.test.ts` (unit) + `parked` assertions (e2e).
- **Accepted untested** (per design, deliberate): the Claude-**success**
  branch of `run()` — live `pickBetter` + `showTable` with a Claude
  winner — needs a `chrome.runtime` mock that does not exist. Mitigation
  is structural: plumbing between fully-tested pure functions, with
  `recipe`/`graded` reassigned together from `pickBetter`'s return — the
  badge-names-the-loser bug is impossible by construction.
