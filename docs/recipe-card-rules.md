# Grading a reduced recipe card

Michael Chu never published a grammar for the Tabular Recipe Notation. The
[one forum post][chu] that states the reading rules is prose, written in 2005,
and it describes how to *read* a table — not how to decide whether a generated
one is any good.

This document is the missing half: an abstract syntax for the card, and a
numbered rule set that any card can be graded against. Rules are grouped into
three tiers, and the tiers are not interchangeable — a **Structural** failure
means the card cannot be drawn at all, a **Faithfulness** failure means it is
drawn beautifully and says something false, and a **Legibility** failure means
it is true but unpleasant.

[chu]: https://www.cookingforengineers.com/forums/viewtopic.php?t=120

## 1. The abstract syntax

A card is a tree. Leaves are ingredients, internal nodes are operations, and
the table is that tree rendered left to right.

```
Card        := Title Yield? Banner* Tree?
Banner      := Text                       -- full-width, consumes nothing
Tree        := Node
Node        := Ingredient | Operation
Ingredient  := { raw, name, quantity?, unit?, metric?, note? }
Operation   := { label, children: Node+, sourceStep }
```

This is `RecipeNode` in [`src/core/types.ts`](../src/core/types.ts). It is
already the de-facto AST; this document only writes it down.

Three derived quantities produce the table, and nothing else is needed:

```
column(Ingredient) = 0
column(Operation)  = 1 + max(column(c) for c in children)
rowSpan(node)      = number of Ingredient leaves in the subtree
row order          = depth-first traversal of the leaves
```

### Canonical text form

For goldens, test fixtures and bug reports, write a card like this — `[label]`
for an operation, `- text` for an ingredient, two spaces per level:

```
[serve]
  [mix]
    - 1 cup plain Greek yogurt
    - 2 cloves garlic, minced
  [cook 2 min]
    [cook 8 to 10 min]
      - 1 lb ground beef (85% lean)
      - 2 tbsp olive oil
    - 1 tsp dried oregano
  [microwave 20 to 30 sec]
    - 4 large pita bread rounds
  - 1 cucumber, diced
```

The form is unambiguous, diffs cleanly, and is what the grading harness should
consume. Filler cells are *not* written — they are a rendering artefact of
`column`, never part of the tree.

### Relationship to prior art

**RxOL** (David A. Mundie, *Computerized Cooking*, 1985) is the only prior
formalism: postfix operators over ingredients, building a graph. A card here is
isomorphic to an RxOL expression, so this AST is a re-derivation rather than an
invention. **Cooklang**, **Pesto** and microformats **h-recipe** are all
*linear* recipe markups — they model a sequence of steps and cannot express the
tree, so they can round-trip a recipe but not a card.

## 2. Tier S — Structural

Binary. A card violating any S rule is invalid, not low-scoring. These are all
checkable from the card alone, with no reference and no source recipe.

| # | Rule |
| --- | --- |
| **S1** | Exactly one root, or an explicitly empty card. |
| **S2** | The graph is a tree: every node has exactly one parent, no cycles, no shared subtrees. |
| **S3** | Every operation has at least one child. A childless operation has nothing to act on. |
| **S4** | Every ingredient leaf is distinct and appears exactly once. |
| **S5** | Row order is the depth-first leaf traversal. |
| **S6** | `column(op) = 1 + max(column(children))`. |
| **S7** | `rowSpan(node) = leafCount(node)`. |
| **S8** | Every operation's leaves occupy a contiguous block of rows. Implied by S5, checked separately because it is the property a `rowspan` actually needs. |
| **S9** | The grid tiles: no holes, no overlaps, nothing spilling past the bounds. |
| **S10** | Banners consume no ingredients and span the full width. |

S9 is the only one enforced today, by
[`validateGrid`](../src/core/layout.ts). S5–S8 hold by construction in
`layout.ts` and are never asserted — construction-correctness is not the same
as a check, and a refactor can silently break them.

## 3. Tier F — Faithfulness

Graded 0–1 each. This tier is where a card lies. Note the split: some rules need
only the source recipe, others need a human-authored reference card. A harness
should implement the first group before attempting the second.

### Checkable against the source recipe alone

| # | Rule |
| --- | --- |
| **F1** | **Ingredient coverage.** Every ingredient line in the source appears as exactly one leaf. |
| **F2** | **No invention.** Every leaf traces to a source ingredient line; no leaf is fabricated. |
| **F3** | **Step coverage.** Every source step appears as an operation, a banner, or is accounted for by a documented merge. |
| **F4** | **Operation provenance.** Every operation carries a `sourceStep` pointing at a real step. |
| **F5** | **Temporal monotonicity.** An operation's `sourceStep` is greater than every `sourceStep` beneath it. Work cannot consume output from a step that had not happened yet. |
| **F6** | **Heat integrity.** An ingredient the recipe never heats has no heat-applying operation among its ancestors. |
| **F7** | **Consumption integrity.** An operation's direct ingredient children are exactly the ingredients its step names. |

**F6 is the rule this project learned the hard way.** The Mediterranean pita
wrap card put `cook 2 min` and `microwave 20 to 30 sec` above a yogurt sauce the
recipe only ever refrigerates — a perfectly valid tree, a perfectly tiled grid,
and a card that tells you to cook yogurt. Every S rule passed. Nothing in the
suite noticed. F6 is mechanically checkable: intersect the heat verbs applied
above a leaf with the verbs the source applies to that ingredient.

### Requires a reference card

| # | Rule |
| --- | --- |
| **F8** | **Parallelism truth.** Two operations in the same column must genuinely be order-independent — this is the semantic content of a column, per Chu: *"Because the mix step is shown in the same column, time is unimportant."* |
| **F9** | **Grouping fidelity.** The partition of ingredients into subtrees matches how a cook would group them. |

## 4. Tier L — Legibility

Graded 0–1 each, weighted lower than F. A card can be entirely true and still
be a bad card.

| # | Rule |
| --- | --- |
| **L1** | **Label is a verb phrase.** Terse, imperative, no sentences. Cap around 58 characters. |
| **L2** | **Label carries stated detail.** If the step gives a temperature or a duration, the cell shows it. |
| **L3** | **Label names the work, not the wait.** Prefer the transformation over a hold: `mix`, not `refrigerate`, unless the hold states its own duration. |
| **L4** | **Bounded width.** Column count stays proportional to the recipe's real structure. A 26-step layer cake must not produce a 24-column table. |
| **L5** | **No phantom operations.** A wrapper invented to join loose ends — the synthetic `combine` — is a smell, not a step. Count them; zero is the target. |
| **L6** | **Logistics folded.** Verbs that move food without changing it (`transfer`, `place`, `cover`) merge into the operation they wrap rather than earning a column. |
| **L7** | **Orphan rate.** Ingredients attached to nothing but the final operation, as a fraction of all ingredients. |
| **L8** | **Ingredient formatting.** Quantity, unit and metric render correctly, including plurals — `2 cloves garlic`, not `2 clove garlic`. |

## 5. Scoring

```
if any S rule fails          -> INVALID (no score)
faithfulness = mean(F1..F9)     weight 0.75
legibility   = mean(L1..L8)     weight 0.25
score        = 100 * (0.75 * faithfulness + 0.25 * legibility)
```

Weighted three-to-one because a card that lies is worse than a card that is
merely ugly, and the failure mode this project actually hit was a lie.

Report the **rule IDs that failed**, never a bare number. "82" is not
actionable; "F6 on the Greek yogurt, L8 on the garlic" is.

`Recipe.confidence` is *not* this score. It measures one thing — the fraction
of ingredient lines a step claimed — which makes it a rough proxy for F1 and
nothing else. A card can reach 100% confidence and still fail F6.

## 6. Current enforcement

| Tier | Asserted | Held by construction | Unchecked |
| --- | --- | --- | --- |
| S | S9 (`validateGrid`) | S1–S8, S10 | — |
| F | F1, F6 (`gradeCard`) | F4, F5 | F2, F3, F7, F8, F9 |
| L | — | L4, L6 | L1, L2, L3, L5, L7, L8 |

[`gradeCard`](../src/core/grade.ts) implements F1 and F6 and runs against all
15 captured site fixtures in `tests/sites.test.ts`. It reports failed rule IDs
with the offending ingredient named — never a score.

**F6 is tuned for precision over recall, deliberately.** Heat legitimately
reaches ingredients a step never names ("add the flour, then bake"), so the
check fires only on the unambiguous signature: an ingredient the recipe
explicitly parked, heated afterwards by a non-root step that names some *other*
ingredient beneath it. A card that sweeps a parked branch into a heat step
naming nothing at all goes unreported, because the source text cannot
distinguish that from a legitimate chill-then-bake. A grader that cries wolf
gets switched off; a missed case costs less.

Both of those carve-outs were found by running the check against the captured
fixtures, not by reasoning: the first draft flagged Simply Recipes (a *freeze
the leftovers* note after the bake) and Tasty (chilling cookie dough that is
then meant to be baked). Both are pinned as regression tests.

Worth being precise about that middle column, because "held by construction" is
doing real work in two different places:

- **`layout.ts`** computes `column` and `rowSpan` from the tree, so S5–S8 cannot
  be wrong unless the layout code itself is.
- **`plan.ts`** is the path where the tree comes from *model output*, and it
  defends itself deliberately: `ref >= index` rejects forward and self
  references (S2, and F5 for free), `consumedSteps` stops a subtree being shared
  (S2), `claimedIngredients` stops an ingredient appearing twice (S4),
  `children.length > 0` prevents a childless operation (S3), and unclaimed
  ingredients are appended rather than dropped (F1, F2).

So the structural tier is in decent shape — but it is *defended*, not
*asserted*. No test would notice if a refactor removed those guards.

The real gap is Tier F. The 15 captured site fixtures assert only that a tree
exists, tiles, and renders with balanced markup. Every one of them would still
pass if the inference attached every operation to entirely the wrong
ingredients — which is precisely the bug that shipped.
