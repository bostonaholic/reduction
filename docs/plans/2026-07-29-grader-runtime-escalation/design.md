---
topic: grader-runtime-escalation
date: 2026-07-29
phase: design
revision: 2
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
(`src/core/grade.ts:408-444`, "no heat above an ingredient the recipe never
heats") is the rule that would have flagged it.

One grader behaviour is load-bearing for this design: **when S1 or S2 fires,
`gradeCard` stops after Tier S** (`src/core/grade.ts:610-613`; also
`docs/recipe-card-rules.md:185-189`). For such a card, `F: []` and `L: []`
mean *never checked*, not *clean*. Any comparison across two graded cards
must not confuse the two.

The badge (`confidenceNote`, `src/core/render.ts:45-65`) reads only
`recipe.inference` and `recipe.confidence`; a card that fails F6 at 79%
coverage displays "moderate confidence".

## Desired end state

1. A local card with any S or F finding escalates to Claude even at ≥ 0.6
   confidence. L-only findings never trigger a call.
2. When two candidates exist, a *gradeable* card always beats an ungradeable
   one; among gradeable cards, no-S beats any-S, then fewer F findings win;
   only then does the existing confidence rule decide. A truthful
   lower-coverage card beats a higher-coverage false one, and a rootless
   card can never beat a drawable one.
3. Still at most one Claude call per `run()`, and every call follows an
   explicit toolbar click.
4. A shipped card with residual S/F findings shows a "low confidence" badge
   whose note names the first finding — and the note provably belongs to the
   card being shown, by construction.
5. A grading crash degrades to today's confidence-only behaviour — the page
   never breaks.

## Patterns to follow

- **Null at the boundary.** `askClaude` (`src/content/index.ts:171-190`) is
  documented "Never throws — the caller has a plan B"; the background worker
  replies `{ ok: false }` rather than throwing (`src/background.ts:43-46`).
  Grading follows the same shape.
- **Core stays pure.** Core is "plain data — no DOM, no browser"
  (`src/core/types.ts:7`); "None of them touch `chrome.*`, so the entire
  product logic is unit-testable in Node" (`README.md:61-62`); `grade.ts`
  imports only core modules (`src/core/grade.ts:21-24`). New decision logic
  goes in core — `src/content/index.ts` has no unit tests.
- **Tiered gating is the intended API.** `gradeByTier` exists "for callers
  that gate the tiers differently" (`src/core/grade.ts:618`); any S finding
  means INVALID — a state with no score, not a low one
  (`docs/recipe-card-rules.md:150`).
- **Test layout.** Vitest, `tests/core/<module>.test.ts` mirroring
  `src/core/<module>.ts`; violating case paired with a near-miss that must
  not trip (`tests/core/grade.test.ts:1-12`).

## Shape of the change

### `src/core/grade.ts` — one new export, no rule changes

`export const UNUSABLE_RULES: readonly RuleId[] = ['S1', 'S2']` — names the
existing short-circuit set at `src/core/grade.ts:610` instead of leaving it
inline, and is imported by the new policy module. Alternative: duplicate
`['S1', 'S2']` in `escalate.ts` — rejected: if the short-circuit set ever
changes, the two copies drift silently and the selection rule silently reads
suppressed tiers as clean again. This names existing behaviour; it changes no
rule (PRD keeps the rule set out of scope).

### New module: `src/core/escalate.ts`

The escalation *policy*, separated from the rulebook (`grade.ts`) and the
shell (`content/index.ts`). With `Graded = Record<Tier, Finding[]>`:

- `CLAUDE_THRESHOLD = 0.6` — moves here from `src/content/index.ts:23`,
  comment included; one definition, now importable by tests.
- `shouldEscalate(confidence: number, graded: Graded | null): boolean` —
  true when `confidence < CLAUDE_THRESHOLD`, or when `graded` is non-null
  and `graded.S.length + graded.F.length > 0`. A null `graded` (grading
  failed) reproduces today's confidence-only trigger exactly. Suppressed
  tiers cannot mislead this function: an S1/S2 card has `S.length > 0`.
- `pickBetter(local: Recipe, localGraded: Graded | null, viaClaude: Recipe, claudeGraded: Graded | null): { recipe: Recipe; graded: Graded | null }`
  — returns the winner *and the winner's own graded record*, so the badge
  can never name the losing card's findings. Alternative: return a bare
  `Recipe` and let the caller recover the record by reference identity —
  rejected: if that invariant ever breaks (a future clone or spread), the
  badge names the wrong card's findings, a wrong-and-quiet failure in a
  feature whose whole point is honesty. Selection rule, in order:
  1. Either grade null → today's rule (`viaClaude.confidence >= local.confidence`).
  2. Exactly one candidate **unusable** (any `UNUSABLE_RULES` finding in
     `graded.S`) → the other wins. An unusable card's F and L tiers were
     never computed (`src/core/grade.ts:610-613`), so no comparison
     involving them is meaningful — and an unusable card is headed for
     `flatTree` or the error panel anyway.
  3. Both unusable → today's confidence rule. (Even their S tiers are
     partial — `checkStructure` returns early at `:177`/`:200` — so counts
     cannot be compared either.)
  4. Neither unusable (both grades complete): no-S beats any-S
     (**presence**, not count — INVALID is a state, "no score"; one INVALID
     card is not twice as invalid as another); then fewer **F findings**
     win (**count** — F is scored as a mean over rules in
     `docs/recipe-card-rules.md:151`, and each finding is a distinct false
     statement a cook could act on); L never participates; full tie →
     today's confidence rule, `>=` still favouring Claude.

The blocking scenario from review round 1 — local `{S:[S1], F:[], L:[]}` vs
Claude `{S:[S4], F:[F3,F5,F6]}` — now resolves at step 2: Claude wins, as it
does today. This is pinned as a regression test.

These functions throw nothing themselves; they are total over their inputs.

### `src/content/index.ts` changes

- Add a private `tryGrade(recipe: Recipe, raw: RawRecipe): Graded | null`
  beside `askClaude`: wraps `gradeByTier(recipe, raw)` in try/catch → null,
  same "plan B" contract. `gradeCard` runs `layout()` internally
  (`src/core/grade.ts:221`) and the doc warns deeper checks assume a tree;
  the catch keeps that off the page. Core stays fail-fast; the boundary is
  where leniency lives.
- Rework `run()` (`:205-213`): grade the local candidate once
  (`localGraded = tryGrade(recipe, raw)`); gate the Claude call on
  `shouldEscalate(recipe.confidence, localGraded)`; keep the existing
  `viaClaude.root` guard, then grade the Claude candidate and destructure
  the winner: `({ recipe, graded } = pickBetter(...))`. Delete the local
  `CLAUDE_THRESHOLD`; import from `escalate.js`.
- `showTable` (`:99`) gains a `findings: Finding[]` parameter — the winner's
  S + F findings from the returned `graded`, `[]` when grading failed or
  `flatTree` replaced the card — and passes it to `confidenceNote`. Finding
  details flow through the existing `escape(note.text)` at `:118`, so
  page-derived strings stay safe.

### `src/core/render.ts` changes

`confidenceNote(recipe: Recipe, findings: Finding[] = [])`. Precedence is
explicit: **the findings check runs first, before the `flat` early-return at
`src/core/render.ts:54`** — non-empty findings force level `'low'` and append
a clause naming the count and the first finding's `detail` (details already
name the ingredient, `src/core/grade.ts:35-36`), whatever the inference
strategy. In practice the content script never passes findings for a flat
card (Decision 5), so the flat message is unchanged; the precedence exists so
the function has a defined contract for any caller, not just today's one.
With empty findings, behaviour is byte-identical to today, which keeps the
single other call site (`src/content/index.ts:100`) valid until it is updated
in the same change; no render snapshots exist. `Finding` is imported with
`import type` — `src/export/print.ts:11` imports `render.ts`, and a value
import would pull the grader into the print/export bundles for a type that
erases at compile time.

### Documentation that must change with the behaviour

- `README.md:74` — "(only below 60% confidence…)" becomes false; reword to
  "when local parsing is uncertain — low confidence, or the self-check found
  a structural or faithfulness problem". `README.md:92-93` ("only when local
  parsing is uncertain") keeps its wording, but note honestly: its meaning is
  redefined by the line-74 reword — "uncertain" now includes a failed
  self-check, not only low confidence. Both lines are reviewed together.
- `docs/recipe-card-rules.md` §6 (`:180-183`) — grading now also runs in the
  extension, not only in tests.
- `CHANGELOG.md` — new entry (repo convention, see `CHANGELOG.md:20`),
  saying plainly that some previously "moderate" badges will now read "low".

## Decisions made

1. **Trigger gates on S ∪ F; the confidence trigger is kept, OR-ed.**
   *Assumption — chosen without user review* (task.md left tier participation
   open). Alternative: replace the confidence trigger with grading alone —
   rejected because sub-0.6 coverage means ≥40% of ingredients unattached,
   which the S/F tiers do not fully re-detect (orphan rate is L7), and the
   documented posture ("not trustworthy enough to show alone",
   `src/content/index.ts:22`) would silently weaken. **Cost:** extra Claude
   calls for ≥0.6 cards with S/F findings — the target class — including the
   sticky repeat named in Decision 9.
2. **Selection: unusable-first, then S-presence, then F-count, then
   confidence.** *Assumption — chosen without user review.* The unusable
   step exists because `gradeCard`'s short-circuit makes suppressed tiers
   unreadable (the round-1 blocking defect); S is compared by presence
   because the rules doc calls any-S INVALID with *no score* — ranking
   INVALID cards against each other by count would invent a score the
   rulebook refuses to give; F is compared by count because §5 scores F as a
   mean over rules and each finding is a distinct false statement.
   Alternatives: lexicographic (S count, F count) — rejected, it let an
   unusable card's empty F tier beat a usable card's real findings, and
   ordered INVALIDs by an invented score; the §5 weighted number — rejected,
   §5 itself says report rule IDs, never a bare number (`:159-160`).
   **Cost:** four steps instead of one comparison — each step is separately
   unit-testable, which is how the cost is paid down.
3. **At most one Claude call per run, unchanged.** Alternative: retry when
   the Claude card also fails — rejected: same prompt, same model, and the
   per-recipe cost posture is documented (`src/llm/claude.ts:51-55, :71-76`)
   for calls spending a key the user supplies themselves (`README.md:74`,
   `src/background.ts:43-46`); no evidence a second identical call
   converges. **Cost:** a page Claude cannot fix still ships flawed — with
   an honest low badge (Decision 4).
4. **Badge reflects residual S/F findings (level → low, note names the first
   finding), taking precedence over the flat early-return.** *Assumption —
   chosen without user review* (PRD required an explicit choice).
   Alternative: leave the badge coverage-only — rejected by PRD story 4
   ("not overstate confidence"). Alternative: a new badge state — rejected;
   badge redesign is out of scope per the PRD. **Cost:** previously
   "moderate" cards with persistent findings now say "low"; named in the
   CHANGELOG.
5. **The `flatTree` fallback is not graded.** *Assumption — chosen without
   user review.* Alternative: grade it and pass its findings to the badge —
   rejected: `confidenceNote` already forces `low` for flat cards
   (`src/core/render.ts:54`) and no escalation decision remains after the
   fallback, so grading spends work with no observable effect.
6. **The Claude candidate is graded fresh.** Alternative: trust `plan.ts`'s
   construction guards and skip the second grade — rejected: those guards
   are "defended, not asserted" (`docs/recipe-card-rules.md:237-238`), and
   the F rules are not defended at all. **Cost:** one extra grade per
   escalating run.
7. **Policy lives in `src/core/escalate.ts`, not inline.** Alternative:
   inline in `content/index.ts` — rejected: untestable (no unit tests touch
   the content script). Alternative: extend `grade.ts` — rejected: the
   grader's header promises it shares no judgement with inference
   (`src/core/grade.ts:15-18`); escalation policy is a different concern.
   **Cost:** one more module and the `UNUSABLE_RULES` export to keep the
   short-circuit set single-sourced.
8. **No `grid` reuse into `gradeCard`, and the whole grade (including the
   unread L tier) runs on every card.** The honest baseline: on the common
   path there is *no* network call to hide behind — grading's cost stands
   alone. It is bounded by input size: pure, synchronous string/array work
   over a recipe-sized input (tens of ingredients and steps on the captured
   real sites), the same order of work the render itself does, and it runs
   once per explicit toolbar click — never per pageview. No measurement
   exists and none is added. If profiling ever shows a problem, the only
   real lever is passing a shared `grid` (the `skip` option is a
   post-filter, `src/core/grade.ts:602-616` — it saves no work; skipping
   the L tier has no API without changing `grade.ts`, which is out of
   scope). Alternative: reuse the grid now — rejected: it threads state
   through `run()` for a saving nobody has measured a need for. **Cost:**
   `layout()` runs up to three times per run (twice inside grades, once at
   `src/content/index.ts:221`), accepted knowingly.
9. **No cross-run memory: the sticky-cost case is accepted.** *Assumption —
   chosen without user review.* A page whose card carries a finding Claude
   also cannot fix pays one Claude call on every open of that page, forever.
   Alternative: memoise verdicts per URL in `chrome.storage` — rejected:
   adds state, invalidation on recipe edits, and a second storage schema for
   a cost that is bounded per click, user-initiated, and spent on the user's
   own key. Reopen trigger in Open questions.

## Edge cases

- **Empty/missing input.** Local root null with ingredients present → S1
  fires → escalation triggers, and step 2 of `pickBetter` hands the win to
  any usable Claude card — matching today's behaviour (local confidence 0,
  `>=` favours Claude) rather than regressing it. Zero ingredient lines →
  S1 deliberately silent (`src/core/grade.ts:170-177`); the error path at
  `:216-218` is unchanged, and any crash in the later tiers walking a null
  root is absorbed by `tryGrade`.
- **Boundary values.** Confidence exactly 0.6 with zero findings → no call
  (strict `<` preserved). 0.79 with an F6 → escalates (the shipped bug).
  Both candidates unusable → confidence rule, exactly today's behaviour.
  Neither unusable, equal S-presence, equal F count, equal confidence →
  Claude wins (`>=` preserved).
- **Failure paths.** `gradeByTier` throws → `tryGrade` null → trigger and
  selection degrade to today's behaviour, badge unchanged from today.
  `askClaude` null (no key, `useClaudeFallback` off, network error) → local
  card ships, now with an honest low badge if it has S/F findings.
- **Ordering/state.** Grading is synchronous and runs before the single
  `await`; the second-click-closes contract (`:193`) is untouched.
- **Resource/cost.** Hard bound: one Claude call per run, each following an
  explicit click. How often the S/F trigger fires on pages in the wild is
  **not known**: the only in-repo evidence — all 15 fixtures grade clean on
  S and F (`tests/sites.test.ts:79-90`) — is near-tautological, because
  those fixtures are the grader's own tuning set
  (`docs/recipe-card-rules.md:206-209`). The design-level mitigation is the
  grader's stated bias ("a grader that cries wolf gets switched off; a
  missed case costs less", `:197-204`), not the fixture result. The sticky
  repeat-cost case is Decision 9.
- **Adversarial/malformed input.** Finding details embed page-controlled
  ingredient text; they reach the DOM only through `escape()`
  (`src/content/index.ts:118`). A malformed Claude plan is already sanitised
  by `plan.ts` and now also graded before it can win.

## Testing

What each PRD acceptance criterion gets, stated plainly:

- **S/F above threshold still escalates** — `tests/core/escalate.test.ts`
  (new): `shouldEscalate` truth table, including the F6-at-0.79 regression.
  The `run()` wiring itself: **accepted untested**.
- **L-only adds no call** — `shouldEscalate` unit test. Wiring: **accepted
  untested**.
- **Fewer/no S-F candidate wins** — `pickBetter` unit tests: usable beats
  unusable (the round-1 blocking scenario, pinned by name); both-unusable
  falls to confidence; no-S beats any-S regardless of F counts; fewer F wins
  at lower confidence; full tie → Claude; null grade → today's rule. Wiring:
  **accepted untested**.
- **Flat fallback preserved** — by construction: `:215-218` are untouched.
- **Badge choice explicit** — `tests/core/render.test.ts` (new):
  `confidenceNote` unchanged for all three strategies with empty findings;
  with an F finding, level `low`, text contains the detail; findings take
  precedence over the flat early-return. One assertion added to
  `tests/e2e/golden.spec.ts` pinning the badge element still renders on the
  fixtures (it currently snapshots `.rd-table` only, `:71`) — this covers
  the no-finding badge path end-to-end.

**Accepted untested, and why:** `tryGrade`'s catch, the reworked `run()`
flow, and the findings-present badge in a real DOM. `src/content/index.ts`
has no unit harness; building one (DOM + `chrome.*` mocks) is more code than
this feature. The mitigation is structural: `run()`'s new lines are plumbing
between fully-tested pure functions, and `pickBetter`'s widened return makes
the one wrong-and-quiet wiring bug (badge naming the loser's findings)
impossible by construction rather than by test.

## Out of scope

Per the PRD: the S/F/L rules themselves, the Claude prompt and `Plan` schema,
any settings toggle, badge visual redesign, F8/F9 reference-card rules. Also
out: telemetry/counting of escalations, cross-run caching of verdicts
(Decision 9), and a content-script unit harness — each is more machinery than
the thinnest honest version needs, and none has a demand signal yet.

## Risks

- `pickBetter` can keep a *lower*-coverage card; if a grading rule over-fires
  on some unseen site, users see sparser cards — and the fixture suite
  cannot warn us, because it is the tuning set (see Resource/cost). The real
  mitigation is the grader's precision-over-recall bias with fixture-pinned
  carve-outs (`docs/recipe-card-rules.md:197-209`).
- A page with a persistent finding pays a Claude call on every open
  (Decision 9). Bounded per click and per key-owner, but unbounded across
  time.
- The escalation wiring in `run()` ships without direct tests (see Testing);
  a plumbing mistake there would surface as behaviour, not as a failing
  suite.
- The badge change makes previously "moderate" cards say "low" when findings
  persist after escalation — intended, but visible; the CHANGELOG entry says
  so plainly.

## Open questions (deferred)

None block this design. Two items are deferred with owners and reopen
triggers, not left ambient:

- **Escalation visibility** (a "why did this call Claude?" affordance).
  Owner: repo maintainer. Reopen if users ask why the badge dropped or why a
  card changed between opens.
- **Cross-run verdict caching** (Decision 9). Owner: repo maintainer. Reopen
  if a user reports meaningful spend from repeatedly opening a page the
  grader keeps flagging.
