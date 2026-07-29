/**
 * Linear recipe -> recipe tree.
 *
 * This is the hard part of the product. A recipe page gives us a flat list of
 * ingredients and a sequence of prose steps; the table needs to know which
 * ingredients each step consumes and how the steps nest.
 *
 * The approach is deliberately mechanical and inspectable:
 *
 *   - Match ingredients to steps by looking for their most distinctive phrase,
 *     longest first. Each ingredient belongs to the first step that claims it.
 *   - Keep a stack of pending outputs. A step consumes prior output when it
 *     says so ("stir into the batter"), when its verb implies it ("add"), or
 *     when it introduced no new ingredients and therefore must be acting on
 *     something already made.
 *   - Steps that only prepare equipment become full-width banner rows.
 *
 * It reports a confidence score rather than pretending to be certain, so the
 * caller can escalate to the Claude fallback or drop to a flat table.
 */

import { parseIngredient, headNoun, searchPhrases, singularize } from './ingredient.js';
import { toCelsius } from './units.js';
import type { Ingredient, RawRecipe, Recipe, RecipeNode } from './types.js';

/** Steps that only ready the kitchen. Checked before ingredient matching, so
 *  "butter and flour an 8x8-in pan" does not eat the butter and the flour. */
const PREP_PATTERNS = [
  /\bpreheat\b/i,
  /\bpre-heat\b/i,
  /\bposition\b.{0,20}\brack\b/i,
  /\b(grease|butter|flour|spray|oil|line)\b.{0,40}\b(pan|tin|sheet|dish|tray|mould|mold|skillet|ramekin|pot)\b/i,
  /\bline\b.{0,30}\b(parchment|baking paper|foil)\b/i,
  /\b(prepare|set up|ready)\b.{0,20}\b(pan|tin|sheet|dish|grill|oven|steamer|station)\b/i,
  /\bbring\b.{0,20}\bto room temperature\b/i,
];

/** Phrases meaning "the thing you just made". */
const ANAPHORA =
  /\b(the |your |this )?(mixture|batter|dough|sauce|filling|frosting|glaze|marinade|paste|purée|puree|dressing|custard|syrup|caramel|roux|slurry|dry ingredients|wet ingredients|flour mixture|butter mixture|egg mixture|sugar mixture|creamed mixture|chocolate mixture)\b/i;

/** Verbs whose object is implicitly the work in progress. */
const ADDITIVE =
  /\b(add|stir in|mix in|fold in|whisk in|beat in|pour in|pour into|stir into|fold into|mix into|combine|incorporate|blend in|transfer|return|top with|sprinkle over|spread over|layer)\b/i;

/** Verbs that end a preparation and therefore sweep up everything pending. */
const TERMINAL = new Set([
  'bake', 'roast', 'broil', 'grill', 'fry', 'cook', 'simmer', 'boil', 'steam',
  'poach', 'chill', 'freeze', 'refrigerate', 'serve', 'rest', 'cool', 'set',
  'sear', 'braise', 'air-fry', 'microwave', 'proof', 'rise',
]);

/** Cooking verbs we recognize, longest phrasing first so "fold in" beats "fold". */
const VERBS = [
  'stir in', 'stir into', 'stir together', 'mix in', 'mix into', 'mix together',
  'fold in', 'fold into', 'whisk in', 'whisk together', 'beat in', 'beat together',
  'pour in', 'pour into', 'pour over', 'bring to a boil', 'set aside', 'let rest',
  'let cool', 'let rise', 'cut in', 'top with', 'melt', 'mix', 'stir', 'whisk',
  'beat', 'cream', 'fold', 'combine', 'add', 'pour', 'sift', 'knead', 'roll',
  'chop', 'slice', 'dice', 'mince', 'grate', 'peel', 'drain', 'rinse', 'soak',
  'marinate', 'season', 'sprinkle', 'spread', 'layer', 'arrange', 'transfer',
  'bake', 'roast', 'broil', 'grill', 'fry', 'sauté', 'saute', 'sear', 'simmer',
  'boil', 'steam', 'poach', 'cook', 'heat', 'warm', 'chill', 'refrigerate',
  'freeze', 'cool', 'rest', 'serve', 'garnish', 'divide', 'scoop', 'drop',
  'shape', 'form', 'press', 'brush', 'dust', 'whip', 'blend', 'purée', 'puree',
  'process', 'pulse', 'toss', 'mash', 'crush', 'squeeze', 'zest', 'reduce',
  'strain', 'cover', 'wrap', 'braise', 'microwave', 'assemble', 'spoon', 'place',
];

const VERB_SOURCE = `\\b(${VERBS.map((v) => v.replace(/\s/g, '\\s+')).join('|')})\\b`;
const VERB_PATTERN = new RegExp(VERB_SOURCE, 'i');
const VERB_PATTERN_ALL = new RegExp(VERB_SOURCE, 'gi');

/** Does this verb phrase end a preparation? "let cool" counts, via "cool". */
function isTerminalPhrase(phrase: string): boolean {
  return phrase.split(/\s+/).some((word) => TERMINAL.has(word));
}

/**
 * Reduce text to singularized word tokens.
 *
 * Matching has to be word-by-word, not substring: "unsalted butter" contains
 * the letters of "salt", and a substring match happily melts the table salt
 * along with the butter.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(singularize);
}

/** Do the words of `phrase` appear consecutively in `haystack`? */
function mentions(haystack: string[], phrase: string): boolean {
  const needle = tokenize(phrase);
  if (needle.length === 0 || needle.length > haystack.length) return false;

  for (let start = 0; start + needle.length <= haystack.length; start++) {
    let matched = true;
    for (let offset = 0; offset < needle.length; offset++) {
      if (haystack[start + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/** The short operation label for a step: verb plus temperature and time. */
export function stepLabel(text: string): string {
  // A step often opens with logistics and ends with the real action —
  // "pour the batter into the pan, then bake at 350°F". The cooking verb is
  // what belongs in the cell, so prefer it over whichever verb came first.
  const found = [...text.matchAll(VERB_PATTERN_ALL)].map((m) =>
    m[1].toLowerCase().replace(/\s+/g, ' '),
  );
  const verbMatch = VERB_PATTERN.exec(text);
  let label =
    found.find(isTerminalPhrase) ??
    (verbMatch ? verbMatch[1].toLowerCase().replace(/\s+/g, ' ') : 'prepare');

  // "mix together" and "whisk together" read better without the adverb.
  label = label.replace(/\s+together$/, '');

  const parts = [label];

  const fahrenheit = /(\d{2,3})\s*(?:°|&deg;|\s)?\s*(?:degrees\s*)?F\b/i.exec(text);
  const celsius = /(\d{2,3})\s*(?:°|&deg;|\s)?\s*(?:degrees\s*)?C\b/i.exec(text);
  if (fahrenheit) {
    const f = Number(fahrenheit[1]);
    parts.push(`${f}°F (${toCelsius(f)}°C)`);
  } else if (celsius) {
    parts.push(`${Number(celsius[1])}°C`);
  }

  const time = /(\d+)\s*(?:(?:to|-|–|—)\s*(\d+)\s*)?(minutes?|mins?|hours?|hrs?|seconds?|secs?)\b/i.exec(text);
  if (time) {
    const unit = /^h/i.test(time[3]) ? 'hr' : /^s/i.test(time[3]) ? 'sec' : 'min';
    parts.push(time[2] ? `${time[1]} to ${time[2]} ${unit}` : `${time[1]} ${unit}`);
  }

  return parts.join(' ');
}

function isPrep(text: string): boolean {
  return PREP_PATTERNS.some((p) => p.test(text));
}

/** Shorten a prep instruction to something that fits a banner row. */
function bannerText(text: string): string {
  const firstSentence = text.split(/(?<=[.!?])\s+/)[0].trim();
  const trimmed = firstSentence.replace(/\.$/, '');
  return trimmed.length > 90 ? `${trimmed.slice(0, 87).trimEnd()}…` : trimmed;
}

interface Matcher {
  ingredient: Ingredient;
  node: RecipeNode;
  phrases: string[];
  /** True when the bare head noun is unique enough to match on its own. */
  headIsDistinctive: boolean;
  claimed: boolean;
}

function buildMatchers(lines: string[]): Matcher[] {
  const ingredients = lines.map(parseIngredient);

  const headCounts = new Map<string, number>();
  for (const ingredient of ingredients) {
    const head = headNoun(ingredient);
    if (head) headCounts.set(head, (headCounts.get(head) ?? 0) + 1);
  }

  return ingredients.map((ingredient) => ({
    ingredient,
    node: { kind: 'ingredient', ingredient } as RecipeNode,
    phrases: searchPhrases(ingredient),
    headIsDistinctive: (headCounts.get(headNoun(ingredient)) ?? 0) === 1,
    claimed: false,
  }));
}

/** Every ingredient leaf under a node, for spotting revisited work. */
function leavesOf(node: RecipeNode, out: Set<RecipeNode> = new Set()): Set<RecipeNode> {
  if (node.kind === 'ingredient') out.add(node);
  else for (const child of node.children) leavesOf(child, out);
  return out;
}

/**
 * Ingredients this step names that some earlier step already took.
 *
 * "Mix the melted butter with the sugar" names butter again — not to add it
 * twice, but to point at the melting. That reference is how a step says which
 * earlier work it is building on, and missing it strands the earlier operation
 * as a separate branch.
 */
function namesAlreadyClaimed(matchers: Matcher[], stepText: string): RecipeNode[] {
  const haystack = tokenize(stepText);
  const found: RecipeNode[] = [];

  for (const matcher of matchers) {
    if (!matcher.claimed) continue;
    for (let i = 0; i < matcher.phrases.length; i++) {
      const phrase = matcher.phrases[i];
      const isBareHead = i === matcher.phrases.length - 1 && matcher.phrases.length > 1;
      if (isBareHead && !matcher.headIsDistinctive) continue;
      if (mentions(haystack, phrase)) {
        found.push(matcher.node);
        break;
      }
    }
  }

  return found;
}

/** Ingredients this step mentions, claimed in place so no ingredient is used twice. */
function claimIngredients(matchers: Matcher[], stepText: string): RecipeNode[] {
  const haystack = tokenize(stepText);
  const claimed: RecipeNode[] = [];

  for (const matcher of matchers) {
    if (matcher.claimed) continue;

    for (let i = 0; i < matcher.phrases.length; i++) {
      const phrase = matcher.phrases[i];
      const isBareHead = i === matcher.phrases.length - 1 && matcher.phrases.length > 1;
      // Only fall back to the bare head noun when nothing else shares it.
      if (isBareHead && !matcher.headIsDistinctive) continue;
      if (mentions(haystack, phrase)) {
        matcher.claimed = true;
        claimed.push(matcher.node);
        break;
      }
    }
  }

  return claimed;
}

/**
 * Build the tree. Pure: same inputs, same tree, every time.
 */
export function inferTree(raw: RawRecipe, sourceUrl: string): Recipe {
  const matchers = buildMatchers(raw.ingredientLines);
  const banners: string[] = [];
  const pending: RecipeNode[] = [];

  const steps = raw.stepTexts.map((text, index) => ({ text, index }));

  for (const step of steps) {
    if (isPrep(step.text)) {
      banners.push(bannerText(step.text));
      continue;
    }

    // Checked before claiming, so this step's own new ingredients do not
    // count as revisited.
    const revisited = namesAlreadyClaimed(matchers, step.text);
    const fresh = claimIngredients(matchers, step.text);
    const isLast = step.index === steps.length - 1;
    const label = stepLabel(step.text);
    const verb = label.split(' ')[0];

    const referencesPrior =
      ANAPHORA.test(step.text) || ADDITIVE.test(step.text) || fresh.length === 0;

    let consumed: RecipeNode[] = [];
    if (pending.length > 0) {
      const sweepsAll =
        isLast ||
        TERMINAL.has(verb) ||
        // A merge step: talks about earlier work, brings nothing new, and there
        // is more than one loose end to tie together.
        (referencesPrior && fresh.length === 0 && pending.length >= 2);

      if (sweepsAll) {
        consumed = pending.splice(0, pending.length);
      } else {
        // A step that names an ingredient again is pointing at the operation
        // that already holds it — take that one, not just the most recent.
        const revisitedPending = pending.filter((node) => {
          const leaves = leavesOf(node);
          return revisited.some((leaf) => leaves.has(leaf));
        });

        if (revisitedPending.length > 0) {
          consumed = revisitedPending;
          for (const node of revisitedPending) pending.splice(pending.indexOf(node), 1);
        } else if (referencesPrior) {
          consumed = [pending.pop()!];
        }
      }
    }

    // Prior work first, then new ingredients — this is what keeps the melted
    // butter above the sugar in the finished table.
    const inputs = [...consumed, ...fresh];
    if (inputs.length === 0) {
      // Nothing to operate on and nothing new: it is a note, not a step.
      if (isPrepish(step.text)) banners.push(bannerText(step.text));
      continue;
    }

    pending.push({ kind: 'op', label, children: inputs, sourceStep: step.index });
  }

  // Any ingredient no step mentioned still deserves a row. Hang them off the
  // final operation rather than inventing a "combine" wrapper, which would add
  // a phantom column to the right of the real last action.
  const orphans = matchers.filter((m) => !m.claimed).map((m) => m.node);

  let root: RecipeNode | null = null;
  if (pending.length === 1) {
    root = pending[0];
    if (orphans.length > 0 && root.kind === 'op') root.children.push(...orphans);
    else if (orphans.length > 0) {
      root = { kind: 'op', label: 'combine', children: [root, ...orphans], sourceStep: steps.length };
    }
  } else if (pending.length > 1 || orphans.length > 0) {
    const children = [...pending, ...orphans];
    root =
      children.length === 1
        ? children[0]
        : { kind: 'op', label: 'combine', children, sourceStep: steps.length };
  }

  root = mergeLogisticsSteps(root);

  const total = matchers.length;
  const matched = total - orphans.length;

  return {
    title: raw.title,
    banners,
    root,
    yield: raw.yield,
    sourceUrl,
    extraction: raw.strategy,
    inference: 'heuristic',
    confidence: total === 0 ? 0 : matched / total,
  };
}

/**
 * Verbs that move food around without changing it. A 26-step layer cake
 * otherwise produces a 24-column table, most of it logistics.
 */
const LOGISTICS = new Set([
  'prepare', 'place', 'transfer', 'cover', 'return', 'remove', 'set aside',
  'assemble', 'arrange', 'wrap', 'spoon', 'divide', 'set',
]);

/** Longest cell text we are willing to create by merging labels. */
const MAX_MERGED_LABEL = 58;

/**
 * Fold a logistics operation into the single operation it wraps, so the table
 * gets a column per transformation rather than a column per sentence.
 *
 * Only applies when the logistics step introduced no ingredients of its own —
 * if it did, it is doing real work and keeps its column. A step that carries a
 * temperature or a time is never merged away either.
 */
function mergeLogisticsSteps(node: RecipeNode | null): RecipeNode | null {
  if (!node || node.kind !== 'op') return node;

  const children = node.children.map((c) => mergeLogisticsSteps(c)!) as RecipeNode[];
  const merged: RecipeNode = { ...node, children };

  const onlyChild = children.length === 1 ? children[0] : undefined;
  if (!onlyChild || onlyChild.kind !== 'op') return merged;

  const verb = merged.label.split(' ')[0];
  const carriesDetail = /\d/.test(merged.label);
  if (!LOGISTICS.has(verb) || carriesDetail) return merged;

  // Repeating "prepare, prepare, prepare" helps nobody, and the placeholder
  // "prepare" earns its space only when it is the sole thing we can say.
  const all = [...new Set([...onlyChild.label.split(', '), merged.label])];
  const parts = all.length > 1 ? all.filter((p) => p !== 'prepare') : all;
  if (parts.length === 0) return merged;
  const combined = parts.join(', ');
  return {
    kind: 'op',
    label: combined.length <= MAX_MERGED_LABEL ? combined : onlyChild.label,
    children: onlyChild.children,
    sourceStep: onlyChild.sourceStep,
  };
}

/** A trailing note like "Store in an airtight container" is banner-ish. */
function isPrepish(text: string): boolean {
  return /\b(store|keep|serve|enjoy|makes|note|tip|leftover)\b/i.test(text);
}

/**
 * Last resort: one column per step, each consuming everything above it. Always
 * produces a readable table, never claims to understand the recipe.
 */
export function flatTree(raw: RawRecipe, sourceUrl: string): Recipe {
  const ingredients = raw.ingredientLines.map(parseIngredient);
  const nodes: RecipeNode[] = ingredients.map((ingredient) => ({ kind: 'ingredient', ingredient }));

  if (nodes.length === 0) {
    return {
      title: raw.title,
      banners: raw.stepTexts.map(bannerText),
      root: null,
      yield: raw.yield,
      sourceUrl,
      extraction: raw.strategy,
      inference: 'flat',
      confidence: 0,
    };
  }

  let root: RecipeNode =
    nodes.length === 1 ? nodes[0] : { kind: 'op', label: 'combine', children: nodes, sourceStep: 0 };

  const banners: string[] = [];
  raw.stepTexts.forEach((text, index) => {
    if (isPrep(text)) {
      banners.push(bannerText(text));
      return;
    }
    if (index === 0 && nodes.length > 1) {
      root = { kind: 'op', label: stepLabel(text), children: nodes, sourceStep: index };
      return;
    }
    root = { kind: 'op', label: stepLabel(text), children: [root], sourceStep: index };
  });

  return {
    title: raw.title,
    banners,
    root,
    yield: raw.yield,
    sourceUrl,
    extraction: raw.strategy,
    inference: 'flat',
    confidence: 0,
  };
}
