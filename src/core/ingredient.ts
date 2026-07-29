/**
 * Ingredient line parsing.
 *
 * Turns "1/2 cup (80 g) all-purpose flour, sifted" into structured data, and
 * derives the search phrases used later to work out which instruction step
 * consumes which ingredient.
 *
 * The parser is deliberately forgiving: when it cannot make sense of a line it
 * keeps the original text and leaves the structured fields empty, so a weird
 * ingredient degrades to "printed verbatim" rather than "dropped".
 */

import type { Ingredient } from './types.js';
import { UNIT_PATTERN, canonicalUnit, metricEquivalent, normalizeText, parseAmount } from './units.js';

/** Leading list decorations that recipe plugins inject. */
const BULLET = /^[\s▢☐☑▪●•·*\-–—]+/;

/** Budget Bytes and friends append a per-ingredient cost. */
const PRICE = /\(\s*[$£€]\s*[\d.,]+\s*\)/g;

/** Footnote markers pointing at a note below the ingredient list. */
const FOOTNOTE = /\s*\*+(?=\s|$)/g;

/** Parenthetical asides that are commentary, not amounts. */
const ASIDE = /\((optional|divided|to taste|or more to taste|plus more[^)]*|see note[^)]*|note \d*)\)/gi;

/**
 * A trailing clause is a preparation note rather than part of the name when it
 * starts like one. Without this check, "boneless, skinless chicken breast"
 * loses everything after the first comma.
 */
const NOTE_STARTER =
  /^(?:[a-z-]+ed\b|to taste|optional|divided|plus more|for (?:garnish|serving|dusting|brushing|greasing)|at room temperature|room temperature|cut into|finely|thinly|roughly|coarsely|freshly|well[- ]shaken|packed|lightly|about|approximately|or more|or less|if (?:desired|needed|using)|preferably|homemade|store[- ]bought)\b/i;

/** A seasoning-to-taste suffix, with or without the comma that would make it a note. */
const TO_TASTE = /\s*,?\s*\bto taste\b\.?$/i;

/** A metric amount already supplied by the site, e.g. "(80 g)". */
const EXISTING_METRIC = /\((\d[\d.,/\s]*)\s*(g|kg|ml|l|grams?|kilograms?|millilitres?|milliliters?|litres?|liters?)\)/i;

/** "1 1/2", "3/4", "2.5", "2" — optionally a range, in which case we take the low end. */
const LEADING_AMOUNT = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+)(?:\s*(?:-|–|to)\s*(?:\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+))?/;

const UNIT_AT_START = new RegExp(`^(${UNIT_PATTERN})\\b\\.?`, 'i');

/** Words that describe an ingredient but never identify it. */
const DESCRIPTORS = new Set([
  'fresh', 'freshly', 'large', 'medium', 'small', 'extra', 'virgin', 'ripe', 'very',
  'chopped', 'finely', 'roughly', 'coarsely', 'thinly', 'ground', 'grated', 'shredded',
  'unsalted', 'salted', 'granulated', 'packed', 'softened', 'melted', 'room',
  'temperature', 'plus', 'more', 'optional', 'divided', 'cold', 'warm', 'hot',
  'dried', 'dry', 'frozen', 'canned', 'organic', 'pure', 'whole', 'low', 'fat',
  'boneless', 'skinless', 'kosher', 'sea', 'and', 'or', 'of', 'the', 'a', 'an',
  'sifted', 'beaten', 'lightly', 'toasted', 'peeled', 'seeded', 'cored', 'trimmed',
  'good', 'quality', 'best', 'about', 'approximately', 'level', 'heaping', 'rounded',
  'plain', 'natural', 'raw', 'cooked', 'uncooked', 'skimmed', 'reduced', 'sodium',
  // Shapes a thing is sold in, never what a step calls it: an instruction says
  // "warm the pita bread", not "warm the pita bread rounds".
  'round', 'rounds',
]);

/** Descriptors we keep because they distinguish one ingredient from another. */
const DISTINGUISHING = new Set([
  'all-purpose', 'bread', 'cake', 'wheat', 'almond', 'coconut', 'baking', 'brown',
  'powdered', 'confectioners', 'white', 'dark', 'semisweet', 'semi-sweet', 'milk',
  'unsweetened', 'sweetened', 'heavy', 'sour', 'olive', 'vegetable', 'canola',
  'self-rising', 'self-raising', 'rolled', 'steel-cut', 'vanilla', 'lemon', 'lime',
  'orange', 'black', 'red', 'green', 'yellow', 'sweet', 'hot', 'smoked',
]);

/** Very rough singularizer — enough to match "eggs" against "egg". */
export function singularize(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('oes') || word.endsWith('ses') || word.endsWith('xes')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** Parse a single ingredient line. */
export function parseIngredient(rawLine: string): Ingredient {
  const raw = normalizeText(rawLine).replace(BULLET, '').trim();

  // Strip site furniture that would otherwise end up in the ingredient name
  // and, worse, at the end of it where the head noun is taken from.
  let asideNote: string | undefined;
  const asides = raw.match(ASIDE);
  if (asides) asideNote = asides.map((a) => a.slice(1, -1)).join(', ');

  let rest = raw
    .replace(PRICE, ' ')
    .replace(ASIDE, ' ')
    .replace(FOOTNOTE, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // A metric amount the site already provided beats anything we would compute.
  let metric: string | undefined;
  const existing = EXISTING_METRIC.exec(rest);
  if (existing) {
    const unit = existing[2].toLowerCase();
    const short = unit.startsWith('k') ? 'kg' : unit.startsWith('g') ? 'g' : unit.startsWith('m') ? 'mL' : 'L';
    metric = `${existing[1].trim()} ${short}`;
    rest = rest.replace(EXISTING_METRIC, ' ').replace(/\s+/g, ' ').trim();
  }

  let quantity: number | undefined;
  const amount = LEADING_AMOUNT.exec(rest);
  if (amount) {
    quantity = parseAmount(amount[1]);
    rest = rest.slice(amount[0].length).trim();
  }

  // A size parenthetical such as "1 (14.5 ounce) can" belongs to the name.
  let sizeNote: string | undefined;
  const size = /^\(([^)]*)\)\s*/.exec(rest);
  if (size) {
    sizeNote = size[1].trim();
    rest = rest.slice(size[0].length).trim();
  }

  let unit: string | undefined;
  const unitMatch = UNIT_AT_START.exec(rest);
  if (unitMatch) {
    const candidate = canonicalUnit(unitMatch[1]);
    // "large" is only a unit when a number precedes it ("2 large eggs").
    if (candidate && (quantity !== undefined || !['large', 'medium', 'small'].includes(candidate))) {
      unit = candidate;
      rest = rest.slice(unitMatch[0].length).trim();
    }
  }

  // "Salt and black pepper to taste" has no comma to hang the note off, and
  // without this the head noun comes out as "taste" — which no step ever says.
  let note: string | undefined;
  if (TO_TASTE.test(rest)) {
    note = 'to taste';
    rest = rest.replace(TO_TASTE, '').trim();
  }

  // A trailing clause becomes a note only when it reads like one, so that
  // "boneless, skinless chicken breast" keeps its whole name.
  const comma = rest.indexOf(',');
  if (comma > 0) {
    const tail = rest.slice(comma + 1).trim();
    if (NOTE_STARTER.test(tail)) {
      note = tail || undefined;
      rest = rest.slice(0, comma).trim();
    }
  }

  let name = rest.replace(/^of\s+/i, '').trim();
  if (sizeNote) name = `${sizeNote} ${name}`.trim();
  if (!name) name = raw;
  if (asideNote) note = note ? `${note}, ${asideNote}` : asideNote;

  if (!metric) metric = metricEquivalent(quantity, unit, name);

  return { raw, quantity, unit, metric, name, note };
}

/**
 * Phrases to look for in instruction text, most distinctive first.
 *
 * "1/2 cup all-purpose flour" yields ["all-purpose flour", "flour"]; matching
 * the longer phrase first is what stops "baking soda" being claimed by a step
 * that only mentions "baking powder".
 */
export function searchPhrases(ingredient: Ingredient): string[] {
  const cleaned = ingredient.name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    // A bare number is never what an instruction calls an ingredient by.
    .filter((w) => w && !/^[\d.-]+$/.test(w) && !/^\d+(oz|g|kg|ml|lb|in|cm)$/.test(w));

  const content = cleaned.filter((w) => DISTINGUISHING.has(w) || !DESCRIPTORS.has(w));
  const words = content.length > 0 ? content : cleaned;
  if (words.length === 0) return [];

  const phrases: string[] = [];
  if (words.length > 1) phrases.push(words.join(' '));
  if (words.length > 2) phrases.push(words.slice(-2).join(' '));
  phrases.push(words[words.length - 1]);

  return [...new Set(phrases)].filter((p) => p.length >= 3);
}

/**
 * The single least-specific phrase for an ingredient. Used to detect when two
 * ingredients would collide on a bare head noun ("cocoa powder" versus
 * "baking powder"), so we can refuse to match on it.
 */
export function headNoun(ingredient: Ingredient): string {
  const phrases = searchPhrases(ingredient);
  return phrases.length > 0 ? phrases[phrases.length - 1] : '';
}
