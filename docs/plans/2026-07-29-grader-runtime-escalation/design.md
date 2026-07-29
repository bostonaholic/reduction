---
topic: grader-runtime-escalation
date: 2026-07-29
phase: design
revision: 3
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

Three grader behaviours are load-bearing for this design:

- **When S1 or S2 fires, `gradeCard` stops after Tier S**
  (`src/core/grade.ts:610-613`). For such a card, `F: []`/`L: []` mean
  *never checked*, not *clean*.
- **The `skip` filter is applied after that short-circuit check** (`:610`
  computes `unusable`, `:615` filters). `skip: ['S1']` on a rootless card
  yields `{S:[], F:[], L:[]}` — indistinguishable from a clean grade.
- **The F tier is blind to sparseness.** F3 stays clean when there is an op
  per source step (`src/core/grade.ts:369-379`); root children are exempt
  from F7 (`:452`); unclaimed ingredients are appended rather than dropped,
  keeping F1/F2 clean (`docs/recipe-card-rules.md:233-235`). A card with
  most ingredients hanging off the root can grade F-clean; orphan rate is
  L7. Coverage is the only signal that sees this.

The badge (`confidenceNote`, `src/core/render.ts:45-65`) reads only
`recipe.inference` and `recipe.confidence`; a card that fails F6 at 79%
coverage displays "moderate confidence".

## Desired end state

1. A local card with any S or F finding escalates to Claude even at ≥ 0.6
   confidence. L-only findings never trigger a call.
2. When two candidates exist: a rooted card always beats a rootless one
   (checked directly, not assumed); a fully-graded card beats one whose
   grade was cut short; among fully-graded cards, no-S beats any-S; F-count
   decides only between cards in the same trust band (same side of
   `CLAUDE_THRESHOLD`); confidence settles everything else. A truthful card
   beats a false one of similar coverage — and a false-but-substantial card
   is not thrown away for a truthful near-flat one.
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

### `src/core/grade.ts` — one new export, one behaviour-preserving edit

`export const UNUSABLE_RULES: readonly RuleId[] = ['S1', 'S2']` — names the
existing short-circuit set, and the inline predicate at
`src/core/grade.ts:610` is edited to reference it. Behaviour is identical,
but the implementer should know `gradeCard`'s body is touched, not merely
appended to. Alternative: duplicate `['S1', 'S2']` in `escalate.ts` —
rejected: if the short-circuit set ever changes, the copies drift silently
and the selection rule reads suppressed tiers as clean again. No grading
rule changes (PRD keeps the rule set out of scope).

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
  rejected: if that invariant ever breaks, the badge names the wrong card's
  findings, a wrong-and-quiet failure in a feature whose whole point is
  honesty.

**`pickBetter`'s rule, in order** (first decisive step wins; "confidence
rule" means today's `viaClaude.confidence >= local.confidence`):

1. **Root check — enforced, not assumed.** Exactly one candidate has a
   non-null `root` → it wins. Both rootless → confidence rule (the winner
   reaches `flatTree` either way; the rule exists only for determinism).
   This no longer leans on S1, which is silent when
   `raw.ingredientLines.length === 0` (`src/core/grade.ts:170-177`) — a
   page extraction accepts with steps but no ingredients
   (`src/core/extract.ts:322`) would otherwise grade vacuously clean and
   read as the best possible card.
2. Either grade null → confidence rule.
3. Exactly one candidate **unusable** (any `UNUSABLE_RULES` finding in
   `graded.S`) → the other wins. An unusable card's F and L tiers were
   never computed (`src/core/grade.ts:610-613`), so no comparison involving
   them is meaningful. (An S1 card is headed for `flatTree` anyway; an S2
   card has a root and would render — it loses here because its grade is
   unreadable past Tier S and any-S is INVALID, not because of where it is
   headed.)
4. Both unusable → confidence rule. (Even their S tiers are partial —
   `checkStructure` returns early at `:177`/`:200` — so counts cannot be
   compared either.)
5. **No-S beats any-S — presence, unconditional.** INVALID is a state with
   no score (`docs/recipe-card-rules.md:150`); an S finding means the card
   is wrong *as an artifact* — mis-tiled, duplicated, mis-spanned — which no
   coverage number redeems, so this step deliberately takes no confidence
   floor. Accepted consequence, stated openly: a high-coverage card with a
   single S finding loses to a sparse S-clean card. Presence, not count:
   ranking one INVALID card above another by count would invent a score the
   rulebook refuses to give.
6. **F-count — only within the same trust band.** If both candidates sit on
   the same side of `CLAUDE_THRESHOLD`, fewer F findings win (count, not
   presence: §5 scores F as a mean over rules,
   `docs/recipe-card-rules.md:151`, and each finding is a distinct false
   statement). If they straddle the threshold, this step is skipped — the F
   tier is blind to sparseness (see Current state), so a near-flat card can
   grade F-clean; letting it win on F-count against a substantial card
   would discard a mostly-correct card for one step above the flat table —
   the mirror of the bug this feature exists to fix. Skipping falls through
   to step 7, which the in-band card wins by arithmetic.
7. Confidence rule, `>=` still favouring Claude.

Worked instances: the round-1 blocking scenario — local `{S:[S1]}` vs
Claude `{S:[S4], F:[F3,F5,F6]}` — resolves at step 3 (Claude wins, as
today). The round-2 blocking scenario — local 0.80 `{F:[F6]}` vs Claude
0.30 `{L:[L7]}` — straddles at step 6, falls to step 7, local wins and
ships with a low badge naming F6. The yogurt fix — local 0.79 `{F:[F6]}`
vs an F-clean Claude card at ≥ 0.6 — resolves at step 6 for Claude, even
at numerically lower confidence. All three are pinned as regression tests.

**Contract, written in the module doc comment:** graded records passed to
these functions must come from an **options-free** `gradeByTier` call. The
`skip` filter runs after the short-circuit check
(`src/core/grade.ts:610` vs `:615`), so a skipped S1/S2 makes a suppressed
grade indistinguishable from clean, defeating step 3. `tryGrade` passes no
options. Alternative: reorder `gradeCard` to filter before the unusable
check — rejected: changes grader behaviour for other callers, out of scope.

These functions throw nothing themselves; they are total over their inputs.

### `src/content/index.ts` changes

- Add a private `tryGrade(recipe: Recipe, raw: RawRecipe): Graded | null`
  beside `askClaude`: wraps `gradeByTier(recipe, raw)` — no options, per the
  contract above — in try/catch → null, same "plan B" contract. `gradeCard`
  runs `layout()` internally (`src/core/grade.ts:221`) and deeper checks
  assume a tree; the catch keeps that off the page. Core stays fail-fast;
  the boundary is where leniency lives.
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
a clause naming the count and the first finding's `detail`, whatever the
inference strategy. The quoted detail is **truncated to a bounded length
(120 characters, with an ellipsis)**: details embed raw ingredient lines
verbatim (`src/core/grade.ts:213, :344, :578`) and, unlike operation labels
(capped at 58, `:62`), ingredient lines have no cap — a page-controlled
string must not balloon the note. In practice the content script never
passes findings for a flat card (Decision 5), so the flat message is
unchanged; the precedence exists so the function has a defined contract for
any caller. With empty findings, behaviour is byte-identical to today, which
keeps the single other call site (`src/content/index.ts:100`) valid until it
is updated in the same change. `confidenceNote` is not covered by any
snapshot — `tests/e2e/golden.spec.ts:71-73` snapshots `.rd-table` only.
`Finding` is imported with `import type` — `src/export/print.ts:11` imports
`render.ts`, and a value import would pull the grader into the print/export
bundles for a type that erases at compile time.

### Documentation that must change with the behaviour

- `README.md:74` — "(only below 60% confidence…)" becomes false; reword to
  "when local parsing is uncertain — low confidence, or the self-check found
  a structural or faithfulness problem". `README.md:92-93` ("only when local
  parsing is uncertain") keeps its wording, but note honestly: its meaning is
  redefined by the line-74 reword. Both lines are reviewed together.
- `docs/recipe-card-rules.md` §6 (`:180-183`) — grading now also runs in the
  extension, not only in tests.
- `CHANGELOG.md` — new entry (repo convention, see `CHANGELOG.md:20`),
  saying plainly that some previously "moderate" badges will now read "low".

## Decisions made

1. **Trigger gates on S ∪ F; the confidence trigger is kept, OR-ed.**
   *Assumption — chosen without user review.* Alternative: grading alone —
   rejected: sub-0.6 coverage means ≥40% of ingredients unattached, which
   the S/F tiers do not fully re-detect (orphan rate is L7), and the
   documented posture ("not trustworthy enough to show alone",
   `src/content/index.ts:22`) would silently weaken. **Cost:** extra Claude
   calls for ≥0.6 cards with S/F findings, including the sticky repeat
   (Decision 9) and the systemic over-fire case (Risks).
2. **Selection is the seven-step rule above.** *Assumption — chosen without
   user review.* The load-bearing choices: root check enforced in code
   rather than assumed from S1 (an unstated precondition breaks quietly);
   unusable-first because suppressed tiers are unreadable (round-1 defect);
   S by presence, unconditional (INVALID is unscoreable; artifact-level
   breakage); F by count but only within a trust band, because the F tier
   cannot see sparseness and coverage is the only signal that can (round-2
   defect — the floor is `CLAUDE_THRESHOLD` itself rather than an invented
   delta, reusing the one number this codebase already defends in prose).
   Alternatives: lexicographic (S count, F count) — rejected in round 1;
   unconditional F-count — rejected in round 2 (the mirror bug); a numeric
   confidence-gap floor (e.g. 0.2) — rejected: an invented constant with no
   doctrinal grounding, where the threshold already encodes "trustworthy
   enough to show alone". **Cost:** seven steps instead of one comparison —
   each separately unit-testable — and a real trade at step 6: a truthful
   below-threshold card loses to an above-threshold card with findings,
   which ships with an honest low badge instead.
3. **At most one Claude call per run, unchanged.** Alternative: retry when
   the Claude card also fails — rejected: same prompt, same model, and the
   per-recipe cost posture is documented (`src/llm/claude.ts:51-55, :71-76`)
   for calls spending a key the user supplies themselves (`README.md:74`,
   `src/background.ts:43-46`); no evidence a second identical call
   converges. **Cost:** a page Claude cannot fix still ships flawed — with
   an honest low badge (Decision 4).
4. **Badge reflects residual S/F findings (level → low, note names the first
   finding, detail truncated), taking precedence over the flat
   early-return.** *Assumption — chosen without user review.* Alternative:
   coverage-only badge — rejected by PRD story 4. Alternative: a new badge
   state — rejected; badge redesign out of scope per the PRD. **Cost:**
   previously "moderate" cards with persistent findings now say "low";
   named in the CHANGELOG.
5. **The `flatTree` fallback is not graded.** *Assumption — chosen without
   user review.* Alternative: grade it and pass its findings to the badge —
   rejected: `confidenceNote` already forces `low` for flat cards
   (`src/core/render.ts:54`) and no escalation decision remains after the
   fallback. **Cost:** a flat-fallback card may carry F findings the user
   is never told about — the badge says low, but the note does not name
   them.
6. **The Claude candidate is graded fresh.** Alternative: trust `plan.ts`'s
   construction guards — rejected: "defended, not asserted"
   (`docs/recipe-card-rules.md:237-238`), and the F rules are not defended
   at all. **Cost:** one extra grade per escalating run.
7. **Policy lives in `src/core/escalate.ts`, not inline.** Alternatives:
   inline in `content/index.ts` — untestable; extend `grade.ts` — the
   grader's header promises it shares no judgement with inference
   (`src/core/grade.ts:15-18`). **Cost:** one more module, the
   `UNUSABLE_RULES` export, and a written options-free precondition that a
   careless future caller could still violate.
8. **No `grid` reuse into `gradeCard`; the whole grade (including the
   unread L tier) runs on every card.** The honest baseline: on the common
   path there is *no* network call to hide behind — grading's cost stands
   alone. It is bounded by input size: pure, synchronous work over a
   recipe-sized input, the same order of work the render does, once per
   explicit toolbar click. If profiling ever shows a problem, the only real
   lever is passing a shared `grid` (the `skip` option is a post-filter,
   `src/core/grade.ts:602-616` — it saves no work, and this design forbids
   it anyway; skipping the L tier has no API without changing `grade.ts`).
   Alternative: reuse the grid now — rejected: threads state through
   `run()` for an unmeasured saving. **Cost:** `layout()` runs up to three
   times per run, accepted knowingly.
9. **No cross-run memory: the sticky-cost case is accepted.** *Assumption —
   chosen without user review.* A page whose card carries a finding Claude
   also cannot fix pays one Claude call on every open, forever. Alternative:
   memoise verdicts per URL in `chrome.storage` — rejected: state and
   invalidation machinery for a cost bounded per click, user-initiated, on
   the user's own key. Reopen trigger in Open questions. The *systemic*
   version — an over-firing rule making every page pay — is a Risk, not an
   accepted cost.
10. **PRD acceptance criterion 3 is deliberately narrowed.** *Assumption —
    chosen without user review.* The PRD says the fewer-findings candidate
    wins "even if its confidence score is numerically lower"; this design
    honours that only within a trust band (step 6). Unqualified, the
    criterion reproduces the round-2 mirror bug — discarding a
    mostly-correct card for a truthful near-flat one — so the narrowing is
    the smaller betrayal of the PRD's own problem statement.

## Edge cases

- **Empty/missing input.** Local root null with ingredients present → S1
  fires → escalation triggers, and step 1 hands the win to any rooted
  Claude card — matching today. Zero ingredient lines → S1 deliberately
  silent (`src/core/grade.ts:170-177`) and the grade is vacuously clean —
  step 1 now catches this case structurally; the error path at `:216-218`
  is unchanged, and any crash in tiers walking a null root is absorbed by
  `tryGrade`.
- **Boundary values.** Confidence exactly 0.6 with zero findings → no call
  (strict `<` preserved). 0.79 with an F6 → escalates (the shipped bug).
  Step 6 band edge: 0.60 vs 0.59 straddles — the 0.60 card wins at step 7.
  Both candidates unusable → confidence rule, today's behaviour. Fully
  graded, equal S-presence, same band, equal F count, equal confidence →
  Claude wins (`>=` preserved).
- **Failure paths.** `gradeByTier` throws → `tryGrade` null → trigger and
  selection degrade to today's behaviour, badge unchanged from today.
  `askClaude` null (no key, `useClaudeFallback` off, network error) → local
  card ships, now with an honest low badge if it has S/F findings.
- **Ordering/state.** Grading is synchronous and runs before the single
  `await`; the second-click-closes contract (`:193`) is untouched.
- **Resource/cost.** Hard bound: one Claude call per run, each following an
  explicit click. How often the S/F trigger fires in the wild is **not
  known**: the only in-repo evidence — the fixtures grade clean on S and F
  (`tests/sites.test.ts:79-84`) — is near-tautological, because those
  fixtures are the grader's own tuning set
  (`docs/recipe-card-rules.md:206-209`). The design-level mitigation is the
  grader's stated bias ("a grader that cries wolf gets switched off",
  `:197-204`). Sticky repeat cost: Decision 9. Systemic over-fire: Risks.
- **Adversarial/malformed input.** Finding details embed page-controlled
  ingredient text; they reach the DOM only through `escape()`
  (`src/content/index.ts:118`) and the badge note truncates them (see
  render changes). A malformed Claude plan is already sanitised by
  `plan.ts` and now also graded before it can win.

## Testing

What each PRD acceptance criterion gets, stated plainly:

- **S/F above threshold still escalates** — `tests/core/escalate.test.ts`
  (new): `shouldEscalate` truth table, including the F6-at-0.79 regression.
  End-to-end: the new golden fixture below exercises the real wiring.
- **L-only adds no call** — `shouldEscalate` unit test.
- **Fewer/no S-F candidate wins** — `pickBetter` unit tests, one per step:
  rootless never beats rooted (and both-rootless → confidence); the
  round-1 scenario (usable beats unusable); both-unusable → confidence;
  no-S beats any-S regardless of F and confidence (the accepted
  consequence, pinned so it is a choice, not an accident); same-band fewer-F
  wins at lower confidence; **the round-2 mirror scenario** (0.80/`F6` vs
  0.30/clean → local wins); band edge 0.60 vs 0.59; full tie → Claude;
  null grade → today's rule.
- **Flat fallback preserved** — by construction: `:215-218` are untouched.
- **Badge choice explicit** — `tests/core/render.test.ts` (new):
  `confidenceNote` unchanged for all three strategies with empty findings;
  with an F finding, level `low`, text contains the detail; truncation at
  the cap; findings take precedence over the flat early-return.

**End-to-end, without mocking:** `tests/e2e/golden.spec.ts:54-63` already
evaluates the real `dist/content.js` against a fixture with `chrome`
undefined, so `askClaude` returns null (`src/content/index.ts:187-189`).
Two additions: (a) an assertion that the badge element renders on the
existing fixtures (the no-finding path — it currently snapshots `.rd-table`
only, `:71-73`); (b) **one new golden fixture that trips an F rule**, which
exercises `tryGrade`, a true `shouldEscalate`, the null-Claude path and the
low badge naming the finding, in a real DOM with no `chrome.*` mocks.

**Accepted untested, and why:** only the Claude-*success* branch of the
reworked `run()` — a live `pickBetter` call on two real candidates and
`showTable` with a Claude winner — because it needs a `chrome.runtime` mock
that does not exist, and building one is more code than this feature. The
mitigation is structural: that branch is plumbing between fully-tested pure
functions, and `pickBetter`'s widened return makes the wrong-and-quiet
wiring bug (badge naming the loser's findings) impossible by construction.

## Out of scope

Per the PRD: the S/F/L rules themselves, the Claude prompt and `Plan`
schema, any settings toggle, badge visual redesign, F8/F9 reference-card
rules. Also out: telemetry/counting of escalations, cross-run caching of
verdicts (Decision 9), and a `chrome.*` mock harness for the content script
— each is more machinery than the thinnest honest version needs, and none
has a demand signal yet.

## Risks

- **Systemic over-fire is a cost risk, not only a quality risk.** If one S
  or F rule over-fires broadly on unseen pages, `shouldEscalate` becomes
  effectively unconditional and every open of every affected page costs a
  Claude call — a different magnitude from Decision 9's single sticky page.
  The fixture suite cannot warn us (it is the tuning set); the mitigation is
  the grader's precision-over-recall bias with fixture-pinned carve-outs
  (`docs/recipe-card-rules.md:197-209`), and the reopen trigger below.
- `pickBetter` can keep a *lower*-coverage card within a trust band; if a
  rule over-fires on some site, users see sparser cards. Same mitigation as
  above. Step 5's unconditional S-presence is the sharpest instance and is
  pinned as a deliberate choice in the test suite.
- A page with a persistent finding pays a Claude call on every open
  (Decision 9). Bounded per click and per key-owner, unbounded across time.
- The Claude-success branch of `run()` ships without direct tests (see
  Testing); a plumbing mistake there would surface as behaviour, not as a
  failing suite.
- The badge change makes previously "moderate" cards say "low" when
  findings persist — intended, but visible; the CHANGELOG says so plainly.

## Open questions (deferred)

None block this design. Two items are deferred with owners and reopen
triggers, not left ambient:

- **Escalation visibility** (a "why did this call Claude?" affordance).
  Owner: repo maintainer. Reopen if users ask why the badge dropped or why a
  card changed between opens.
- **Cross-run verdict caching** (Decision 9). Owner: repo maintainer.
  Reopen if a user reports meaningful spend from repeated opens — one page
  (sticky case) or many (systemic over-fire).
