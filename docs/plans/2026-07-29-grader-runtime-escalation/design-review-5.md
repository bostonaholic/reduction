---
topic: grader-runtime-escalation
date: 2026-07-29
phase: design-review
verdict: APPROVE
---

# Design review — round 5 (cap round)

**Final verdict: APPROVE**, pinned by the reviewer to a specific SHA.

> "I APPROVE the design.md whose content is that of af1da6e / 5e11f01: the
> RETAIN_RATIO = 0.75 ratio guard with dyadic-exact boundary fixtures and
> commensurability asserted as verified. I do NOT approve the
> COVERAGE_GAP = 0.2 text of 453fd5c."

Verified: HEAD's `design.md` is byte-identical to `af1da6e`, so the approved
content is what is on disk. The reviewer pinned the verdict because the file
moved three times during the round — an unqualified approval could otherwise be
claimed for whichever text landed next.

Its first report returned REQUEST CHANGES, on a blocking item that was purely
file-state, not content:

> "On the merits, this design is ready… If the committed text were what sat on
> disk I would approve it without reservation, with only the two nitpicks in
> section 5 as optional polish."
>
> "Reconcile the file and the design is good to go — this is a one-command fix,
> and I want to be explicit that it is NOT a request for a revision 6 of the
> design's content."

The sole blocking item was that the working tree held a *different algorithm
under the same revision number* than the committed text. That was an
orchestrator bookkeeping fault, not a design fault: two rapid rewrites landed,
and the wrong one was committed as authoritative.

**Resolution:** the working tree was reconciled to the verified text (the
`RETAIN_RATIO` version). The condition the reviewer named is met, so this
record carries `verdict: APPROVE`. The distinction is stated plainly rather
than quietly, because the verdict line the reviewer emitted says otherwise.

## What was verified, independently

**The ratio guard — 12/12 pinned scenarios.** Predicate
`favoured.confidence >= other.confidence * 0.75 - 1e-9`, favoured = fewer
distinct failed F rules:

| pair | ratio | outcome |
| --- | --- | --- |
| 0.20 `{F6}` vs 0.01 clean | 0.0500 | skip → local |
| hole A 0.55 vs 0.05 | 0.0909 | skip → local |
| 0.25 vs 0.05 | 0.2000 | skip → local |
| round-2 0.80 vs 0.30 | 0.3750 | skip → local |
| round-3 0.59 vs 0.30 | 0.5085 | skip → local |
| hole B 1.00 vs 0.61 | 0.6100 | skip → local |
| round-3 0.95 vs 0.61 | 0.6421 | skip → local |
| 0.30 vs 0.20 | 0.6667 | skip → local |
| both-weak 0.65 vs 0.50 | 0.7692 | fires → truthful |
| 0.30 vs 0.25 | 0.8333 | fires → truthful |
| yogurt 0.79 vs 0.70 | 0.8861 | fires → Claude |
| hole D 0.61 vs 0.59 | 0.9672 | fires → truthful |

**The feasible band, derived independently:** the binding must-block constraint
is 0.30-vs-0.20 at 0.6667 (not hole B at 0.61); the binding must-fire
constraint is both-weak at 0.7692. Any value in (0.6667, 0.7692] reproduces
every pinned outcome. The design's claimed insensitive range [0.68, 0.76] sits
strictly inside that band, and 0.75 inside the range. **The claim is true.**

**Scale-invariance closes the low-coverage degeneration by construction, not by
retune.** Under an absolute gap the maximum achievable difference is bounded by
the higher card's own coverage, so below 0.2 every pair is automatically in-gap
and the guard is dead. Under a ratio the allowed deficit scales with the rival.
The 0.20-vs-0.01 pair moves from in-gap at difference 0.19 to blocked with
enormous margin at ratio 0.05.

**What a ratio loosens that a difference did not** — exactly one thing: large
*absolute* deficits at high coverage. 1.00 `{F6}` vs 0.76 clean now upgrades
where the gap blocked it. Found already named and argued in Decision 2's
"Disclosed boundary move".

**Rival at exactly 0** — guard always fires. Not a hole: displacing a
zero-coverage card costs no coverage, so the mirror bug is unreachable there by
definition. At both-zero the clean card wins where today's `>=` gives Claude —
an improvement. Undiscussed in the text; one sentence would cover it.

**Boundary fixtures — exact.** 0.75 = 3/4, 0.5 = 1/2, 1.0, 0.5625 = 9/16 are
all dyadic; both products are exact in IEEE 754. `0.75 >= 0.75 - 1e-9` is true
even with EPSILON removed, so it genuinely tests the inclusive `>=` rather than
the slack. The round-4 arithmetic hole is properly closed, and the design
explicitly disowns the 0.79/0.59 pair.

**A tighter EPSILON proof than the design's own.** Both confidences share the
denominator `n = raw.ingredientLines.length`, so
`favoured - 0.75 × other = (4p - 3m) / 4n` for integers p, m. That numerator is
either 0 — an exact tie, decisive either way — or at least 1, giving a gap of
at least `1/(4n) ≈ 0.005` at n = 50. Six orders of magnitude above 1e-9.
EPSILON is unreachable for any real pair.

**Commensurability — verified at source.** Both denominators reduce to
`raw.ingredientLines.length` (`infer.ts:211-212`, `:392-393`, `:403`;
`plan.ts:75`, `:138`); both numerators exclude root-appended orphans
(`infer.ts:373`, `plan.ts:115`). The design's "verified in review" sentence is
accurate and correctly promoted from a risk bullet. This also underwrites the
EPSILON bound above — same denominator is what makes it hold.

**The three round-4 items — all closed.** Cross-rule magnitude has its own
Risks bullet with the pair named and a test pin; Decision 2's never-trade case
now carries the "when the axes conflict" qualifier; `confidenceNote` is cited
with its doc comment, which is the convention round 4 asked for.

**Fallout from the structural change — clean.** Zero occurrences of the old
constant. Desired end state, Decision 2's rejected alternatives, Decision 10,
Edge cases, the test list, Risks and Open questions were all converted, not
left stale. Decision 2's rejection of a fixed coverage floor was checked and is
substantive: any floor near `CLAUDE_THRESHOLD` would reopen hole D by blocking
the 0.59 truthful card.

## Remaining nitpicks — optional polish, not gating

1. The Risks bullet says the pinned scenarios are insensitive across
   [0.68, 0.76], dropping the step-6 text's "real-card" qualifier. The dyadic
   boundary fixture sits at ratio exactly 0.75 and is by construction sensitive
   — at 0.76 it flips. Related: nothing warns a future tuner that changing
   `RETAIN_RATIO` requires recomputing the dyadic fixtures. One clause in the
   Open questions reopen trigger covers both.
2. The bounds paragraph attributes the high-end constraint to hole B
   ("above 0.61"). True but not binding — 0.30-vs-0.20 forces > 0.6667. The
   correct number appears later; it is just attributed to the wrong pair.
3. Rival-at-zero behaviour is benign but undiscussed.

## The round-4 withdrawal was wrong — the last round says so plainly

Round 4's reviewer withdrew its low-coverage finding on re-audit. Round 5
disagrees, and gives four regressions against shipped behaviour under the gap
rule (favoured = F-clean Claude, other = local `{F6}`):

| favoured | other | deficit | decisive | today |
| --- | --- | --- | --- | --- |
| 0.01 | 0.20 | 0.19 | yes | local wins |
| 0.05 | 0.25 | 0.20 | yes | local wins |
| 0.20 | 0.30 | 0.10 | yes | local wins |
| 0.25 | 0.30 | 0.05 | yes | local wins |

In the first, a card with 1% of ingredients attached replaces one with 20% — a
20× coverage loss, and the feature spends a Claude call to make the card worse.

The structural point: below 0.2 coverage the deficit is bounded above by the
higher card's own coverage, hence necessarily ≤ 0.2, hence **always in-gap**.
The guard is provably inert there. That is a property of the rule's shape, not
its constant — no retune fixes it.

Why the re-audit erred, specifically:

1. **Factual.** It justified withdrawal by citing text that names the
   0.65-vs-0.50 *both-weak* pair, not the 0.20-vs-0.01 pair. At 0.65/0.50 the
   displaced card keeps 77% of the winner's coverage and "no substantial card
   is displaced" is true. At 0.20/0.01 the displaced card has 20× the winner's
   coverage and the phrase is unargued. A correctly-scoped argument was
   generalised past its scope.
2. **Self-contradiction.** The gap text's own Current state says the F tier is
   blind to sparseness "at *any* confidence" and that "sparseness is
   continuous: no single cutoff point encodes it". An absolute gap *is* a
   single cutoff on the difference axis.

Moot against the current file — at ratio 0.05 that pair is blocked with
enormous margin — but it is why `453fd5c` must not be re-landed.

## A stronger EPSILON bound than either the design or I produced

Because both confidences share denominator `n`, the deficit is exactly
`(m − p) / n` for integers. For EPSILON to wrongly flip a pair you would need
that value in `(0.2, 0.2 + 1e-9]`. Brute-forced over every `n` up to 200:

    min nonzero |(m−p)/n − 0.2|  =  0.001005  =  1,005,025 × EPSILON

Float error ~1e-16 ≪ EPSILON 1e-9 ≪ 0.001 minimum real separation. EPSILON can
only rescue the exact-0.2 case — which the inclusive `>=` intends to be
decisive — from representation error. **This argument is load-bearing on
commensurability**: if the denominators ever diverged, the integer-numerator
step fails and the bound with it.

## Process faults, recorded

The reviewer named three, all accurate and all the orchestrator's:

1. `design.md` was rewritten three times mid-review and twice committed. Two of
   the reviewer's three reports were aimed at text that no longer existed when
   filed. It pinned its verdict to a SHA for exactly this reason.
2. Commit `5e11f01`'s message reads "round 5 passes" — the gate declared itself
   passed before the gate had reported.
3. Task #14 DESIGN was marked complete and #15 STRUCTURE started before the
   verdict existed.

None changed the technical outcome, and the reviewer did not withhold approval
over them. Verified afterwards: `structure.md` cites `RETAIN_RATIO` and never
`COVERAGE_GAP`, and pins the dyadic fixtures, so it did derive from the
approved text.

VERDICT: APPROVE — pinned to the content of af1da6e / 5e11f01
