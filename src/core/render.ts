/**
 * Grid -> HTML.
 *
 * A string of markup rather than DOM calls, so the same function serves the
 * overlay, the print view and the SVG exporter, and so it can be snapshot
 * tested without a browser.
 */

import { cellsByRow } from './layout.js';
import type { Grid, Recipe } from './types.js';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The table alone, with no surrounding chrome. */
export function renderTable(recipe: Recipe, grid: Grid): string {
  const rows = cellsByRow(grid)
    .map((cells) => {
      const tds = cells
        .map((cell) => {
          const span = [
            cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : '',
            cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : '',
          ].join('');
          return `<td class="rd-${cell.kind}"${span}>${escapeHtml(cell.text)}</td>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');

  const caption = recipe.title
    ? `<caption class="rd-caption">${escapeHtml(recipe.title)}</caption>`
    : '';

  return `<table class="rd-table">${caption}<tbody>${rows}</tbody></table>`;
}

/** How the parse went, in one honest sentence. */
export function confidenceNote(recipe: Recipe): { level: 'high' | 'moderate' | 'low'; text: string } {
  const percent = Math.round(recipe.confidence * 100);
  const via =
    recipe.inference === 'claude'
      ? 'Claude worked out the groupings'
      : recipe.inference === 'flat'
        ? 'Steps could not be grouped, so they are listed in order'
        : 'Groupings inferred locally';

  if (recipe.inference === 'flat') return { level: 'low', text: `${via}.` };
  if (recipe.confidence >= 0.85) {
    return { level: 'high', text: `${via}; ${percent}% of ingredients matched a step.` };
  }
  if (recipe.confidence >= 0.6) {
    return { level: 'moderate', text: `${via}; ${percent}% of ingredients matched a step.` };
  }
  return {
    level: 'low',
    text: `${via}; only ${percent}% of ingredients matched a step, so the nesting may be wrong.`,
  };
}
