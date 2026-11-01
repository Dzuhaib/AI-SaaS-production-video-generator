/**
 * Theme, icon and layout tests.
 *
 * One property under test above all others: **nothing is hardcoded to a brand.**
 * Every film used to arrive dark blue with a purple-cyan aurora and no logo,
 * whatever site it came from, and that sameness is the loudest possible tell that a
 * video was generated. So these assert that two different brands produce two
 * different films, and that the extracted logo, accent, radius and typeface all
 * actually reach the page.
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { storyboardSchema, type Storyboard } from '../../src/storyboard/schema.js';
import { compile } from '../../src/compiler/index.js';
import { themeFor, presetFor, hexToHsl } from '../../src/compiler/theme.js';
import { resolveIcon, iconSvg, ICON_NAMES } from '../../src/compiler/icons.js';
import { stripComments, MOTION_CSS } from '../helpers/html.js';

async function fakeRuntime(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'urlume-runtime-'));
  await mkdir(join(dir, 'runtime', 'assets'), { recursive: true });
  await mkdir(join(dir, 'assets'), { recursive: true });
  for (const f of ['explainer.css', 'components.css', 'timeline.js', 'sfx.js']) {
    await writeFile(join(dir, 'runtime', 'assets', f), '/* stub */\n', 'utf8');
  }
  await writeFile(join(dir, 'assets', 'depth.css'), '/* depth */\n', 'utf8');
  return dir;
}

function film(overrides: Record<string, unknown> = {}): Storyboard {
  return storyboardSchema.parse({
    product: 'Acme',
    duration: 12_000,
    resolution: { width: 1920, height: 1080 },
    brand: { accent: '#0A84FF', scheme: 'dark', productName: 'Acme' },
    scenes: [
      {
        id: 'hook',
        beat: 'hook',
        type: 'text',
        start: 0,
        duration: 5000,
        copy: { headline: 'A problem.', bodySize: 32 },
        elements: [{ id: 'r1', type: 'row', text: 'WhatsApp message', importance: 0.5 }],
      },
      {
        id: 'end',
        beat: 'end',
        type: 'cta',
        start: 4700,
        duration: 3600,
        copy: { headline: 'Start free', cta: 'acme.com', bodySize: 28 },
      },
    ],
    ...overrides,
  });
}

async function build(sb: Storyboard) {
  const root = await fakeRuntime();
  const outDir = await mkdtemp(join(tmpdir(), 'urlume-film-'));
  return compile({
    storyboard: sb,
    outDir,
    runtimeDir: join(root, 'runtime'),
    extraAssetsDir: join(root, 'assets'),
  });
}

describe('preset selection', () => {
  it('never puts a light brand on a dark preset', () => {
    // A light film on a dark preset is unreadable, not merely off-brand.
    expect(presetFor({ scheme: 'light', accent: '#4a918c', productName: 'x' })).toBe('light');
    expect(presetFor({ scheme: 'light', accent: '#ff0000', productName: 'x' })).toBe('light');
  });

  it('picks a field that suits the accent hue', () => {
    expect(presetFor({ scheme: 'dark', accent: '#ff5722', productName: 'x' })).toBe('warm');
    expect(presetFor({ scheme: 'dark', accent: '#6b4dff', productName: 'x' })).toBe('midnight');
    expect(presetFor({ scheme: 'dark', accent: '#8a8a8a', productName: 'x' })).toBe('mono');
  });

  it('reads a hex accent correctly', () => {
    const teal = hexToHsl('#4a918c');
    expect(teal).not.toBeNull();
    expect(Math.round(teal!.h)).toBeGreaterThan(160);
    expect(Math.round(teal!.h)).toBeLessThan(190);
  });
});

describe('the brand reaches the page', () => {
  it('writes accent, radius and typeface as custom properties', async () => {
    const built = await build(
      film({
        brand: {
          // 7.2:1 on the light preset's #F5F5F7, so contrast repair leaves it alone
          // and this test stays about the plumbing rather than about the repair.
          accent: '#1f5f5a',
          scheme: 'light',
          productName: 'Clinza',
          radius: 8,
          fontDisplay: 'Poppins',
        },
      })
    );

    expect(built.html).toContain('--accent:#1f5f5a');
    expect(built.html).toContain('--r-md:8px');
    expect(built.html).toContain('Poppins');
    expect(built.html).toContain('data-preset="light"');
  });

  it('builds the background field from the accent, not a fixed palette', async () => {
    // The stock aurora is hsl(211) blue + hsl(266) purple + hsl(190) cyan. A teal
    // brand that still renders those is the bug this exists to prevent.
    const built = await build(
      film({ brand: { accent: '#4a918c', scheme: 'light', productName: 'Clinza' } })
    );
    const aurora = /class="bg-aurora"[^>]*style="background:([^"]+)"/.exec(built.html);
    expect(aurora).not.toBeNull();
    expect(aurora![1]).toMatch(/hsl\(17[0-9] /); // the brand's own hue
    expect(aurora![1]).not.toContain('hsl(211');
    expect(aurora![1]).not.toContain('hsl(266');
  });

  it('gives two different brands two different films', async () => {
    const teal = await build(
      film({ brand: { accent: '#4a918c', scheme: 'light', productName: 'A', radius: 4 } })
    );
    const orange = await build(
      film({ brand: { accent: '#ff5722', scheme: 'dark', productName: 'B', radius: 20 } })
    );

    expect(teal.html).not.toBe(orange.html);
    expect(teal.html).toContain('data-preset="light"');
    expect(orange.html).toContain('data-preset="warm"');
    expect(teal.html).toContain('--r-md:4px');
    expect(orange.html).toContain('--r-md:20px');
  });

  it('inlines the extracted logo rather than dropping it', async () => {
    // It was extracted and then thrown away: the compiler never emitted it.
    const logo = '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="18"/></svg>';
    const built = await build(
      film({ brand: { accent: '#0A84FF', scheme: 'dark', productName: 'Acme', logoSvg: logo } })
    );
    expect(built.html).toContain('circle cx="20"');
    expect(built.html).toContain('data-el="logo"');
  });

  it('falls back to a wordmark when the site has no usable logo', async () => {
    const built = await build(film());
    expect(built.html).toContain('brand-word');
    expect(built.html).toContain('Acme');
  });

  it('ships the depth layer alongside the engine', async () => {
    const built = await build(film());
    expect(built.html).toContain('assets/depth.css');
    expect(built.files.some((f) => f.endsWith('depth.css'))).toBe(true);
  });
});

describe('scene layouts differ by type', () => {
  const types = ['hero', 'dashboard', 'device', 'feature', 'scroll', 'cta', 'logo'] as const;

  it('renders a distinct composition for every type', async () => {
    // Every scene used to be "centred copy plus absolutely positioned elements",
    // which is why a dashboard beat and an end card looked like the same shot.
    const seen = new Map<string, string>();

    for (const type of types) {
      const sb = film();
      sb.scenes[0]!.type = type;
      sb.scenes[0]!.elements = [
        { id: 'a', type: 'feature', text: 'Auto booking', secondary: 'Books itself', importance: 0.8 },
        { id: 'b', type: 'metric', text: 'Replies', value: '2.4s', importance: 0.7 },
        { id: 'c', type: 'row', text: 'WhatsApp', secondary: 'new', importance: 0.6 },
      ];
      const built = await build(sb);
      const scene = /<section class="scene[^"]*" data-scene="hook">([\s\S]*?)<\/section>/.exec(built.html);
      expect(scene, `no scene markup for ${type}`).not.toBeNull();
      seen.set(type, scene![1]!);
    }

    // No two types may produce identical markup.
    const rendered = [...seen.values()];
    expect(new Set(rendered).size).toBe(rendered.length);
  });

  it('puts a real browser frame in a dashboard beat', async () => {
    // The payload matters: a dashboard is furniture — rows, numbers, an action —
    // and that is what justifies chrome around it. A scene carrying one lone
    // metric is a proof shot and deliberately takes a different layout (below).
    const sb = film();
    sb.scenes[0]!.type = 'dashboard';
    sb.scenes[0]!.elements = [
      { id: 'm', type: 'metric', text: 'Leads', value: '128', importance: 0.9 },
      { id: 'm2', type: 'metric', text: 'Replies', value: '2.4s', importance: 0.8 },
      { id: 'r1', type: 'row', text: 'Sara M. WhatsApp', importance: 0.6 },
      { id: 'r2', type: 'row', text: 'Nour K. Instagram', importance: 0.6 },
      { id: 'b', type: 'button', text: 'Open conversation', importance: 0.5 },
    ];
    const built = await build(sb);
    expect(built.html).toContain('frame-window');
    expect(built.html).toContain('frame-bar');
  });

  it('gives a lone metric the big-number layout, whatever the scene type says', async () => {
    // Regression, found by looking at a rendered film rather than by any test:
    // a `payoff` beat with one metric and a badge was typed `dashboard`, so it
    // got a browser window — a squat, near-empty chrome frame with "+40%" set at
    // body size in the corner. The number the film exists to land was the
    // smallest text on screen. Content shape decides this, not the declared type.
    for (const type of ['dashboard', 'feature', 'zoom', 'hero'] as const) {
      const sb = film();
      sb.scenes[0]!.type = type;
      sb.scenes[0]!.elements = [
        { id: 'm', type: 'metric', text: 'More bookings', value: '+40%', importance: 0.9 },
        { id: 'b', type: 'badge', text: 'verified', importance: 0.3 },
      ];
      const built = await build(sb);
      expect(built.html, `${type} buried its only number in chrome`).toContain('stat-value');
      expect(built.html, `${type} framed a single metric`).not.toContain('frame-window');
      expect(built.html).toContain('+40%');
    }
  });

  it('still renders every metric when a scene carries several', async () => {
    // The mirror of the rule above: three numbers are a stat row, not one hero
    // number, and routing them to the big-number layout rendered the first and
    // silently dropped the other two.
    const sb = film();
    sb.scenes[0]!.type = 'feature';
    sb.scenes[0]!.elements = [
      { id: 'm1', type: 'metric', text: 'Bookings', value: '+40%', importance: 0.9 },
      { id: 'm2', type: 'metric', text: 'Replies', value: '2.4s', importance: 0.8 },
      { id: 'm3', type: 'metric', text: 'Handled', value: '10k', importance: 0.7 },
    ];
    const built = await build(sb);
    for (const value of ['+40%', '2.4s', '10k']) {
      expect(built.html, `dropped ${value}`).toContain(value);
    }
  });

  it('puts a phone frame and an alternating thread in a device beat', async () => {
    const sb = film();
    sb.scenes[0]!.type = 'device';
    sb.scenes[0]!.elements = [
      { id: 'q', type: 'row', text: 'Are you open?', importance: 0.6 },
      { id: 'a', type: 'row', text: 'Yes — Thursday 10:00', importance: 0.6 },
    ];
    const built = await build(sb);
    expect(built.html).toContain('frame-phone');
    expect(built.html).toContain('bubble-them');
    expect(built.html).toContain('bubble-us');
  });

  it('brings a frame in with real 3D rotation', async () => {
    // A frame is the subject of its beat, so it enters as an object with mass
    // rather than fading in flat. The engine always interpolated rotateY; the
    // schema simply never exposed it.
    const sb = film();
    sb.scenes[0]!.type = 'dashboard';
    sb.scenes[0]!.animations = [];
    const built = await build(sb);
    expect(built.timeline).toMatch(/rotateY: \[/);
    expect(built.timeline).toMatch(/app-frame/);
  });

  it('still animates the frame when the model supplied its own motion', async () => {
    // This lived in the fallback path, which only fires when a storyboard has no
    // animations — and a model always supplies some. The depth was therefore
    // present in exactly the films nobody generates. The frame is structural: the
    // compiler placed it and the model does not know its selector.
    const sb = film();
    sb.scenes[0]!.type = 'device';
    sb.scenes[0]!.animations = [
      {
        target: '[data-el="headline"]',
        at: 200,
        dur: 700,
        ease: 'outExpo',
        opacity: [0, 1],
        y: [20, 0],
      },
    ];
    const built = await build(sb);
    expect(built.timeline).toMatch(/rotateY: \[/);
    expect(built.timeline).toMatch(/data-el=\\?"phone/);
  });

  it('carries motion through the cut instead of stopping dead', async () => {
    // Scene ranges overlap so a tween can survive the cut, but nothing was moving
    // during the overlap — every scene eased in, sat still, and was replaced, which
    // reads as a slideshow however good each frame is.
    const sb = film();
    sb.scenes[0]!.type = 'dashboard';
    const built = await build(sb);
    expect(built.timeline).toMatch(/recedes as the next scene starts/);
    expect(built.timeline).toMatch(/z: \[0, -/);
  });

  it('does not push the end card away', async () => {
    // Holding the final frame is the one thing the film is asking for.
    const sb = film();
    sb.scenes[1]!.type = 'cta';
    const built = await build(sb);
    const endBlock = built.timeline.slice(built.timeline.indexOf('---- end'));
    expect(endBlock).not.toMatch(/recedes as the next scene/);
  });

  it('staggers a feature grid so it reads as a set', async () => {
    const sb = film();
    sb.scenes[0]!.type = 'feature';
    sb.scenes[0]!.animations = [];
    sb.scenes[0]!.elements = [
      { id: 'a', type: 'feature', text: 'Auto booking', importance: 0.8 },
      { id: 'b', type: 'feature', text: 'Sales reports', importance: 0.7 },
      { id: 'c', type: 'feature', text: 'Smart handoff', importance: 0.6 },
    ];
    const built = await build(sb);
    expect(built.timeline).toMatch(/\.cell[\s\S]*stagger:/);
    expect(built.timeline).toMatch(/\.icon-tile/);
  });

  it('uses real CSS 3D rather than a flat plane', async () => {
    const sb = film();
    sb.scenes[0]!.type = 'dashboard';
    const built = await build(sb);
    expect(built.html).toMatch(/class="scene scene-3d[^"]*"/);
    expect(built.html).toMatch(/tilt-(l|r|up)/);
  });

  it('never emits a CSS transition or keyframe', async () => {
    // Under frame-by-frame export the browser clock does not advance, so either
    // would freeze at its initial value while the timeline moved everything else.
    for (const type of types) {
      const sb = film();
      sb.scenes[0]!.type = type;
      const built = await build(sb);
      // Comments stripped: the film-grade comment explains the rule in prose
      // that names the very tokens under test.
      const markup = stripComments(built.html);
      for (const pattern of MOTION_CSS) {
        expect(markup, `${type} emitted ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it('does not render the headline twice', async () => {
    // A layout that owns its copy must suppress the generic copy block, or the
    // headline lands in two places at two sizes.
    const sb = film();
    sb.scenes[0]!.type = 'hero';
    sb.scenes[0]!.copy = { headline: 'Unmistakable', bodySize: 30 };
    const built = await build(sb);
    const matches = built.html.match(/Unmistakable/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});

describe('icons', () => {
  it('maps a brand\'s own wording onto a real glyph', () => {
    expect(resolveIcon('WhatsApp')).toBe('message');
    expect(resolveIcon('Auto booking')).toBe('calendar');
    expect(resolveIcon('Revenue')).toBe('dollar');
    expect(resolveIcon('Enterprise Security')).toBe('shield');
  });

  it('finds a match inside a longer label', () => {
    // Real labels are "WhatsApp · 11:48 PM", not a bare keyword.
    expect(resolveIcon('WhatsApp · 11:48 PM')).toBe('message');
    expect(resolveIcon('Smart Lead Scoring')).toBe('user-check');
  });

  it('falls back rather than emitting nothing', () => {
    expect(ICON_NAMES).toContain(resolveIcon('something entirely unmapped'));
  });

  it('inherits colour so the accent applies', () => {
    const svg = iconSvg('message');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('fill="none"');
  });

  it('is inlined, never fetched', () => {
    // A CDN icon is a runtime network fetch, which §19.5 lists as unguarded: under
    // export it races and the frame ships with a missing glyph.
    const svg = iconSvg('calendar');
    expect(svg).toContain('<path');
    expect(svg).not.toMatch(/https?:\/\//);
  });
});

describe('themeFor', () => {
  it('respects an explicit non-default preset as art direction', () => {
    const theme = themeFor(film({ preset: 'mono' }));
    expect(theme.preset).toBe('mono');
  });

  it('treats the schema default as unset and derives instead', () => {
    // `apple` is the schema default, so it is not a decision.
    const theme = themeFor(
      film({ preset: 'apple', brand: { accent: '#4a918c', scheme: 'light', productName: 'x' } })
    );
    expect(theme.preset).toBe('light');
  });
});
