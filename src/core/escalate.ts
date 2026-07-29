/**
 * The escalation policy: when to ask Claude, and which candidate to show.
 *
 * Pure functions over recipes and their graded findings — no DOM, no
 * `chrome.*`. Neither function throws, over any input combination.
 *
 * CONTRACT: graded records must come from an OPTIONS-FREE `gradeByTier`
 * call. The grader's `skip` filter runs after its S1/S2 short-circuit
 * check, so a skipped S1 or S2 reads as a clean record here and defeats
 * the unusable-card step of `pickBetter`.
 */

import { UNUSABLE_RULES, type Finding, type Tier } from './grade.js';
import type { Recipe } from './types.js';

/** Findings grouped by tier, as an options-free `gradeByTier` returns them. */
export type Graded = Record<Tier, Finding[]>;

/** Below this, the local heuristics are not trustworthy enough to show alone. */
export const CLAUDE_THRESHOLD = 0.6;

/**
 * The fraction of its rival's coverage a card must retain for having fewer
 * distinct failed F rules to be decisive. Chosen, not borrowed from
 * `CLAUDE_THRESHOLD`; a ratio rather than an absolute gap, because a fixed
 * gap degenerates at low coverage — where F-clean near-flat cards live.
 *
 * Bounds: the binding must-block scenario is 0.30-vs-0.20 (ratio > 0.6667;
 * hole B's 0.61 is true but not binding), and the binding must-fire is the
 * both-weak 0.65-vs-0.50 pair (ratio ≤ 0.7692). Every value in
 * [0.68, 0.76] picks the same winner in every pinned real-card scenario.
 * Retuning this constant requires recomputing the dyadic boundary fixtures
 * in tests/core/escalate.test.ts. When the rival sits at zero coverage the
 * guard always fires — benign, since displacing a zero-coverage card costs
 * nothing.
 */
export const RETAIN_RATIO = 0.75;

/**
 * Boundary slack only. Both confidences share the denominator
 * `raw.ingredientLines.length`, so any non-tie gap is at least `1/(4n)` —
 * orders of magnitude above this slack.
 */
export const EPSILON = 1e-9;

/**
 * Should the local card be escalated to Claude?
 *
 * True when coverage is below `CLAUDE_THRESHOLD` (strict), or when the
 * self-check found any structural or faithfulness problem. A null grade
 * reproduces today's confidence-only trigger exactly. Zero-ingredient
 * recipes grade vacuously clean and escalate on the confidence arm alone
 * (`inferTree` reports confidence 0 for them) — remove that arm and they
 * silently stop escalating.
 */
export function shouldEscalate(confidence: number, graded: Graded | null): boolean {
  if (confidence < CLAUDE_THRESHOLD) return true;
  return graded !== null && graded.S.length + graded.F.length > 0;
}

function isUnusable(graded: Graded): boolean {
  return graded.S.some((finding) => UNUSABLE_RULES.includes(finding.rule));
}

function distinctFailedRules(findings: Finding[]): number {
  return new Set(findings.map((f) => f.rule)).size;
}

/**
 * Pick the candidate to show, returning the winner AND the winner's own
 * graded record — so the badge can never name the losing card's findings.
 *
 * Seven steps; the first decisive one wins. The "confidence rule" is
 * today's shipped rule: Claude wins at equal-or-higher confidence.
 *
 *   1. Exactly one card has a root — it wins. Both rootless — confidence.
 *   2. Either grade null — confidence rule.
 *   3. Exactly one unusable (S1/S2) — the other wins.
 *   4. Both unusable — confidence rule.
 *   5. Exactly one carries any S finding — the S-free card wins,
 *      unconditionally, at any confidence distance.
 *   6. Fewer DISTINCT failed F rules is favoured; decisive only when the
 *      favoured card retains at least `RETAIN_RATIO` of its rival's
 *      coverage. Equal counts, or the guard unmet — fall through.
 *   7. Confidence rule.
 */
export function pickBetter(
  local: Recipe,
  localGraded: Graded | null,
  viaClaude: Recipe,
  claudeGraded: Graded | null,
): { recipe: Recipe; graded: Graded | null } {
  const localWins = { recipe: local, graded: localGraded };
  const claudeWins = { recipe: viaClaude, graded: claudeGraded };
  const byConfidence = () => (viaClaude.confidence >= local.confidence ? claudeWins : localWins);

  // 1 — a card with no root cannot be laid out at all.
  if (local.root && !viaClaude.root) return localWins;
  if (viaClaude.root && !local.root) return claudeWins;
  if (!local.root && !viaClaude.root) return byConfidence();

  // 2 — with a grade missing there is nothing to compare on.
  if (!localGraded || !claudeGraded) return byConfidence();

  // 3, 4 — an S1/S2 card is invalid, not merely low-scoring.
  const localUnusable = isUnusable(localGraded);
  const claudeUnusable = isUnusable(claudeGraded);
  if (localUnusable !== claudeUnusable) return localUnusable ? claudeWins : localWins;
  if (localUnusable) return byConfidence();

  // 5 — any other structural finding still loses to a structurally clean card.
  const localHasS = localGraded.S.length > 0;
  const claudeHasS = claudeGraded.S.length > 0;
  if (localHasS !== claudeHasS) return localHasS ? claudeWins : localWins;

  // 6 — fewer distinct failed F rules, guarded by coverage retention.
  const localF = distinctFailedRules(localGraded.F);
  const claudeF = distinctFailedRules(claudeGraded.F);
  if (localF !== claudeF) {
    const [favoured, other] = localF < claudeF ? [localWins, claudeWins] : [claudeWins, localWins];
    if (favoured.recipe.confidence >= other.recipe.confidence * RETAIN_RATIO - EPSILON) {
      return favoured;
    }
  }

  // 7
  return byConfidence();
}
