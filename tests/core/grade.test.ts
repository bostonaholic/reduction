import { describe, expect, it } from 'vitest';
import { gradeCard } from '../../src/core/grade.js';
import { inferTree } from '../../src/core/infer.js';
import { parseIngredient } from '../../src/core/ingredient.js';
import type { RawRecipe, Recipe, RecipeNode } from '../../src/core/types.js';

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

function raw(lines: string[] = LINES): RawRecipe {
  return { title: 'Pita Wraps', ingredientLines: lines, stepTexts: STEPS, strategy: 'json-ld' };
}

function ing(line: string): RecipeNode {
  return { kind: 'ingredient', ingredient: parseIngredient(line) };
}

function op(label: string, sourceStep: number, ...children: RecipeNode[]): RecipeNode {
  return { kind: 'op', label, children, sourceStep };
}

function card(root: RecipeNode): Recipe {
  return {
    title: 'Pita Wraps',
    banners: [],
    root,
    sourceUrl: 'https://example.test/x',
    extraction: 'json-ld',
    inference: 'heuristic',
    confidence: 1,
  };
}

/** Every ingredient line as a leaf, so a card can be built without listing them twice. */
const leaves = Object.fromEntries(LINES.map((l) => [l, ing(l)])) as Record<string, RecipeNode>;

function rules(findings: { rule: string }[]): string[] {
  return [...new Set(findings.map((f) => f.rule))].sort();
}

describe('F6 — heat integrity', () => {
  it('flags a card that cooks a sauce the recipe only refrigerates', () => {
    // The shape that shipped: the refrigerated sauce swept into the beef's
    // cooking chain, so heat lands on yogurt the recipe never heats.
    const broken = card(
      op(
        'serve',
        4,
        op(
          'microwave 20 to 30 sec',
          3,
          op(
            'cook 2 min',
            2,
            op('refrigerate', 0, leaves[LINES[2]], leaves[LINES[4]]),
            leaves[LINES[5]],
          ),
        ),
        leaves[LINES[0]],
        leaves[LINES[1]],
        leaves[LINES[3]],
        leaves[LINES[6]],
      ),
    );

    const findings = gradeCard(broken, raw());
    expect(rules(findings)).toContain('F6');
    expect(findings.find((f) => f.rule === 'F6')?.detail).toMatch(/Greek yogurt/);
  });

  it('passes the card the inference produces today', () => {
    const findings = gradeCard(inferTree(raw(), 'https://example.test/x'), raw());
    expect(rules(findings)).not.toContain('F6');
  });

  it('does not flag heat applied by a step that names the ingredient', () => {
    const fine = card(
      op('serve', 4, op('cook 8 to 10 min', 1, leaves[LINES[0]], leaves[LINES[6]]),
        leaves[LINES[1]], leaves[LINES[2]], leaves[LINES[3]], leaves[LINES[4]], leaves[LINES[5]]),
    );
    expect(rules(gradeCard(fine, raw()))).not.toContain('F6');
  });

  it('does not flag a parked branch reunited by the final assembly', () => {
    // "Refrigerate the sauce ... then bake the whole dish" is legitimate: the
    // root operation is where every branch is supposed to meet again.
    const baked = card(
      op(
        'bake 30 min',
        4,
        op('refrigerate', 0, leaves[LINES[2]], leaves[LINES[4]]),
        leaves[LINES[0]], leaves[LINES[1]], leaves[LINES[3]], leaves[LINES[5]], leaves[LINES[6]],
      ),
    );
    expect(rules(gradeCard(baked, raw()))).not.toContain('F6');
  });
});

describe('F1 — ingredient coverage', () => {
  it('flags an ingredient line that never reaches the card', () => {
    const missing = card(
      op('serve', 4, leaves[LINES[0]], leaves[LINES[1]], leaves[LINES[2]],
        leaves[LINES[3]], leaves[LINES[4]], leaves[LINES[5]]),
    );
    const findings = gradeCard(missing, raw());
    expect(rules(findings)).toContain('F1');
    expect(findings.find((f) => f.rule === 'F1')?.detail).toMatch(/olive oil/);
  });

  it('flags an ingredient that appears twice', () => {
    const twice = card(
      op('serve', 4, ...LINES.map((l) => leaves[l]), ing(LINES[0])),
    );
    const findings = gradeCard(twice, raw());
    expect(rules(findings)).toContain('F1');
    expect(findings.find((f) => f.rule === 'F1')?.detail).toMatch(/ground beef/);
  });

  it('passes when every line appears exactly once', () => {
    expect(rules(gradeCard(inferTree(raw(), 'x'), raw()))).not.toContain('F1');
  });

  it('reports nothing at all for a clean card', () => {
    expect(gradeCard(inferTree(raw(), 'x'), raw())).toEqual([]);
  });
});

describe('F6 — false positives the captured fixtures caught', () => {
  it('ignores a storage note that comes after the baking', () => {
    // Simply Recipes: "...remove the banana bread from the pan... freeze for
    // up to 3 months". A park that happens after the heat cannot invalidate it.
    // (It also only "names" the bananas via the words "banana bread".)
    const bananas: RawRecipe = {
      title: 'Banana Bread',
      ingredientLines: ['2 very ripe bananas', '1 cup all-purpose flour'],
      stepTexts: [
        'In a mixing bowl, mash the ripe bananas with a fork, then mix in the flour.',
        'Pour the batter into the pan. Bake for 55 to 65 minutes at 350\u00b0F (175\u00b0C).',
        'Remove from oven and let cool. Then remove the banana bread from the pan and freeze for up to 3 months.',
      ],
      strategy: 'json-ld',
    };
    const tree = card(
      op('cool', 2,
        op('bake 350\u00b0F (175\u00b0C) 55 to 65 min', 1,
          op('mash', 0, ing('2 very ripe bananas'), ing('1 cup all-purpose flour')))),
    );
    expect(rules(gradeCard(tree, bananas))).not.toContain('F6');
  });

  it('ignores a chill that is a stage of one chain rather than a parked branch', () => {
    // Tasty: "Fold in the chocolate chunks, then chill the dough for at least
    // 30 minutes" ... "Bake for 12-15 minutes". The chocolate is meant to bake.
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
