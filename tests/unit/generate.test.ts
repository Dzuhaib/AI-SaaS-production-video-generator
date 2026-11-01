/**
 * Storyboard generation tests.
 *
 * The provider is a stub returning canned JSON, so what is under test is the
 * funnel, not a model: does invalid output get rejected, does mechanical breakage
 * get repaired without a round trip, does a content decision go back to the model
 * with the rule text, and is the loop actually bounded.
 *
 * This is the load-bearing part of the architecture (§29.1, §58). A model that has
 * read "cut, do not crossfade" will still crossfade — these tests are what verify
 * that something stops it.
 */

import { describe, it, expect } from 'vitest';

import { generateStoryboard, validateStoryboard } from '../../src/storyboard/generate.js';
import { loadSkills, type SkillLibrary } from '../../src/skills/library.js';
import type { AIProvider, GenerateRequest, Message } from '../../src/providers/types.js';
import type { RouteAnalysis } from '../../src/browser/analyze.js';
import { join } from 'node:path';

const skills: SkillLibrary = await loadSkills({
  packagedDir: join(process.cwd(), 'Skills'),
  userDir: '/none',
  projectDir: '/none',
});

/** A provider that replays scripted responses and records what it was asked. */
function scripted(responses: string[]): AIProvider & { calls: GenerateRequest[] } {
  const calls: GenerateRequest[] = [];
  let i = 0;
  return {
    id: 'stub',
    name: 'Stub',
    envVars: [],
    calls,
    async listModels() {
      return [];
    },
    async generate(request) {
      calls.push(request);
      const text = responses[Math.min(i, responses.length - 1)]!;
      i++;
      return { text, model: 'stub-1', stopReason: 'stop' as const };
    },
  };
}

const analysis: RouteAnalysis[] = [
  {
    route: '/',
    title: 'Relay — support that answers itself',
    screenshot: '',
    elements: [
      {
        selector: 'h1',
        type: 'hero',
        text: 'Every password reset, handled',
        bounds: { x: 100, y: 200, width: 800, height: 90 },
        importance: 0.9,
      },
    ],
    brand: {
      productName: 'Relay',
      tagline: 'Support that answers itself',
      accent: '#0A84FF',
      accentCandidates: [],
      background: '#000000',
      scheme: 'dark',
      fontDisplay: 'Inter',
      fontText: 'Inter',
      radius: 12,
      hasShadows: true,
      navLabels: ['Product', 'Pricing'],
      headings: ['Every password reset, handled'],
      ctaLabels: ['Start free trial'],
      logoSvg: null,
      fontWarnings: [],
    },
  },
];

/** A storyboard that passes the schema and every craft rule. */
function validFilm(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    product: 'Relay',
    thesis: 'Relay answers repetitive tickets so a support lead does not have to.',
    duration: 12_000,
    fps: 30,
    aspect: '16:9',
    resolution: { width: 1920, height: 1080 },
    preset: 'apple',
    brand: { accent: '#0A84FF', scheme: 'dark', productName: 'Relay' },
    scenes: [
      {
        id: 'hook',
        beat: 'hook',
        type: 'text',
        start: 0,
        duration: 5000,
        copy: { headline: 'Every day, the same ticket.', bodySize: 32 },
        animations: [
          { target: '[data-el="headline"]', at: 300, dur: 800, ease: 'outExpo', opacity: [0, 1], y: [24, 0] },
        ],
      },
      {
        id: 'end',
        beat: 'end',
        type: 'cta',
        start: 4700,
        duration: 3600,
        copy: { headline: 'Start free trial', cta: 'relay.app', bodySize: 28 },
        animations: [
          { target: '[data-el="headline"]', at: 200, dur: 900, ease: 'outExpo', opacity: [0, 1], y: [110, 0] },
        ],
      },
    ],
    ...overrides,
  };
}

const base = {
  skills,
  analysis,
  model: 'stub-1',
  durationMs: 12_000,
} as const;

describe('the prompt', () => {
  it('carries the laws, the skill index and the stage policy', async () => {
    const provider = scripted([JSON.stringify(validFilm())]);
    await generateStoryboard({ ...base, provider });

    const system = provider.calls[0]!.messages.find((m: Message) => m.role === 'system')!.content;
    expect(system).toMatch(/Craft laws/);
    expect(system).toMatch(/hard cut/i);
    expect(system).toMatch(/# Skill library/);
    expect(system).toMatch(/Craft guidance for this step/);
  });

  it('states every enum exhaustively', async () => {
    // A model inventing `easeOut` is the most common single failure and costs a
    // full round trip, so the vocabulary is spelled out rather than described.
    const provider = scripted([JSON.stringify(validFilm())]);
    await generateStoryboard({ ...base, provider });

    const user = provider.calls[0]!.messages.filter((m: Message) => m.role === 'user')[0]!.content;
    expect(user).toContain('"outQuint"');
    expect(user).toContain('"softLand"');
    expect(user).toContain('"payoff"');
    expect(user).toContain('"dashboard"');
  });

  it("passes the user's own words through", async () => {
    const provider = scripted([JSON.stringify(validFilm())]);
    await generateStoryboard({ ...base, provider, prompt: 'make it feel urgent, 12 seconds' });
    const user = provider.calls[0]!.messages.filter((m: Message) => m.role === 'user')[0]!.content;
    expect(user).toContain('make it feel urgent');
  });

  it("gives the model the product's own headlines", async () => {
    const provider = scripted([JSON.stringify(validFilm())]);
    await generateStoryboard({ ...base, provider });
    const user = provider.calls[0]!.messages.filter((m: Message) => m.role === 'user')[0]!.content;
    expect(user).toContain('Every password reset, handled');
    expect(user).toContain('#0A84FF');
  });

  it('asks for JSON and keeps the temperature low', async () => {
    // The film is the creative artefact; the JSON is a structured document, where
    // creativity shows up as an invalid enum.
    const provider = scripted([JSON.stringify(validFilm())]);
    await generateStoryboard({ ...base, provider });
    expect(provider.calls[0]!.json).toBe(true);
    expect(provider.calls[0]!.temperature).toBeLessThanOrEqual(0.5);
  });

  it('matches the resolution to the requested aspect', async () => {
    const provider = scripted([
      JSON.stringify(validFilm({ aspect: '9:16', resolution: { width: 1080, height: 1920 } })),
    ]);
    await generateStoryboard({ ...base, provider, aspect: '9:16' });
    const user = provider.calls[0]!.messages.filter((m: Message) => m.role === 'user')[0]!.content;
    expect(user).toContain('"9:16"');
    expect(user).toContain('1080');
  });
});

describe('the validation loop', () => {
  it('accepts a clean storyboard in one call', async () => {
    const provider = scripted([JSON.stringify(validFilm())]);
    const result = await generateStoryboard({ ...base, provider });
    expect(result.attempts).toBe(1);
    expect(result.storyboard.product).toBe('Relay');
    expect(provider.calls).toHaveLength(1);
  });

  it('merges measured brand facts back in rather than asking for them', async () => {
    // A logo is a blob of SVG no model should transcribe, and radius and typeface
    // are measurements — asking invites invention, and a hallucinated brand is
    // worse than a plain one.
    const withLogo: RouteAnalysis[] = [
      {
        ...analysis[0]!,
        brand: { ...analysis[0]!.brand, logoSvg: '<svg><circle r="9"/></svg>', radius: 8 },
      },
    ];
    const provider = scripted([JSON.stringify(validFilm())]);
    const result = await generateStoryboard({ ...base, provider, analysis: withLogo });

    expect(result.storyboard.brand.logoSvg).toContain('circle');
    expect(result.storyboard.brand.radius).toBe(8);
    expect(result.storyboard.brand.fontDisplay).toBe('Inter');
  });

  it('does not overwrite a brand value the model set deliberately', async () => {
    const film = validFilm();
    (film.brand as Record<string, unknown>).fontDisplay = 'Playfair Display';
    const provider = scripted([JSON.stringify(film)]);
    const result = await generateStoryboard({ ...base, provider });
    expect(result.storyboard.brand.fontDisplay).toBe('Playfair Display');
  });

  it('strips prose and fences around the JSON', async () => {
    const provider = scripted([
      `Here is the storyboard:\n\`\`\`json\n${JSON.stringify(validFilm())}\n\`\`\`\nLet me know!`,
    ]);
    const result = await generateStoryboard({ ...base, provider });
    expect(result.storyboard.product).toBe('Relay');
  });

  it('repairs a mechanical violation without asking the model', async () => {
    // A linear ease on a moving element has exactly one right answer, so spending
    // a round trip on it is waste.
    const film = validFilm();
    (film.scenes as Record<string, unknown>[])[0]!.animations = [
      { target: '[data-el="headline"]', at: 300, dur: 800, ease: 'linear', opacity: [0, 1], y: [24, 0] },
    ];

    const provider = scripted([JSON.stringify(film)]);
    const result = await generateStoryboard({ ...base, provider });

    expect(provider.calls).toHaveLength(1); // repaired locally
    expect(result.storyboard.scenes[0]!.animations[0]!.ease).toBe('outQuint');
    expect(result.repaired.some((v) => v.rule === 'no-linear-on-motion')).toBe(true);
  });

  it('sends a content violation back with the rule text', async () => {
    // Two CTAs is a content decision: deleting one silently would produce a film
    // that is technically clean and commercially wrong.
    const twoCtas = validFilm();
    (twoCtas.scenes as Record<string, unknown>[])[0]!.copy = {
      headline: 'Every day, the same ticket.',
      cta: 'Book a demo',
      bodySize: 32,
    };

    const provider = scripted([JSON.stringify(twoCtas), JSON.stringify(validFilm())]);
    const result = await generateStoryboard({ ...base, provider });

    expect(provider.calls).toHaveLength(2);
    const reask = provider.calls[1]!.messages[provider.calls[1]!.messages.length - 1]!.content;
    expect(reask).toContain('single-cta');
    expect(reask).toContain('§'); // the rule cites its skill section
    expect(result.attempts).toBe(2);
  });

  it('sends schema issues back as specific paths', async () => {
    const provider = scripted([
      JSON.stringify(validFilm({ duration: 500 })), // below the 3000ms floor
      JSON.stringify(validFilm()),
    ]);
    const result = await generateStoryboard({ ...base, provider });

    const reask = provider.calls[1]!.messages[provider.calls[1]!.messages.length - 1]!.content;
    expect(reask).toMatch(/duration/);
    expect(result.attempts).toBe(2);
  });

  it('asks again when the response is not JSON at all', async () => {
    const provider = scripted(['I would rather not.', JSON.stringify(validFilm())]);
    const result = await generateStoryboard({ ...base, provider });
    expect(result.attempts).toBe(2);
    const reask = provider.calls[1]!.messages[provider.calls[1]!.messages.length - 1]!.content;
    expect(reask).toMatch(/not parseable as JSON/);
  });

  it('carries the previous answer into the re-ask', async () => {
    // The model needs its own output to correct it; a bare complaint makes it
    // start over and usually reintroduces the fault.
    const twoCtas = validFilm();
    (twoCtas.scenes as Record<string, unknown>[])[0]!.copy = { headline: 'x', cta: 'Book a demo', bodySize: 32 };
    const provider = scripted([JSON.stringify(twoCtas), JSON.stringify(validFilm())]);
    await generateStoryboard({ ...base, provider });

    const roles = provider.calls[1]!.messages.map((m: Message) => m.role);
    expect(roles).toContain('assistant');
  });

  it('is bounded — it reports the violation rather than looping', async () => {
    // §29.1: a user would rather read "this film has two calls to action" than
    // watch a spinner burn tokens.
    const twoCtas = validFilm();
    (twoCtas.scenes as Record<string, unknown>[])[0]!.copy = { headline: 'x', cta: 'Book a demo', bodySize: 32 };

    const provider = scripted([JSON.stringify(twoCtas)]);
    await expect(
      generateStoryboard({ ...base, provider, maxAttempts: 2 })
    ).rejects.toThrow(/craft rule/);
    expect(provider.calls).toHaveLength(2);
  });

  it('explains a truncated response instead of retrying it', async () => {
    // The fix is fewer scenes or a higher maxTokens, not another identical call.
    const provider: AIProvider = {
      id: 'stub',
      name: 'Stub',
      envVars: [],
      async listModels() {
        return [];
      },
      async generate() {
        return { text: '{"product":"Relay"', model: 'stub-1', stopReason: 'length' as const };
      },
    };
    await expect(generateStoryboard({ ...base, provider })).rejects.toThrow(/cut off/);
  });

  it('reports warnings without blocking', async () => {
    // §57.2: a warning is reported and proceeds; only an error blocks.
    const film = validFilm();
    // Butt-joined scenes: a pacing warning, not a broken film.
    (film.scenes as Record<string, unknown>[])[1]!.start = 5000;
    const provider = scripted([JSON.stringify(film)]);
    const result = await generateStoryboard({ ...base, provider });
    expect(result.storyboard).toBeDefined();
  });
});

describe('delivery', () => {
  /**
   * Delivery is the caller's decision, not the model's — it is a fact about
   * where the film is going, and the model is told it rather than asked. These
   * tests exist because the contract used to hardcode `"fps": 30`, which is a
   * broadcast cadence in neither region, and there was no way to set it: asking
   * for a UK master produced a guaranteed conformance error with no remedy.
   */
  it('tells the model the cadence and the destination', async () => {
    const provider = scripted([JSON.stringify(validFilm({ fps: 25, delivery: 'broadcast-uk' }))]);
    await generateStoryboard({ ...base, provider, delivery: 'broadcast-uk' });
    const user = provider.calls[0]!.messages.filter((m: Message) => m.role === 'user')[0]!.content;
    expect(user).toContain('"fps":        25');
    expect(user).toContain('"broadcast-uk"');
  });

  it('derives the cadence from the profile: 25 for UK, 29.97 for US', async () => {
    for (const [delivery, fps] of [['broadcast-uk', 25], ['broadcast-us', 29.97]] as const) {
      const provider = scripted([JSON.stringify(validFilm({ fps, delivery }))]);
      const result = await generateStoryboard({ ...base, provider, delivery });
      expect(result.storyboard.fps).toBe(fps);
      expect(result.storyboard.delivery).toBe(delivery);
    }
  });

  it('pins the profile even when the model returns a different one', async () => {
    // The model has no basis for revising a destination it was handed, and a
    // film written for broadcast but labelled `web` encodes at the wrong
    // loudness with nothing in the picture to reveal it.
    const provider = scripted([JSON.stringify(validFilm({ fps: 25, delivery: 'web' }))]);
    const result = await generateStoryboard({ ...base, provider, delivery: 'broadcast-uk' });
    expect(result.storyboard.delivery).toBe('broadcast-uk');
    expect(result.storyboard.fps).toBe(25);
  });

  it('leaves a web film its own cadence, which is a creative call', async () => {
    // 24, 30 and 60 are all legitimate for the web, so a model choosing 24 for
    // a cinematic cut is making a decision rather than an error. Only a
    // profile that pins a cadence overrides it.
    const provider = scripted([JSON.stringify(validFilm({ fps: 24 }))]);
    const result = await generateStoryboard({ ...base, provider });
    expect(result.storyboard.fps).toBe(24);
    expect(result.storyboard.delivery).toBe('web');
  });

  it('honours an explicit fps override against the profile default', async () => {
    const provider = scripted([JSON.stringify(validFilm({ fps: 50, delivery: 'broadcast-uk' }))]);
    const result = await generateStoryboard({ ...base, provider, delivery: 'broadcast-uk', fps: 50 });
    expect(result.storyboard.fps).toBe(50);
  });

  it('defaults to web when given nothing', async () => {
    const provider = scripted([JSON.stringify(validFilm())]);
    const result = await generateStoryboard({ ...base, provider });
    expect(result.storyboard.delivery).toBe('web');
  });
});

describe('validateStoryboard', () => {
  it('accepts the shipped demo storyboard', async () => {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(join(process.cwd(), 'examples', 'demo-film', 'storyboard.json'), 'utf8');
    const result = validateStoryboard(JSON.parse(raw));
    expect(result.issues).toEqual([]);
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('reports schema issues as paths', () => {
    const result = validateStoryboard({ product: 'x' });
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});
