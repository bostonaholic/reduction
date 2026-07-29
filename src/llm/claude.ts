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
   * Whether the model accepts `output_config.effort`. Haiku 4.5 rejects the
   * field outright, so for that model the request omits it and the options
   * page disables the effort picker rather than pretending it applies.
   */
  supportsEffort: boolean;
}

const OPUS_5: ModelOption = {
  id: 'claude-opus-5',
  label: 'Claude Opus 5 — recommended',
  supportsEffort: true,
};

/**
 * The models offered in the options page. All of them support structured
 * outputs, which the flat-plan schema depends on; ordered most capable first.
 */
export const MODELS: readonly ModelOption[] = [
  {
    id: 'claude-fable-5',
    label: 'Claude Fable 5 — most capable, highest cost',
    supportsEffort: true,
  },
  OPUS_5,
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — balanced', supportsEffort: true },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5 — fastest and cheapest',
    supportsEffort: false,
  },
];

/**
 * Opus 5 rather than the head of the list: Fable 5 costs more per recipe than
 * this tier is worth by default, and it is rejected outright for organisations
 * on zero data retention, which we cannot detect from here.
 */
export const DEFAULT_MODEL = OPUS_5;

/** How hard the model works before answering. Every level below is valid on
 * every model whose `supportsEffort` is true. */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export type Effort = (typeof EFFORTS)[number];

export const EFFORT_LABELS: Record<Effort, string> = {
  low: 'Low — fastest and cheapest',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max — slowest and most expensive',
};

/**
 * Low, because reading a recipe is not a hard reasoning problem: the local
 * heuristics have already done the extraction, and all that is left is
 * deciding which step consumes what. Raising it costs tokens for little gain.
 */
export const DEFAULT_EFFORT: Effort = 'low';

/**
 * Look up a stored model id. Anything unrecognised — a hand-edited setting, or
 * an id this version no longer offers — falls back to the default rather than
 * failing the request with a 404.
 */
export function resolveModel(id: string | undefined): ModelOption {
  return MODELS.find((model) => model.id === id) ?? DEFAULT_MODEL;
}

/** As `resolveModel`, for the stored effort level. */
export function resolveEffort(level: string | undefined): Effort {
  return EFFORTS.find((effort) => effort === level) ?? DEFAULT_EFFORT;
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

/**
 * What shapes the request: the options-page choices (key, model, effort)
 * plus one fact only the caller knows — whether it is running in a browser.
 */
export interface ClaudeSettings {
  apiKey: string;
  model: ModelOption;
  effort: Effort;
  /** True in the extension, false in the CLI; gates the browser-only header. */
  browser: boolean;
}

/** Ask Claude for the plan. Throws with a usable message on any failure. */
export async function callClaude(
  settings: ClaudeSettings,
  title: string,
  ingredients: string[],
  steps: string[],
): Promise<Plan> {
  const { apiKey, model, effort, browser } = settings;
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Required when calling the API from a browser context; sending a
      // browser-only opt-in from Node would be misleading, so it is gated.
      ...(browser ? { 'anthropic-dangerous-direct-browser-access': 'true' } : {}),
    },
    body: JSON.stringify({
      model: model.id,
      max_tokens: 16000,
      system: SYSTEM,
      // The request deliberately sends no `thinking` block at all — Fable 5
      // rejects one, and every other model here defaults to what we would have
      // asked for. Depth is steered with effort instead, which Haiku 4.5 does
      // not accept, hence the conditional.
      output_config: {
        ...(model.supportsEffort ? { effort } : {}),
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
