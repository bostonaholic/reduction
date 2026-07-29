/**
 * Grade a rendered card against the recipe it claims to describe.
 *
 * The layout engine already proves a card can be *drawn* — `validateGrid`
 * catches holes and overlaps. Nothing proves a card is *true*. A tree can tile
 * perfectly and still tell you to cook the yogurt.
 *
 * The rules are numbered and explained in docs/recipe-card-rules.md, in three
 * tiers: S is structural (the card cannot be drawn), F is faithfulness (it is
 * drawn beautifully and says something false), L is legibility (it is true but
 * unpleasant). Everything here is checkable from the card plus the source
 * recipe; F8 and F9 need a human-authored reference card and are deliberately
 * absent rather than faked.
 *
 * A grader that reused the inference's reasoning would only agree with itself,
 * so the F rules work from the source text: they ask what the *recipe* says,
 * never what the tree decided. The two share vocabulary — how to tell whether
 * a sentence names an ingredient — but no judgement.
 */

import { mentions, stepLabel, tokenize } from './infer.js';
import { parseIngredient, searchPhrases } from './ingredient.js';
import { column, formatIngredient, layout, leafCount, validateGrid } from './layout.js';
import type { Grid, Ingredient, RawRecipe, Recipe, RecipeNode } from './types.js';

export type RuleId =
  | 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8' | 'S9' | 'S10'
  | 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7'
  | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7' | 'L8';

export type Tier = 'S' | 'F' | 'L';

export interface Finding {
  rule: RuleId;
  /** What went wrong, naming the ingredient or step, never a bare score. */
  detail: string;
}

/** Rules that need a human-authored reference card, so no code can decide them. */
export const NEEDS_REFERENCE_CARD = ['F8', 'F9'] as const;

export function tierOf(rule: RuleId): Tier {
  return rule[0] as Tier;
}

/** Verbs that put energy into food. An operation label starting with one applies heat. */
const HEAT = new Set([
  'bake', 'roast', 'broil', 'grill', 'fry', 'sauté', 'saute', 'sear', 'simmer',
  'boil', 'steam', 'poach', 'cook', 'heat', 'warm', 'braise', 'microwave', 'toast',
]);

/** Verbs that send something away from the stove to wait. */
const PARK = new Set(['refrigerate', 'chill', 'freeze']);

/** Verbs that move food without changing it — they should not own a column. */
const LOGISTICS = new Set([
  'prepare', 'place', 'transfer', 'cover', 'return', 'remove', 'set',
  'assemble', 'arrange', 'wrap', 'spoon', 'divide',
]);

/** Longest label the renderer is willing to produce. */
const MAX_LABEL = 58;

/** How long a step says it takes, if it says. */
const DURATION =
  /(\d+)\s*(?:(?:to|-|–|—)\s*(\d+)\s*)?(minutes?|mins?|hours?|hrs?|seconds?|secs?)\b/i;

/** A temperature a step states. */
const TEMPERATURE = /(\d{2,3})\s*(?:°|&deg;|\s)?\s*(?:degrees\s*)?[FC]\b/;

// ---------------------------------------------------------------------------
// Tree walking
// ---------------------------------------------------------------------------

function verbOf(node: RecipeNode): string {
  return node.kind === 'op' ? node.label.split(' ')[0].toLowerCase() : '';
}

/**
 * Every ingredient leaf beneath a node.
 *
 * Cycle-safe on purpose: a malformed card is exactly what this module exists to
 * report, so no traversal here may hang or overflow the stack on one.
 */
function leavesOf(node: RecipeNode, out: RecipeNode[] = [], seen = new Set<RecipeNode>()): RecipeNode[] {
  if (seen.has(node)) return out;
  seen.add(node);
  if (node.kind === 'ingredient') out.push(node);
  else for (const child of node.children) leavesOf(child, out, seen);
  return out;
}

/** Every node, parents before children. Stops on revisits so a cycle cannot hang it. */
function walk(root: RecipeNode): { nodes: RecipeNode[]; revisited: RecipeNode[] } {
  const nodes: RecipeNode[] = [];
  const seen = new Set<RecipeNode>();
  const revisited: RecipeNode[] = [];

  const visit = (node: RecipeNode): void => {
    if (seen.has(node)) {
      revisited.push(node);
      return;
    }
    seen.add(node);
    nodes.push(node);
    if (node.kind === 'op') for (const child of node.children) visit(child);
  };

  visit(root);
  return { nodes, revisited };
}

type Operation = Extract<RecipeNode, { kind: 'op' }>;
type IngredientNode = Extract<RecipeNode, { kind: 'ingredient' }>;

function opsOf(root: RecipeNode): Operation[] {
  return walk(root).nodes.filter((n): n is Operation => n.kind === 'op');
}

/** Every (leaf, ancestors) pair, ancestors ordered root-first. */
function pathsToLeaves(
  node: RecipeNode,
  ancestors: RecipeNode[] = [],
  out: Array<{ leaf: RecipeNode; ancestors: RecipeNode[] }> = [],
): Array<{ leaf: RecipeNode; ancestors: RecipeNode[] }> {
  if (ancestors.includes(node)) return out; // Cycle — S2 reports it; do not recurse.
  if (node.kind === 'ingredient') out.push({ leaf: node, ancestors });
  else for (const child of node.children) pathsToLeaves(child, [...ancestors, node], out);
  return out;
}

function describe(node: RecipeNode): string {
  return node.kind === 'op' ? `"${node.label}"` : `"${node.ingredient.name}"`;
}

/** Count each ingredient line the way the card and the source both spell it. */
function countByRaw(keys: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

/** The joiner `inferTree` invents when several branches are left over. */
function isSynthetic(op: Operation, raw: RawRecipe): boolean {
  return op.label === 'combine' && op.sourceStep >= raw.stepTexts.length;
}

/**
 * Trailing prose that is not a step: storage, serving suggestions, sign-offs.
 * Mirrors `isPrepish` in infer.ts, which is how the inference decides the same
 * thing — "Store the cake, covered, at room temperature" names an ingredient
 * without asking you to do anything to it.
 */
const ADVISORY = /\b(store|keep|serve|enjoy|makes|note|tip|leftover)\b/i;

/** First sentence, trimmed — how a banner is derived from a step. */
function headOf(text: string): string {
  return text.split(/(?<=[.!?])\s+/)[0].trim().replace(/\.$/, '');
}

// ---------------------------------------------------------------------------
// Tier S — structural. Decidable from the card alone.
// ---------------------------------------------------------------------------

function checkStructure(recipe: Recipe, raw: RawRecipe, injected?: Grid): Finding[] {
  const findings: Finding[] = [];
  const root = recipe.root;

  // S1 — one root, unless the recipe genuinely had no ingredients to lay out.
  if (!root) {
    if (raw.ingredientLines.length > 0) {
      findings.push({
        rule: 'S1',
        detail: `the recipe has ${raw.ingredientLines.length} ingredients but the card has no root`,
      });
    }
    return findings;
  }

  const { nodes, revisited } = walk(root);

  // S2 — a tree, not a DAG. A reused node is a cycle or a shared subtree.
  for (const node of revisited) {
    findings.push({
      rule: 'S2',
      detail: `${describe(node)} appears more than once — a cycle or a shared subtree, not a tree`,
    });
  }

  // S3 — an operation with no inputs has nothing to act on.
  for (const node of nodes) {
    if (node.kind === 'op' && node.children.length === 0) {
      findings.push({ rule: 'S3', detail: `${describe(node)} is an operation with no inputs` });
    }
  }

  // A card that is not a tree cannot be measured any further: `column` and
  // `leafCount` recurse without a visited set, because the layout engine is
  // entitled to assume a tree. Report the structural break and stop.
  if (findings.some((f) => f.rule === 'S2')) return findings;

  // S4 — no leaf duplicated beyond what the source lists. F1 owns the missing
  // direction and F2 owns leaves the recipe never mentioned.
  const sourceCounts = countByRaw(raw.ingredientLines.map((l) => parseIngredient(l).raw));
  const cardCounts = countByRaw(
    leavesOf(root).filter((l): l is IngredientNode => l.kind === 'ingredient').map((l) => l.ingredient.raw),
  );
  for (const [key, got] of cardCounts) {
    const want = sourceCounts.get(key) ?? 0;
    if (want > 0 && got > want) {
      findings.push({
        rule: 'S4',
        detail: `"${key}" appears ${got} times on the card but the recipe lists it ${want}`,
      });
    }
  }

  // S5–S10 need the rendered grid. Callers may supply one they already have —
  // and a test may supply a deliberately broken one, which is the only way to
  // prove these checks can fail at all.
  const grid = injected ?? layout(recipe);

  // S9 — the grid tiles. validateGrid already decides this; wear its answers.
  for (const problem of validateGrid(grid)) findings.push({ rule: 'S9', detail: problem });

  // S5 — row order is the depth-first leaf traversal. Compared on the rendered
  // text, because that is what the cell holds: the raw line "0.5 teaspoon salt"
  // is shown as "1/2 tsp (3 g) salt", and only one of those is in the grid.
  const dfsLeaves = leavesOf(root).filter((l): l is IngredientNode => l.kind === 'ingredient');
  const dfs = dfsLeaves.map((l) => formatIngredient(l));
  const laidOut = grid.cells
    .filter((c) => c.kind === 'ingredient')
    .sort((a, b) => a.row - b.row)
    .map((c) => c.text);
  for (let i = 0; i < Math.min(dfs.length, laidOut.length); i++) {
    if (dfs[i] !== laidOut[i]) {
      findings.push({
        rule: 'S5',
        detail: `row ${i} holds "${laidOut[i]}" but the depth-first leaf order expects "${dfs[i]}"`,
      });
      break;
    }
  }

  // S6 / S7 — the two derivation rules, checked against the placed cells rather
  // than trusted because `layout` computed them from the same functions.
  const placedByLabel = new Map<string, { col: number; rowSpan: number }[]>();
  for (const cell of grid.cells) {
    if (cell.kind !== 'op') continue;
    const list = placedByLabel.get(cell.text) ?? [];
    list.push({ col: cell.col, rowSpan: cell.rowSpan });
    placedByLabel.set(cell.text, list);
  }
  for (const op of opsOf(root)) {
    const placed = placedByLabel.get(op.label)?.shift();
    if (!placed) continue; // A label the grid never shows is S9's problem, not S6's.
    if (placed.col !== column(op)) {
      findings.push({
        rule: 'S6',
        detail: `${describe(op)} sits in column ${placed.col} but its depth from the leaves is ${column(op)}`,
      });
    }
    if (placed.rowSpan !== leafCount(op)) {
      findings.push({
        rule: 'S7',
        detail: `${describe(op)} spans ${placed.rowSpan} rows but covers ${leafCount(op)} ingredients`,
      });
    }
  }

  // S8 — every operation's leaves occupy a contiguous block of rows. This is
  // the property a rowspan actually needs, so it is checked against where the
  // grid *placed* each ingredient, not against the traversal order.
  // A recipe may list the same line twice ("1 tsp vanilla, divided"), so rows
  // are handed out from a queue per rendered text rather than a single lookup —
  // otherwise both leaves claim the first row and every operation looks broken.
  const rowQueue = new Map<string, number[]>();
  for (const cell of [...grid.cells].sort((a, b) => a.row - b.row)) {
    if (cell.kind !== 'ingredient') continue;
    rowQueue.set(cell.text, [...(rowQueue.get(cell.text) ?? []), cell.row]);
  }
  const rowOfLeaf = new Map<IngredientNode, number>();
  for (const leafNode of dfsLeaves) {
    const queue = rowQueue.get(formatIngredient(leafNode));
    const row = queue?.shift();
    if (row !== undefined) rowOfLeaf.set(leafNode, row);
  }
  for (const op of opsOf(root)) {
    const rows = leavesOf(op)
      .filter((l): l is IngredientNode => l.kind === 'ingredient')
      .map((l) => rowOfLeaf.get(l))
      .filter((r): r is number => r !== undefined)
      .sort((a, b) => a - b);
    if (rows.length < 2) continue;
    if (rows[rows.length - 1] - rows[0] !== rows.length - 1) {
      findings.push({
        rule: 'S8',
        detail: `${describe(op)} covers rows ${rows.join(', ')}, which a single rowspan cannot span`,
      });
    }
  }

  // S10 — banners are full-width.
  for (const cell of grid.cells) {
    if (cell.kind !== 'banner') continue;
    if (cell.colSpan !== grid.cols) {
      findings.push({
        rule: 'S10',
        detail: `banner "${cell.text}" spans ${cell.colSpan} of ${grid.cols} columns, not the full width`,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Tier F — faithfulness. Decided against the source recipe.
// ---------------------------------------------------------------------------

function checkFaithfulness(recipe: Recipe, raw: RawRecipe): Finding[] {
  const findings: Finding[] = [];
  const root = recipe.root;
  if (!root) return findings;

  const stepTokens = raw.stepTexts.map(tokenize);
  const leaves = leavesOf(root).filter((l): l is IngredientNode => l.kind === 'ingredient');

  const namesIn = (index: number, ingredient: Ingredient): boolean =>
    index >= 0 &&
    index < stepTokens.length &&
    searchPhrases(ingredient).some((phrase) => mentions(stepTokens[index], phrase));

  // F1 — every source line reaches the card. S4 owns duplicates.
  const sourceCounts = countByRaw(raw.ingredientLines.map((l) => parseIngredient(l).raw));
  const cardCounts = countByRaw(leaves.map((l) => l.ingredient.raw));
  for (const [key, want] of sourceCounts) {
    const got = cardCounts.get(key) ?? 0;
    if (got < want) {
      findings.push({
        rule: 'F1',
        detail:
          got === 0
            ? `"${key}" is in the recipe but never reaches the card`
            : `"${key}" appears ${got} times on the card but the recipe lists it ${want}`,
      });
    }
  }

  // F2 — nothing on the card the recipe never listed.
  for (const [key, got] of cardCounts) {
    if (!sourceCounts.has(key)) {
      findings.push({ rule: 'F2', detail: `"${key}" is on the card (${got}x) but not in the recipe` });
    }
  }

  const ops = opsOf(root);

  // F3 — every source step that does real work is represented, as an operation
  // or a banner.
  //
  // Recipe prose is full of things that look like steps and are not: "Enjoy!",
  // "For tips on slicing, see...", "If you're pressed for time you can skip
  // this step". Flagging those buries the one finding that matters, so a step
  // only counts as missing when it names an ingredient — that is the evidence
  // it had something to contribute to the tree.
  const cited = new Set(ops.map((op) => op.sourceStep));
  const bannerHeads = recipe.banners.map(headOf).filter(Boolean);
  raw.stepTexts.forEach((text, index) => {
    if (cited.has(index)) return;
    const head = headOf(text);
    if (bannerHeads.some((b) => head.startsWith(b.slice(0, 24)) || b.startsWith(head.slice(0, 24)))) return;
    if (ADVISORY.test(text)) return;
    if (!leaves.some((l) => namesIn(index, l.ingredient))) return;
    findings.push({
      rule: 'F3',
      detail: `step ${index + 1} ("${head.slice(0, 48)}") names ingredients but appears nowhere on the card`,
    });
  });

  // F4 — every operation points at a real step. The synthetic joiner is L5's.
  for (const op of ops) {
    if (isSynthetic(op, raw)) continue;
    if (op.sourceStep < 0 || op.sourceStep >= raw.stepTexts.length) {
      findings.push({
        rule: 'F4',
        detail: `${describe(op)} cites step ${op.sourceStep + 1}, which the recipe does not have`,
      });
    }
  }

  // F5 — work cannot consume output from a step that had not happened yet.
  for (const op of ops) {
    if (isSynthetic(op, raw)) continue;
    for (const child of op.children) {
      if (child.kind !== 'op') continue;
      if (child.sourceStep >= op.sourceStep) {
        findings.push({
          rule: 'F5',
          detail:
            `${describe(op)} (step ${op.sourceStep + 1}) consumes ${describe(child)} ` +
            `from step ${child.sourceStep + 1}, which is not earlier`,
        });
      }
    }
  }

  // F6 — no heat above an ingredient the recipe never heats.
  //
  // Heat legitimately reaches things a step never names ("add the flour, then
  // bake"), so flagging every unnamed-but-heated ingredient would flag most of
  // every recipe. The check fires on one unambiguous signature: an ingredient
  // the recipe explicitly parked, heated afterwards as a passenger.
  for (const { leaf, ancestors } of pathsToLeaves(root)) {
    if (leaf.kind !== 'ingredient') continue;
    if (searchPhrases(leaf.ingredient).length === 0) continue;

    const parkedAt = raw.stepTexts.findIndex(
      (text, index) => namesIn(index, leaf.ingredient) && tokenize(text).some((w) => PARK.has(w)),
    );
    if (parkedAt < 0) continue;

    for (const ancestor of ancestors) {
      if (ancestor === root) continue; // The root is where branches are meant to meet.
      if (ancestor.kind !== 'op') continue;
      if (!HEAT.has(verbOf(ancestor))) continue;
      if (namesIn(ancestor.sourceStep, leaf.ingredient)) continue;
      if (parkedAt >= ancestor.sourceStep) continue; // A later storage note says nothing.

      // Did the step have a subject of its own that swept this branch in?
      const hasNamedSubject = leavesOf(ancestor).some(
        (other) =>
          other !== leaf && other.kind === 'ingredient' && namesIn(ancestor.sourceStep, other.ingredient),
      );
      if (!hasNamedSubject) continue;

      findings.push({
        rule: 'F6',
        detail:
          `"${leaf.ingredient.name}" is put away in step ${parkedAt + 1} but ${describe(ancestor)} ` +
          `(step ${ancestor.sourceStep + 1}) applies heat to it, and that step never mentions it`,
      });
      break;
    }
  }

  // F7 — an operation's own ingredients are the ones its step names.
  //
  // Only fires when some *other* step names the ingredient: one that no step
  // mentions had nowhere better to go, and the root legitimately collects them.
  for (const op of ops) {
    if (op === root || isSynthetic(op, raw)) continue;
    for (const child of op.children) {
      if (child.kind !== 'ingredient') continue;
      if (namesIn(op.sourceStep, child.ingredient)) continue;
      const namedBy = raw.stepTexts.findIndex((_, i) => namesIn(i, child.ingredient));
      if (namedBy < 0) continue;
      findings.push({
        rule: 'F7',
        detail:
          `${describe(op)} (step ${op.sourceStep + 1}) takes "${child.ingredient.name}", ` +
          `but only step ${namedBy + 1} names it`,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Tier L — legibility. True but unpleasant.
// ---------------------------------------------------------------------------

export interface LegibilityLimits {
  /** Operation columns allowed per source step before the table sprawls. */
  columnsPerStep: number;
  /** Share of ingredients allowed to hang off the root with no operation. */
  orphanRate: number;
}

/** Measured from the captured fixtures, not invented — see docs/recipe-card-rules.md. */
export const DEFAULT_LIMITS: LegibilityLimits = { columnsPerStep: 1, orphanRate: 0.8 };

function checkLegibility(recipe: Recipe, raw: RawRecipe, limits: LegibilityLimits): Finding[] {
  const findings: Finding[] = [];
  const root = recipe.root;
  if (!root) return findings;

  for (const op of opsOf(root)) {
    // L1 — a terse verb phrase, not a sentence.
    if (op.label.trim().length === 0) {
      findings.push({ rule: 'L1', detail: 'an operation has an empty label' });
    } else if (op.label.length > MAX_LABEL) {
      findings.push({
        rule: 'L1',
        detail: `${describe(op)} is ${op.label.length} characters, over the ${MAX_LABEL} cap`,
      });
    } else if (/[.!?]$/.test(op.label)) {
      findings.push({ rule: 'L1', detail: `${describe(op)} reads as a sentence, not a verb phrase` });
    }

    // L5 — no operation invented to join loose ends. Checked before the guard
    // below, because the synthetic joiner cites a step that does not exist.
    if (isSynthetic(op, raw)) {
      findings.push({
        rule: 'L5',
        detail: `the card invents a "${op.label}" to join ${op.children.length} loose branches`,
      });
    }

    const step = raw.stepTexts[op.sourceStep];
    if (!step) continue;

    // L2 — if the step states a temperature or a duration, the cell shows it.
    if ((TEMPERATURE.test(step) || DURATION.test(step)) && !/\d/.test(op.label)) {
      findings.push({
        rule: 'L2',
        detail: `step ${op.sourceStep + 1} states ${TEMPERATURE.test(step) ? 'a temperature' : 'a duration'} but ${describe(op)} omits it`,
      });
    }

    // L3 — name the work, not the wait.
    if (PARK.has(verbOf(op)) && !DURATION.test(step)) {
      const withoutHold = step.replace(new RegExp(`\\b${verbOf(op)}\\w*\\b`, 'gi'), ' ');
      const alternative = stepLabel(withoutHold);
      if (alternative !== 'prepare' && !PARK.has(alternative.split(' ')[0])) {
        findings.push({
          rule: 'L3',
          detail: `${describe(op)} is a hold with no stated duration; step ${op.sourceStep + 1} also does "${alternative}"`,
        });
      }
    }

    // L6 — a logistics verb wrapping a single operation should have been folded.
    // A label carrying a time or temperature is exempt, matching the same
    // carve-out in `mergeLogisticsSteps`: "place 30 min" is real information.
    if (LOGISTICS.has(verbOf(op)) && !/\d/.test(op.label) &&
        op.children.length === 1 && op.children[0].kind === 'op') {
      findings.push({ rule: 'L6', detail: `${describe(op)} only moves food and wraps a single operation` });
    }

  }

  // L4 — bounded width.
  const columns = column(root);
  const budget = Math.max(2, Math.ceil(raw.stepTexts.length * limits.columnsPerStep));
  if (columns > budget) {
    findings.push({
      rule: 'L4',
      detail: `${columns} operation columns for ${raw.stepTexts.length} steps, over the budget of ${budget}`,
    });
  }

  // L7 — ingredients hanging off the root with no operation of their own.
  const leaves = leavesOf(root);
  if (root.kind === 'op' && leaves.length > 0) {
    const bare = root.children.filter((c) => c.kind === 'ingredient').length;
    const rate = bare / leaves.length;
    if (rate > limits.orphanRate) {
      findings.push({
        rule: 'L7',
        detail: `${bare} of ${leaves.length} ingredients hang off ${describe(root)} unoperated (${Math.round(rate * 100)}%)`,
      });
    }
  }

  // L8 — the rendered amount reads correctly, plurals included.
  for (const leaf of leaves) {
    if (leaf.kind !== 'ingredient') continue;
    const { quantity, unit, raw: line } = leaf.ingredient;
    if (quantity === undefined || quantity <= 1 || !unit) continue;
    if (!/^[a-z]{4,}$/i.test(unit)) continue; // Abbreviations never pluralize.
    const rendered = formatIngredient(leaf);
    if (rendered.includes(`${unit}s`)) continue;
    if (new RegExp(`\\b${unit}s\\b`, 'i').test(line)) {
      findings.push({
        rule: 'L8',
        detail: `"${line}" renders as "${rendered}" — ${quantity} takes the plural "${unit}s"`,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------

export interface GradeOptions {
  /** Rules to skip, for a known defect being fixed separately. */
  skip?: RuleId[];
  limits?: LegibilityLimits;
  /** Grade this grid instead of laying the card out again. */
  grid?: Grid;
}

/**
 * Grade a card. An empty result is a pass.
 *
 * Findings name the rule and the ingredient, never a score — "82" tells you
 * nothing you can act on, "F6 on the Greek yogurt" tells you where to look.
 */
export function gradeCard(recipe: Recipe, raw: RawRecipe, options: GradeOptions = {}): Finding[] {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const skip = new Set<RuleId>(options.skip ?? []);
  const structural = checkStructure(recipe, raw, options.grid);

  // A missing root or a graph that is not a tree makes the later tiers
  // meaningless — and unrunnable, since they walk the tree assuming one. The
  // rules call this INVALID rather than low-scoring, so report it and stop.
  const unusable = structural.some((f) => f.rule === 'S1' || f.rule === 'S2');
  const rest = unusable
    ? []
    : [...checkFaithfulness(recipe, raw), ...checkLegibility(recipe, raw, limits)];

  return [...structural, ...rest].filter((f) => !skip.has(f.rule));
}

/** Findings grouped by tier, for callers that gate the tiers differently. */
export function gradeByTier(
  recipe: Recipe,
  raw: RawRecipe,
  options: GradeOptions = {},
): Record<Tier, Finding[]> {
  const out: Record<Tier, Finding[]> = { S: [], F: [], L: [] };
  for (const finding of gradeCard(recipe, raw, options)) out[tierOf(finding.rule)].push(finding);
  return out;
}
