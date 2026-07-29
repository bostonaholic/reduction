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
    { apiKey: 'sk-ant-test', model: resolveModel(modelId), effort, browser: true },
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

/** Captures the request headers callClaude would put on the wire. */
async function requestHeadersFor(browser: boolean): Promise<Record<string, string>> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: '{"banners":[],"steps":[]}' }] }),
  });
  vi.stubGlobal('fetch', fetchMock);

  const settings = { apiKey: 'sk-ant-test', model: DEFAULT_MODEL, effort: DEFAULT_EFFORT, browser };
  await callClaude(settings, 'Brownies', ['4 oz butter'], ['Melt it.']);

  return fetchMock.mock.calls[0][1].headers;
}

describe('callClaude browser header', () => {
  it('sends the direct-browser-access opt-in when the caller is a browser', async () => {
    const headers = await requestHeadersFor(true);
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  });

  it('omits the browser-only header when the caller is not a browser', async () => {
    // Sending a browser-only opt-in from Node is misleading and fragile; the
    // CLI constructs its settings with browser: false.
    const headers = await requestHeadersFor(false);
    expect(headers).not.toHaveProperty('anthropic-dangerous-direct-browser-access');
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

  it('clips each prompt line, so one huge line cannot fill the context window', async () => {
    // The extraction caps bound line counts, not line lengths — without a
    // per-line clip a single multi-megabyte "ingredient" would reach the API
    // intact and spend the user's budget on garbage.
    const huge = `1 cup sugar, then ${'x'.repeat(100_000)}`;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '{"banners":[],"steps":[]}' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await callClaude(
      { apiKey: 'sk-ant-test', model: DEFAULT_MODEL, effort: DEFAULT_EFFORT, browser: false },
      huge,
      [huge, '4 oz butter'],
      [huge],
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const prompt: string = body.messages[0].content;
    expect(prompt).not.toContain(huge);
    expect(prompt).toContain('1 cup sugar, then ');
    expect(prompt).toContain('4 oz butter'); // Short lines pass untouched.
    // Title and ingredient clip at 300, the step at 2000, plus scaffolding.
    expect(prompt.length).toBeLessThan(3000);
  });

  it('passes a real-world long step through intact', async () => {
    // The longest step across the captured site fixtures is 778 characters
    // (Bon Appétit). A bound that clips it degrades the exact pages the
    // Claude tier exists to rescue, so a step of that size must survive.
    const longStep = `Fold in the chocolate, then rest the dough. ${'Stir gently. '.repeat(58)}`;
    expect(longStep.length).toBeGreaterThan(750);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '{"banners":[],"steps":[]}' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await callClaude(
      { apiKey: 'sk-ant-test', model: DEFAULT_MODEL, effort: DEFAULT_EFFORT, browser: false },
      'Brownies',
      ['4 oz butter'],
      [longStep],
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain(longStep);
  });

  it('clips on code points, never leaving a lone surrogate', async () => {
    // A cut that lands inside a surrogate pair would put a mangled character
    // on the wire; the clip must slice whole code points.
    const emoji = '🍰'.repeat(5000); // 10,000 UTF-16 units, all astral.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '{"banners":[],"steps":[]}' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await callClaude(
      { apiKey: 'sk-ant-test', model: DEFAULT_MODEL, effort: DEFAULT_EFFORT, browser: false },
      emoji,
      [emoji],
      [emoji],
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const prompt: string = body.messages[0].content;
    expect(prompt.length).toBeLessThan(emoji.length);
    // A high surrogate not followed by a low surrogate is a mangled cut.
    expect(prompt).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});
