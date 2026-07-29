/**
 * Unit handling and metric conversion.
 *
 * Cooking For Engineers writes both systems, metric in parentheses:
 * `4 oz (115 g) unsalted butter`, `1/4 tsp. (2.5 mL) vanilla extract`.
 * Note which one it picks — mass for things we know the density of, volume
 * for everything else. We follow the same rule, because claiming a gram
 * weight for an ingredient whose density we are guessing at is worse than
 * honestly printing millilitres.
 */

/** Canonical unit name -> the spellings that mean it. */
const UNIT_ALIASES: Record<string, string[]> = {
  cup: ['cup', 'cups', 'c'],
  tbsp: ['tablespoon', 'tablespoons', 'tbsp', 'tbsps', 'tbs', 'tb', 'tablespoonful'],
  tsp: ['teaspoon', 'teaspoons', 'tsp', 'tsps', 'ts', 'teaspoonful'],
  'fl oz': ['fluid ounce', 'fluid ounces', 'fl oz', 'fl. oz.', 'floz'],
  pint: ['pint', 'pints', 'pt'],
  quart: ['quart', 'quarts', 'qt'],
  gallon: ['gallon', 'gallons', 'gal'],
  oz: ['ounce', 'ounces', 'oz'],
  lb: ['pound', 'pounds', 'lb', 'lbs'],
  g: ['gram', 'grams', 'g', 'gr'],
  kg: ['kilogram', 'kilograms', 'kg'],
  ml: ['millilitre', 'millilitres', 'milliliter', 'milliliters', 'ml'],
  l: ['litre', 'litres', 'liter', 'liters', 'l'],
  stick: ['stick', 'sticks'],
  clove: ['clove', 'cloves'],
  can: ['can', 'cans'],
  package: ['package', 'packages', 'pkg', 'packet', 'packets'],
  slice: ['slice', 'slices'],
  pinch: ['pinch', 'pinches'],
  dash: ['dash', 'dashes'],
  sprig: ['sprig', 'sprigs'],
  bunch: ['bunch', 'bunches'],
  head: ['head', 'heads'],
  large: ['large'],
  medium: ['medium'],
  small: ['small'],
  shot: ['shot', 'shots'],
};

const UNIT_LOOKUP = new Map<string, string>();
for (const [canonical, aliases] of Object.entries(UNIT_ALIASES)) {
  for (const alias of aliases) UNIT_LOOKUP.set(alias, canonical);
}

/** Longest alias first, so "fluid ounces" wins over "ounces". */
export const UNIT_PATTERN = [...UNIT_LOOKUP.keys()]
  .sort((a, b) => b.length - a.length)
  .map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

/**
 * Units that are words rather than abbreviations, with the plural a cook writes.
 *
 * Abbreviations are deliberately absent: Cooking For Engineers writes "4 oz"
 * and "2 tbsp", never "4 ozs". So are the size words — "large" is an adjective
 * describing the egg, so "2 larges eggs" is not English.
 */
const UNIT_PLURALS: Record<string, string> = {
  cup: 'cups',
  pint: 'pints',
  quart: 'quarts',
  gallon: 'gallons',
  stick: 'sticks',
  clove: 'cloves',
  can: 'cans',
  package: 'packages',
  slice: 'slices',
  pinch: 'pinches',
  dash: 'dashes',
  sprig: 'sprigs',
  bunch: 'bunches',
  head: 'heads',
  shot: 'shots',
};

/**
 * The unit as written for this amount: "1 clove", "2 cloves", always "4 oz".
 *
 * Parsing canonicalizes "cloves" down to "clove", which is right for lookup and
 * wrong for display — without this the table reads "2 clove garlic".
 */
export function pluralizeUnit(unit: string, quantity: number | undefined): string {
  if (quantity === undefined || quantity <= 1) return unit;
  return UNIT_PLURALS[unit] ?? unit;
}

/** Resolve a written unit to its canonical form, or undefined if unrecognized. */
export function canonicalUnit(raw: string): string | undefined {
  const key = raw.toLowerCase().replace(/\.$/, '').trim();
  return UNIT_LOOKUP.get(key) ?? UNIT_LOOKUP.get(key.replace(/\./g, ''));
}

const ML_PER: Record<string, number> = {
  cup: 236.588,
  tbsp: 14.787,
  tsp: 4.929,
  'fl oz': 29.574,
  pint: 473.176,
  quart: 946.353,
  gallon: 3785.41,
  ml: 1,
  l: 1000,
};

const GRAMS_PER: Record<string, number> = {
  oz: 28.3495,
  lb: 453.592,
  g: 1,
  kg: 1000,
  stick: 113, // a US stick of butter
};

/**
 * Grams per US cup for ingredients common enough to be worth knowing.
 * Keys are matched as substrings of the ingredient name, longest first.
 */
const GRAMS_PER_CUP: Record<string, number> = {
  'all-purpose flour': 125,
  'all purpose flour': 125,
  'bread flour': 127,
  'cake flour': 114,
  'whole wheat flour': 120,
  'almond flour': 96,
  flour: 125,
  'brown sugar': 213,
  'powdered sugar': 120,
  "confectioners' sugar": 120,
  'confectioners sugar': 120,
  'granulated sugar': 200,
  sugar: 200,
  'cocoa powder': 85,
  cocoa: 85,
  cornstarch: 128,
  'rolled oats': 90,
  oats: 90,
  'chocolate chips': 170,
  chocolate: 170,
  butter: 227,
  'peanut butter': 258,
  honey: 340,
  'maple syrup': 322,
  molasses: 337,
  rice: 185,
  'baking powder': 220,
  'baking soda': 220,
  'kosher salt': 240,
  salt: 292,
  'breadcrumbs' : 108,
  'bread crumbs': 108,
  'parmesan': 100,
  'shredded cheese': 113,
  cheese: 113,
  yogurt: 245,
  'sour cream': 230,
  'heavy cream': 238,
  cream: 238,
  milk: 240,
  water: 237,
  oil: 218,
};

/** Mass of one of a countable thing, for "2 large eggs" -> "(100 g)". */
const GRAMS_EACH: Record<string, number> = {
  egg: 50,
  'egg yolk': 18,
  'egg white': 33,
  'garlic clove': 3,
  clove: 3,
};

const DENSITY_KEYS = Object.keys(GRAMS_PER_CUP).sort((a, b) => b.length - a.length);
const EACH_KEYS = Object.keys(GRAMS_EACH).sort((a, b) => b.length - a.length);

function lookupBySubstring(name: string, keys: string[], table: Record<string, number>) {
  const haystack = name.toLowerCase();
  for (const key of keys) if (haystack.includes(key)) return table[key];
  return undefined;
}

/** Round to a precision a cook can act on: 2 significant-ish figures. */
export function roundSensibly(value: number): number {
  if (value >= 100) return Math.round(value / 5) * 5;
  if (value >= 10) return Math.round(value);
  if (value >= 1) return Math.round(value * 10) / 10;
  return Math.round(value * 100) / 100;
}

/**
 * The metric equivalent to print in parentheses, or undefined when there is
 * nothing useful to say (the amount is already metric, or unparseable).
 */
export function metricEquivalent(
  quantity: number | undefined,
  unit: string | undefined,
  name: string,
): string | undefined {
  if (quantity === undefined || quantity <= 0) return undefined;

  // Already metric — no point repeating it.
  if (unit && ['g', 'kg', 'ml', 'l'].includes(unit)) return undefined;

  if (unit && unit in GRAMS_PER) {
    const grams = quantity * GRAMS_PER[unit];
    return grams >= 1000 ? `${roundSensibly(grams / 1000)} kg` : `${roundSensibly(grams)} g`;
  }

  if (unit && unit in ML_PER) {
    const ml = quantity * ML_PER[unit];
    const gramsPerCup = lookupBySubstring(name, DENSITY_KEYS, GRAMS_PER_CUP);
    if (gramsPerCup !== undefined) {
      const grams = (ml / ML_PER.cup) * gramsPerCup;
      return grams >= 1000 ? `${roundSensibly(grams / 1000)} kg` : `${roundSensibly(grams)} g`;
    }
    return ml >= 1000 ? `${roundSensibly(ml / 1000)} L` : `${roundSensibly(ml)} mL`;
  }

  // Countable things: "2 large eggs" -> "(100 g)".
  const each = lookupBySubstring(name, EACH_KEYS, GRAMS_EACH);
  if (each !== undefined) return `${roundSensibly(quantity * each)} g`;

  return undefined;
}

/** Fahrenheit -> Celsius, rounded to the nearest 5 the way recipes write it. */
export function toCelsius(fahrenheit: number): number {
  return Math.round((((fahrenheit - 32) * 5) / 9) / 5) * 5;
}

const UNICODE_FRACTIONS: Record<string, string> = {
  '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4',
  '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5', '⅙': '1/6',
  '⅚': '5/6', '⅐': '1/7', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8',
  '⅞': '7/8', '⅑': '1/9', '⅒': '1/10',
};

/**
 * Normalize the typographic soup real recipe sites ship: unicode fractions,
 * non-breaking spaces, fancy quotes, "1-1/2" style mixed numbers.
 */
export function normalizeText(input: string): string {
  let out = input.replace(/ /g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  for (const [glyph, ascii] of Object.entries(UNICODE_FRACTIONS)) {
    // "1½" needs a space inserted; a bare "½" does not.
    out = out.replace(new RegExp(`(\\d)${glyph}`, 'g'), `$1 ${ascii}`);
    out = out.replace(new RegExp(glyph, 'g'), ascii);
  }
  // "1-1/2 cups" is a mixed number, not a range.
  out = out.replace(/(\d)\s*-\s*(\d\/\d)/g, '$1 $2');
  return out.replace(/\s+/g, ' ').trim();
}

/** Parse "1 1/2", "3/4", "2.5", "2" into a number. */
export function parseAmount(text: string): number | undefined {
  const trimmed = text.trim();
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(trimmed);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = /^(\d+)\/(\d+)$/.exec(trimmed);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const decimal = /^\d*\.?\d+$/.exec(trimmed);
  if (decimal) return Number(trimmed);
  return undefined;
}
