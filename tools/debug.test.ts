/**
 * Ad-hoc inspection of one fixture. Set FIXTURE to the site name.
 *
 *   FIXTURE=budgetbytes npx vitest run --config vitest.report.config.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { it } from 'vitest';
import { extractRecipe } from '../src/core/extract.js';
import { parseIngredient, searchPhrases } from '../src/core/ingredient.js';

const name = process.env.FIXTURE;

it.skipIf(!name)('dumps the parsed shape of one fixture', () => {
  const path = join(import.meta.dirname, '..', 'tests', 'fixtures', `${name}.html`);
  const doc = new JSDOM(readFileSync(path, 'utf8')).window.document;
  const raw = extractRecipe(doc);

  const out: string[] = [`\n--- ${name} (${raw.strategy}) ---`];
  out.push('INGREDIENT PHRASES:');
  for (const line of raw.ingredientLines) {
    const parsed = parseIngredient(line);
    out.push(`  ${parsed.name.slice(0, 34).padEnd(34)} -> [${searchPhrases(parsed).join(', ')}]`);
  }
  out.push('STEP OPENINGS:');
  raw.stepTexts.forEach((s, i) => out.push(`  ${i}: ${s.slice(0, 100)}`));
  process.stdout.write(`${out.join('\n')}\n`);
});
