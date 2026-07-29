/**
 * The confidence badge (`confidenceNote`) and its findings-aware contract.
 *
 * Slice 1 of grader-runtime-escalation: `confidenceNote` gains a second
 * parameter, `findings: Finding[] = []`. The contract these tests pin:
 *
 *   - Empty findings (passed or defaulted) → byte-identical to today's
 *     output on every path. Those tests pass against today's code and are
 *     the no-regression net.
 *   - Non-empty findings force `'low'` and the text names the count and the
 *     first finding's detail, truncated to 120 characters with an ellipsis
 *     appended when longer.
 *   - The findings check runs BEFORE the `flat` early-return.
 *
 * Wording is the implementer's choice; these tests pin the contract (level,
 * count, detail, truncation, byte-identity), not prose.
 */

import { describe, expect, it } from 'vitest';
import { confidenceNote } from '../../src/core/render.js';
import type { Finding } from '../../src/core/grade.js';
import type { InferenceStrategy, Recipe } from '../../src/core/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function rec(inference: InferenceStrategy, confidence: number): Recipe {
  return {
    title: 'Pita Wraps',
    banners: [],
    root: null,
    sourceUrl: 'https://example.test/x',
    extraction: 'json-ld',
    inference,
    confidence,
  };
}

function f6(detail: string): Finding {
  return { rule: 'F6', detail };
}

// ---------------------------------------------------------------------------
// Byte-identity with empty findings — the no-regression net
// ---------------------------------------------------------------------------

describe('confidenceNote with no findings is byte-identical to today', () => {
  /** Both call forms: `[]` explicitly, and omitted — pinning the default. */
  function expectNote(recipe: Recipe, level: 'high' | 'moderate' | 'low', text: string): void {
    expect(confidenceNote(recipe)).toEqual({ level, text });
    expect(confidenceNote(recipe, [])).toEqual({ level, text });
  }

  it('keeps the flat message', () => {
    expectNote(rec('flat', 0), 'low', 'Steps could not be grouped, so they are listed in order.');
  });

  it('keeps high for heuristic at 0.9', () => {
    expectNote(
      rec('heuristic', 0.9),
      'high',
      'Groupings inferred locally; 90% of ingredients matched a step.',
    );
  });

  it('keeps moderate for heuristic at 0.7', () => {
    expectNote(
      rec('heuristic', 0.7),
      'moderate',
      'Groupings inferred locally; 70% of ingredients matched a step.',
    );
  });

  it('keeps low for heuristic at 0.5', () => {
    expectNote(
      rec('heuristic', 0.5),
      'low',
      'Groupings inferred locally; only 50% of ingredients matched a step, so the nesting may be wrong.',
    );
  });

  it('keeps moderate for claude at 0.7', () => {
    expectNote(
      rec('claude', 0.7),
      'moderate',
      'Claude worked out the groupings; 70% of ingredients matched a step.',
    );
  });
});

// ---------------------------------------------------------------------------
// Findings force low and name the problem
// ---------------------------------------------------------------------------

describe('confidenceNote with findings', () => {
  it('forces low for an F finding the coverage alone would call moderate', () => {
    const detail = 'F6 heats the Greek yogurt after step 1 refrigerates it';
    const note = confidenceNote(rec('heuristic', 0.79), [f6(detail)]);
    expect(note.level).toBe('low');
    expect(note.text).toContain(detail);
  });

  it('stays moderate for the same card with no findings — the near-miss', () => {
    expect(confidenceNote(rec('heuristic', 0.79), []).level).toBe('moderate');
  });

  it('runs the findings check before the flat early-return', () => {
    const detail = 'F1 the olive oil never reaches the card';
    const note = confidenceNote(rec('flat', 0), [f6(detail)]);
    expect(note.level).toBe('low');
    expect(note.text).toContain(detail);
    expect(note.text).not.toBe('Steps could not be grouped, so they are listed in order.');
  });

  it('truncates a detail past 120 characters and appends an ellipsis', () => {
    const detail = 'A'.repeat(120) + ' the-part-past-the-cap';
    const note = confidenceNote(rec('heuristic', 0.9), [f6(detail)]);
    expect(note.level).toBe('low');
    expect(note.text).toContain('A'.repeat(120) + '…');
    expect(note.text).not.toContain('the-part-past-the-cap');
  });

  it('keeps a detail of exactly 120 characters whole, with no ellipsis — the near-miss', () => {
    const detail = 'B'.repeat(120);
    const note = confidenceNote(rec('heuristic', 0.9), [f6(detail)]);
    expect(note.text).toContain(detail);
    expect(note.text).not.toContain(detail + '…');
  });

  it('names the count and only the first detail when there are two findings', () => {
    const note = confidenceNote(rec('heuristic', 0.9), [
      f6('first-finding-detail'),
      { rule: 'F3', detail: 'second-finding-detail' },
    ]);
    expect(note.level).toBe('low');
    expect(note.text).toMatch(/\b2\b/);
    expect(note.text).toContain('first-finding-detail');
    expect(note.text).not.toContain('second-finding-detail');
  });
});
