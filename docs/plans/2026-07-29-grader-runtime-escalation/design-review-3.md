---
topic: grader-runtime-escalation
date: 2026-07-29
phase: design-review
verdict: REQUEST CHANGES
---

# Design review — round 3

Fresh adversarial reviewer (3a) against revision 3. The closure auditor (3b)
did not deliver; 3a's verdict is decisive on its own.

## Blocking — the trust band fixes the instance, not the class

Step 6 skips the F comparison when candidates straddle `CLAUDE_THRESHOLD`.
But sparseness is continuous and the band boundary is a single point, so the
guard fires only when a pair happens to sit across that one point. **The same
bug survives inside each band.**

Shift the round-2 scenario down 0.21:

- local `0.59` `{F:[F6]}` vs Claude `0.30` `{L:[L7]}` — both below 0.6, same
  band, step 6 fires, Claude wins. A 30%-coverage card replaces a 59% one.
  **Today's code keeps the local card** (`0.30 >= 0.59` is false), so this is a
  regression, not merely an unfixed case.
- Same shape above the line: local `0.95` `{F:[F6]}` vs Claude `0.61`
  `{L:[L7]}`. Same band, Claude wins at 0.61 against 0.95.

This contradicts Desired end state #2 as written: "a false-but-substantial card
is not thrown away for a truthful near-flat one." The design's own rationale at
`:159-162` — "the F tier is blind to sparseness… a near-flat card can grade
F-clean" — is exactly as true at 0.59 as at 0.30. The band does not encode the
property the rationale appeals to.

Decision 2 rejected "a numeric confidence-gap floor (e.g. 0.2)" as "an invented
constant with no doctrinal grounding". A gap floor is precisely what closes this
hole, and the threshold band does not. The rejection must answer the
0.59-vs-0.30 case, or the constant comes back.

`design.md:156-163`

## Issue — the cited line argues against the rule it justifies

Step 6's parenthetical justifies count-over-presence with "§5 scores F as a mean
over rules, `docs/recipe-card-rules.md:151`". That line reads
`faithfulness = mean(F1..F9)  weight 0.75` — a mean over nine **rules**,
pass/fail per rule, wholly insensitive to how many findings a rule emits. The
citation supports presence-per-rule, the option the design rejects.

The two orders disagree on real inputs, because several F rules emit one finding
per offending pair: F7 per (op, child) (`src/core/grade.ts:451-465`), F3 per
uncited step (`:369-379`), F5 per (op, child) (`:393-406`), F6 per leaf
(`:414-445`). So local `{F:[F7,F7,F7]}` vs Claude `{F:[F3,F6]}`, same
confidence, same band: `pickBetter` counts 3 vs 2 and keeps Claude, while the
rulebook scores local 8/9 and Claude 7/9 and prefers local. Step 6 can keep the
card the project's own scoring calls worse, citing the line that says so.

Either count distinct rules (`new Set(findings.map(f => f.rule)).size`), or drop
the citation and own "distinct false statements" as the design's own judgement —
but not both. `design.md:158-160`

## Issue — `shouldEscalate`'s stated reason is false in the zero-ingredient case

"Suppressed tiers cannot mislead this function: an S1/S2 card has `S.length > 0`"
is false when `raw.ingredientLines.length === 0`: S1 is deliberately silent
(`src/core/grade.ts:170-177`), so `unusable` is false at `:610`,
`checkFaithfulness` and `checkLegibility` both run and both return `[]`
immediately on the null root (`:324`, `:487`). The card grades `{S:[],F:[],L:[]}`
and the grading arm returns false.

It escalates anyway — but via the **confidence** arm, because `inferTree` returns
0 when there are no ingredients (`src/core/infer.ts:403`). Right outcome, wrong
stated reason, in a sentence an implementer will lean on when deciding whether
the grading arm alone suffices. `pickBetter` step 1 handles the analogous case
explicitly; `shouldEscalate` should too. `design.md:115`

## Suggestion — `graded`'s value on the non-escalating paths is never stated

The wiring is given as `({ recipe, graded } = pickBetter(...))`, which runs only
when a rooted Claude candidate exists. The design never says what `graded` holds
when `shouldEscalate` is false, when `askClaude` returns null, when
`viaClaude.root` is null, or after `:215` swaps in `flatTree`. Edge cases
promises "askClaude null → local card ships, now with an honest low badge if it
has S/F findings" — a promise resting entirely on an initialiser the document
never writes down. `design.md:186-202`

## Nitpicks

- Half of step 1 is unreachable from its only caller: `run()` keeps the
  `viaClaude.root` guard, so `pickBetter` only ever sees a rooted Claude card.
  Step 1's rationale argues the root check belongs inside `pickBetter`, which
  reads as an argument for dropping the outer guard. A reader cannot tell which
  guard is authoritative. `design.md:126-131` vs `:195`
- "unlike operation labels (capped at 58, `:62`)" — `MAX_LABEL` is the threshold
  L1 *reports* against, not a cap applied to data (`grade.ts:493-497` flags, it
  does not shorten). F-tier details embed `describe(op)` (`:401`, `:440`,
  `:461`), so op labels reach the badge uncapped too. `design.md:212-213`

## What held up

All seven sections present, none thin. ~25 citations checked; every one resolves
and says what the doc claims (the `:151` case is a misreading, not a
fabrication). Decision 8's cost accounting is right — `layout()` three times.
The confidence numbers from `infer.ts:403` and `plan.ts:138` are commensurable,
both claimed-ingredients over ingredient-line count, so step 6 compares like with
like. Steps 3 and 4 introduce no case where an unusable card is newly selected;
on that axis revision 3 strictly improves on today.

**Not covered by 3a:** L-tier badge interaction (S+F only reach the badge); no
real page fixture was constructed for the 0.59-vs-0.30 pair.

VERDICT: REQUEST CHANGES
