/**
 * Content script: the whole product, from the user's point of view.
 *
 * Reads the page, builds the table, and shows it in a shadow root so the host
 * page's CSS cannot touch it and ours cannot leak out. Clicking the toolbar
 * button again closes it.
 */

import { NoRecipeFound, extractRecipe } from '../core/extract.js';
import { gradeByTier, type Finding, type Tier } from '../core/grade.js';
import { flatTree, inferTree } from '../core/infer.js';
import { layout } from '../core/layout.js';
import { treeFromPlan, type Plan } from '../core/plan.js';
import { confidenceNote, renderTable } from '../core/render.js';
import { toPng, toSvg } from '../export/image.js';
import { printableDocument } from '../export/print.js';
import type { ClaudeReply, Message } from '../messages.js';
import type { Grid, RawRecipe, Recipe } from '../core/types.js';
import styles from './overlay.css';

const HOST_ID = 'reduction-overlay-host';

/** Below this, the local heuristics are not trustworthy enough to show alone. */
const CLAUDE_THRESHOLD = 0.6;

function removeExisting(): boolean {
  const existing = document.getElementById(HOST_ID);
  if (!existing) return false;
  existing.remove();
  return true;
}

function mount(): ShadowRoot {
  const host = document.createElement('div');
  host.id = HOST_ID;
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const sheet = document.createElement('style');
  sheet.textContent = styles;
  shadow.appendChild(sheet);
  return shadow;
}

/**
 * Every value taken from the page is escaped before it reaches innerHTML.
 * Quotes are escaped too, so a value is safe in an attribute position as well
 * as in text — cheaper than auditing each call site.
 */
function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showError(shadow: ShadowRoot, message: string): void {
  shadow.appendChild(
    element(`
      <div class="rd-backdrop">
        <div class="rd-panel">
          <div class="rd-head">
            <h2 class="rd-title">No recipe found on this page</h2>
            <div class="rd-actions"><button class="rd-btn" data-act="close">Close</button></div>
          </div>
          <div class="rd-error">
            Reduction looks for a schema.org recipe, then microdata, then an
            ingredients list under a heading. None of those turned up here.
            <br /><br /><code>${escape(message)}</code>
          </div>
        </div>
      </div>
    `),
  );
  wireClose(shadow);
}

function element(html: string): Element {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild!;
}

function wireClose(shadow: ShadowRoot): void {
  shadow.querySelector('[data-act="close"]')?.addEventListener('click', () => removeExisting());
  shadow.querySelector('.rd-backdrop')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) removeExisting();
  });
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') removeExisting();
    },
    { once: true },
  );
}

function showTable(shadow: ShadowRoot, recipe: Recipe, grid: Grid, findings: Finding[]): void {
  const note = confidenceNote(recipe, findings);
  const servings = recipe.yield ? `<span class="rd-meta">${escape(recipe.yield)}</span>` : '';

  shadow.appendChild(
    element(`
      <div class="rd-backdrop">
        <div class="rd-panel">
          <div class="rd-head">
            <h2 class="rd-title">${escape(recipe.title)}</h2>
            ${servings}
            <span class="rd-badge ${note.level}">${note.level} confidence</span>
            <div class="rd-actions">
              <button class="rd-btn" data-act="png">PNG</button>
              <button class="rd-btn" data-act="svg">SVG</button>
              <button class="rd-btn primary" data-act="print">Print</button>
              <button class="rd-btn" data-act="close">Close</button>
            </div>
          </div>
          <div class="rd-note">${escape(note.text)}</div>
          <div class="rd-scroll">${renderTable(recipe, grid)}</div>
        </div>
      </div>
    `),
  );

  const table = shadow.querySelector('.rd-table') as HTMLTableElement | null;

  shadow.querySelector('[data-act="print"]')?.addEventListener('click', () => {
    const message: Message = {
      type: 'open-print-view',
      html: printableDocument(recipe, grid, styles),
    };
    chrome.runtime.sendMessage(message);
  });

  shadow.querySelector('[data-act="svg"]')?.addEventListener('click', () => {
    if (table) download(`${slug(recipe.title)}.svg`, toSvg(table, recipe.sourceUrl), 'image/svg+xml');
  });

  shadow.querySelector('[data-act="png"]')?.addEventListener('click', async () => {
    if (!table) return;
    const blob = await toPng(table, recipe.sourceUrl);
    if (blob) downloadBlob(`${slug(recipe.title)}.png`, blob);
  });

  wireClose(shadow);
}

function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'recipe'
  );
}

function download(filename: string, text: string, type: string): void {
  downloadBlob(filename, new Blob([text], { type }));
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Grade a card for the badge. A grading crash degrades to "no findings". */
function tryGrade(recipe: Recipe, raw: RawRecipe): Record<Tier, Finding[]> | null {
  try {
    return gradeByTier(recipe, raw);
  } catch {
    return null;
  }
}

/** Ask the service worker to try Claude. Never throws — the caller has a plan B. */
async function askClaude(
  title: string,
  ingredients: string[],
  steps: string[],
): Promise<Plan | null> {
  try {
    const reply = (await chrome.runtime.sendMessage({
      type: 'infer-with-claude',
      title,
      ingredients,
      steps,
    } satisfies Message)) as ClaudeReply | undefined;

    if (!reply?.ok || !reply.tree) return null;
    return reply.tree as Plan;
  } catch {
    return null;
  }
}

async function run(): Promise<void> {
  if (removeExisting()) return; // Second click closes.

  const shadow = mount();

  let raw;
  try {
    raw = extractRecipe(document);
  } catch (err) {
    showError(shadow, err instanceof NoRecipeFound ? err.message : String(err));
    return;
  }

  let recipe = inferTree(raw, location.href);
  // The badge must always describe the card on screen, so recipe and graded
  // are reassigned together at every point recipe changes hands.
  let graded = tryGrade(recipe, raw);

  if (recipe.confidence < CLAUDE_THRESHOLD) {
    const plan = await askClaude(raw.title, raw.ingredientLines, raw.stepTexts);
    if (plan) {
      const viaClaude = treeFromPlan(plan, raw, location.href);
      if (viaClaude.root && viaClaude.confidence >= recipe.confidence) {
        recipe = viaClaude;
        graded = tryGrade(viaClaude, raw);
      }
    }
  }

  if (!recipe.root) {
    // The flat table never claims to understand the recipe, so grading it
    // against the source would only restate that.
    recipe = flatTree(raw, location.href);
    graded = null;
  }
  if (!recipe.root) {
    showError(shadow, 'Found a recipe but no ingredients to lay out.');
    return;
  }

  showTable(shadow, recipe, layout(recipe), graded ? [...graded.S, ...graded.F] : []);
}

void run();
