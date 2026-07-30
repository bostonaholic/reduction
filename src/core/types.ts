/**
 * Core data model for Reduction.
 *
 * A Cooking For Engineers table is a left-to-right rendering of a tree:
 * leaves are ingredients (one row each), internal nodes are operations, an
 * operation's rowspan is the leaf count of its subtree, and its column is its
 * depth. Everything in this file is plain data — no DOM, no browser.
 */

/** A single parsed ingredient line. */
export interface Ingredient {
  /** The original text, kept verbatim so we can always fall back to it. */
  raw: string;
  /** Numeric amount, e.g. 0.5 for "1/2". Absent for "salt to taste". */
  quantity?: number;
  /** Unit as written, normalized to a canonical short form ("cup", "tsp", "oz"). */
  unit?: string;
  /** Metric equivalent rendered in parentheses, e.g. "115 g". */
  metric?: string;
  /** The ingredient itself, e.g. "all-purpose flour". */
  name: string;
  /** Trailing preparation note, e.g. "melted", "finely chopped". */
  note?: string;
}

/** One instruction from the source recipe, before we know what it consumes. */
export interface Step {
  /** Full instruction text. */
  text: string;
  /** Position in the source recipe. */
  index: number;
}

/** A node in the recipe tree. */
export type RecipeNode =
  | { kind: 'ingredient'; ingredient: Ingredient }
  | { kind: 'op'; label: string; children: RecipeNode[]; sourceStep: number };

/** How the tree was produced, surfaced to the user so a bad parse is visible. */
export type InferenceStrategy = 'heuristic' | 'claude' | 'flat';

/** Where the raw recipe data came from. */
export type ExtractionStrategy = 'json-ld' | 'microdata' | 'heuristic';

/** Raw recipe data straight off the page, before normalization. */
export interface RawRecipe {
  title: string;
  ingredientLines: string[];
  stepTexts: string[];
  yield?: string;
  strategy: ExtractionStrategy;
  /**
   * Notices produced during extraction — currently only that a list hit its
   * size cap. Every tree constructor surfaces them as leading banner rows,
   * so a truncated diagram is never presented as complete.
   */
  truncationBanners?: string[];
}

/** A fully processed recipe, ready to lay out. */
export interface Recipe {
  title: string;
  /** Full-width prep rows that consume no ingredients (preheat, grease a pan). */
  banners: string[];
  root: RecipeNode | null;
  yield?: string;
  sourceUrl: string;
  extraction: ExtractionStrategy;
  inference: InferenceStrategy;
  /** 0–1. Fraction of ingredients we managed to attach to a step. */
  confidence: number;
}

export type CellKind = 'banner' | 'ingredient' | 'op' | 'filler';

/** One table cell with its grid position and spans. */
export interface Cell {
  text: string;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  kind: CellKind;
}

/** The laid-out table. */
export interface Grid {
  cells: Cell[];
  rows: number;
  cols: number;
}

/** Type guard, used constantly in the layout code. */
export function isIngredient(
  node: RecipeNode,
): node is Extract<RecipeNode, { kind: 'ingredient' }> {
  return node.kind === 'ingredient';
}
