---
topic: grader-runtime-escalation
date: 2026-07-29
phase: questions
---

# Research Questions: grader-runtime-escalation

## Codebase context
- Scope: `src/content/index.ts`, `src/core/grade.ts`, `src/core/infer.ts`,
  `src/core/plan.ts`, `src/core/render.ts`, `src/core/types.ts`,
  `src/llm/claude.ts`, `src/background.ts`, `src/messages.ts`,
  `src/options/options.ts`, `tests/core/grade.test.ts`,
  `tests/sites.test.ts`, `docs/recipe-card-rules.md`.
- Vocabulary:
  - **Confidence** — the `Recipe.confidence` field (`src/core/types.ts`),
    a number from 0 to 1.
  - **Escalation** — the point where a second inference pass may run before
    a result is shown (the term `src/core/infer.ts` itself uses in
    comments).
  - **Grading** — the output of `gradeCard` / `gradeByTier` in
    `src/core/grade.ts`: a `Finding[]` list, each with a `RuleId` and a
    `detail` string, grouped into tiers `S`, `F`, `L`.
  - **Inference strategy** — the `InferenceStrategy` field
    (`'heuristic' | 'claude' | 'flat'`) recording which pass produced a
    given `Recipe`.

## Topology
- Where in `src/content/index.ts` is the decision made about whether a
  second inference pass runs, and what values does that decision currently
  read?
- Where in `src/content/index.ts` is the decision made about which of two
  candidate results is kept, and what values does that decision currently
  read?
- What does `src/core/grade.ts` export, what are the parameter and return
  types of each export, and what inputs does it need that are not already
  available at the decision points above?
- What modules currently import from `src/core/grade.ts`, and how does each
  one call it?
- Which module computes and renders the confidence text/level shown to the
  user, and what inputs does it take?

## Conventions
- What test framework, file layout, and naming convention does this
  codebase use for `src/core/*` unit tests (e.g., `tests/core/grade.test.ts`)?
- How does `src/core/grade.ts` itself group and label its output (tiers,
  rule IDs), and where is that scheme documented?
- What error-handling pattern does `src/content/index.ts` use around
  asynchronous calls that can fail or return nothing (e.g., messages to the
  background service worker)?

## Constraints
- What are the full type signatures of `Finding`, `Tier`, `RuleId`,
  `GradeOptions`, and `Recipe`, and which fields on each are optional?
- Does `src/core/grade.ts` depend on the DOM or any `chrome.*` API, and is
  it currently part of `src/content/index.ts`'s import graph?
- What settings govern whether and how a Claude API call is made (model,
  effort, enabled flag, API key), and where are they read from and stored
  (`src/background.ts`, `src/messages.ts`, `src/options/options.ts`)?
- Is there any documented constraint (comment, README, CHANGELOG) about the
  cost, latency, or frequency of calls to the Claude API?

## Reference points
- What is the most representative existing caller of `gradeCard` or
  `gradeByTier`, and what pattern does it use for interpreting the returned
  findings?
- What comments, README sections, or CHANGELOG entries describe the
  intended relationship between `src/core/grade.ts` and the rest of the
  pipeline?
- What other place(s) in `src/content/index.ts` or `src/core/infer.ts`
  compare or choose between two `Recipe` values, and how is that comparison
  implemented?
