import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  callClaude,
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
  EFFORTS,
  MODELS,
  resolveEffort,
  resolveModel,
  type Effort,
} from '../../src/llm/claude.js';

/** Captures the request body callClaude would put on the wire. */
async function requestBodyFor(
  modelId: string,
  effort: Effort = DEFAULT_EFFORT,
): Promise<Record<string, any>> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: '{"banners":[],"steps":[]}' }] }),
  });
  vi.stubGlobal('fetch', fetchMock);

  await callClaude(
    { apiKey: 'sk-ant-test', model: resolveModel(modelId), effort },
    'Brownies',
    ['4 oz butter'],
    ['Melt it.'],
  );

  return JSON.parse(fetchMock.mock.calls[0][1].body);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveModel', () => {
  it('returns the matching option', () => {
    expect(resolveModel('claude-haiku-4-5').id).toBe('claude-haiku-4-5');
  });

  it('defaults to Opus 5, not the head of the list', () => {
    // Fable 5 leads the list because it is the most capable, but it costs more
    // and is unavailable on zero-retention accounts, so it must not become the
    // default by virtue of being first.
    expect(DEFAULT_MODEL.id).toBe('claude-opus-5');
    expect(MODELS[0].id).toBe('claude-fable-5');
  });

  it('falls back to the default for an unset or unrecognised id', () => {
    // A hand-edited setting, or one this version no longer offers, should not
    // reach the API and 404 — it should quietly become the default.
    expect(resolveModel(undefined)).toBe(DEFAULT_MODEL);
    expect(resolveModel('claude-from-the-future')).toBe(DEFAULT_MODEL);
  });
});

describe('resolveEffort', () => {
  it('returns the matching level', () => {
    expect(resolveEffort('max')).toBe('max');
  });

  it('falls back to low for an unset or unrecognised level', () => {
    expect(resolveEffort(undefined)).toBe('low');
    expect(resolveEffort('exhaustive')).toBe('low');
    expect(DEFAULT_EFFORT).toBe('low');
  });
});

describe('callClaude', () => {
  it('sends the chosen model', async () => {
    const body = await requestBodyFor('claude-sonnet-5');
    expect(body.model).toBe('claude-sonnet-5');
  });

  it('sends the chosen effort on models that accept one', async () => {
    for (const effort of EFFORTS) {
      const body = await requestBodyFor('claude-opus-5', effort);
      expect(body.output_config.effort).toBe(effort);
    }
  });

  it('omits effort for Haiku even when a level is stored', async () => {
    // Sending output_config.effort to Haiku 4.5 is a 400. The picker disables
    // the control, but a stored level from another model must not leak through.
    const body = await requestBodyFor('claude-haiku-4-5', 'max');
    expect(body.output_config).not.toHaveProperty('effort');
    expect(body.output_config.format.type).toBe('json_schema');
  });

  it('never sends a thinking block, which Fable 5 rejects', async () => {
    for (const model of MODELS) {
      const body = await requestBodyFor(model.id);
      expect(body).not.toHaveProperty('thinking');
    }
  });

  it('always asks for the plan schema', async () => {
    for (const model of MODELS) {
      const body = await requestBodyFor(model.id);
      expect(body.output_config.format.type).toBe('json_schema');
    }
  });
});
