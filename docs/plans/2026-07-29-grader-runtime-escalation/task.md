---
topic: grader-runtime-escalation
date: 2026-07-29
phase: task
ticketId: null
---

# Task: grader-runtime-escalation

## Description
"wire the grader into the runtime escalation"

Clarifications established this session:

- The three-tier inference ladder lives in `src/content/index.ts` (~line
  192-222): local heuristics (`inferTree`) run first; if `recipe.confidence`
  is below `CLAUDE_THRESHOLD` (0.6), a Claude-assisted pass (`askClaude` ->
  `treeFromPlan`) runs and its result replaces the heuristic one only if
  `viaClaude.confidence >= recipe.confidence`; if no root ever forms,
  `flatTree` is the last resort.
- `Recipe.confidence` is a pure coverage metric (`matched / total` ingredient
  lines a step claimed) — it says nothing about whether an ingredient was
  attached to the *right* operation.
- That gap shipped a real bug: a card told the user to cook and microwave a
  Greek-yogurt sauce the recipe only refrigerated, and to serve ground beef
  raw. It scored 79% confidence — above threshold — so it never escalated.
- A card grader (`src/core/grade.ts`, PR #3 and a follow-up) exports
  `gradeCard(recipe, raw, options)` / `gradeByTier(...)` -> `Finding[]` /
  `Record<Tier, Finding[]>`, with rule IDs across three tiers: **S**
  (structural — the card cannot be drawn), **F** (faithfulness — it is drawn
  but says something false), **L** (legibility — true but unpleasant). It is
  pure (no DOM/`chrome.*`), documented in `docs/recipe-card-rules.md`, and
  today is called only from tests (`tests/core/grade.test.ts`,
  `tests/sites.test.ts`).
- The goal: make the grader's verdict participate in the runtime escalation
  decision — both whether a second (Claude) pass runs, and which candidate
  result wins — rather than leaving that decision to confidence alone.

See `docs/plans/2026-07-29-grader-runtime-escalation/prd.md` for the detailed
scope and acceptance criteria worked out this session.

## Stated goal
Wire `src/core/grade.ts`'s grading output into the escalation decision in
`src/content/index.ts`, so the grader's verdict — not `Recipe.confidence`
alone — determines whether a second inference pass runs and which result is
kept.

## Inferred goal
Stop cards that are confidently *wrong* (like the yogurt/beef example) from
reaching the person reading the card while they cook, without materially
increasing the number of paid Claude calls made on their behalf for cards
that are merely unpolished rather than untrue.

## Acceptance signals
- A card graded with a structural or faithfulness finding no longer ships to
  the user on confidence alone — a second inference pass is attempted first.
- When both a heuristic and a Claude-produced result exist, the one with
  fewer/no structural or faithfulness findings wins, even if its confidence
  score is lower.
- Cards graded with only legibility findings do not, by themselves, trigger
  an extra Claude call.
- (Open) Whether the on-screen confidence badge (`confidenceNote` in
  `src/core/render.ts`) also reflects grader findings, or continues to
  reflect coverage alone.

## Open assumptions
- This work is confined to the Reduction repository; the description names
  no other repo.
- Which tier(s) — S, F, L — participate in the *trigger* decision versus the
  *selection* (tie-break) decision is left open; the background notes these
  carry different semantics (structural = undrawable, faithfulness = untrue,
  legibility = cosmetic) and explicitly should not be assumed uniform.
- No numeric cost/latency budget was given for additional Claude calls;
  absent one, the design should avoid increasing calls-per-card beyond
  today's single optional escalation unless justified.
- The existing `CLAUDE_THRESHOLD` (0.6) and confidence-based fallback
  structure are assumed to persist alongside the grader's input, not
  necessarily be removed, unless research/design finds reason otherwise.
