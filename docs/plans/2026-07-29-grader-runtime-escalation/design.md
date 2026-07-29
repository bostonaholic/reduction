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
- **The F tier is blind to sparseness, at every coverage level.** F3 stays
  clean with an op per source step (`:369-379`); root children are exempt
  from F7 (`:452`); unclaimed ingredients are appended, keeping F1/F2 clean
  (`docs/recipe-card-rules.md:233-235`; `src/core/plan.ts:120-127` does not
  count appended orphans as matched). A card with most ingredients hanging
  off the root can grade F-clean — and a near-flat card is low-coverage *by
  definition*, so F-clean near-flat cards live precisely in the low-coverage
  region. Any guard against them must therefore hold there, not only where
  coverage is high.

Also load-bearing: several F rules emit one finding per offending pair —
F7 per (op, child) (`:451-465`), F3 per uncited step (`:369-379`), F5 per
(op, child) (`:393-406`), F6 per leaf (`:414-445`) — so raw finding counts
vary with tree shape, while §5 scores faithfulness pass/fail **per rule**
(`faithfulness = mean(F1..F9)`, `docs/recipe-card-rules.md:151`).

The badge (`confidenceNote`, `src/core/render.ts:44-65`) reads only
`recipe.inference` and `recipe.confidence`; a card that fails F6 at 79%
coverage displays "moderate confidence".

The two confidence constructors are commensurable — verified in review:
`buildMatchers` maps 1:1 over ingredient lines with no filtering, and
`treeFromPlan` maps the same array (`src/core/plan.ts:75`); both numerators
exclude root-appended orphans. A rule on their ratio compares like with
like.

## Desired end state

1. A local card with any S or F finding escalates to Claude even at ≥ 0.6
   confidence. L-only findings never trigger a call.
2. When two candidates exist: a rooted card always beats a rootless one
   (checked in one authoritative place); a fully-graded card beats one whose
   grade was cut short; among fully-graded cards, no-S beats any-S; fewer
   *distinct failed F rules* wins — but only for a card that **retains at
   least three-quarters of its rival's coverage**, a proportion, so the
   guard tightens exactly where near-flat cards live; confidence settles
   everything else.
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
- `RETAIN_RATIO = 0.75` — the sparseness guard for step 6: the card that
  step 6 favours must retain at least this fraction of its rival's
  coverage. **The constant is chosen, not borrowed, and its doc comment
  says so.** Selection borrows nothing from `CLAUDE_THRESHOLD` — that
  constant's documented meaning (`src/content/index.ts:22`) governs display
  trust and call-spending. A *ratio* rather than an absolute difference,
  because the maximum achievable difference is bounded by the higher card's
  own coverage: an absolute gap degenerates in the low-coverage region —
  every pair becomes automatically in-gap, and that region is exactly where
  F-clean near-flat cards live (see Current state). The ratio tightens in
  proportion: at a 1.0 rival the allowed deficit is 0.25 of the recipe; at
  a 0.2 rival it is 0.05 — one line of a 20-line recipe. **Bounds, argued
  at both ends of the axis.** High end: the ratio must be **above 0.61**
  or the 1.00-vs-0.61 mirror pair (hole B) stops resolving as today's code
  does. Low end (the region the absolute gap left unguarded): 0.20-vs-0.01
  and 0.25-vs-0.05 (ratios 0.05, 0.20) must stay blocked — any ratio above
  ~0.67 does that with a wide margin, and the pinned wins demand the ratio
  sit **at or below 0.769** (the 0.65-vs-0.50 both-weak pair). Every value
  in [0.68, 0.76] picks the same winner in every pinned real-card
  scenario; 0.75 — three-quarters — is the round number in that range.
- `EPSILON = 1e-9` — numeric slack for the step-6 boundary, nothing more.
  Confidence values are ratios of small integers and decimal boundaries
  are not exactly representable (`0.79 - 0.59 > 0.2` in IEEE 754 — the
  round-4 finding). The smallest *meaningful* coverage difference is one
  ingredient line — at least `1/50 ≈ 0.02` for any plausible recipe, seven
  orders of magnitude above the slack — so the tolerance can never change
  a real winner; it exists so a boundary test does not hinge on rounding
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
6. **Fewer distinct failed F rules wins — guarded by retained coverage.**
   Compared as `new Set(F.map(f => f.rule)).size`, which matches §5's
   per-rule scoring (`docs/recipe-card-rules.md:151`) and is insensitive
   to how many findings one rule emits per offending pair — raw counts
   vary with tree shape (Current state) and can disagree with the
   rulebook's own order ({F7,F7,F7} counts worse than {F3,F6} but scores
   better; distinct-rule counting agrees with the score). Equal distinct
   counts fall through. **The guard, stated precisely enough to code
   from:** the candidate this step favours is the one with fewer distinct
   failed F rules; the step is decisive iff
   `favoured.confidence >= other.confidence * RETAIN_RATIO - EPSILON`;
   otherwise skip to step 7. The guard is a **proportion of the rival's
   coverage**, so its strength is uniform in relative terms at every point
   on the axis — an absolute difference degenerates at low coverage, where
   the maximum possible difference shrinks below any fixed constant and
   the guard could never fire (the round-4 hole: 0.20 `{F6}` vs 0.01
   clean, difference 0.19, would have upgraded to a card with 99% of
   ingredients on the root; today's code keeps local, and so does this
   rule — ratio 0.05). It closes every named hole: **(A)** 0.55 `{F6}` vs
   0.05 clean (ratio 0.09) and **(B)** 1.00 `{F6}` vs 0.61 clean (0.61) →
   guard skips, local kept, as today. **(round-4)** 0.20-vs-0.01 (0.05)
   and 0.25-vs-0.05 (0.20) → local, as today. **(D)** 0.61 `{F1..F7}` vs
   0.59 clean (0.967) → decisive, the truthful card wins — indifferent to
   which side of any threshold the pair sits on. **(C)** the cliff at the
   guard boundary is real and deliberately placed: any rule honouring the
   task's acceptance signal — the fewer-findings card "wins, even if its
   confidence score is lower" (task.md) — has a flip point somewhere; only
   the never-trade rule has none, and Decision 2 rejects it. Both sides of
   this cliff are acceptable outcomes — a truthful upgrade retaining at
   least three-quarters of its rival's coverage, or a richer card shipped
   with a badge naming its falsehood. Accepted consequence, pinned: when
   *both* cards are weak (0.65 `{F6}` vs 0.50 clean, ratio 0.769), the
   truthful one wins — the mirror doctrine is relational, and no
   substantial card is displaced there.
7. Confidence rule, `>=` still favouring Claude.

**Worked instances, all pinned as regression tests:** round-1 (local
`{S:[S1]}` vs Claude `{S:[S4],F:[F3,F5,F6]}`) → step 3, Claude, as today.
Every mirror pair keeps local exactly as today's code does — round-2 0.80
vs 0.30 (ratio 0.375); round-3 0.59 vs 0.30 (0.508) and 0.95 vs 0.61
(0.642); hole A 0.55 vs 0.05 (0.09); hole B 1.00 vs 0.61 (0.61); **the
round-4 low-coverage pairs 0.20 vs 0.01 (0.05) and 0.25 vs 0.05 (0.20)**
— each `{F6}` vs clean. Low-coverage in both directions: 0.30 `{F6}` vs
0.25 clean (0.833) → truthful card wins; 0.30 `{F6}` vs 0.20 clean
(0.667) → local. Hole D: 0.61 `{F1..F7}` vs 0.59 clean → truthful card
wins. Both-weak: 0.65 `{F6}` vs 0.50 clean → truthful card wins, pinned
as deliberate. The yogurt fix (0.79 `{F6}` vs F-clean Claude at 0.70,
ratio 0.886) → Claude, at numerically lower confidence. The rulebook pair
({F7,F7,F7} vs {F3,F6}, equal confidence) → local, agreeing with §5. The
boundary, pinned with **dyadic-exact fixtures** so IEEE 754 cannot decide
the test (the round-4 arithmetic finding): favoured 0.75 vs rival 1.0 —
both exactly representable, product exact — sits exactly on the boundary
and is decisive (inclusive `>=`); favoured 0.5 vs rival 0.75 (boundary
0.5625, exact) is not. Real-world ratios never sit on the boundary
meaningfully; `EPSILON` absorbs their rounding.

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
   authority; unusable-first (round 1: suppressed tiers are unreadable);
   S by presence, unconditional (step 5's three named reasons); F by
   **distinct failed rules** (aligns with §5's per-rule scoring); the F
   step guarded by **retained coverage — a ratio, not a difference**.
   Alternatives rejected across rounds: lexicographic counts (round 1);
   unconditional F-count (round 2, mirror bug); trust-band floor (round 3:
   guards one point on a continuous axis, inert in the only region the old
   trigger reaches, borrowed `CLAUDE_THRESHOLD`'s authority); raw finding
   count (round 3, contradicts §5); **absolute difference floor** (round
   4: the maximum achievable difference is bounded by the higher card's
   coverage, so the guard degenerates exactly where near-flat F-clean
   cards live — closing it needed a clause of a different *shape*, not a
   retuned constant); **a fixed floor on the favoured card's own
   coverage** (round 4's other sanctioned option) — rejected: a second
   constant needing its own bounds argument, two clauses instead of one,
   and any floor at or near `CLAUDE_THRESHOLD` would have reopened hole D
   by blocking the 0.59 truthful card; and **the never-trade rule**
   (`RETAIN_RATIO = 1`) — rejected: it refuses the very upgrade the
   feature exists to perform (a genuine repair typically costs some
   coverage), deletes a user-stated acceptance signal (task.md: the
   fewer-findings candidate "wins, even if its confidence score is lower";
   PRD AC3) in every conflict case, and buys cannot-regress by never
   improving when the axes conflict — where bounded-trade's failure mode
   is a labelled card, not an unlabelled lie. **Disclosed boundary move:**
   relative to revision 4's absolute rule, a truthful card retaining
   ≥ 0.75 of a high-coverage rival can now win at deficits up to 0.25
   (e.g. 1.00 `{F6}` vs 0.76 clean upgrades) — that is the yogurt class,
   not the mirror class: a card retaining three-quarters of its rival is
   not near-flat. **Cost:** seven steps, each separately unit-testable;
   and a real trade at step 6 — a truthful card below the retention
   boundary loses, and the false card ships with an honest low badge
   naming its finding.
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
    numerically lower" is honoured only for a card retaining at least
    `RETAIN_RATIO` of its rival's coverage (step 6). Unqualified, the
    criterion reproduces the mirror bug — discarding a substantial,
    mostly-correct card for a truthful near-flat one — and would regress
    pairs today's code already gets right, at every coverage level. The
    narrowing is the smaller betrayal of the PRD's own problem statement.

## Edge cases

- **Empty/missing input.** Local root null with ingredients → S1 fires →
  grading arm escalates; step 1 hands the win to any rooted Claude card.
  Zero ingredient lines → the grade is vacuously clean; escalation rides
  the confidence arm (`infer.ts:403`), and step 1 blocks the clean-looking
  rootless card from ever winning; the error path at `:216-218` unchanged;
  crashes on a null root absorbed by `tryGrade`.
- **Boundary values.** Confidence exactly 0.6, zero findings → no call
  (strict `<`). 0.79 with F6 → escalates. The step-6 boundary is pinned
  with dyadic-exact fixtures (0.75-vs-1.0 decisive inclusive; 0.5-vs-0.75
  not) — decimal pairs like 0.79/0.59 are **not** used as boundary pins,
  because IEEE 754 makes their difference land on an unspecified side
  (the round-4 finding); `EPSILON` absorbs rounding for real-world
  ratios. A pair straddling the old threshold by 0.02 (0.61 vs 0.59) →
  the ratio rules, threshold sides ignored (hole D). Fully graded, same
  S-presence, equal distinct F rules, equal confidence → Claude (`>=`
  preserved). Both unusable → confidence rule.
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
  confidence (pinned deliberate consequence); the yogurt fix (fewer
  distinct F, in-ratio, lower confidence → wins); **every mirror pair by
  name** (0.80/0.30, 0.59/0.30, 0.95/0.61, hole A 0.55/0.05, hole B
  1.00/0.61, **and the round-4 low-coverage pairs 0.20/0.01 and
  0.25/0.05** — guard skips, local kept, matching today); **low-coverage
  in both directions** (0.30/0.25 → truthful wins; 0.30/0.20 → local);
  hole D (0.61 `{F1..F7}` vs 0.59 clean → truthful wins across the old
  threshold); the both-weak pair (0.65/0.50 → truthful wins, pinned as
  deliberate); the rulebook pair ({F7,F7,F7} vs {F3,F6} → local, agreeing
  with §5); the magnitude-inversion pair ({F3×30, F6×30} vs {F3,F5,F6} →
  the two-rule card wins, pinned as deliberate — see Risks); **the
  boundary with dyadic-exact fixtures** (0.75-vs-1.0 decisive inclusive;
  0.5-vs-0.75 not); full tie → Claude; null grade → today's rule.
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
- **`RETAIN_RATIO` is chosen, not derived.** Its bounds are argued at both
  ends of the axis and the pinned scenarios are insensitive across
  [0.68, 0.76], but a real pair could sit at the cliff (a truthful card
  retaining 0.74 of its rival loses; 0.76 wins). Both sides of that cliff
  produce an acceptable, labelled outcome — the argued reason the cliff is
  tolerable — and the constant is named, exported, and documented as a
  judgement so it can be re-argued with field evidence.
- **Distinct-rule counting inverts magnitude — deliberate, like step 5.**
  {F3×30, F6×30} (two rules, sixty false statements) beats {F3, F5, F6}
  (three rules, three statements) at in-ratio confidence. This is
  rulebook-consistent — §5 scores 7/9 vs 6/9 the same way — and is the
  exact mirror of the raw-count complaint that produced the change; the
  consequence is pinned in tests so it stays a choice. If field evidence
  shows finding-magnitude matters, the §5 scoring model is the thing to
  re-argue, not this comparator alone.
- Step 5's unconditional S-presence lets a sparse S-clean card beat a rich
  one-S card at any coverage distance — deliberate, argued at step 5,
  pinned in tests.
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
- **`RETAIN_RATIO` calibration.** Owner: repo maintainer. Reopen if a real
  page produces a pair inside the [0.68, 0.76] sensitivity window with a
  disputed winner.
