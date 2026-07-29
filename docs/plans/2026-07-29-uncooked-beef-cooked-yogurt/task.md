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
