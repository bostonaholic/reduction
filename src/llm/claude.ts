/**
 * The Claude fallback tier.
 *
 * Runs only when the local heuristics are not confident and the user has saved
 * an API key. Lives in the service worker because that is the only extension
 * context allowed to talk to another origin.
 */

import { PLAN_SCHEMA, type Plan } from '../core/plan.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-5';

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
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      // Adaptive thinking with low effort: cheap and fast, and it avoids the
      // failure modes that come with disabling thinking outright.
      output_config: {
        effort: 'low',
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
