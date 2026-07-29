---
topic: uncooked-beef-cooked-yogurt
date: 2026-07-29
phase: task
ticketId: null
---

# Operations attach to the wrong ingredients on Mediterranean Ground Beef Pita Wraps

Source page:
<https://www.shaykeerecipes.com/mediterranean-ground-beef-pita-wraps/>

## Observed

The rendered table shows:

- `refrigerate` → `cook 2 min` → `microwave 20 to 30 sec` stacked over the
  **Greek yogurt sauce**. The yogurt sauce is refrigerated in step 1 and never
  cooked or microwaved by the recipe.
- **Ground beef** sits as an unoperated leaf feeding straight into `serve`,
  i.e. the table says to serve it raw.
- `Heat olive oil in a skillet over medium heat` rendered as a banner row.
- **Pita bread** sits as an unoperated leaf, though step 4 warms it.

## Expected

- Greek yogurt has no cooking operation above it — only `refrigerate`, then
  the final `serve`.
- Ground beef is under a `cook` operation.
- Pita bread is under the `microwave 20 to 30 sec` operation.

## Root causes

1. `PREP_PATTERNS` in `src/core/infer.ts` matches the greasing pattern
   `oil … skillet` inside *"Heat olive **oil** in a **skillet** over medium
   heat. Add ground beef… Cook until browned"*. The whole step is demoted to a
   banner, so the beef and the olive oil are never claimed and never cooked.
   The pattern does not distinguish `oil` the imperative verb ("oil the pan")
   from `oil` the noun ("olive oil").

2. `inferTree`'s `sweepsAll` rule vacuums **every** pending branch whenever the
   step's verb is in `TERMINAL`, so each subsequent `cook` / `microwave` step
   swallows the refrigerated yogurt sauce. A component that a step explicitly
   parked ("Refrigerate until ready to use") should wait for assembly.

3. `sweepsAll` also fires for a terminal-verb step that brings its own fresh
   ingredients and never refers back — step 4 (`warm the pita`) is a new
   branch, not a continuation.

4. `searchPhrases` in `src/core/ingredient.ts` reduces
   `4 large pita bread rounds` to the phrases `pita bread rounds` /
   `bread rounds` / `rounds`, none of which match the step's `the pita bread`.

5. Found while verifying against the captured site fixtures: `ADDITIVE` has the
   same noun/verb ambiguity as (1) on `layer`, so *"Spread the strips over a
   baking sheet in a single **layer**"* reads as adding to work in progress.
   Combined with (3) this had Budget Bytes baking the soup along with the
   tortilla crisps.

## Verification

- `tests/core/infer.test.ts` — five assertions, each mutation-checked against
  the line of the fix it covers.
- Full unit suite (96) and typecheck pass.
- All 16 Playwright golden snapshots pass unchanged — no pixel moved on the
  six reference diagrams.
- Inferred trees for all 15 captured real-site fixtures were dumped before and
  after. The only difference is Budget Bytes, which improves: its tortilla
  crisps gain the `bake 10 to 15 min` operation they were missing (confidence
  0.75 → 0.80) instead of hanging off `serve` as unoperated leaves.
