---
topic: grader-runtime-escalation
date: 2026-07-29
phase: design
revision: 5
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
but nothing in `src/` imports it; only tests do (research Q4). The shipped
yogurt/raw-beef card scored 0.79 confidence, above threshold, so it never
escalated; F6 (`src/core/grade.ts:408-444`) is the rule that would have
flagged it.

Four grader behaviours are load-bearing for this design:

- **When S1 or S2 fires, `gradeCard` stops after Tier S**
  (`src/core/grade.ts:610-613`). For such a card, `F: []`/`L: []` mean
  *never checked*, not *clean*.
- **S1 is silent when `raw.ingredientLines.length === 0`** (`:170-177`), and
  the F and L checks return `[]` immediately on a null root (`:324`, `:487`)
  — so a rootless zero-ingredient card grades `{S:[], F:[], L:[]}`,
  vacuously clean.
- **The `skip` filter is applied after the short-circuit check** (`:610`
  computes `unusable`, `:615` filters). `skip: ['S1']` on a rootless card
  yields a grade indistinguishable from clean.
- **The F tier is blind to sparseness.** F3 stays clean with an op per
  source step (`:369-379`); root children are exempt from F7 (`:452`);
  unclaimed ingredients are appended, keeping F1/F2 clean
  (`docs/recipe-card-rules.md:233-235`). A card with most ingredients
  hanging off the root can grade F-clean at *any* confidence — orphan rate
  is L7. Coverage is the only signal that sees sparseness, and sparseness
  is continuous: no single cutoff point encodes it.

Also load-bearing: several F rules emit one finding per offending pair —
F7 per (op, child) (`:451-465`), F3 per uncited step (`:369-379`), F5 per
(op, child) (`:393-406`), F6 per leaf (`:414-445`) — so raw finding counts
vary with tree shape, while §5 scores faithfulness pass/fail **per rule**
(`faithfulness = mean(F1..F9)`, `docs/recipe-card-rules.md:151`).

The badge (`confidenceNote`, `src/core/render.ts:44-65`) reads only
`recipe.inference` and `recipe.confidence`; a card that fails F6 at 79%
coverage displays "moderate confidence".

## Desired end state

1. A local card with any S or F finding escalates to Claude even at ≥ 0.6
   confidence. L-only findings never trigger a call.
2. When two candidates exist: a rooted card always beats a rootless one
   (checked in one authoritative place); a fully-graded card beats one whose
   grade was cut short; among fully-graded cards, no-S beats any-S; fewer
   *distinct failed F rules* wins — but never for a card **materially
   sparser** than its rival, where "materially" is a named constant, not a
   band boundary; confidence settles everything else.
3. Still at most one Claude call per `run()`, each following an explicit
   toolbar click.
4. A shipped card with residual S/F findings shows a "low confidence" badge
   whose note names the first finding — and the note provably belongs to the
   card being shown, by construction, on **every** path through `run()`.
5. A grading crash degrades to today's confidence-only behaviour — the page
   never breaks.

## Patterns to follow

- **Null at the boundary.** `askClaude` (`src/content/index.ts:171-190`) is
  documented "Never throws — the caller has a plan B"; the background worker
  replies `{ ok: false }` rather than throwing (`src/background.ts:43-46`).
- **Core stays pure.** Core is "plain data — no DOM, no browser"
  (`src/core/types.ts:7`); "None of them touch `chrome.*`, so the entire
  product logic is unit-testable in Node" (`README.md:61-62`). New decision
  logic goes in core — `src/content/index.ts` has no unit tests.
- **Tiered gating is the intended API.** `gradeByTier` exists "for callers
  that gate the tiers differently" (`src/core/grade.ts:618`); any S finding
  means INVALID — no score, not a low one (`docs/recipe-card-rules.md:150`).
- **Test layout.** Vitest, `tests/core/<module>.test.ts` mirroring
  `src/core/<module>.ts`; violating case paired with a near-miss
  (`tests/core/grade.test.ts:1-12`).

## Shape of the change

### `src/core/grade.ts` — one new export, one behaviour-preserving edit

`export const UNUSABLE_RULES: readonly RuleId[] = ['S1', 'S2']` — names the
existing short-circuit set; the inline predicate at `:610` is edited to
reference it. Behaviour identical, but `gradeCard`'s body is touched, not
merely appended to. Alternative: duplicate the list in `escalate.ts` —
rejected: silent drift. No grading rule changes (PRD keeps the rule set out
of scope).

### New module: `src/core/escalate.ts`

The escalation *policy*. With `Graded = Record<Tier, Finding[]>`:

- `CLAUDE_THRESHOLD = 0.6` — moves here from `src/content/index.ts:23`,
  comment included.
- `COVERAGE_GAP = 0.2` — the sparseness guard for step 6. **The constant is
  chosen, not borrowed, and its doc comment says so.** Selection borrows
  nothing from `CLAUDE_THRESHOLD`: that constant's documented meaning
  (`src/content/index.ts:22`, "not trustworthy enough to show alone")
  governs display trust and call-spending, and transferring its authority
  into selection — the band — is what round 3 rejected. The guard's
  strength is uniform, 0.2 of coverage at every point on the axis, where
  the band's varied from ~0 to 0.6 with absolute position. The *bounds* on
  the value are argued, not invented: it must be **below 0.29** so every
  pinned mirror pair (deficits 0.29–0.50) resolves as today's code does,
  and **above ~0.1** so a genuine fix costing about one reattached
  ingredient line on a typical 10-line recipe can still win — `GAP = 0`
  (the never-trade rule) fails that lower bound by construction. Every
  value in [0.15, 0.25] picks the same winner in every pinned scenario;
  0.2 is the round number in that insensitive range.
- `EPSILON = 1e-9` — numeric slack for the step-6 boundary, nothing more.
  Confidence values are ratios (`matched / total`), so exact decimal
  boundaries are essentially never attainable in IEEE 754 — checked:
  `0.79 - 0.2 === 0.5900000000000001`, so without slack the pinned
  boundary pair would evaluate the wrong way and "inclusive" would be
  decorative. The smallest *meaningful* coverage difference is one
  ingredient line — at least `1/50 ≈ 0.02` for any plausible recipe, seven
  orders of magnitude above the slack — so the tolerance can never change
  a real winner; it exists so the boundary does not hinge on rounding
  direction.
- `shouldEscalate(confidence: number, graded: Graded | null): boolean` —
  true when `confidence < CLAUDE_THRESHOLD`, or when `graded` is non-null
  and `graded.S.length + graded.F.length > 0`. Null `graded` reproduces
  today's confidence-only trigger. Two arms, honestly stated: when S1/S2
  fire, the grading arm sees `S.length > 0`; in the **zero-ingredient
  rootless case the grading arm is blind** — the grade is vacuously clean
  (see Current state) and escalation rides on the confidence arm alone,
  which covers it because `inferTree` returns confidence 0 with no
  ingredients (`src/core/infer.ts:403`). The doc comment states the
  dependency: remove the confidence arm and that case silently stops
  escalating.
- `pickBetter(local: Recipe, localGraded: Graded | null, viaClaude: Recipe, claudeGraded: Graded | null): { recipe: Recipe; graded: Graded | null }`
  — returns the winner *and the winner's own graded record*, so the badge
  can never name the losing card's findings. (Alternative — bare `Recipe`
  plus identity recovery — rejected in round 1: wrong-and-quiet.)

**`pickBetter`'s rule, in order** (first decisive step wins; "confidence
rule" = today's `viaClaude.confidence >= local.confidence`):

1. **Root check — the single authority.** Exactly one candidate has a
   non-null `root` → it wins. Both rootless → confidence rule (the winner
   reaches `flatTree` either way; determinism only). `run()` drops the
   outer `viaClaude.root` guard at `src/content/index.ts:211` so root
   reasoning lives in one place — verified non-regressive in review by
   tracing `src/core/infer.ts:374-393`: local-rootless implies confidence
   0, so today's rule already gave Claude the win. This step is also why
   the zero-ingredient vacuously-clean card can never win by its clean
   grade: it has no root.
2. Either grade null → confidence rule.
3. Exactly one candidate **unusable** (any `UNUSABLE_RULES` finding in
   `graded.S`) → the other wins: an unusable card's F and L tiers were
   never computed. (An S1 card is headed for `flatTree`; an S2 card has a
   root and would render — it loses because its grade is unreadable past
   Tier S and any-S is INVALID, not because of where it is headed.)
4. Both unusable → confidence rule (their S tiers are partial too —
   `checkStructure` returns early at `:177`/`:200`).
5. **No-S beats any-S — presence, unconditional.** *Assumption — chosen
   without user review.* Three reasons: INVALID is a state with no score
   (`docs/recipe-card-rules.md:150`); S findings are artifact-level
   breakage — a duplicated leaf doubles a quantity, a mis-spanned row
   visually attaches instructions to the wrong ingredients — corrupting how
   the whole grid reads, where an F finding names one checkable statement
   the badge can point at; and the product's own floor is already a sparse
   valid presentation (`flatTree` "never claims to understand",
   `README.md:82-83`). Accepted consequence, pinned in tests: a
   high-coverage card with one S finding loses to a sparse S-clean card.
   Presence, not count: ranking INVALIDs by count invents a score the
   rulebook refuses.
6. **Fewer distinct failed F rules wins — guarded by `COVERAGE_GAP`.**
   Compared as `new Set(F.map(f => f.rule)).size`, which matches §5's
   per-rule scoring (`docs/recipe-card-rules.md:151`) and is insensitive to
   how many findings one rule emits per offending pair — raw finding counts
   vary with tree shape (see Current state) and can disagree with the
   rulebook's own order ({F7,F7,F7} counts worse than {F3,F6} but scores
   better, 8/9 vs 7/9; distinct-rule counting agrees with the score).
   Equal distinct counts — including magnitude differences within one rule
   — fall through. **The guard, stated literally:** the candidate this
   step favours is the one with fewer distinct failed F rules; the step is
   decisive iff
   `favoured.confidence >= other.confidence - COVERAGE_GAP - EPSILON`;
   otherwise skip to step 7. `EPSILON` makes the boundary genuinely
   inclusive under floating point: a deficit of exactly 0.2 is decisive —
   `0.59 >= 0.79 - 0.2 - 1e-9` is true where the bare subtraction is not.
   The guard is a function of the coverage *difference*, uniform
   everywhere on the axis. That matters because under today's trigger,
   escalation only ever runs below 0.6 — so a rule keyed to band
   membership was inert exactly where the pre-existing path operates, and
   the lower band is precisely where near-flat F-clean cards live (a
   near-flat card is low-coverage by definition;
   `src/core/plan.ts:120-127` does not count appended orphans as matched).
   It closes the named holes: **(A)** 0.55 `{F6}` vs 0.05 clean (deficit
   0.50) and **(B)** 1.00 `{F6}` vs 0.61 clean (0.39) → guard skips, local
   kept, as today. **(D)** 0.61 `{F1..F7}` vs 0.59 clean (deficit 0.02) →
   decisive, the truthful card wins — the guard is indifferent to which
   side of any threshold the pair sits on, so step 7's truth-blindness is
   reached only when the truthful card is materially sparser. **(C)** the
   cliff at the guard boundary is real and deliberately placed: any rule
   honouring the task's acceptance signal — the fewer-findings card "wins,
   even if its confidence score is lower" (task.md) — has a flip point
   somewhere; only the never-trade rule has none, and Decision 2 rejects
   it. Both sides of this cliff are acceptable outcomes — a truthful
   upgrade within the gap, or a richer card shipped with a badge naming
   its falsehood — unlike the band's cliff, where one side was the mirror
   bug. Accepted consequence, pinned: when *both* cards are weak (0.65
   `{F6}` vs 0.50 clean), the truthful one wins within the gap. The
   mirror doctrine is relational, and "substantial" is anchored to the
   constant, not left as prose: **no card more than `COVERAGE_GAP` of
   coverage richer than its rival is ever displaced.** A 0.55 `{F6}` card
   *can* lose to a 0.36 clean one (deficit 0.19, in-gap) — that is the
   bounded trade working as specified, not a protected card slipping
   through.
7. Confidence rule, `>=` still favouring Claude.

**Worked instances, all pinned as regression tests:** round-1 (local
`{S:[S1]}` vs Claude `{S:[S4],F:[F3,F5,F6]}`) → step 3, Claude, as today.
Every mirror pair keeps local exactly as today's code does — round-2 0.80
vs 0.30 (deficit 0.50); round-3 0.59 vs 0.30 (0.29) and 0.95 vs 0.61
(0.34); hole A 0.55 vs 0.05 (0.50); hole B 1.00 vs 0.61 (0.39) — each
`{F6}` vs clean. Hole D: 0.61 `{F1..F7}` vs 0.59 clean → the truthful
card wins (deficit 0.02). The cliff, pinned from both sides and evaluated
under the stated predicate with `EPSILON`: 0.79 `{F6}` vs 0.59 clean
(deficit exactly 0.2) → truthful card wins; 0.80 `{F6}` vs 0.59 clean
(0.21) → local, badged. Both-weak: 0.65 `{F6}` vs 0.50 clean → truthful
card wins, pinned as deliberate. The yogurt fix (0.79 `{F6}` vs an
F-clean Claude card at 0.70; deficit 0.09) → Claude, at numerically lower
confidence. The rulebook pair ({F7,F7,F7} vs {F3,F6}, equal confidence) →
local, agreeing with §5.

**Commensurability — verified, not deferred.** Both confidence numbers
divide by `raw.ingredientLines.length`. `buildMatchers`
(`src/core/infer.ts:211-213`) is `lines.map(parseIngredient)` mapped 1:1
with no filtering, so `matchers.length === raw.ingredientLines.length` and
`infer.ts:392-393` divides by that; `plan.ts:75` maps the same array and
`plan.ts:138` divides by its length. Numerators agree in kind —
`infer.ts:392` subtracts unclaimed matchers, `plan.ts:137` counts
`claimedIngredients.size`, and both exclude ingredients appended to the
root (`infer.ts:377`, `plan.ts:115`). The two scales are commensurable, so
a constant expressed as their difference is meaningful.

**Contract, in the module doc comment:** graded records must come from an
**options-free** `gradeByTier` call — the `skip` filter runs after the
short-circuit check (`:610` vs `:615`), so a skipped S1/S2 reads as clean
and defeats step 3. `tryGrade` passes no options. (Reordering `gradeCard`'s
filter instead: rejected, changes grader behaviour for other callers.)

These functions throw nothing; they are total over their inputs.

### `src/content/index.ts` changes

- Private `tryGrade(recipe: Recipe, raw: RawRecipe): Graded | null` beside
  `askClaude`: wraps `gradeByTier(recipe, raw)` — no options — in try/catch
  → null. Core stays fail-fast; the boundary is where leniency lives.
- Rework `run()` (`:205-215`). **The `graded` lifecycle, on every path:**

  | Path | `graded` holds |
  | --- | --- |
  | After `inferTree` + `tryGrade` | `localGraded` — the initialiser; possibly null |
  | `shouldEscalate` false | unchanged: `localGraded` |
  | `askClaude` returns null | unchanged: `localGraded` — this initialiser is what the honest-badge promise on the no-key/offline path rests on |
  | Claude plan received | `({ recipe, graded } = pickBetter(recipe, localGraded, viaClaude, tryGrade(viaClaude, raw)))` — recipe and graded reassigned together, never separately |
  | `flatTree` swap at `:215` | reset to `null` — flat cards are not graded (Decision 5) |

  The outer `viaClaude.root` guard is dropped (step 1 is the authority);
  `treeFromPlan` still runs only when a plan exists. Local
  `CLAUDE_THRESHOLD` deleted; imported from `escalate.js`.
- `showTable` (`:99`) gains `findings: Finding[]` — computed as
  `graded ? [...graded.S, ...graded.F] : []` — passed to `confidenceNote`.
  Details flow through the existing `escape(note.text)` at `:118`.

### `src/core/render.ts` changes

`confidenceNote(recipe: Recipe, findings: Finding[] = [])`. Precedence
explicit: **the findings check runs first, before the `flat` early-return
at `:54`** — non-empty findings force `'low'` and append a clause naming
the count and the first finding's `detail`, whatever the strategy. The
quoted detail is **truncated to 120 characters with an ellipsis**: details
embed page-derived text verbatim — raw ingredient lines (`grade.ts:213,
:344, :578`) and operation labels via `describe(op)` (`:401, :440, :461`)
— and nothing in the grader caps either (`MAX_LABEL` at `:62` is the
threshold L1 *reports against*, `:493-497`; it shortens nothing). With
empty findings, behaviour is byte-identical to today, keeping the single
other call site (`src/content/index.ts:100`) valid until updated in the
same change. `confidenceNote` is not covered by any snapshot —
`tests/e2e/golden.spec.ts:71-73` snapshots `.rd-table` only. `Finding` is
imported with `import type` (`src/export/print.ts:11` imports `render.ts`;
a value import would drag the grader into the print/export bundles).

### Documentation that must change with the behaviour

- `README.md:74` — "(only below 60% confidence…)" becomes false; reword to
  "when local parsing is uncertain — low confidence, or the self-check
  found a structural or faithfulness problem". `README.md:92-93` keeps its
  wording but its meaning is redefined by the reword; reviewed together.
- `docs/recipe-card-rules.md` §6 (`:180-183`) — grading now also runs in
  the extension.
- `CHANGELOG.md` — new entry (convention: `CHANGELOG.md:20`), saying
  plainly that some previously "moderate" badges will now read "low".

## Decisions made

1. **Trigger gates on S ∪ F; the confidence trigger is kept, OR-ed.**
   *Assumption — chosen without user review.* Alternative: grading alone —
   rejected: the S/F tiers cannot see sparseness (orphan rate is L7), and
   the grading arm is blind to the zero-ingredient rootless case, which
   only the confidence arm catches (`src/core/infer.ts:403`). **Cost:**
   extra Claude calls for ≥0.6 cards with S/F findings, plus Decision 9's
   sticky repeat and the systemic over-fire risk.
2. **Selection is the seven-step rule above.** *Assumption — chosen without
   user review.* The load-bearing choices: root check as the single
   authority (the outer guard is dropped, not duplicated); unusable-first
   (round-1 defect: suppressed tiers are unreadable); S by presence,
   unconditional (step 5's three named reasons); F by **distinct failed
   rules** (aligns the runtime order with §5's per-rule scoring — raw
   counts can prefer the card the rulebook calls worse); the F step guarded
   by **`COVERAGE_GAP`, a function of the coverage difference** (round-3
   defect: a threshold band guards one point on a continuous axis, is a
   no-op in the only region today's trigger reaches, and borrowed
   `CLAUDE_THRESHOLD`'s authority across a semantic boundary). Alternatives
   rejected across rounds: lexicographic counts (round 1), unconditional
   F-count (round 2, mirror bug), trust-band floor (round 3, fixes
   instance not class), raw finding count (round 3, contradicts §5), and
   **the never-trade rule** (round-3 audit's suggested direction: Claude
   wins only when no worse on *both* axes). Never-trade is
   `COVERAGE_GAP = 0`, the degenerate member of the same family, and is
   rejected for two reasons that stand alone: it fails the argued lower
   bound — a genuine repair typically reattaches differently and costs
   some coverage, so never-trade refuses the very upgrade the feature
   exists to perform; and it deletes a user-stated acceptance signal
   (task.md: the fewer-findings candidate "wins, even if its confidence
   score is lower"; PRD AC3) in every conflict case where the truthful
   card is even slightly sparser. Its cannot-regress property is real but
   narrower than it sounds: at equal confidence it does improve on
   today's `>=` (the truthful card wins the tie), yet it forgoes every
   upgrade in which truth costs any coverage at all — where the
   bounded-trade rule's failure mode on the wrong side of its cliff is a
   labelled card, not an unlabelled lie. On the constant itself: revision
   3 rejected a numeric gap as unjustifiable while adopting a band that
   *was* a gap floor in disguise — an unargued, position-dependent one.
   This design resolves the inconsistency in the constant's favour:
   **chosen, not borrowed**, with the bounds and the insensitive range
   [0.15, 0.25] argued at the definition. **Cost:** seven steps, each
   separately unit-testable; and a real trade at step 6 — a truthful card
   materially sparser than a false rival loses, and the false card ships
   with an honest low badge naming its finding.
3. **At most one Claude call per run, unchanged.** Alternative: retry when
   the Claude card also fails — rejected: same prompt, same model, per-recipe
   cost posture documented (`src/llm/claude.ts:51-55, :71-76`) for calls
   spending the user's own key (`README.md:74`, `src/background.ts:43-46`).
   **Cost:** a page Claude cannot fix still ships flawed — badged.
4. **Badge reflects residual S/F findings (level → low, note names the
   first finding, detail truncated), taking precedence over the flat
   early-return.** *Assumption — chosen without user review.* Alternatives:
   coverage-only badge — rejected by PRD story 4; new badge state —
   rejected, redesign out of scope. **Cost:** previously "moderate" cards
   with persistent findings now say "low"; named in the CHANGELOG.
5. **The `flatTree` fallback is not graded; `graded` resets to null on that
   path.** *Assumption — chosen without user review.* Alternative: grade it
   for the badge — rejected: `confidenceNote` already forces `low` for flat
   (`src/core/render.ts:54`) and no decision remains. **Cost:** a flat card
   may carry F findings the user is never told about by name.
6. **The Claude candidate is graded fresh.** Alternative: trust `plan.ts`'s
   guards — rejected: "defended, not asserted"
   (`docs/recipe-card-rules.md:237-238`); F rules are not defended at all.
   **Cost:** one extra grade per escalating run.
7. **Policy lives in `src/core/escalate.ts`.** Alternatives: inline —
   untestable; extend `grade.ts` — the grader shares no judgement with
   inference (`src/core/grade.ts:15-18`). **Cost:** one more module, three
   exported constants, and a written options-free precondition a careless
   future caller could still violate.
8. **No `grid` reuse; the whole grade (unread L tier included) runs on
   every card.** Honest baseline: on the common path there is no network
   call to hide behind. Bounded by input size, synchronous, once per
   explicit click. The only real lever if profiling ever demands one is a
   shared `grid` (`skip` is a post-filter, `grade.ts:602-616`, saves no
   work, and is forbidden here anyway). **Cost:** `layout()` up to three
   times per run, accepted knowingly.
9. **No cross-run memory: sticky cost accepted.** *Assumption — chosen
   without user review.* A page with a finding Claude cannot fix pays one
   call per open, forever. Alternative: memoise per URL in `chrome.storage`
   — rejected: state and invalidation machinery for a per-click,
   user-initiated, own-key cost. Reopen trigger below. The systemic version
   is a Risk, not an accepted cost.
10. **PRD acceptance criterion 3 is deliberately narrowed.** *Assumption —
    chosen without user review.* "Even if its confidence score is
    numerically lower" is honoured only within `COVERAGE_GAP` (step 6).
    Unqualified, the criterion reproduces the mirror bug — discarding a
    substantial, mostly-correct card for a truthful near-flat one — and
    from round 3, would regress pairs today's code already gets right. The
    narrowing is the smaller betrayal of the PRD's own problem statement.

## Edge cases

- **Empty/missing input.** Local root null with ingredients → S1 fires →
  grading arm escalates; step 1 hands the win to any rooted Claude card.
  Zero ingredient lines → the grade is vacuously clean; escalation rides
  the confidence arm (`infer.ts:403`), and step 1 blocks the clean-looking
  rootless card from ever winning; the error path at `:216-218` unchanged;
  crashes on a null root absorbed by `tryGrade`.
- **Boundary values.** Confidence exactly 0.6, zero findings → no call
  (strict `<`). 0.79 with F6 → escalates. Deficit exactly `COVERAGE_GAP`
  (0.79 vs 0.59) → step 6 decisive **because the predicate carries
  `EPSILON`** — the bare subtraction lands on the wrong side in IEEE 754
  (`0.79 - 0.2 === 0.5900000000000001`), which is exactly why the
  tolerance is part of the spec; one point past it (0.80 vs 0.59) → guard
  skips to confidence — the cliff, probed from both sides. A pair
  straddling the old threshold by 0.02 (0.61 vs 0.59) → deficit rules,
  threshold sides ignored (hole D). Fully graded, same S-presence, equal
  distinct F rules, equal confidence → Claude (`>=` preserved). Both
  unusable → confidence rule.
- **Failure paths.** `gradeByTier` throws → `tryGrade` null → both
  decisions degrade to today's behaviour, badge unchanged from today.
  `askClaude` null → local ships; `graded` still holds `localGraded` (see
  lifecycle table), so the honest low badge appears if the card has S/F
  findings.
- **Ordering/state.** Grading is synchronous, before the single `await`;
  second-click-closes (`:193`) untouched.
- **Resource/cost.** Hard bound: one call per run, per click. Wild-page
  trigger frequency is **not known** — the fixtures grade clean on S/F
  (`tests/sites.test.ts:79-84`) but are the grader's own tuning set
  (`docs/recipe-card-rules.md:206-209`), so that is near-tautological.
  Mitigation is the grader's precision-over-recall bias (`:197-204`).
  Sticky repeat: Decision 9. Systemic over-fire: Risks.
- **Adversarial/malformed input.** Finding details embed page-controlled
  text; they reach the DOM only through `escape()`
  (`src/content/index.ts:118`) and the badge note truncates them. A
  malformed Claude plan is sanitised by `plan.ts` and now also graded —
  and, rootless, it loses at step 1 without any outer guard.

## Testing

Per PRD acceptance criterion:

- **S/F above threshold escalates** — `tests/core/escalate.test.ts` (new):
  `shouldEscalate` truth table including F6-at-0.79, and the
  zero-ingredient case asserting **which arm** fires (grading arm false,
  confidence arm true) so the stated dependency is pinned, not just prose.
- **L-only adds no call** — `shouldEscalate` unit test.
- **Fewer/no S-F candidate wins** — `pickBetter` unit tests, one per step:
  root combinations including both-rootless (step 1, the only authority);
  round-1 scenario (step 3); both-unusable; no-S beats any-S at any
  confidence (the pinned deliberate consequence); the yogurt fix (fewer
  distinct F, in-gap, lower confidence → wins); **every mirror pair by
  name** (0.80/0.30, 0.59/0.30, 0.95/0.61, hole A 0.55/0.05, hole B
  1.00/0.61 — guard skips, local kept, matching today); hole D
  (0.61 `{F1..F7}` vs 0.59 clean → truthful wins across the old
  threshold); the both-weak pair (0.65/0.50 → truthful wins, pinned as
  deliberate); the rulebook pair ({F7,F7,F7} vs {F3,F6} → local, agreeing
  with §5); the magnitude-inversion pair ({F3×30, F6×30} vs {F3,F5,F6} →
  the two-rule card wins, pinned as deliberate — see Risks); the cliff
  from both sides under the `EPSILON`-carrying predicate (0.79/0.59
  decisive, 0.80/0.59 not); full tie → Claude; null grade → today's rule.
- **Flat fallback preserved** — by construction: `:215-218` untouched;
  lifecycle table resets `graded` to null there.
- **Badge choice explicit** — `tests/core/render.test.ts` (new): unchanged
  for all three strategies with empty findings; F finding → `low` + detail
  in text; truncation at the cap; findings precede the flat early-return.

**End-to-end, no mocking:** `tests/e2e/golden.spec.ts:54-63` evaluates the
real `dist/content.js` with `chrome` undefined, so `askClaude` returns null
(`src/content/index.ts:187-189`). Two additions: (a) assert the badge
element renders on existing fixtures (no-finding path); (b) **one new
golden fixture tripping an F rule** — exercises `tryGrade`, a true
`shouldEscalate`, the null-Claude path, the `localGraded` initialiser, and
the low badge naming the finding, in a real DOM.

**Accepted untested:** only the Claude-success branch of `run()` — a live
`pickBetter` call and `showTable` with a Claude winner — because it needs a
`chrome.runtime` mock that does not exist. Mitigation is structural: that
branch is plumbing between fully-tested pure functions; `recipe` and
`graded` are reassigned together from `pickBetter`'s return, making the
badge-names-the-loser bug impossible by construction.

## Out of scope

Per the PRD: the S/F/L rules, the Claude prompt and `Plan` schema, settings
toggles, badge redesign, F8/F9. Also out: escalation telemetry, cross-run
verdict caching (Decision 9), and a `chrome.*` mock harness — each more
machinery than the thinnest honest version needs, none with a demand signal.

## Risks

- **Systemic over-fire is a cost risk.** One broadly over-firing S/F rule
  makes `shouldEscalate` effectively unconditional — every open of every
  affected page costs a call, a different magnitude from Decision 9. The
  fixture suite cannot warn us (tuning set); mitigation is the grader's
  precision-over-recall bias (`docs/recipe-card-rules.md:197-209`) and the
  reopen trigger below.
- `COVERAGE_GAP` is chosen, not derived. Its bounds are argued and the
  pinned scenarios are insensitive across [0.15, 0.25], but a pair of real
  cards could sit at the cliff (a truthful card 0.21 sparser loses; 0.20
  sparser wins). Both sides of that cliff produce an acceptable, labelled
  outcome — which is the argued reason the cliff is tolerable at all — and
  the constant is named, exported, and documented as a judgement so it can
  be re-argued with field evidence.
- **Distinct-rule counting inverts magnitude across rules — deliberate,
  like step 5.** {F3×30, F6×30} (two rules, sixty false statements) beats
  {F3, F5, F6} (three rules, three statements) at in-gap confidence. This
  is rulebook-consistent — §5 scores the pair 7/9 vs 6/9 the same way —
  and is the exact mirror of the raw-count complaint that produced the
  change; the consequence is pinned in tests so it stays a choice. If
  field evidence shows finding-magnitude matters, the §5 scoring model is
  the thing to re-argue, not this comparator alone.
- Step 5's unconditional S-presence lets a sparse S-clean card beat a rich
  one-S card at any coverage distance — deliberate, argued at step 5, and
  pinned in tests so it stays a choice.
- A page with a persistent finding pays a call on every open (Decision 9).
- The Claude-success branch of `run()` ships without direct tests; a
  plumbing mistake there surfaces as behaviour, not a failing suite.
- Previously "moderate" cards with persistent findings now say "low" —
  intended, visible, named in the CHANGELOG.

## Open questions (deferred)

None block this design. Deferred with owners and reopen triggers:

- **Escalation visibility** ("why did this call Claude?"). Owner: repo
  maintainer. Reopen if users ask why the badge dropped or a card changed
  between opens.
- **Cross-run verdict caching** (Decision 9). Owner: repo maintainer.
  Reopen if a user reports meaningful spend — one page (sticky) or many
  (systemic over-fire).
- **`COVERAGE_GAP` calibration.** Owner: repo maintainer. Reopen if a real
  page produces a pair inside the [0.15, 0.25] sensitivity window with a
  disputed winner.
