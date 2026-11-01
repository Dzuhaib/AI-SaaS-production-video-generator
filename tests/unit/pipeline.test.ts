/**
 * Pipeline wiring tests.
 *
 * One regression motivates this whole file, and it is the reason the US/UK
 * delivery layer sat unreachable through a whole session:
 *
 *   `runPipeline` read `sb.delivery`, reported `conformance()` against it, and
 *   then called `render()` without passing it. `encode()` defaulted to `web`.
 *
 * So a film declared for UK broadcast was *checked* as a UK master and
 * *written* at -14 LUFS with no closed GOPs — a file that passes its own
 * conformance report and fails QC. Every unit in the chain was correct. Only
 * the wire between two of them was missing, and neither the type checker nor
 * 226 passing tests said a word.
 *
 * These tests assert on the arguments that actually cross the boundaries,
 * because that is where the defect lived. The browser, the provider and the
 * renderer are mocked; the compiler runs for real, so the storyboard is
 * genuinely compiled and the caption/conformance notes are genuinely derived.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RenderOptions } from '../../src/renderer/index.js';
import type { RouteAnalysis } from '../../src/browser/analyze.js';

/* ---- Recorded calls --------------------------------------------- */

const renderCalls: RenderOptions[] = [];

/* ---- Mocks ------------------------------------------------------- *
 * Everything that needs a browser, a network or an API key. The compiler and
 * the storyboard schema are deliberately real.
 */

const analysis: RouteAnalysis[] = [
  {
    route: '/',
    title: 'Relay',
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
      navLabels: [],
      headings: ['Every password reset, handled'],
      ctaLabels: ['Start free trial'],
      logoSvg: null,
      fontWarnings: [],
    },
  },
];

/** A storyboard that passes the schema and every craft rule. */
function film(over: Record<string, unknown> = {}): Record<string, unknown> {
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
    ...over,
  };
}

/** What the scripted model returns. Mutable, so a test can change it. */
let modelResponse = JSON.stringify(film());

vi.mock('../../src/providers/index.js', () => ({
  resolveProvider: async () => ({
    provider: {
      id: 'stub',
      name: 'Stub',
      envVars: [],
      listModels: async () => [],
      generate: async () => ({ text: modelResponse, model: 'stub-1', stopReason: 'stop' as const }),
    },
    model: 'stub-1',
    origin: 'env' as const,
  }),
}));

vi.mock('../../src/browser/crawl.js', () => ({
  crawlRoutes: async () => ({ routes: ['/'], skipped: [] }),
}));

vi.mock('../../src/browser/analyze.js', () => ({
  analyzeRoutes: async () => analysis,
}));

vi.mock('../../src/renderer/index.js', () => ({
  render: async (opts: RenderOptions) => {
    renderCalls.push(opts);
    return opts.output;
  },
}));

const { runPipeline } = await import('../../src/pipeline.js');

/* ---- Harness ----------------------------------------------------- */

let workDir: string;

beforeEach(async () => {
  renderCalls.length = 0;
  modelResponse = JSON.stringify(film());
  workDir = await mkdtemp(join(tmpdir(), 'urlume-pipeline-'));
});

async function run(opts: Record<string, unknown> = {}) {
  const result = await runPipeline({
    url: 'https://relay.test',
    workDir,
    cache: false,
    ...opts,
  } as Parameters<typeof runPipeline>[0]);
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
  return result;
}

/* ------------------------------------------------------------------ *
 * The regression
 * ------------------------------------------------------------------ */

describe('delivery reaches the encoder', () => {
  it('passes the storyboard profile to the renderer', async () => {
    // THE regression. Without this line in pipeline.ts the renderer defaults to
    // `web` and a broadcast master is silently written at the wrong loudness.
    modelResponse = JSON.stringify(film({ fps: 25, delivery: 'broadcast-uk' }));
    await run({ delivery: 'broadcast-uk' });

    expect(renderCalls).toHaveLength(1);
    expect(renderCalls[0]!.profile).toBe('broadcast-uk');
  });

  it('carries a web film through as web', async () => {
    await run();
    expect(renderCalls[0]!.profile).toBe('web');
  });

  it('burns in captions for social without being asked', async () => {
    // Most feed players never show a sidecar, so a social cut that only writes
    // one ships effectively uncaptioned.
    modelResponse = JSON.stringify(film({ delivery: 'social' }));
    await run({ delivery: 'social' });
    expect(renderCalls[0]!.burnCaptions).toBe(true);
  });

  it('does not burn captions into a broadcast master, which wants the sidecar', async () => {
    modelResponse = JSON.stringify(film({ fps: 25, delivery: 'broadcast-uk' }));
    await run({ delivery: 'broadcast-uk' });
    expect(renderCalls[0]!.burnCaptions).toBeUndefined();
  });

  it('honours an explicit --burn-captions on any profile', async () => {
    await run({ burnCaptions: true });
    expect(renderCalls[0]!.burnCaptions).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Conformance gating
 * ------------------------------------------------------------------ */

describe('conformance gating', () => {
  it('emits a conformance report before rendering', async () => {
    const events: { type: string; name?: string }[] = [];
    modelResponse = JSON.stringify(film({ fps: 25, delivery: 'broadcast-uk' }));
    await run({
      delivery: 'broadcast-uk',
      onEvent: (e: { type: string; name?: string }) => events.push(e),
    });

    // Against the render *stage* marker rather than a `render` event: the
    // renderer is mocked here and emits none of its own.
    const labels = events.map((e) => (e.type === 'stage' ? `stage:${e.name}` : e.type));
    expect(labels).toContain('conformance');
    expect(labels).toContain('stage:render');
    // Before the render, or it has cost nine hundred frames to learn something
    // that was knowable from the storyboard.
    expect(labels.indexOf('conformance')).toBeLessThan(labels.indexOf('stage:render'));
  });

  it('renders despite a conformance error by default', async () => {
    // 30fps is a cadence in neither region. Advisory unless asked otherwise:
    // the caller decides whether a warning blocks delivery.
    modelResponse = JSON.stringify(film({ fps: 30, delivery: 'broadcast-uk' }));
    await run({ delivery: 'broadcast-uk', fps: 30 });
    expect(renderCalls).toHaveLength(1);
  });

  it('refuses under --strict, before spending a single frame', async () => {
    modelResponse = JSON.stringify(film({ fps: 30, delivery: 'broadcast-uk' }));
    await expect(
      run({ delivery: 'broadcast-uk', fps: 30, strict: true })
    ).rejects.toThrow(/does not conform/);
    expect(renderCalls).toHaveLength(0);
  });

  it('renders under --strict --force', async () => {
    modelResponse = JSON.stringify(film({ fps: 30, delivery: 'broadcast-uk' }));
    await run({ delivery: 'broadcast-uk', fps: 30, strict: true, force: true });
    expect(renderCalls).toHaveLength(1);
  });

  it('does not block on warnings alone', async () => {
    // A landscape film bound for a feed is a warning, and blocking on it would
    // make --strict unusable in practice.
    modelResponse = JSON.stringify(film({ delivery: 'social' }));
    await run({ delivery: 'social', strict: true });
    expect(renderCalls).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

describe('the saved storyboard', () => {
  it('records the delivery profile, so a later bare `render` can find it', async () => {
    // `urlume render` against an existing build has no storyboard in hand. It
    // reads this file; if the profile were not written, it would revert to web.
    modelResponse = JSON.stringify(film({ fps: 25, delivery: 'broadcast-uk' }));
    const dir = await mkdtemp(join(tmpdir(), 'urlume-persist-'));
    try {
      await runPipeline({
        url: 'https://relay.test',
        workDir: dir,
        cache: false,
        delivery: 'broadcast-uk',
        stopAfterStoryboard: true,
      });
      const saved = JSON.parse(
        await readFile(join(dir, '.urlume', 'storyboard', 'main.json'), 'utf8')
      ) as { delivery: string; fps: number };
      expect(saved.delivery).toBe('broadcast-uk');
      expect(saved.fps).toBe(25);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('stops before the renderer when asked for a storyboard only', async () => {
    await run({ stopAfterStoryboard: true });
    expect(renderCalls).toHaveLength(0);
  });
});
