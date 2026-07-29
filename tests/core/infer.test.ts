import { describe, expect, it } from 'vitest';
import { inferTree, stepLabel } from '../../src/core/infer.js';
import type { RawRecipe, Recipe, RecipeNode } from '../../src/core/types.js';

/**
 * A recipe with two independent branches: a cold sauce that is made first and
 * parked in the fridge, and a hot component cooked afterwards. Nothing links
 * the two until the final assembly, which is exactly where the inference used
 * to go wrong — every subsequent cooking step swept the parked sauce up with
 * it, and the step that actually browns the beef was demoted to a banner
 * because "Heat olive **oil** in a **skillet**" reads like "oil the pan".
 *
 * https://www.shaykeerecipes.com/mediterranean-ground-beef-pita-wraps/
 */
function pitaWraps(): RawRecipe {
  return {
    title: 'Mediterranean Ground Beef Pita Wraps',
    ingredientLines: [
      '1 lb ground beef (85% lean)',
      '4 large pita bread rounds',
      '1 cup plain Greek yogurt',
      '1 cucumber, diced',
      '1 tomato, diced',
      '1/2 red onion, thinly sliced',
      '2 cloves garlic, minced',
      '1 tsp dried oregano',
      '1 tsp ground cumin',
      '1/2 tsp paprika',
      'Salt and black pepper to taste',
      '2 tbsp olive oil',
      'Fresh parsley, chopped (for garnish)',
      'Lemon wedges (for serving)',
    ],
    stepTexts: [
      'In a bowl, mix Greek yogurt, minced garlic, a pinch of salt, and a squeeze of lemon juice to make the sauce. Refrigerate until ready to use.',
      'Heat olive oil in a skillet over medium heat. Add ground beef, breaking it up with a spoon. Cook until browned, about 8-10 minutes.',
      'Stir in oregano, cumin, paprika, salt, and pepper. Cook for another 2 minutes until fragrant, then remove from heat.',
      'Warm the pita bread in a dry skillet or microwave for 20-30 seconds until soft and pliable.',
      'Assemble wraps by spreading a spoonful of yogurt sauce on each pita, adding ground beef, cucumber, tomato, and red onion. Garnish with parsley and serve with lemon wedges.',
    ],
    strategy: 'json-ld',
  };
}

/** Labels of every operation above the ingredient whose name contains `needle`. */
function opsOver(recipe: Recipe, needle: string): string[] {
  const walk = (node: RecipeNode, ancestors: string[]): string[] | null => {
    if (node.kind === 'ingredient') {
      return node.ingredient.raw.toLowerCase().includes(needle.toLowerCase()) ? ancestors : null;
    }
    for (const child of node.children) {
      const found = walk(child, [...ancestors, node.label]);
      if (found) return found;
    }
    return null;
  };

  const found = recipe.root ? walk(recipe.root, []) : null;
  if (!found) throw new Error(`no ingredient matching "${needle}" in the tree`);
  return found;
}

/** Operations that apply heat. The point of the diagram is knowing what got cooked. */
const HEAT = /^(cook|bake|roast|broil|grill|fry|sear|simmer|boil|steam|poach|braise|microwave|heat|warm)\b/;

describe('inferTree — parallel branches that meet at assembly', () => {
  const recipe = inferTree(pitaWraps(), 'https://example.test/pita-wraps');

  it('does not cook the yogurt sauce that step 1 parked in the fridge', () => {
    expect(opsOver(recipe, 'Greek yogurt').filter((label) => HEAT.test(label))).toEqual([]);
  });

  it('cooks the ground beef', () => {
    expect(opsOver(recipe, 'ground beef').filter((label) => HEAT.test(label))).toContainEqual(
      expect.stringMatching(/^cook\b/),
    );
  });

  it('warms the pita bread rather than leaving it an untouched leaf', () => {
    expect(opsOver(recipe, 'pita bread')).toContain('microwave 20 to 30 sec');
  });

  it('does not microwave the beef along with the pita', () => {
    expect(opsOver(recipe, 'ground beef')).not.toContain('microwave 20 to 30 sec');
  });

  it('keeps the step that browns the beef as an operation, not a banner row', () => {
    expect(recipe.banners).toEqual([]);
  });

  it('names the sauce step for what it does, not for the hold at the end', () => {
    expect(opsOver(recipe, 'Greek yogurt')).toContain('mix');
  });

  it('seasons the beef with the salt and pepper rather than orphaning the line', () => {
    expect(opsOver(recipe, 'Salt and black pepper')).toContain('cook 2 min');
  });
});

describe('stepLabel', () => {
  it('prefers the transformation over a hold with no stated duration', () => {
    expect(
      stepLabel('In a bowl, mix the yogurt and garlic to make the sauce. Refrigerate until ready to use.'),
    ).toBe('mix');
  });

  it('keeps a hold that states its own duration — that is the step', () => {
    expect(stepLabel('Cover and refrigerate the dough for at least 2 hours.')).toBe('refrigerate 2 hr');
  });
});

