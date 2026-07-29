import { afterEach, describe, expect, it, vi } from 'vitest';
import { callClaude, DEFAULT_MODEL, MODELS, resolveModel } from '../../src/llm/claude.js';

/** Captures the request body callClaude would put on the wire. */
async function requestBodyFor(modelId: string): Promise<Record<string, any>> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: '{"banners":[],"steps":[]}' }] }),
  });
  vi.stubGlobal('fetch', fetchMock);

  await callClaude('sk-ant-test', resolveModel(modelId), 'Brownies', ['4 oz butter'], ['Melt it.']);

  return JSON.parse(fetchMock.mock.calls[0][1].body);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveModel', () => {
  it('returns the matching option', () => {
    expect(resolveModel('claude-haiku-4-5').id).toBe('claude-haiku-4-5');
  });

  it('falls back to the default for an unset or unrecognised id', () => {
    // A hand-edited setting, or one this version no longer offers, should not
    // reach the API and 404 — it should quietly become the default.
    expect(resolveModel(undefined)).toBe(DEFAULT_MODEL);
    expect(resolveModel('claude-from-the-future')).toBe(DEFAULT_MODEL);
  });
});

describe('callClaude', () => {
  it('sends the chosen model', async () => {
    const body = await requestBodyFor('claude-sonnet-5');
    expect(body.model).toBe('claude-sonnet-5');
  });

  it('requests low effort on models that accept it', async () => {
    const body = await requestBodyFor('claude-opus-5');
    expect(body.output_config.effort).toBe('low');
  });

  it('omits effort for Haiku, which rejects the field outright', async () => {
    // Sending output_config.effort to Haiku 4.5 is a 400, so the request must
    // leave it out rather than pass undefined.
    const body = await requestBodyFor('claude-haiku-4-5');
    expect(body.output_config).not.toHaveProperty('effort');
    expect(body.output_config.format.type).toBe('json_schema');
  });

  it('always asks for the plan schema', async () => {
    for (const model of MODELS) {
      const body = await requestBodyFor(model.id);
      expect(body.output_config.format.type).toBe('json_schema');
    }
  });
});
