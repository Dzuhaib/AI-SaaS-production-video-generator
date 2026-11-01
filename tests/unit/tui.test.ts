/**
 * Interface tests.
 *
 * Ink's input layer needs a real TTY, so keystrokes cannot be simulated here — the
 * TTY guard in `startTui` is what makes that explicit rather than a hang. What *is*
 * testable is everything the interface is built out of: the banner geometry, the
 * command catalogue, the provider and gateway tables, and the credential shape the
 * setup flow produces. Those are where a mistake ships silently; a mis-wired keypress
 * is caught the first time anyone runs it.
 */

import { describe, it, expect } from 'vitest';

import { banner, TAGLINE, BLURB, ART_HEIGHT } from '../../src/tui/banner.js';
import {
  PROVIDER_IDS,
  PROVIDER_NAMES,
  OFFICIAL_BASE_URLS,
  GATEWAYS,
  DEFAULT_MODELS,
  createProvider,
} from '../../src/providers/index.js';

describe('banner', () => {
  it('centres the block art without shearing it', () => {
    const lines = banner(100);
    // Matched on any box-drawing character, not just `█`: the bottom row of the
    // wordmark is entirely `╚═╝` and would otherwise be missed.
    const art = lines.filter((l) => /[█╗║╔╝╚═]/.test(l.text));
    expect(art.length).toBe(ART_HEIGHT);

    // The block must be centred as one rectangle. Rows 3-4 end early and the last
    // row starts with a space that belongs to its glyph, so the art is normalised
    // before centring; measured per row, the indent may differ by at most that one
    // intentional character.
    const indents = art.map((l) => l.text.length - l.text.trimStart().length);
    const spread = Math.max(...indents) - Math.min(...indents);
    expect(spread, 'rows are sheared relative to each other').toBeLessThanOrEqual(1);

    for (const line of art) expect(line.text.length).toBeLessThanOrEqual(100);
  });

  it('falls back to plain text in a narrow terminal', () => {
    // Half a sheared block letter reads as a rendering fault, and a narrow terminal
    // is exactly where a first impression matters.
    const lines = banner(40);
    expect(lines.some((l) => l.text.includes('█'))).toBe(false);
    expect(lines[0]!.text).toBe('URLUME');
    for (const line of lines) expect(line.text.length).toBeLessThanOrEqual(62);
  });

  it('carries the wordmark and the promise', () => {
    const text = banner(100)
      .map((l) => l.text)
      .join('\n');
    expect(text).toContain(TAGLINE);
    expect(text).toContain(BLURB);
  });

  it('never lets the art exceed the terminal', () => {
    for (const columns of [56, 60, 80, 120, 200]) {
      for (const line of banner(columns)) {
        expect(line.text.length, `${columns} columns`).toBeLessThanOrEqual(columns);
      }
    }
  });
});

describe('the provider menu', () => {
  it('offers every provider that has an adapter', () => {
    // The menu is hand-written, so a provider added to the registry and forgotten in
    // the UI is unreachable — this is the check that catches it.
    for (const id of PROVIDER_IDS) {
      expect(PROVIDER_NAMES[id], `${id} has no display name`).toBeTruthy();
    }
  });

  it('has an official endpoint for every first-party provider', () => {
    // `custom` is the exception by definition: it exists to be given a URL.
    for (const id of PROVIDER_IDS) {
      if (id === 'custom') continue;
      expect(OFFICIAL_BASE_URLS[id], `${id} has no official base URL`).toMatch(/^https:\/\//);
    }
  });

  it('has a default model for every first-party provider', () => {
    for (const id of PROVIDER_IDS) {
      if (id === 'custom') continue;
      expect(DEFAULT_MODELS[id], `${id} has no default model`).toBeTruthy();
    }
  });
});

describe('gateway presets', () => {
  it('gives every gateway a usable URL', () => {
    expect(GATEWAYS.length).toBeGreaterThan(0);
    for (const gateway of GATEWAYS) {
      expect(gateway.baseUrl, gateway.id).toMatch(/^https?:\/\//);
      // No trailing slash: the adapter appends `/chat/completions`, and a double
      // slash is a 404 on several gateways.
      expect(gateway.baseUrl.endsWith('/'), gateway.id).toBe(false);
      expect(gateway.name.length).toBeGreaterThan(2);
    }
  });

  it('carries the client header AgentRouter requires', () => {
    // It authenticates the *client* as well as the key and rejects an unrecognised
    // user-agent with a 401 that reads exactly like a stale credential. Shipping the
    // header with the preset is what stops a user rotating a perfectly good key.
    const agentRouter = GATEWAYS.find((g) => g.id === 'agentrouter');
    expect(agentRouter).toBeDefined();
    expect(agentRouter!.headers?.['user-agent']).toBeTruthy();
  });

  it('names a default model where the catalogue is the gateway\'s own', () => {
    // A gateway's model ids are not the vendor's, so DEFAULT_MODELS cannot help.
    const agentRouter = GATEWAYS.find((g) => g.id === 'agentrouter');
    expect(agentRouter!.model).toBeTruthy();
  });

  it('builds a working client from every preset', () => {
    // The setup flow stores a gateway under `custom` (or `openai`), because a gateway
    // speaks the OpenAI wire format whichever vendor's models it resells.
    for (const gateway of GATEWAYS) {
      const client = createProvider('custom', 'test-key', {
        baseUrl: gateway.baseUrl,
        ...(gateway.headers ? { headers: gateway.headers } : {}),
      });
      expect(client.id, gateway.id).toBe('custom');
      expect(typeof client.generate).toBe('function');
      expect(typeof client.listModels).toBe('function');
    }
  });
});

describe('doctor', () => {
  it('reports on node, chromium, ffmpeg and the provider', async () => {
    const { doctor } = await import('../../src/tui/app.js');
    const report = await doctor();
    const text = report.map((r) => r.text).join('\n');
    expect(text).toContain('node');
    expect(text).toContain('chromium');
    expect(text).toContain('ffmpeg');
    expect(text).toContain('provider');
  });

  it('names playwright-core, not playwright, when the browser is missing', async () => {
    // Each Playwright version expects one specific Chromium revision, so
    // `npx playwright install` fetches whatever the latest release wants and leaves
    // this build still looking for a revision nobody downloaded.
    const { doctor } = await import('../../src/tui/app.js');
    const report = await doctor();
    const hint = report.find((r) => r.text.includes('install chromium'));
    if (hint) expect(hint.text).toContain('playwright-core install');
  });
});
