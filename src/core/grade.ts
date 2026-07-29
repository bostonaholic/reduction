/**
 * Grade a rendered card against the recipe it claims to describe.
 *
 * The layout engine already proves a card can be *drawn* — `validateGrid`
 * catches holes and overlaps. Nothing proves a card is *true*. A tree can tile
 * perfectly and still tell you to cook the yogurt.
 *
 * The rules are numbered in docs/recipe-card-rules.md; this module implements
 * the two that need no reference card, only the source recipe:
 *
 *   F1  every ingredient line appears as exactly one leaf
 *   F6  no heat is applied to an ingredient the recipe never heats
 *
 * A grader that reuses the inference's reasoning would only agree with itself,
 * so F6 deliberately works from the source text: it asks what the *recipe*
 * says, never what the tree decided. The two share vocabulary — how to tell
 * whether a sentence names an ingredient — but no judgement.
 */

import { mentions, tokenize } from './infer.js';
import { parseIngredient, searchPhrases } from './ingredient.js';
import type { RawRecipe, Recipe, RecipeNode } from './types.js';

/** Rules this module can decide. Others need a reference card. */
export type RuleId = 'F1' | 'F6';

export interface Finding {
  rule: RuleId;
  /** What went wrong, naming the ingredient or step, never a bare score. */
  detail: string;
}

/** Verbs that put energy into food. An operation label starting with one applies heat. */
const HEAT = new Set([
  'bake', 'roast', 'broil', 'grill', 'fry', 'sauté', 'saute', 'sear', 'simmer',
  'boil', 'steam', 'poach', 'cook', 'heat', 'warm', 'braise', 'microwave', 'toast',
]);

/** Verbs that send something away from the stove to wait. */
const PARK = new Set(['refrigerate', 'chill', 'freeze']);

function labelVerb(node: RecipeNode): string {
  return node.kind === 'op' ? node.label.split(' ')[0].toLowerCase() : '';
}

function leavesOf(node: RecipeNode, out: RecipeNode[] = []): RecipeNode[] {
  if (node.kind === 'ingredient') out.push(node);
  else for (const child of node.children) leavesOf(child, out);
  return out;
}

/** Every (leaf, ancestors) pair, ancestors ordered root-first. */
function pathsToLeaves(
  node: RecipeNode,
  ancestors: RecipeNode[] = [],
  out: Array<{ leaf: RecipeNode; ancestors: RecipeNode[] }> = [],
): Array<{ leaf: RecipeNode; ancestors: RecipeNode[] }> {
  if (node.kind === 'ingredient') out.push({ leaf: node, ancestors });
  else for (const child of node.children) pathsToLeaves(child, [...ancestors, node], out);
  return out;
}

/**
 * F1 — every source ingredient line appears as exactly one leaf.
 *
 * Compared as a multiset of the verbatim `raw` text, so a line repeated in the
 * source ("1 cup flour, divided" twice) is expected twice rather than flagged.
 */
function checkCoverage(recipe: Recipe, raw: RawRecipe): Finding[] {
  const expected = new Map<string, number>();
  for (const line of raw.ingredientLines) {
    const key = parseIngredient(line).raw;
    expected.set(key, (expected.get(key) ?? 0) + 1);
  }

  const actual = new Map<string, number>();
  for (const leaf of recipe.root ? leavesOf(recipe.root) : []) {
    if (leaf.kind !== 'ingredient') continue;
    const key = leaf.ingredient.raw;
    actual.set(key, (actual.get(key) ?? 0) + 1);
  }

  const findings: Finding[] = [];
  for (const [key, want] of expected) {
    const got = actual.get(key) ?? 0;
    if (got < want) {
      findings.push({
        rule: 'F1',
        detail: `"${key}" is in the recipe but ${got === 0 ? 'never reaches the card' : `appears only ${got} of ${want} times`}`,
      });
    } else if (got > want) {
      findings.push({ rule: 'F1', detail: `"${key}" appears ${got} times but the recipe lists it ${want}` });
    }
  }
  for (const [key, got] of actual) {
    if (!expected.has(key)) {
      findings.push({ rule: 'F1', detail: `"${key}" is on the card but not in the recipe (${got}x)` });
    }
  }

  return findings;
}

/**
 * F6 — no heat above an ingredient the recipe never heats.
 *
 * The hard part is that heat legitimately reaches things a step never names:
 * "add the flour, then bake" heats flour without saying so. Flagging every
 * unnamed-but-heated ingredient would flag most of every recipe.
 *
 * So the check looks for the one signature that is unambiguous — an ingredient
 * the recipe explicitly *parked*, then heated anyway as a passenger:
 *
 *   1. a heat operation sits above the leaf, and
 *   2. that operation's own step does not name the leaf, and
 *   3. a step that names the leaf put it away (refrigerate / chill / freeze)
 *      *before* the heat step — a storage note at the end of a recipe says
 *      nothing about a bake that already happened, and
 *   4. the heat operation is not the root, because the root is exactly where
 *      every branch is supposed to meet again — "chill the filling, assemble,
 *      bake" is a real recipe, not a defect, and
 *   5. the heat step names some *other* ingredient beneath that operation. That
 *      is what makes the parked branch a passenger rather than the subject:
 *      "stir in oregano, cook 2 min" had a real subject and swept the sauce up
 *      with it, whereas a bare "bake for 12-15 minutes" after chilling the
 *      dough is heating exactly what it should be.
 *
 * Rule 5 is deliberately conservative. A card that sweeps a parked branch into
 * a heat step naming nothing at all goes unreported, because the source text
 * cannot distinguish that from a legitimate chill-then-bake. A grader that
 * cries wolf gets switched off; missing a case costs less than that.
 */
function checkHeatIntegrity(recipe: Recipe, raw: RawRecipe): Finding[] {
  if (!recipe.root) return [];

  const stepTokens = raw.stepTexts.map(tokenize);
  const findings: Finding[] = [];

  for (const { leaf, ancestors } of pathsToLeaves(recipe.root)) {
    if (leaf.kind !== 'ingredient') continue;
    const phrases = searchPhrases(leaf.ingredient);
    if (phrases.length === 0) continue;

    const names = (index: number): boolean =>
      index >= 0 &&
      index < stepTokens.length &&
      phrases.some((phrase) => mentions(stepTokens[index], phrase));

    // (3) Did a step that names this ingredient put it away?
    const parkedAt = raw.stepTexts.findIndex(
      (text, index) => names(index) && [...tokenize(text)].some((word) => PARK.has(word)),
    );
    if (parkedAt < 0) continue;

    for (const ancestor of ancestors) {
      if (ancestor === recipe.root) continue; // (4)
      if (!HEAT.has(labelVerb(ancestor))) continue; // (1)
      if (ancestor.kind !== 'op') continue;
      if (names(ancestor.sourceStep)) continue; // (2)
      if (parkedAt >= ancestor.sourceStep) continue; // (3)

      // (5) Did this step have a subject of its own that it swept the parked
      // branch in alongside?
      const hasNamedSubject = leavesOf(ancestor).some(
        (other) =>
          other !== leaf &&
          other.kind === 'ingredient' &&
          searchPhrases(other.ingredient).some((phrase) =>
            mentions(stepTokens[ancestor.sourceStep] ?? [], phrase),
          ),
      );
      if (!hasNamedSubject) continue;

      findings.push({
        rule: 'F6',
        detail:
          `"${leaf.ingredient.name}" is put away in step ${parkedAt + 1} but "${ancestor.label}" ` +
          `(step ${ancestor.sourceStep + 1}) applies heat to it, and that step never mentions it`,
      });
      break;
    }
  }

  return findings;
}

/**
 * Grade a card. An empty result is a pass.
 *
 * Findings name the rule and the ingredient, never a score — "82" tells you
 * nothing you can act on, "F6 on the Greek yogurt" tells you where to look.
 */
export function gradeCard(recipe: Recipe, raw: RawRecipe): Finding[] {
  return [...checkCoverage(recipe, raw), ...checkHeatIntegrity(recipe, raw)];
}
