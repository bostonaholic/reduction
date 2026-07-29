/**
 * The printable view.
 *
 * Builds a standalone document the service worker hands to an extension page.
 * Going through an extension page rather than printing the overlay in place
 * means the host page's print styles cannot interfere, and the result is a
 * clean single-page card for the kitchen.
 */

import { layout } from '../core/layout.js';
import { escapeHtml, renderTable } from '../core/render.js';
import { isHttpUrl, sanitizeSourceUrl } from './source-url.js';
import type { Grid, Recipe } from '../core/types.js';

const PRINT_CSS = `
  body {
    margin: 0;
    padding: 28px 32px;
    background: #fff;
    color: #16211a;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  }
  .rd-doc-title {
    font-size: 21px;
    margin: 0 0 4px;
  }
  .rd-doc-meta {
    font-size: 12.5px;
    color: #6b7268;
    margin: 0 0 18px;
    overflow-wrap: anywhere;
  }
  .rd-doc-meta a { color: #3d6b3f; }
  .rd-caption { display: none; }
  @media print {
    body { padding: 0; }
    .rd-doc-meta a { text-decoration: none; }
    .rd-table { page-break-inside: avoid; }
    @page { margin: 12mm; }
  }
`;

/** A complete HTML document for the print tab. */
export function printableDocument(recipe: Recipe, grid: Grid, sharedCss: string): string {
  const url = sanitizeSourceUrl(recipe.sourceUrl);
  const source = !url
    ? ''
    : isHttpUrl(url)
      ? `<a href="${escapeHtml(url)}" rel="noreferrer noopener">${escapeHtml(url)}</a>`
      : escapeHtml(url);
  const servings = recipe.yield ? escapeHtml(recipe.yield) : '';
  const meta = [source, servings].filter(Boolean).join(' · ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(recipe.title)}</title>
<style>${sharedCss}</style>
<style>${PRINT_CSS}</style>
</head>
<body>
<h1 class="rd-doc-title">${escapeHtml(recipe.title)}</h1>
<p class="rd-doc-meta">${meta}</p>
${renderTable(recipe, grid)}
</body>
</html>`;
}

/** Convenience for callers that hold a recipe but not a grid. */
export function printableFromRecipe(recipe: Recipe, sharedCss: string): string {
  return printableDocument(recipe, layout(recipe), sharedCss);
}
