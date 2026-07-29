/**
 * Flat plan -> recipe tree.
 *
 * Structured outputs cannot express a recursive schema, so the model returns
 * a flat list of operations that reference ingredients and earlier operations
 * by index. That is a DAG description; this module turns it into the tree the
 * layout engine needs, and it is a pure function, so the whole Claude path is
 * testable without a network call.
 */

import { parseIngredient } from './ingredient.js';
import type { RawRecipe, Recipe, RecipeNode } from './types.js';

export interface PlanStep {
  label: string;
  /** Indices into the ingredient list this step consumes. */
  ingredients: number[];
  /** Indices of earlier steps whose output this step consumes. */
  uses: number[];
}

export interface Plan {
  banners: string[];
  steps: PlanStep[];
}

/** The schema handed to the model. Kept next to the parser that consumes it. */
export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    banners: {
      type: 'array',
      description:
        'Preparation steps that consume no ingredients, e.g. "Preheat oven to 350°F (175°C)".',
      items: { type: 'string' },
    },
    steps: {
      type: 'array',
      description: 'Operations in the order they are performed.',
      items: {
        type: 'object',
        properties: {
          label: {
            type: 'string',
            description:
              'Two to six words: an imperative verb plus temperature and time when relevant, e.g. "fold in" or "bake 350°F (175°C) 30 to 40 min".',
          },
          ingredients: {
            type: 'array',
            description: 'Zero-based indices of the ingredients this step adds.',
            items: { type: 'integer' },
          },
          uses: {
            type: 'array',
            description:
              'Zero-based indices of earlier steps in this list whose output this step consumes.',
            items: { type: 'integer' },
          },
        },
        required: ['label', 'ingredients', 'uses'],
        additionalProperties: false,
      },
    },
  },
  required: ['banners', 'steps'],
  additionalProperties: false,
} as const;

/**
 * Build the tree. Defensive throughout: the model can hand back duplicate
 * indices, forward references, or orphaned steps, and none of those should
 * produce a broken table.
 */
export function treeFromPlan(plan: Plan, raw: RawRecipe, sourceUrl: string): Recipe {
  const ingredients = raw.ingredientLines.map(parseIngredient);
  const ingredientNodes: RecipeNode[] = ingredients.map((ingredient) => ({
    kind: 'ingredient',
    ingredient,
  }));

  const claimedIngredients = new Set<number>();
  const consumedSteps = new Set<number>();
  const built: Array<RecipeNode | null> = [];

  plan.steps.forEach((step, index) => {
    const children: RecipeNode[] = [];

    // Earlier steps first, so their rows sort above the new ingredients.
    for (const ref of step.uses) {
      if (ref < 0 || ref >= index) continue; // Forward or self reference.
      if (consumedSteps.has(ref)) continue; // Already folded into another step.
      const node = built[ref];
      if (!node) continue;
      consumedSteps.add(ref);
      children.push(node);
    }

    for (const ref of step.ingredients) {
      if (ref < 0 || ref >= ingredientNodes.length) continue;
      if (claimedIngredients.has(ref)) continue;
      claimedIngredients.add(ref);
      children.push(ingredientNodes[ref]);
    }

    built.push(
      children.length > 0
        ? { kind: 'op', label: step.label.trim() || 'prepare', children, sourceStep: index }
        : null,
    );
  });

  // Whatever was never consumed becomes the root, plus any ingredient the plan
  // forgot — dropping an ingredient silently would be the worst failure here.
  const loose = built.filter((node, index): node is RecipeNode => !!node && !consumedSteps.has(index));
  const orphans = ingredientNodes.filter((_, index) => !claimedIngredients.has(index));

  let root: RecipeNode | null = null;
  if (loose.length === 1) {
    root = loose[0];
    if (orphans.length > 0 && root.kind === 'op') root.children.push(...orphans);
  } else if (loose.length > 1 || orphans.length > 0) {
    const children = [...loose, ...orphans];
    root =
      children.length === 1
        ? children[0]
        : { kind: 'op', label: 'combine', children, sourceStep: plan.steps.length };
  }

  const matched = claimedIngredients.size;
  return {
    title: raw.title,
    banners: plan.banners.map((b) => b.trim()).filter(Boolean),
    root,
    yield: raw.yield,
    sourceUrl,
    extraction: raw.strategy,
    inference: 'claude',
    confidence: ingredients.length === 0 ? 0 : matched / ingredients.length,
  };
}
