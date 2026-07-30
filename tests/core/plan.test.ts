/**
 * Tests for treeFromPlan's handling of model-returned text.
 *
 * Step labels and banners come from remote JSON and land in cell text in
 * every output format, so they pass through plainText exactly like page
 * text — a control character in either would otherwise reach terminals
 * (and agent transcripts) verbatim.
 */

import { describe, expect, it } from 'vitest';
import { treeFromPlan } from '../../src/core/plan.js';
import type { Plan } from '../../src/core/plan.js';
import type { RawRecipe } from '../../src/core/types.js';

const ESC = String.fromCharCode(27);

const RAW: RawRecipe = {
  title: 'Test Bake',
  ingredientLines: ['1 cup flour'],
  stepTexts: ['Mix.'],
  strategy: 'json-ld',
};

describe('treeFromPlan text hygiene', () => {
  it('strips control characters from step labels', () => {
    const plan: Plan = {
      banners: [],
      steps: [{ label: `mix ${ESC}[2Jwell`, ingredients: [0], uses: [] }],
    };

    const recipe = treeFromPlan(plan, RAW, 'https://example.test/');

    expect(recipe.root?.kind).toBe('op');
    if (recipe.root?.kind === 'op') expect(recipe.root.label).toBe('mix [2Jwell');
  });

  it('strips control characters from banners', () => {
    const plan: Plan = {
      banners: [`preheat${String.fromCharCode(7)} oven`],
      steps: [{ label: 'mix', ingredients: [0], uses: [] }],
    };

    const recipe = treeFromPlan(plan, RAW, 'https://example.test/');

    expect(recipe.banners).toEqual(['preheat oven']);
  });
});
