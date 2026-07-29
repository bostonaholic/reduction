/**
 * One test per rule in docs/recipe-card-rules.md.
 *
 * Each rule gets a card that violates it and, where the distinction matters, a
 * neighbouring card that must NOT trip it — the near-miss is what stops a rule
 * being a blunt instrument.
 *
 * F8 and F9 are absent on purpose: deciding whether two operations are truly
 * order-independent needs a human-authored reference card, so there is nothing
 * for code to assert. The rule-set tests at the bottom pin that omission so it
 * stays deliberate rather than becoming an oversight.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMITS,
  NEEDS_REFERENCE_CARD,
  gradeByTier,
  gradeCard,
  tierOf,
  type Finding,
  type RuleId,
} from '../../src/core/grade.js';
import { inferTree } from '../../src/core/infer.js';
import { parseIngredient } from '../../src/core/ingredient.js';
import { layout } from '../../src/core/layout.js';
import type { Grid, RawRecipe, Recipe, RecipeNode } from '../../src/core/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LINES = [
  '1 lb ground beef (85% lean)',
  '4 large pita bread rounds',
  '1 cup plain Greek yogurt',
  '1 cucumber, diced',
  '2 cloves garlic, minced',
  '1 tsp dried oregano',
  '2 tbsp olive oil',
];

const STEPS = [
  'In a bowl, mix Greek yogurt, minced garlic, a pinch of salt, and a squeeze of lemon juice to make the sauce. Refrigerate until ready to use.',
  'Heat olive oil in a skillet over medium heat. Add ground beef, breaking it up with a spoon. Cook until browned, about 8-10 minutes.',
  'Stir in oregano and pepper. Cook for another 2 minutes until fragrant, then remove from heat.',
  'Warm the pita bread in a dry skillet or microwave for 20-30 seconds until soft and pliable.',
  'Assemble wraps by spreading a spoonful of yogurt sauce on each pita, adding ground beef and cucumber, and serve.',
];

const [BEEF, PITA, YOGURT, CUCUMBER, GARLIC, OREGANO, OIL] = LINES;

function raw(over: Partial<RawRecipe> = {}): RawRecipe {
  return { title: 'Pita Wraps', ingredientLines: LINES, stepTexts: STEPS, strategy: 'json-ld', ...over };
}

function ing(line: string): RecipeNode {
  return { kind: 'ingredient', ingredient: parseIngredient(line) };
}

function op(label: string, sourceStep: number, ...children: RecipeNode[]): RecipeNode {
  return { kind: 'op', label, children, sourceStep };
}

function card(root: RecipeNode | null, over: Partial<Recipe> = {}): Recipe {
  return {
    title: 'Pita Wraps',
    banners: [],
    root,
    sourceUrl: 'https://example.test/x',
    extraction: 'json-ld',
    inference: 'heuristic',
    confidence: 1,
    ...over,
  };
}

/** One leaf per source line, so a card need not repeat the text. */
const leaf = Object.fromEntries(LINES.map((l) => [l, ing(l)])) as Record<string, RecipeNode>;

/** The card the inference produces today — the clean baseline. */
function goodCard(): Recipe {
  return inferTree(raw(), 'https://example.test/x');
}

function rules(findings: Finding[]): RuleId[] {
  return [...new Set(findings.map((f) => f.rule))].sort() as RuleId[];
}

/** Assert a rule fires, and that its message names something useful. */
function expectRule(findings: Finding[], rule: RuleId, mentioning?: RegExp): void {
  expect(rules(findings)).toContain(rule);
  if (mentioning) expect(findings.find((f) => f.rule === rule)!.detail).toMatch(mentioning);
}

// ---------------------------------------------------------------------------
// Tier S — structural
// ---------------------------------------------------------------------------

describe('S1 — a single root', () => {
  it('flags a card with no root when the recipe had ingredients', () => {
    expectRule(gradeCard(card(null), raw()), 'S1', /7 ingredients/);
  });

  it('accepts a rootless card when the recipe had nothing to lay out', () => {
    expect(gradeCard(card(null), raw({ ingredientLines: [] }))).toEqual([]);
  });
});

describe('S2 — a tree, not a graph', () => {
  it('flags a subtree reached from two parents', () => {
    const shared = op('mix', 0, leaf[YOGURT], leaf[GARLIC]);
    const both = card(op('serve', 4, shared, op('cook 2 min', 2, shared), leaf[BEEF]));
    expectRule(gradeCard(both, raw()), 'S2', /more than once/);
  });

  it('does not hang on a cycle', () => {
    const loop = op('mix', 0, leaf[YOGURT]) as Extract<RecipeNode, { kind: 'op' }>;
    loop.children.push(loop);
    expectRule(gradeCard(card(loop), raw()), 'S2');
  });
});

describe('S3 — every operation has inputs', () => {
  it('flags an operation with no children', () => {
    expectRule(gradeCard(card(op('serve', 4, op('mix', 0), leaf[BEEF])), raw()), 'S3', /no inputs/);
  });
});

describe('S4 — no duplicated leaf', () => {
  it('flags an ingredient shown more often than the recipe lists it', () => {
    const twice = card(op('serve', 4, ...LINES.map((l) => leaf[l]), ing(BEEF)));
    expectRule(gradeCard(twice, raw()), 'S4', /ground beef/);
  });

  it('allows a line the recipe genuinely lists twice', () => {
    const divided = raw({ ingredientLines: [...LINES, OIL] });
    const both = card(op('serve', 4, ...LINES.map((l) => leaf[l]), ing(OIL)));
    expect(rules(gradeCard(both, divided))).not.toContain('S4');
  });
});

describe('S5 — row order is the depth-first leaf traversal', () => {
  it('flags a grid whose ingredient rows are out of traversal order', () => {
    const recipe = goodCard();
    const grid = layout(recipe);
    const rows = grid.cells.filter((c) => c.kind === 'ingredient');
    const swapped: Grid = {
      ...grid,
      cells: grid.cells.map((c) =>
        c === rows[0] ? { ...c, text: rows[1].text } : c === rows[1] ? { ...c, text: rows[0].text } : c,
      ),
    };
    expectRule(gradeCard(recipe, raw(), { grid: swapped }), 'S5');
  });
});

describe('S6 / S7 — column is depth, rowSpan is leaf count', () => {
  it('flags an operation placed in the wrong column', () => {
    const recipe = goodCard();
    const grid = layout(recipe);
    const moved: Grid = {
      ...grid,
      cells: grid.cells.map((c) => (c.kind === 'op' ? { ...c, col: c.col + 1 } : c)),
    };
    expectRule(gradeCard(recipe, raw(), { grid: moved }), 'S6', /column/);
  });

  it('flags an operation whose rowspan does not match its leaf count', () => {
    const recipe = goodCard();
    const grid = layout(recipe);
    const stretched: Grid = {
      ...grid,
      cells: grid.cells.map((c) => (c.kind === 'op' ? { ...c, rowSpan: c.rowSpan + 1 } : c)),
    };
    expectRule(gradeCard(recipe, raw(), { grid: stretched }), 'S7', /spans/);
  });
});

describe('S8 — an operation covers a contiguous block of rows', () => {
  it('flags leaves scattered so no rowspan could cover them', () => {
    const recipe = goodCard();
    const grid = layout(recipe);
    const rows = grid.cells.filter((c) => c.kind === 'ingredient');
    const scattered: Grid = {
      ...grid,
      cells: grid.cells.map((c) => (c === rows[0] ? { ...c, row: grid.rows - 1 } : c)),
    };
    expectRule(gradeCard(recipe, raw(), { grid: scattered }), 'S8', /rowspan/);
  });
});

describe('S9 — the grid tiles', () => {
  it('reports holes and overlaps from validateGrid', () => {
    const recipe = goodCard();
    const grid = layout(recipe);
    const holed: Grid = { ...grid, cells: grid.cells.slice(1) };
    expectRule(gradeCard(recipe, raw(), { grid: holed }), 'S9', /hole|overlap/);
  });
});

describe('S10 — banners span the full width', () => {
  it('flags a banner that does not reach across the table', () => {
    const recipe = card(goodCard().root, { banners: ['Preheat oven to 350°F'] });
    const grid = layout(recipe);
    const narrow: Grid = {
      ...grid,
      cells: grid.cells.map((c) => (c.kind === 'banner' ? { ...c, colSpan: 1 } : c)),
    };
    expectRule(gradeCard(recipe, raw(), { grid: narrow }), 'S10', /full width/);
  });
});

// ---------------------------------------------------------------------------
// Tier F — faithfulness
// ---------------------------------------------------------------------------

describe('F1 — ingredient coverage', () => {
  it('flags a source line that never reaches the card', () => {
    const missing = card(op('serve', 4, ...LINES.slice(0, 6).map((l) => leaf[l])));
    expectRule(gradeCard(missing, raw()), 'F1', /olive oil/);
  });

  it('passes when every line appears', () => {
    expect(rules(gradeCard(goodCard(), raw()))).not.toContain('F1');
  });
});

describe('F2 — nothing invented', () => {
  it('flags a leaf the recipe never listed', () => {
    const invented = card(op('serve', 4, ...LINES.map((l) => leaf[l]), ing('1 cup truffle oil')));
    expectRule(gradeCard(invented, raw()), 'F2', /truffle oil/);
  });
});

describe('F3 — every step is represented', () => {
  it('flags a step that appears nowhere', () => {
    const short = card(op('serve', 4, ...LINES.map((l) => leaf[l])));
    expectRule(gradeCard(short, raw()), 'F3', /step 1/);
  });

  it('counts a step rendered as a banner as represented', () => {
    const withBanner = card(op('serve', 4, ...LINES.map((l) => leaf[l])), {
      banners: ['Heat olive oil in a skillet over medium heat'],
    });
    const details = gradeCard(withBanner, raw())
      .filter((f) => f.rule === 'F3')
      .map((f) => f.detail)
      .join(' ');
    expect(details).not.toMatch(/step 2 /);
  });
});

describe('F4 — operations cite a real step', () => {
  it('flags an operation pointing past the end of the recipe', () => {
    expectRule(gradeCard(card(op('serve', 99, leaf[BEEF])), raw()), 'F4', /step 100/);
  });
});

describe('F5 — work cannot consume the future', () => {
  it('flags an operation consuming output from a later step', () => {
    const backwards = card(op('mix', 0, op('cook 2 min', 2, leaf[BEEF]), leaf[YOGURT]));
    expectRule(gradeCard(backwards, raw()), 'F5', /not earlier/);
  });

  it('accepts the normal earlier-feeds-later order', () => {
    expect(rules(gradeCard(goodCard(), raw()))).not.toContain('F5');
  });
});

describe('F6 — heat integrity', () => {
  it('flags a card that cooks a sauce the recipe only refrigerates', () => {
    const broken = card(
      op('serve', 4,
        op('microwave 20 to 30 sec', 3,
          op('cook 2 min', 2, op('refrigerate', 0, leaf[YOGURT], leaf[GARLIC]), leaf[OREGANO])),
        leaf[BEEF], leaf[PITA], leaf[CUCUMBER], leaf[OIL]),
    );
    expectRule(gradeCard(broken, raw()), 'F6', /Greek yogurt/);
  });

  it('passes the card the inference produces today', () => {
    expect(rules(gradeCard(goodCard(), raw()))).not.toContain('F6');
  });

  it('does not flag heat applied by a step that names the ingredient', () => {
    const fine = card(
      op('serve', 4, op('cook 8 to 10 min', 1, leaf[BEEF], leaf[OIL]),
        leaf[PITA], leaf[YOGURT], leaf[CUCUMBER], leaf[GARLIC], leaf[OREGANO]),
    );
    expect(rules(gradeCard(fine, raw()))).not.toContain('F6');
  });

  it('does not flag a parked branch reunited by the final assembly', () => {
    const baked = card(
      op('bake 30 min', 4, op('refrigerate', 0, leaf[YOGURT], leaf[GARLIC]),
        leaf[BEEF], leaf[PITA], leaf[CUCUMBER], leaf[OREGANO], leaf[OIL]),
    );
    expect(rules(gradeCard(baked, raw()))).not.toContain('F6');
  });

  it('ignores a storage note that comes after the baking', () => {
    // Simply Recipes: "...remove the banana bread from the pan... freeze for up
    // to 3 months". A park after the heat cannot invalidate it.
    const bananas: RawRecipe = {
      title: 'Banana Bread',
      ingredientLines: ['2 very ripe bananas', '1 cup all-purpose flour'],
      stepTexts: [
        'In a mixing bowl, mash the ripe bananas with a fork, then mix in the flour.',
        'Pour the batter into the pan. Bake for 55 to 65 minutes at 350°F (175°C).',
        'Remove from oven and let cool. Then remove the banana bread from the pan and freeze for up to 3 months.',
      ],
      strategy: 'json-ld',
    };
    const tree = card(
      op('cool', 2,
        op('bake 350°F (175°C) 55 to 65 min', 1,
          op('mash', 0, ing('2 very ripe bananas'), ing('1 cup all-purpose flour')))),
    );
    expect(rules(gradeCard(tree, bananas))).not.toContain('F6');
  });

  it('ignores a chill that is a stage of one chain rather than a parked branch', () => {
    // Tasty: "Fold in the chocolate chunks, then chill the dough..." then bake.
    const cookies: RawRecipe = {
      title: 'Cookies',
      ingredientLines: ['4 oz milk chocolate chunks', '1 1/4 cups all-purpose flour'],
      stepTexts: [
        'Sift in the flour and baking soda, then fold with a spatula.',
        'Fold in the chocolate chunks, then chill the dough for at least 30 minutes.',
        'Bake for 12-15 minutes, until the edges have started to barely brown.',
        'Cool completely before serving.',
      ],
      strategy: 'json-ld',
    };
    const tree = card(
      op('cool', 3,
        op('bake 12 to 15 min', 2,
          op('chill 30 min', 1,
            op('sift', 0, ing('1 1/4 cups all-purpose flour')),
            ing('4 oz milk chocolate chunks')))),
    );
    expect(rules(gradeCard(tree, cookies))).not.toContain('F6');
  });
});

describe('F7 — an operation takes what its step names', () => {
  it('flags an ingredient attached to a step that never mentions it', () => {
    // Step 3 stirs in the oregano; it says nothing about the cucumber.
    const wrong = card(
      op('serve', 4,
        op('cook 2 min', 2, leaf[OREGANO], leaf[CUCUMBER]),
        leaf[BEEF], leaf[PITA], leaf[YOGURT], leaf[GARLIC], leaf[OIL]),
    );
    expectRule(gradeCard(wrong, raw()), 'F7', /cucumber/);
  });

  it('does not flag an ingredient no step mentions at all', () => {
    const garnish = raw({ ingredientLines: [...LINES, 'Fresh parsley, for garnish'] });
    const withGarnish = card(
      op('serve', 4,
        op('cook 8 to 10 min', 1, leaf[BEEF], leaf[OIL], ing('Fresh parsley, for garnish')),
        leaf[PITA], leaf[YOGURT], leaf[CUCUMBER], leaf[GARLIC], leaf[OREGANO]),
    );
    expect(rules(gradeCard(withGarnish, garnish))).not.toContain('F7');
  });
});

// ---------------------------------------------------------------------------
// Tier L — legibility
// ---------------------------------------------------------------------------

describe('L1 — labels are terse verb phrases', () => {
  it('flags a label longer than the renderer will take', () => {
    expectRule(gradeCard(card(op('x'.repeat(70), 0, leaf[BEEF])), raw()), 'L1', /characters/);
  });

  it('flags a label that reads as a sentence', () => {
    expectRule(gradeCard(card(op('Mix it all together.', 0, leaf[BEEF])), raw()), 'L1', /sentence/);
  });

  it('flags an empty label', () => {
    expectRule(gradeCard(card(op('  ', 0, leaf[BEEF])), raw()), 'L1', /empty/);
  });
});

describe('L2 — labels carry a stated temperature or duration', () => {
  it('flags a label omitting a duration the step gives', () => {
    // Step 2 says "about 8-10 minutes".
    expectRule(gradeCard(card(op('cook', 1, leaf[BEEF], leaf[OIL])), raw()), 'L2', /duration/);
  });

  it('accepts a label that shows it', () => {
    const shown = card(op('cook 8 to 10 min', 1, leaf[BEEF], leaf[OIL]));
    expect(rules(gradeCard(shown, raw()))).not.toContain('L2');
  });
});

describe('L3 — labels name the work, not the wait', () => {
  it('flags a hold with no stated duration when the step also does something', () => {
    // Step 1 mixes the sauce, then says "Refrigerate until ready to use".
    expectRule(gradeCard(card(op('refrigerate', 0, leaf[YOGURT], leaf[GARLIC])), raw()), 'L3', /hold/);
  });

  it('accepts a hold that states its own duration', () => {
    const timed: RawRecipe = {
      title: 'Dough',
      ingredientLines: ['1 cup all-purpose flour'],
      stepTexts: ['Cover and refrigerate the dough for at least 2 hours.'],
      strategy: 'json-ld',
    };
    const tree = card(op('refrigerate 2 hr', 0, ing('1 cup all-purpose flour')));
    expect(rules(gradeCard(tree, timed))).not.toContain('L3');
  });
});

describe('L4 — bounded width', () => {
  it('flags more operation columns than the recipe has steps to justify', () => {
    const tall: RawRecipe = {
      title: 'Sprawl',
      ingredientLines: ['1 cup all-purpose flour'],
      stepTexts: ['Mix the flour.', 'Bake it.'],
      strategy: 'json-ld',
    };
    let node: RecipeNode = ing('1 cup all-purpose flour');
    for (let i = 0; i < 6; i++) node = op(`stir ${i}`, 0, node);
    expectRule(gradeCard(card(node), tall), 'L4', /operation columns/);
  });

  it('accepts a table proportionate to its steps', () => {
    expect(rules(gradeCard(goodCard(), raw()))).not.toContain('L4');
  });
});

describe('L5 — no operation invented to join loose ends', () => {
  it('flags the synthetic combine', () => {
    expectRule(gradeCard(card(op('combine', STEPS.length, leaf[BEEF], leaf[YOGURT])), raw()), 'L5', /invents/);
  });

  it('does not flag a real combine the recipe asked for', () => {
    expect(rules(gradeCard(card(op('combine', 0, leaf[YOGURT], leaf[GARLIC])), raw()))).not.toContain('L5');
  });
});

describe('L6 — logistics verbs are folded away', () => {
  it('flags a logistics operation wrapping a single operation', () => {
    const wrapped = card(op('transfer', 2, op('cook 8 to 10 min', 1, leaf[BEEF], leaf[OIL])));
    expectRule(gradeCard(wrapped, raw()), 'L6', /moves food/);
  });

  it('does not flag a logistics step that brings ingredients of its own', () => {
    const real = card(op('assemble', 4, op('cook 8 to 10 min', 1, leaf[BEEF], leaf[OIL]), leaf[PITA]));
    expect(rules(gradeCard(real, raw()))).not.toContain('L6');
  });
});

describe('L7 — orphan rate', () => {
  it('flags a card where nearly everything hangs off the root unoperated', () => {
    expectRule(gradeCard(card(op('serve', 4, ...LINES.map((l) => leaf[l]))), raw()), 'L7', /unoperated/);
  });

  it('accepts the inference output, which groups most ingredients', () => {
    expect(rules(gradeCard(goodCard(), raw()))).not.toContain('L7');
  });
});

describe('L8 — amounts render correctly', () => {
  it('flags a singular unit on a plural amount', () => {
    // `formatIngredient` pluralizes every unit it knows, so this is built by
    // hand: a card from the Claude path can carry a unit the table has never
    // seen, and the rule still has to notice "3 piece chocolate".
    const odd: RecipeNode = {
      kind: 'ingredient',
      ingredient: { raw: '3 pieces dark chocolate', name: 'dark chocolate', quantity: 3, unit: 'piece' },
    };
    expectRule(gradeCard(card(op('melt', 0, odd)), raw()), 'L8', /piece/);
  });

  it('passes now that known units pluralize', () => {
    // "2 cloves garlic" used to render as "2 clove garlic".
    expect(rules(gradeCard(goodCard(), raw()))).not.toContain('L8');
  });

  it('does not flag an abbreviation, which never pluralizes', () => {
    const details = gradeCard(card(op('mix', 0, leaf[OIL])), raw())
      .filter((f) => f.rule === 'L8')
      .map((f) => f.detail)
      .join(' ');
    expect(details).not.toMatch(/tbsp/);
  });
});

// ---------------------------------------------------------------------------
// The rule set itself
// ---------------------------------------------------------------------------

describe('the rule set', () => {
  const EVERY_RULE: RuleId[] = [
    'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10',
    'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7',
    'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8',
  ];

  it('sorts every rule into the tier its number implies', () => {
    for (const rule of EVERY_RULE) expect(tierOf(rule)).toBe(rule[0]);
  });

  it('names the two rules no code can decide', () => {
    expect([...NEEDS_REFERENCE_CARD]).toEqual(['F8', 'F9']);
  });

  it('honours a skip list', () => {
    const flat = card(op('serve', 4, ...LINES.map((l) => leaf[l])));
    expect(rules(gradeCard(flat, raw()))).toContain('L7');
    expect(rules(gradeCard(flat, raw(), { skip: ['L7'] }))).not.toContain('L7');
  });

  it('groups findings by tier', () => {
    const byTier = gradeByTier(card(op('serve', 4, ...LINES.map((l) => leaf[l]))), raw());
    expect(byTier.S.every((f) => tierOf(f.rule) === 'S')).toBe(true);
    expect(byTier.F.every((f) => tierOf(f.rule) === 'F')).toBe(true);
    expect(byTier.L.every((f) => tierOf(f.rule) === 'L')).toBe(true);
  });

  it('exposes the legibility limits it was measured against', () => {
    expect(DEFAULT_LIMITS.columnsPerStep).toBeGreaterThan(0);
    expect(DEFAULT_LIMITS.orphanRate).toBeGreaterThan(0);
  });

  it('leaves the shipped pita card clean on every tier', () => {
    const byTier = gradeByTier(goodCard(), raw());
    expect(byTier.S).toEqual([]);
    expect(byTier.F).toEqual([]);
    expect(byTier.L).toEqual([]);
  });
});
