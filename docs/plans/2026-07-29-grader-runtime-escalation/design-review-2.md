---
topic: grader-runtime-escalation
date: 2026-07-29
phase: design-review
verdict: REQUEST CHANGES
---

# Design review — round 2

Two reviewers ran against `design.md` revision 2, with different briefs:

| Reviewer | Brief | Verdict |
| --- | --- | --- |
| 2a | Fresh adversarial review, deliberately blind to round 1 | **REQUEST CHANGES** |
| 2b | Audit each round-1 finding for closure | **APPROVE** |

**The round verdict is REQUEST CHANGES.** 2b confirms revision 2 closed
everything round 1 raised and regressed nothing — that is real progress. But
2a, looking with fresh eyes, found a correctness hole nobody had looked for.
An audit of old findings cannot clear a new one.

## The new blocking finding — 2a

**Step 4's F-count comparison is blind to coverage**, and it is blind to
exactly the signal Decision 1 already identifies as invisible to S and F.

Concrete failure (`design.md:120-126`):

- **Local:** good tree, all 10 ingredient lines present, 8 attached to steps →
  `confidence 0.80`, graded `{S:[], F:[F6], L:[]}`. This is the shipped yogurt
  bug — one real falsehood, otherwise a good card.
- **Claude:** an op for every source step, so `F3` stays clean
  (`src/core/grade.ts:369-379`), but 7 of 10 ingredients hang directly off the
  root. Root children are exempt from `F7` (`src/core/grade.ts:452`), and
  unclaimed ingredients are appended rather than dropped, so `F1`/`F2` stay
  clean (`docs/recipe-card-rules.md:233-235`). Result: `confidence 0.30`,
  graded `{S:[], F:[], L:[L7]}`.

Step 4 picks Claude — 0 F beats 1 F, and confidence is never consulted. The
user loses a mostly-correct card and gets something one step from the flat
table.

Decision 1 (`design.md:186-194`) already names this blindness — "sub-0.6
coverage … which the S/F tiers do not fully re-detect (orphan rate is L7)" —
and uses it to justify keeping the confidence *trigger*. The same argument
applies to *selection*, where the consequence is worse. The design does not
apply it. The Risks bullet at `:338-343` describes a different mechanism (a
rule that over-fires), not this one.

Needs a floor — a card cannot win on F-count if its confidence is more than X
below the loser's — or an explicit, argued acceptance that F-count outranks
coverage unconditionally.

## Also raised by 2a

- **issue** — "a rootless card can never beat a drawable one" (`:48-52`) is
  asserted but not enforced. `pickBetter` has no root check; the invariant
  rests on S1 firing, and S1 is silent when `raw.ingredientLines.length === 0`
  (`src/core/grade.ts:170-177`). Extraction does not guarantee ingredients —
  `src/core/extract.ts:322` accepts `ingredientLines.length > 0 || stepTexts.length > 0`.
  Such a page grades `{S:[], F:[], L:[]}` (both checks return `[]` on a null
  root, `:324`, `:487`), which step 4 reads as the *best possible* grade.
  Narrow reachability, but an invariant that holds by luck of an unstated
  precondition breaks quietly later.
- **issue** — the emptiness-ambiguity argument (`:99-103`) is narrower than
  stated. It holds only because the caller passes no `skip`. `gradeCard`
  computes `unusable` at `:610` and applies the skip filter at `:615` —
  *after*. A caller passing `skip: ['S1']` gets `{S:[], F:[], L:[]}` for a
  rootless card: indistinguishable from clean, defeating `UNUSABLE_RULES`
  detection at step 2. The design single-sources `UNUSABLE_RULES` so it cannot
  drift, then leaves the load-bearing precondition unwritten.
- **suggestion** — an over-firing S or F rule is a *cost* risk, not only a
  quality risk. If one rule over-fires broadly, `shouldEscalate` becomes
  effectively unconditional and every card on every open costs a Claude call.
  Decision 9 accepts that for one sticky page; the systemic version is a
  different magnitude.
- **suggestion** — the "no unit harness" justification for leaving `run()`
  untested (`:321-327`) is overstated: `tests/e2e/golden.spec.ts:54-63` loads a
  fixture and `page.evaluate`s the real `dist/content.js`. There `chrome` is
  undefined, so `askClaude` returns `null` (`src/content/index.ts:187-189`). A
  golden fixture tripping an F rule would exercise `tryGrade`,
  `shouldEscalate`, the null path and the badge in a real DOM, with no
  `chrome.*` mocking. All three PRD acceptance criteria are `run()` behaviour.
- **suggestion** — Decision 5 states no cost, unlike every other decision. Its
  real cost: a flat-fallback card may carry F findings the user is never told
  about.
- **nitpick** — "no render snapshots exist" (`:166`) is inaccurate;
  `tests/e2e/golden.spec.ts:71-73` snapshots `.rd-table`. The intended claim
  (`confidenceNote` is not snapshotted) is true; the sentence is not.
- **nitpick** — `tests/sites.test.ts:79-90` (`:287-288`) folds in the L-tier
  test; S/F assertions are `:79-84`.
- **nitpick** — finding `detail` length is unbounded in the badge note.
  Details embed raw ingredient lines verbatim (`grade.ts:213`, `:344`, `:578`);
  operations cap at 58 chars (`:62`), ingredient lines do not.

**2a's citation audit:** 24 references checked, every one resolves and says
what the document claims. No false citations.

**2a did not cover:** `src/core/plan.ts` and `src/core/infer.ts` in full — the
confidence formulas were grepped, not read in context, so the orphan scenario
is reasoned from the grader's carve-outs rather than executed.

## 2b — closure audit, all CLOSED

Every round-1 finding closed, verified at source rather than taken on the
document's word. The blocking one traced through `gradeCard`, `checkStructure`,
`treeFromPlan`, `flatTree` and `run()`; two escape hatches probed and sealed
(both-unusable falls to confidence; the zero-ingredient case cannot produce a
rooted Claude rival, so `pickBetter` never runs).

Two new nitpicks from 2b:

- `:115-116` justifies step 2 partly with "an unusable card is headed for
  `flatTree` or the error panel anyway" — true for S1, **false for S2**: a
  cyclic card has a root and renders today.
- `:82` heads the change "one new export, no rule changes", but naming the
  short-circuit set implies a behaviour-preserving edit to `gradeCard`'s body,
  not purely an addition. The implementer should know.

VERDICT: REQUEST CHANGES
