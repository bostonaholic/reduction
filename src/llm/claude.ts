/**
 * The Claude fallback tier.
 *
 * Runs only when the local heuristics are not confident and the user has saved
 * an API key. Lives in the service worker because that is the only extension
 * context allowed to talk to another origin.
 */

import { PLAN_SCHEMA, type Plan } from '../core/plan.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

export interface ModelOption {
  id: string;
  /** Shown in the options page picker. */
  label: string;
  /**
   * Effort to request, for models that accept one. Haiku 4.5 rejects
   * `output_config.effort` outright, so its entry leaves this unset and the
   * field is omitted from the request.
   */
  effort?: 'low';
}

/**
 * The models offered in the options page. All of them support structured
 * outputs, which the flat-plan schema depends on; ordered most capable first.
 */
export const MODELS: readonly ModelOption[] = [
  { id: 'claude-opus-5', label: 'Claude Opus 5 — most accurate', effort: 'low' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — balanced', effort: 'low' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — fastest and cheapest' },
];

export const DEFAULT_MODEL = MODELS[0];

/**
 * Look up a stored model id. Anything unrecognised — a hand-edited setting, or
 * an id this version no longer offers — falls back to the default rather than
 * failing the request with a 404.
 */
export function resolveModel(id: string | undefined): ModelOption {
  return MODELS.find((model) => model.id === id) ?? DEFAULT_MODEL;
}

const SYSTEM = `You convert recipes into the tabular diagram format used by Cooking For Engineers.

That diagram is a tree. Ingredients are the leaves; each operation consumes some
combination of ingredients and the output of earlier operations. Your job is to
say which is which.

Rules:
- Every ingredient index must appear in exactly one step's "ingredients" array.
- "uses" refers to earlier steps in your own list, by zero-based index. A step
  that works on something already made must say so there.
- Steps that touch no ingredients — preheating, greasing a pan, lining a tin —
  go in "banners", not in "steps".
- Labels are terse: an imperative verb, plus temperature and time when the step
  has them. "mix", "fold in", "bake 350°F (175°C) 30 to 40 min".
- Exactly one step should end up unconsumed: the final one.`;

function buildPrompt(title: string, ingredients: string[], steps: string[]): string {
  const ingredientList = ingredients.map((line, i) => `${i}: ${line}`).join('\n');
  const stepList = steps.map((text, i) => `${i}: ${text}`).join('\n');
  return `Recipe: ${title}\n\nIngredients (index: text)\n${ingredientList}\n\nInstructions (index: text)\n${stepList}`;
}

/** Ask Claude for the plan. Throws with a usable message on any failure. */
export async function callClaude(
  apiKey: string,
  model: ModelOption,
  title: string,
  ingredients: string[],
  steps: string[],
): Promise<Plan> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Required when calling the API from a browser context.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: model.id,
      max_tokens: 16000,
      system: SYSTEM,
      // Adaptive thinking with low effort: cheap and fast, and it avoids the
      // failure modes that come with disabling thinking outright.
      output_config: {
        ...(model.effort ? { effort: model.effort } : {}),
        format: { type: 'json_schema', schema: PLAN_SCHEMA },
      },
      messages: [{ role: 'user', content: buildPrompt(title, ingredients, steps) }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Claude API ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }

  const body = (await response.json()) as {
    stop_reason?: string;
    content?: Array<{ type: string; text?: string }>;
  };

  if (body.stop_reason === 'refusal') {
    throw new Error('Claude declined to process this page.');
  }

  const text = (body.content ?? []).find((block) => block.type === 'text')?.text;
  if (!text) throw new Error('Claude returned no usable content.');

  return JSON.parse(text) as Plan;
}
