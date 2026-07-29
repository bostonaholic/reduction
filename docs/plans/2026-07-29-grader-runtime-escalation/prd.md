---
topic: grader-runtime-escalation
date: 2026-07-29
phase: prd
---

# PRD: grader-runtime-escalation

### Problem Statement
Reduction decides whether to attempt a second, Claude-assisted inference
pass — and which of two candidate results to keep — using only
`Recipe.confidence`, a coverage metric (the share of ingredient lines a step
claimed). Coverage does not say whether an ingredient was attached to the
right operation. A card can score high confidence and still tell the cook
to do something the recipe never says — for example, heat something the
recipe only refrigerates. A grading module (`src/core/grade.ts`) that can
catch this class of problem already exists, but today it runs only in
tests, not in the running extension.

### User Stories
- As someone using Reduction to cook from a page it rendered, I want a card
  with a real correctness problem to trigger a second inference attempt even
  when its coverage score looks fine, so I am not shown instructions that
  contradict the recipe.
- As someone using Reduction, I want the tool to keep whichever candidate
  card is more correct, not just whichever covers more ingredient lines,
  when it must choose between the local and the Claude-produced version of a
  card.
- As the holder of the Anthropic API key that pays for Claude calls, I want
  a card with only cosmetic (legibility) issues to not, by itself, trigger
  an extra paid call.
- As someone reading the on-screen confidence indicator, I want it to not
  overstate confidence for a card with a known correctness problem.

### Acceptance Criteria
- [ ] GIVEN a locally-inferred card with a structural or faithfulness
      finding WHEN its confidence is at or above `CLAUDE_THRESHOLD` THEN a
      Claude-assisted pass is still attempted before the card is shown.
- [ ] GIVEN a locally-inferred card with only legibility findings WHEN its
      confidence is at or above `CLAUDE_THRESHOLD` THEN no additional
      Claude call is triggered by those findings alone.
- [ ] GIVEN both a heuristic and a Claude-produced candidate exist for the
      same page WHEN the extension chooses between them THEN the candidate
      with fewer/no structural or faithfulness findings is kept, even if
      its confidence score is numerically lower.
- [ ] GIVEN neither candidate is structurally usable WHEN both inference
      passes are exhausted THEN the existing flat-table fallback still
      applies.
- [ ] GIVEN grading could change what the confidence badge says WHEN the
      design is written THEN that choice is made explicitly, not left
      implicit.

### Scope Boundaries

**In Scope:**
- Feeding `gradeCard` / `gradeByTier` output into the *trigger* decision
  (whether a second inference pass runs) in `src/content/index.ts`.
- Feeding grading output into the *selection* decision (which candidate
  result is kept).
- Keeping added Claude-call volume bounded, so legibility-only findings do
  not drive extra cost.

**Out of Scope:**
- Changing the grading rules themselves (the S/F/L rule set in
  `src/core/grade.ts` and `docs/recipe-card-rules.md`).
- Changing the Claude prompt or the `Plan` schema (`src/core/plan.ts`).
- Adding a new user-facing settings toggle for this behavior.
- A visual redesign of the confidence badge; only whether its level/text
  should account for grading is in scope.

**Future Scope:**
- Reference-card-based faithfulness rules (F8/F9), which `src/core/grade.ts`
  already declines to implement for lack of a human-authored reference card.

### Constraints
- **Performance:** the change must not turn every card into two Claude
  calls; legibility-only findings must not, alone, add a call.
- **Compatibility:** `src/core/grade.ts` has no DOM or `chrome.*` dependency
  today; that must stay true no matter where it is called from.
- **Operational:** Claude calls spend the user's own supplied API key
  (`src/options/options.ts`, `src/background.ts`); the model/effort settings
  already in place must keep being honored, not bypassed.
