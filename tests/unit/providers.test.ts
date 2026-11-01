/**
 * Provider tests.
 *
 * `fetch` is stubbed rather than hit. What matters here is not that a live API
 * answers — that is verified by running the tool — but that each adapter builds the
 * request its vendor actually expects. Those three shapes differ in ways that fail
 * *silently*: a system message in Anthropic's `messages` array is a 400, and
 * Gemini's `assistant` role is accepted and quietly drops the turn.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createAnthropicProvider } from '../../src/providers/anthropic.js';
import { createGeminiProvider } from '../../src/providers/gemini.js';
import { createOpenAIProvider, createOpenAICompatibleProvider } from '../../src/providers/openai.js';
import { extractJson, ProviderError, withRetry } from '../../src/providers/types.js';

const original = globalThis.fetch;

interface Captured {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

let captured: Captured[] = [];

/** Stub fetch, returning a canned body for whatever the adapter posts. */
function stub(response: unknown, status = 200): void {
  captured = [];
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({
      url: String(url),
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => response,
      text: async () => JSON.stringify(response),
    } as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  captured = [];
});

afterEach(() => {
  globalThis.fetch = original;
  vi.restoreAllMocks();
});

describe('anthropic adapter', () => {
  it('sends the system prompt as a top-level field, not a message', async () => {
    // A `role: 'system'` entry in `messages` is a 400 from this API.
    stub({ content: [{ type: 'text', text: 'hi' }], model: 'claude-opus-4-6', stop_reason: 'end_turn' });

    await createAnthropicProvider('k').generate({
      model: 'claude-opus-4-6',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hello' },
      ],
    });

    const body = captured[0]!.body;
    expect(body.system).toBe('be brief');
    expect((body.messages as { role: string }[]).some((m) => m.role === 'system')).toBe(false);
  });

  it('prefills `{` for JSON mode and prepends it back', async () => {
    // There is no response_format on this API. Prefilling the assistant turn is
    // what stops the model opening with "Here is the storyboard:".
    stub({ content: [{ type: 'text', text: '"a":1}' }], stop_reason: 'end_turn' });

    const result = await createAnthropicProvider('k').generate({
      model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'json please' }],
      json: true,
    });

    const messages = captured[0]!.body.messages as { role: string; content: { text?: string }[] }[];
    expect(messages[messages.length - 1]).toMatchObject({ role: 'assistant' });
    expect(messages[messages.length - 1]!.content[0]!.text).toBe('{');
    // The prefill is not echoed, so without prepending this would be invalid JSON.
    expect(result.text).toBe('{"a":1}');
    expect(JSON.parse(result.text)).toEqual({ a: 1 });
  });

  it('sends images before text', async () => {
    stub({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' });

    await createAnthropicProvider('k').generate({
      model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'what is this', images: ['AAAA'] }],
    });

    const content = (captured[0]!.body.messages as { content: { type: string }[] }[])[0]!.content;
    expect(content[0]!.type).toBe('image');
    expect(content[1]!.type).toBe('text');
  });

  it('carries the key in x-api-key with a version header', async () => {
    stub({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' });
    await createAnthropicProvider('secret').generate({
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(captured[0]!.headers['x-api-key']).toBe('secret');
    expect(captured[0]!.headers['anthropic-version']).toBeTruthy();
  });

  it('maps max_tokens to a length stop, not a normal one', async () => {
    // The caller distinguishes these: `length` means truncated JSON, whose fix is
    // fewer scenes rather than a retry.
    stub({ content: [{ type: 'text', text: '{' }], stop_reason: 'max_tokens' });
    const result = await createAnthropicProvider('k').generate({
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(result.stopReason).toBe('length');
  });

  it('explains a 401 rather than reporting the status', async () => {
    stub({ error: { message: 'invalid x-api-key' } }, 401);
    await expect(
      createAnthropicProvider('bad').generate({ model: 'm', messages: [{ role: 'user', content: 'x' }] })
    ).rejects.toThrow(ProviderError);
  });

  it('refuses a request with no user turn', async () => {
    stub({});
    await expect(
      createAnthropicProvider('k').generate({
        model: 'm',
        messages: [{ role: 'system', content: 'only a system prompt' }],
      })
    ).rejects.toThrow(/No user message/);
  });
});

describe('openai adapter', () => {
  it('keeps the system prompt as an ordinary message', async () => {
    stub({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] });

    await createOpenAIProvider('k').generate({
      model: 'gpt-5',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hello' },
      ],
    });

    const messages = captured[0]!.body.messages as { role: string }[];
    expect(messages[0]!.role).toBe('system');
    expect(captured[0]!.body.system).toBeUndefined();
  });

  it('asks for json_object rather than a full schema', async () => {
    // The storyboard schema uses unions several compatible servers reject, and Zod
    // validates regardless — so the schema costs portability and buys little.
    stub({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] });
    await createOpenAIProvider('k').generate({
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'x' }],
      json: true,
    });
    expect(captured[0]!.body.response_format).toEqual({ type: 'json_object' });
  });

  it('inlines images as data URLs rather than uploading them', async () => {
    // §30.1: a screenshot of the user's own site is never uploaded anywhere.
    stub({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
    await createOpenAIProvider('k').generate({
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'what', images: ['AAAA'] }],
    });
    const content = (captured[0]!.body.messages as { content: { type: string; image_url?: { url: string } }[] }[])[0]!.content;
    expect(content[0]!.image_url!.url).toMatch(/^data:image\/png;base64,/);
  });

  it('sends text-only turns as a plain string', async () => {
    // Some compatible servers reject the content-array form for text-only turns.
    stub({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
    await createOpenAIProvider('k').generate({
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'plain' }],
    });
    expect((captured[0]!.body.messages as { content: unknown }[])[0]!.content).toBe('plain');
  });

  it('points at a custom base URL without a trailing slash', async () => {
    stub({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
    await createOpenAICompatibleProvider({
      id: 'local',
      name: 'Local',
      apiKey: 'k',
      baseUrl: 'http://localhost:11434/v1/',
    }).generate({ model: 'llama', messages: [{ role: 'user', content: 'x' }] });
    expect(captured[0]!.url).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('treats an empty completion as an error, not an empty storyboard', async () => {
    stub({ choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] });
    await expect(
      createOpenAIProvider('k').generate({ model: 'gpt-5', messages: [{ role: 'user', content: 'x' }] })
    ).rejects.toThrow(/empty response/);
  });
});

describe('gemini adapter', () => {
  it('uses systemInstruction and the `model` role', async () => {
    // 'assistant' is accepted and silently drops the turn from the model's view.
    stub({ candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }] });

    await createGeminiProvider('k').generate({
      model: 'gemini-2.5-pro',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'prior turn' },
      ],
    });

    const body = captured[0]!.body as {
      systemInstruction?: { parts: { text: string }[] };
      contents: { role: string }[];
    };
    expect(body.systemInstruction!.parts[0]!.text).toBe('be brief');
    expect(body.contents.map((c) => c.role)).toEqual(['user', 'model']);
  });

  it('puts generation settings under generationConfig', async () => {
    stub({ candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'STOP' }] });
    await createGeminiProvider('k').generate({
      model: 'gemini-2.5-pro',
      messages: [{ role: 'user', content: 'x' }],
      maxTokens: 100,
      temperature: 0.2,
      json: true,
    });
    const config = (captured[0]!.body as { generationConfig: Record<string, unknown> }).generationConfig;
    expect(config).toMatchObject({
      maxOutputTokens: 100,
      temperature: 0.2,
      responseMimeType: 'application/json',
    });
    // Not at the top level, where they would be ignored.
    expect(captured[0]!.body.maxOutputTokens).toBeUndefined();
  });

  it('reports a prompt-level safety block instead of returning empty text', async () => {
    // This comes back as HTTP 200 with no candidates at all.
    stub({ promptFeedback: { blockReason: 'SAFETY' } });
    await expect(
      createGeminiProvider('k').generate({ model: 'g', messages: [{ role: 'user', content: 'x' }] })
    ).rejects.toThrow(/blocked: SAFETY/);
  });

  it('strips the `models/` prefix when listing', async () => {
    // The listing returns `models/gemini-2.5-pro`; generateContent wants the bare id.
    stub({
      models: [
        { name: 'models/gemini-2.5-pro', displayName: 'Pro', supportedGenerationMethods: ['generateContent'] },
      ],
    });
    const models = await createGeminiProvider('k').listModels();
    expect(models[0]!.id).toBe('gemini-2.5-pro');
  });
});

describe('extractJson', () => {
  it('parses a bare object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('pulls an object out of a code fence', () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```\nHope that helps!')).toEqual({ a: 1 });
  });

  it('survives a closing brace inside a string', () => {
    // A regex or naive scan ends the object early here and loses everything after.
    const text = 'prose {"headline":"we fixed } everything","n":2} trailing';
    expect(extractJson(text)).toEqual({ headline: 'we fixed } everything', n: 2 });
  });

  it('survives an escaped quote inside a string', () => {
    expect(extractJson('{"q":"a \\" brace } here"}')).toEqual({ q: 'a " brace } here' });
  });

  it('handles nested objects', () => {
    expect(extractJson('x {"a":{"b":{"c":1}}} y')).toEqual({ a: { b: { c: 1 } } });
  });

  it('distinguishes truncation from malformation', () => {
    // The fix differs: truncation means raise maxTokens, malformation means retry.
    expect(() => extractJson('{"a":1')).toThrow(/never closed|truncated/);
    expect(() => extractJson('I cannot help with that request.')).toThrow(/no JSON object/);
  });

  it('quotes the start of a refusal so the user can see it', () => {
    try {
      extractJson('I will not write marketing copy.');
      expect.unreachable();
    } catch (err) {
      expect((err as ProviderError).hints.join('\n')).toContain('I will not write');
    }
  });
});

describe('withRetry', () => {
  it('retries a 429 and succeeds', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 2) throw new ProviderError({ provider: 'x', status: 429, message: 'slow down' });
        return 'ok';
      },
      { baseMs: 1 }
    );
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('does not retry a 401', async () => {
    // A stale key will never succeed on a second attempt; retrying only delays a
    // clear error.
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new ProviderError({ provider: 'x', status: 401, message: 'bad key' });
        },
        { baseMs: 1 }
      )
    ).rejects.toThrow(/bad key/);
    expect(calls).toBe(1);
  });

  it('gives up after the attempt limit', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new ProviderError({ provider: 'x', status: 500, message: 'oops' });
        },
        { attempts: 3, baseMs: 1 }
      )
    ).rejects.toThrow(/oops/);
    expect(calls).toBe(3);
  });
});
