---
topic: grader-runtime-escalation
date: 2026-07-29
phase: design-review
verdict: REQUEST CHANGES
---

# Design review — round 4 (cap round)

Closure audit against revision 4 (amended). Most of round 3 is genuinely
closed and verified at source. Two blocking-tier items remain.

## HOLE 1 (blocking) — the gap has no coverage floor

`COVERAGE_GAP` is an **absolute** difference, but the maximum achievable
difference is bounded above by the higher card's confidence. So in the
low-coverage region every pair is automatically in-gap, the guard cannot fire,
and step 6 decides on F-count alone:

- local `0.20` `{F6}` vs Claude `0.01` clean → gap `0.19 ≤ 0.2` → step 6
  decisive → **Claude wins with 99% of ingredients hanging off the root**.
  `src/content/index.ts:211` today keeps the local card. Regression.
- local `0.25` `{F6}` vs Claude `0.05` clean → gap `0.20` → same outcome. This
  is 3b's Hole A pair shifted down 0.30; nothing about the pathology changed,
  only the arithmetic that happened to save the pinned instance.

Two things make this the round-3 finding rather than a new nitpick: a near-flat
card is low-coverage *by definition*, so F-clean near-flat cards live exactly
here; and Decision 1 argues sub-0.6 means "the S/F tiers cannot see
sparseness" — **the design's own rationale is strongest in the region its guard
is weakest**.

Every pinned scenario sits at gap 0.09, 0.29, 0.34 or 0.50. There is no test
anywhere below 0.55 coverage, so the suite would not catch it.

**Closing it needs one more clause — a floor on the favoured card's own
coverage, or a relative rather than absolute gap — not a different constant.**

## HOLE 2 (blocking-tier) — the stated boundary is arithmetically wrong

Edge cases says "Gap exactly `COVERAGE_GAP` (0.79 vs 0.59) → step 6 decisive",
and Testing pins "gap-edge pair (0.79/0.59 decisive, 0.80/0.59 not)".

Checked in node: `0.79 - 0.59 === 0.20000000000000007`, which is `> 0.2`. The
guard skips and **the pinned test fails as specified**. Confidence values are
ratios, so exact decimal boundaries are unreachable in general. Needs an
explicit tolerance, a restated predicate, or boundary fixtures chosen from
representable ratios.

## HOLE 3 (suggestion) — distinct-rule counting inverts magnitude

`{F3×30, F6×30}` (2 rules, 60 false statements) beats `{F3, F5, F6}` (3 rules,
3 statements) at in-gap confidence. Rulebook-consistent (7/9 vs 6/9), so
probably not wrong — but it is the exact mirror of the complaint that produced
the change, and only the within-one-rule case is disclosed. Step 5's analogous
deliberate consequence gets a Risks bullet; this should too.

## HOLE 4 (nitpick)

`confidenceNote` is cited as `src/core/render.ts:45-65`; it starts at `:44`.

## Closed and verified

| Round-3 finding | Status |
| --- | --- |
| 3a-1 band fixes instance not class | PARTIAL — band gone, guard fires at any position; class survives via HOLE 1 |
| 3a-2 `:151` citation contradicted the rule | CLOSED — now counts distinct rules; rulebook pair agrees with §5 |
| 3a-3 `shouldEscalate` false at zero ingredients | CLOSED — grading arm named blind, confidence arm does the work, which arm fires is pinned |
| 3a-4 `graded` unstated on other paths | CLOSED — five-row lifecycle table |
| 3a-5 step 1 half-unreachable | CLOSED — outer guard dropped, and non-regression **verified by tracing** `infer.ts:374-393`: local-rootless ⟹ confidence 0 ⟹ today's rule already gave Claude the win |
| 3a-6 `MAX_LABEL` | CLOSED |
| 3b-A both below (0.55 vs 0.05) | CLOSED for that pair only — gap 0.50 happens to be large |
| 3b-B both above (1.00 vs 0.61) | CLOSED — gap 0.39 |
| 3b-C cliff | RELOCATED to the gap boundary, disclosed and probed both sides — but see HOLE 2 |
| 3b-D step 7 truth-blind | **CLOSED — revision 4's best win.** 0.61 `{F1..F7}` vs 0.59 clean: gap 0.02 ≤ 0.2 → step 6 decisive → Claude wins. Seven falsehoods no longer ship over a truthful card 0.02 behind |
| 3b-E predicate literal | CLOSED (modulo HOLE 2) |
| 3b unprobed: commensurability | **CLOSED** — verified independently: `buildMatchers` maps 1:1 over lines with no filtering, `plan.ts:75` maps the same array; numerators both exclude root-appended orphans. Same measurement, so a constant on their difference is meaningful |

## On the constant

`COVERAGE_GAP = 0.2` **is** the invented constant Decision 2 rejected two
revisions ago, and the design says so in both places rather than hiding it. The
bounds arithmetic was checked and is honest: below 0.29 required by the pinned
gaps, above ~0.1 required by the yogurt gap of 0.09, and the claimed insensitive
range [0.15, 0.25] genuinely picks the same winner in all six pinned scenarios.

Its blind spot is that it is **calibrated entirely on high-coverage pairs** —
which is HOLE 1.

VERDICT: REQUEST CHANGES
