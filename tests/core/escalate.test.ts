/**
 * The escalation policy: `shouldEscalate` and `pickBetter`.
 *
 * Five rounds of adversarial design review produced twelve pinned numeric
 * scenarios for the step-6 selection rule, each a concrete input pair with a
 * stated expected winner (design.md, Testing; verified in design-review-5.md).
 * Every one is a regression test here — several encode fixes against today's
 * shipped behaviour, and losing any of them loses the reason this feature
 * exists. Do not substitute, drop, or "simplify" any pinned pair.
 *
 * The step-6 boundary is pinned with DYADIC fixtures only (0.75 vs 1.0 →
 * boundary exactly 0.75; 0.5 vs 0.75 → boundary 0.5625) — all values and
 * both products exact in IEEE 754. Decimal pairs like 0.79/0.59 must never
 * be used as boundary pins: IEEE 754 decides their side (the round-4
 * finding). `EPSILON` absorbs rounding for the real-world ratios.
 *
 * `pickBetter` returns the winner AND the winner's own graded record, so the
 * badge can never name the losing card's findings — asserted by identity.
 */

import { describe, expect, it } from 'vitest';
import { pickBetter, shouldEscalate, type Graded } from '../../src/core/escalate.js';
import type { RuleId, Tier } from '../../src/core/grade.js';
import type { Recipe, RecipeNode } from '../../src/core/types.js';

// ---------------------------------------------------------------------------
// Fixtures — pickBetter reads only `root` nullness and `confidence`
// ---------------------------------------------------------------------------

const LEAF: RecipeNode = {
  kind: 'ingredient',
  ingredient: { raw: '1 cup plain Greek yogurt', name: 'plain Greek yogurt', quantity: 1, unit: 'cup' },
};

function rec(confidence: number, root: RecipeNode | null = LEAF): Recipe {
  return {
    title: 'Pita Wraps',
    banners: [],
    root,
    sourceUrl: 'https://example.test/x',
    extraction: 'json-ld',
    inference: 'heuristic',
    confidence,
  };
}

function graded(rules: RuleId[]): Graded {
  const out: Graded = { S: [], F: [], L: [] };
  rules.forEach((rule, i) => out[rule[0] as Tier].push({ rule, detail: `${rule} finding ${i}` }));
  return out;
}

const CLEAN = graded([]);

function expectWinner(
  result: { recipe: Recipe; graded: Graded | null },
  recipe: Recipe,
  gradedRecord: Graded | null,
): void {
  expect(result.recipe).toBe(recipe);
  expect(result.graded).toBe(gradedRecord);
}

// ---------------------------------------------------------------------------
// shouldEscalate — the truth table
// ---------------------------------------------------------------------------

describe('shouldEscalate', () => {
  it('escalates F6 at 0.79 — the yogurt trigger, a regression against today', () => {
    expect(shouldEscalate(0.79, graded(['F6']))).toBe(true);
  });

  it('never calls for L-only findings', () => {
    expect(shouldEscalate(0.9, graded(['L1']))).toBe(false);
  });

  it('escalates on an S finding regardless of confidence', () => {
    expect(shouldEscalate(0.9, graded(['S1']))).toBe(true);
  });

  it('does not call at exactly 0.6 with a clean grade — strict < at the boundary', () => {
    expect(shouldEscalate(0.6, CLEAN)).toBe(false);
  });

  it('calls below 0.6 with a clean grade — the confidence arm', () => {
    expect(shouldEscalate(0.59, CLEAN)).toBe(true);
  });

  it("reproduces today's confidence-only trigger when the grade is null", () => {
    expect(shouldEscalate(0.6, null)).toBe(false);
    expect(shouldEscalate(0.59, null)).toBe(true);
  });

  it('zero-ingredient: the confidence arm fires and the grading arm is blind', () => {
    // A rootless zero-ingredient card grades vacuously clean; escalation
    // rides on the confidence arm alone (infer.ts returns confidence 0).
    // Remove that arm and this case silently stops escalating.
    const vacuous = graded([]);
    expect(shouldEscalate(0, vacuous)).toBe(true); // the confidence arm does the work
    expect(shouldEscalate(0.6, vacuous)).toBe(false); // the grading arm sees nothing
  });
});

// ---------------------------------------------------------------------------
// pickBetter — one test per step
// ---------------------------------------------------------------------------

describe('pickBetter step 1 — the root check is the single authority', () => {
  it('a rooted local card beats a rootless Claude card at any confidence', () => {
    const local = rec(0.1);
    const localGraded = graded(['S4']);
    const viaClaude = rec(0.9, null);
    expectWinner(pickBetter(local, localGraded, viaClaude, graded([])), local, localGraded);
  });

  it('a rooted Claude card beats a rootless local card at any confidence', () => {
    const local = rec(0.9, null);
    const viaClaude = rec(0.1);
    const claudeGraded = graded(['S4']);
    expectWinner(pickBetter(local, graded([]), viaClaude, claudeGraded), viaClaude, claudeGraded);
  });

  it('both rootless falls back to the confidence rule, ties to Claude', () => {
    const local = rec(0.5, null);
    const localGraded = graded([]);
    const viaClaude = rec(0.4, null);
    expectWinner(pickBetter(local, localGraded, viaClaude, graded([])), local, localGraded);

    const tiedLocal = rec(0.5, null);
    const tiedClaude = rec(0.5, null);
    const tiedClaudeGraded = graded([]);
    expectWinner(pickBetter(tiedLocal, graded([]), tiedClaude, tiedClaudeGraded), tiedClaude, tiedClaudeGraded);
  });
});

describe('pickBetter step 2 — a null grade falls back to the confidence rule', () => {
  it('local at 0.8 with a null grade beats a graded Claude at 0.7 — and carries its null grade', () => {
    const local = rec(0.8);
    const viaClaude = rec(0.7);
    expectWinner(pickBetter(local, null, viaClaude, graded([])), local, null);
  });

  it('a confidence tie with one null grade goes to Claude', () => {
    const local = rec(0.7);
    const viaClaude = rec(0.7);
    const claudeGraded = graded([]);
    expectWinner(pickBetter(local, null, viaClaude, claudeGraded), viaClaude, claudeGraded);
  });

  it("both grades null reproduces today's rule exactly", () => {
    const local = rec(0.7);
    const viaClaude = rec(0.6);
    expectWinner(pickBetter(local, null, viaClaude, null), local, null);

    const tiedLocal = rec(0.6);
    const tiedClaude = rec(0.6);
    expectWinner(pickBetter(tiedLocal, null, tiedClaude, null), tiedClaude, null);
  });
});

describe('pickBetter steps 3 and 4 — unusable cards', () => {
  it('round-1: an unusable card loses even to a card carrying S and F findings', () => {
    const local = rec(0.9);
    const viaClaude = rec(0.3);
    const claudeGraded = graded(['S4', 'F3', 'F5', 'F6']);
    expectWinner(pickBetter(local, graded(['S1']), viaClaude, claudeGraded), viaClaude, claudeGraded);
  });

  it('both unusable falls back to the confidence rule', () => {
    const local = rec(0.5);
    const localGraded = graded(['S1']);
    const viaClaude = rec(0.4);
    expectWinner(pickBetter(local, localGraded, viaClaude, graded(['S2'])), local, localGraded);
  });
});

describe('pickBetter step 5 — no-S beats any-S, presence, unconditional', () => {
  it('a sparse S-clean card beats a rich one-S card at any confidence distance — pinned deliberate', () => {
    const local = rec(0.95);
    const viaClaude = rec(0.3);
    const claudeGraded = graded([]);
    expectWinner(pickBetter(local, graded(['S4']), viaClaude, claudeGraded), viaClaude, claudeGraded);
  });
});

// ---------------------------------------------------------------------------
// pickBetter step 6 — the twelve pinned scenarios
//
// Local carries the F findings; Claude is F-clean. Ratios are
// favoured/other where favoured has fewer distinct failed F rules;
// step 6 is decisive iff the favoured card retains >= RETAIN_RATIO of
// its rival's coverage. Winners verified in design-review-5.md.
// Rows 9-12 are regressions against today, which keeps local in all 12.
// ---------------------------------------------------------------------------

describe('pickBetter step 6 — the twelve pinned pairs', () => {
  const PINNED: Array<{
    n: number;
    local: number;
    rules: RuleId[];
    claude: number;
    ratio: string;
    winner: 'local' | 'claude';
    name: string;
  }> = [
    { n: 1, local: 0.2, rules: ['F6'], claude: 0.01, ratio: '0.0500', winner: 'local', name: 'round-4 low-coverage' },
    { n: 2, local: 0.55, rules: ['F6'], claude: 0.05, ratio: '0.0909', winner: 'local', name: 'hole A' },
    { n: 3, local: 0.25, rules: ['F6'], claude: 0.05, ratio: '0.2000', winner: 'local', name: 'round-4 low-coverage' },
    { n: 4, local: 0.8, rules: ['F6'], claude: 0.3, ratio: '0.3750', winner: 'local', name: 'round-2 mirror' },
    { n: 5, local: 0.59, rules: ['F6'], claude: 0.3, ratio: '0.5085', winner: 'local', name: 'round-3 mirror' },
    { n: 6, local: 1.0, rules: ['F6'], claude: 0.61, ratio: '0.6100', winner: 'local', name: 'hole B' },
    { n: 7, local: 0.95, rules: ['F6'], claude: 0.61, ratio: '0.6421', winner: 'local', name: 'round-3 mirror' },
    { n: 8, local: 0.3, rules: ['F6'], claude: 0.2, ratio: '0.6667', winner: 'local', name: 'guard skips' },
    { n: 9, local: 0.65, rules: ['F6'], claude: 0.5, ratio: '0.7692', winner: 'claude', name: 'both-weak, deliberate' },
    { n: 10, local: 0.3, rules: ['F6'], claude: 0.25, ratio: '0.8333', winner: 'claude', name: 'guard fires' },
    { n: 11, local: 0.79, rules: ['F6'], claude: 0.7, ratio: '0.8861', winner: 'claude', name: 'the yogurt fix' },
    {
      n: 12,
      local: 0.61,
      rules: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7'],
      claude: 0.59,
      ratio: '0.9672',
      winner: 'claude',
      name: 'hole D, straddles the old threshold',
    },
  ];

  for (const row of PINNED) {
    it(`#${row.n}: ${row.local} {${row.rules.join(',')}} vs ${row.claude} clean — ratio ${row.ratio} → ${row.winner} (${row.name})`, () => {
      const local = rec(row.local);
      const localGraded = graded(row.rules);
      const viaClaude = rec(row.claude);
      const claudeGraded = graded([]);
      const result = pickBetter(local, localGraded, viaClaude, claudeGraded);
      if (row.winner === 'local') expectWinner(result, local, localGraded);
      else expectWinner(result, viaClaude, claudeGraded);
    });
  }
});

// ---------------------------------------------------------------------------
// pickBetter step 6 — comparator and boundary pins
// ---------------------------------------------------------------------------

describe('pickBetter step 6 — distinct failed F rules, not raw finding counts', () => {
  it('rulebook pair: {F7,F7,F7} (1 distinct) beats {F3,F6} (2 distinct) at equal confidence — agreeing with §5', () => {
    const local = rec(0.8);
    const localGraded = graded(['F7', 'F7', 'F7']);
    const viaClaude = rec(0.8);
    expectWinner(pickBetter(local, localGraded, viaClaude, graded(['F3', 'F6'])), local, localGraded);
  });

  it('magnitude inversion: {F3×30, F6×30} (2 distinct) beats {F3,F5,F6} (3 distinct) in-ratio — pinned deliberate', () => {
    const sixty = [...Array(30)].flatMap((): RuleId[] => ['F3', 'F6']);
    const local = rec(0.8);
    const localGraded = graded(sixty);
    const viaClaude = rec(0.8);
    expectWinner(pickBetter(local, localGraded, viaClaude, graded(['F3', 'F5', 'F6'])), local, localGraded);
  });
});

describe('pickBetter step 6 — the dyadic boundary', () => {
  // The only legitimate boundary fixtures: every value and both products
  // are exactly representable in IEEE 754. Decimal pairs (e.g. 0.79/0.59)
  // must NOT be used here — IEEE 754 decides their side (round-4 finding).

  it('favoured 0.75 vs rival 1.0 sits exactly on the boundary and is decisive — inclusive >=', () => {
    const local = rec(0.75);
    const localGraded = graded([]);
    const viaClaude = rec(1.0);
    // The favoured F-clean card wins despite lower confidence.
    expectWinner(pickBetter(local, localGraded, viaClaude, graded(['F6'])), local, localGraded);
  });

  it('favoured 0.5 vs rival 0.75 — boundary 0.5625 — is not decisive; the confidence rule settles it', () => {
    const local = rec(0.5);
    const viaClaude = rec(0.75);
    const claudeGraded = graded(['F6']);
    expectWinner(pickBetter(local, graded([]), viaClaude, claudeGraded), viaClaude, claudeGraded);
  });

  it('rival at zero coverage: the guard always fires, benign — clean 0.05 displaces {F6} at 0.0', () => {
    const local = rec(0);
    const viaClaude = rec(0.05);
    const claudeGraded = graded([]);
    expectWinner(pickBetter(local, graded(['F6']), viaClaude, claudeGraded), viaClaude, claudeGraded);
  });

  it('both at zero coverage: the clean card wins — pinned as an improvement', () => {
    const local = rec(0);
    const viaClaude = rec(0);
    const claudeGraded = graded([]);
    expectWinner(pickBetter(local, graded(['F6']), viaClaude, claudeGraded), viaClaude, claudeGraded);
  });
});

describe('pickBetter step 7 — the confidence rule settles the rest', () => {
  it('a full tie, both clean, goes to Claude — >= preserved', () => {
    const local = rec(0.7);
    const viaClaude = rec(0.7);
    const claudeGraded = graded([]);
    expectWinner(pickBetter(local, graded([]), viaClaude, claudeGraded), viaClaude, claudeGraded);
  });
});

// ---------------------------------------------------------------------------
// Totality — neither function throws, over any input combination
// ---------------------------------------------------------------------------

describe('totality', () => {
  const gradeds: Array<Graded | null> = [
    null,
    graded([]),
    graded(['S1']),
    graded(['S2']),
    graded(['S4', 'F6']),
    graded(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7']),
    graded(['L1']),
  ];
  const confidences = [0, 0.3, 0.6, 0.75, 1];

  it('shouldEscalate never throws', () => {
    for (const confidence of confidences) {
      for (const g of gradeds) {
        expect(() => shouldEscalate(confidence, g)).not.toThrow();
      }
    }
  });

  it('pickBetter never throws', () => {
    const roots: Array<RecipeNode | null> = [LEAF, null];
    for (const localRoot of roots) {
      for (const claudeRoot of roots) {
        for (const localGraded of gradeds) {
          for (const claudeGraded of gradeds) {
            for (const localConf of confidences) {
              for (const claudeConf of confidences) {
                expect(() =>
                  pickBetter(rec(localConf, localRoot), localGraded, rec(claudeConf, claudeRoot), claudeGraded),
                ).not.toThrow();
              }
            }
          }
        }
      }
    }
  });
});
