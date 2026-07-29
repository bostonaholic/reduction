/**
 * Getting a recipe off an arbitrary page.
 *
 * Three strategies, tried in order of how much we can trust them:
 *
 *   1. JSON-LD schema.org/Recipe — what most publishers ship for Google.
 *   2. Microdata — the older schema.org encoding, still common on food blogs.
 *   3. DOM heuristics — recipe-plugin markup, then "Ingredients"/"Instructions"
 *      headings followed by lists.
 *
 * Everything here takes a Document and returns plain data, so it runs
 * identically in a content script and in a jsdom test.
 */

import type { ExtractionStrategy, RawRecipe } from './types.js';

/** Thrown when no strategy found a recipe. Loud, with the reason. */
export class NoRecipeFound extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoRecipeFound';
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', deg: '°', frac12: '½', frac14: '¼', frac34: '¾',
};

/** Strip tags and decode entities without touching the DOM. */
export function plainText(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|li|div|h[1-6])>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z][a-z0-9]*);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Walk any JSON-LD payload and yield every object in it. */
function* walkJsonLd(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const item of value) yield* walkJsonLd(item);
    return;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    yield obj;
    if ('@graph' in obj) yield* walkJsonLd(obj['@graph']);
  }
}

function hasType(obj: Record<string, unknown>, wanted: string): boolean {
  const type = obj['@type'];
  if (typeof type === 'string') return type.toLowerCase() === wanted;
  if (Array.isArray(type)) return type.some((t) => String(t).toLowerCase() === wanted);
  return false;
}

/** schema.org fields are maddeningly polymorphic; coerce to a string. */
function asText(value: unknown): string {
  if (typeof value === 'string') return plainText(value);
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(', ');
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['text', 'name', '@value']) {
      if (typeof obj[key] === 'string') return plainText(obj[key] as string);
    }
  }
  return '';
}

/**
 * recipeInstructions in the wild: a paragraph, an array of strings, an array
 * of HowToStep, an array of HowToSection each holding its own steps, or any
 * mixture of those.
 */
function flattenInstructions(value: unknown): string[] {
  if (!value) return [];

  if (typeof value === 'string') return splitProse(plainText(value));

  if (Array.isArray(value)) return value.flatMap(flattenInstructions);

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (hasType(obj, 'howtosection')) {
      return flattenInstructions(obj.itemListElement ?? obj.steps);
    }
    if (obj.itemListElement) return flattenInstructions(obj.itemListElement);
    const text = asText(obj.text ?? obj.name ?? obj.description);
    return text ? [text] : [];
  }

  return [];
}

/** One blob of instruction prose into individual steps. */
export function splitProse(text: string): string[] {
  const byLine = text
    .split(/\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (byLine.length > 1) return byLine.map(stripStepNumber).filter(Boolean);

  // "Step 1 ... Step 2 ..." or "1. ... 2. ..."
  const numbered = text.split(/(?:^|\s)(?:Step\s*)?\d{1,2}[.)]\s+/i).filter((s) => s.trim());
  if (numbered.length > 1) return numbered.map((s) => s.trim());

  // Fall back to sentences, grouped in pairs so steps are not absurdly short.
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])/).filter((s) => s.trim());
  if (sentences.length <= 1) return text ? [text] : [];
  const grouped: string[] = [];
  for (let i = 0; i < sentences.length; i += 2) {
    grouped.push(sentences.slice(i, i + 2).join(' ').trim());
  }
  return grouped;
}

function stripStepNumber(line: string): string {
  return line.replace(/^(?:step\s*)?\d{1,2}[.):]\s*/i, '').trim();
}

function fromJsonLd(doc: Document): RawRecipe | null {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');

  for (const script of Array.from(scripts)) {
    const source = script.textContent?.trim();
    if (!source) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      // Some sites emit JSON-LD with a trailing comment or stray semicolon.
      try {
        parsed = JSON.parse(source.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '').replace(/;\s*$/, ''));
      } catch {
        continue;
      }
    }

    for (const node of walkJsonLd(parsed)) {
      if (!hasType(node, 'recipe')) continue;

      const ingredientLines = (
        Array.isArray(node.recipeIngredient)
          ? node.recipeIngredient
          : Array.isArray(node.ingredients)
            ? node.ingredients
            : []
      )
        .map(asText)
        .filter(Boolean);

      const stepTexts = flattenInstructions(node.recipeInstructions).filter(Boolean);

      if (ingredientLines.length === 0 && stepTexts.length === 0) continue;

      return {
        title: asText(node.name) || doc.title || 'Recipe',
        ingredientLines,
        stepTexts,
        yield: asText(node.recipeYield) || undefined,
        strategy: 'json-ld',
      };
    }
  }

  return null;
}

function textOf(el: Element | null | undefined): string {
  return el ? plainText(el.textContent ?? '') : '';
}

function fromMicrodata(doc: Document): RawRecipe | null {
  const scope = doc.querySelector('[itemtype*="schema.org/Recipe" i]');
  if (!scope) return null;

  const pick = (prop: string) =>
    Array.from(scope.querySelectorAll(`[itemprop="${prop}"]`))
      .map((el) => textOf(el))
      .filter(Boolean);

  const ingredientLines = [...pick('recipeIngredient'), ...pick('ingredients')];
  let stepTexts = pick('recipeInstructions');

  // A single container holding the whole method rather than one node per step.
  if (stepTexts.length === 1) stepTexts = splitProse(stepTexts[0]);

  if (ingredientLines.length === 0 && stepTexts.length === 0) return null;

  return {
    title: pick('name')[0] || textOf(doc.querySelector('h1')) || doc.title || 'Recipe',
    ingredientLines,
    stepTexts,
    yield: pick('recipeYield')[0] || undefined,
    strategy: 'microdata',
  };
}

/** Markup emitted by the recipe plugins that dominate food blogs. */
const PLUGIN_SELECTORS = {
  ingredients: [
    '.wprm-recipe-ingredient',
    '.tasty-recipes-ingredients li',
    '.tasty-recipe-ingredients li',
    '.mv-create-ingredients li',
    '.recipe-ingredients li',
    '.ingredients-item',
    '[class*="ingredient"] li',
  ],
  steps: [
    '.wprm-recipe-instruction',
    '.tasty-recipes-instructions li',
    '.tasty-recipe-instructions li',
    '.mv-create-instructions li',
    '.recipe-instructions li',
    '.instructions-section li',
    '[class*="instruction"] li',
  ],
};

function firstMatching(doc: Document, selectors: string[]): string[] {
  for (const selector of selectors) {
    let found: Element[];
    try {
      found = Array.from(doc.querySelectorAll(selector));
    } catch {
      continue; // Malformed selector on an exotic DOM.
    }
    const texts = found.map(textOf).filter((t) => t.length > 2);
    if (texts.length >= 2) return texts;
  }
  return [];
}

const INGREDIENT_HEADING = /^\s*ingredients?\b/i;
const STEP_HEADING = /^\s*(instructions?|directions?|method|steps|preparation)\b/i;

/** Items in the first list that follows a heading. */
function listAfterHeading(doc: Document, pattern: RegExp): string[] {
  const headings = Array.from(doc.querySelectorAll('h1,h2,h3,h4,h5,h6,legend,strong'));
  for (const heading of headings) {
    if (!pattern.test(heading.textContent ?? '')) continue;

    let node: Element | null = heading;
    for (let hops = 0; node && hops < 6; hops++) {
      node = node.nextElementSibling;
      if (!node) break;
      const list = node.matches('ul,ol') ? node : node.querySelector('ul,ol');
      if (list) {
        const items = Array.from(list.querySelectorAll('li')).map(textOf).filter(Boolean);
        if (items.length >= 2) return items;
      }
      const paragraphs = Array.from(node.querySelectorAll('p')).map(textOf).filter(Boolean);
      if (paragraphs.length >= 2) return paragraphs;
    }

    // Some layouts nest the list inside the heading's parent section.
    const section = heading.parentElement;
    const list = section?.querySelector('ul,ol');
    if (list) {
      const items = Array.from(list.querySelectorAll('li')).map(textOf).filter(Boolean);
      if (items.length >= 2) return items;
    }
  }
  return [];
}

function fromHeuristics(doc: Document): RawRecipe | null {
  const ingredientLines =
    firstMatching(doc, PLUGIN_SELECTORS.ingredients).length > 0
      ? firstMatching(doc, PLUGIN_SELECTORS.ingredients)
      : listAfterHeading(doc, INGREDIENT_HEADING);

  const stepTexts =
    firstMatching(doc, PLUGIN_SELECTORS.steps).length > 0
      ? firstMatching(doc, PLUGIN_SELECTORS.steps)
      : listAfterHeading(doc, STEP_HEADING);

  if (ingredientLines.length === 0 || stepTexts.length === 0) return null;

  return {
    title: textOf(doc.querySelector('h1')) || doc.title || 'Recipe',
    ingredientLines,
    stepTexts,
    strategy: 'heuristic',
  };
}

const STRATEGIES: Array<[ExtractionStrategy, (doc: Document) => RawRecipe | null]> = [
  ['json-ld', fromJsonLd],
  ['microdata', fromMicrodata],
  ['heuristic', fromHeuristics],
];

/**
 * Pull a recipe off the page, or throw with the reason.
 *
 * A result with steps but no ingredients is still returned — the flat
 * fallback renderer can do something useful with it, and a partial answer
 * beats a blank overlay.
 */
export function extractRecipe(doc: Document): RawRecipe {
  const attempts: string[] = [];

  for (const [name, strategy] of STRATEGIES) {
    let result: RawRecipe | null = null;
    try {
      result = strategy(doc);
    } catch (err) {
      attempts.push(`${name} threw: ${(err as Error).message}`);
      continue;
    }
    if (result && (result.ingredientLines.length > 0 || result.stepTexts.length > 0)) {
      return result;
    }
    attempts.push(`${name} found nothing`);
  }

  throw new NoRecipeFound(`No recipe on this page (${attempts.join('; ')})`);
}
