/**
 * Compiler tests.
 *
 * The compiler is the deterministic half of the architecture: the model has
 * already made every creative decision, and this turns that JSON into markup and
 * timeline records. So what is worth asserting is not "does it look nice" but the
 * structural invariants a film silently breaks without them:
 *
 * 1. The generated `timeline.js` is syntactically valid JavaScript. It is code
 *    assembled by string interpolation from model-supplied values, so this is not
 *    a formality — a scene id of `"scene-1"` used to emit `SCENES.scene-1`.
 * 2. Markup carries no motion, and the cursor lives outside every scene.
 * 3. Script order is sfx -> engine -> film.
 * 4. Model-supplied strings cannot escape the literal or attribute they land in.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { storyboardSchema, type Storyboard } from '../../src/storyboard/schema.js';
import { compile } from '../../src/compiler/index.js';
import { stripComments, MOTION_CSS } from '../helpers/html.js';

/** A runtime/ stand-in. The compiler only copies it and reads glass-filters.svg. */
async function fakeRuntime(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'urlume-runtime-'));
  await mkdir(join(dir, 'assets'), { recursive: true });
  await writeFile(join(dir, 'assets', 'explainer.css'), '/* stub */\n', 'utf8');
  await writeFile(join(dir, 'assets', 'components.css'), '/* stub */\n', 'utf8');
  await writeFile(join(dir, 'assets', 'timeline.js'), '/* stub */\n', 'utf8');
  await writeFile(join(dir, 'assets', 'sfx.js'), '/* stub */\n', 'utf8');
  await writeFile(
    join(dir, 'assets', 'glass-filters.svg'),
    '<svg><filter id="lens"></filter></svg>\n',
    'utf8'
  );
  return dir;
}

function film(overrides: Partial<Storyboard> = {}): Storyboard {
  return storyboardSchema.parse({
    product: 'Relay',
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
        copy: { headline: 'You have answered this 400 times.', bodySize: 34 },
        animations: [
          {
            target: '[data-el="headline"]',
            at: 300,
            dur: 800,
            ease: 'outExpo',
            opacity: [0, 1],
            y: [24, 0],
          },
        ],
      },
      {
        id: 'how',
        beat: 'how',
        type: 'dashboard',
        start: 4700,
        duration: 6400,
        camera: { target: '[data-el="send"]', zoom: 1.8, at: 1200, dur: 900, ease: 'inOutCubic' },
        cursor: [{ target: '[data-el="send"]', at: 1460, travel: 620, click: true, latency: 110 }],
        cues: [{ name: 'chime', at: 2600, gain: 0.9 }],
        elements: [
          { id: 'r1', type: 'row', text: 'Password reset', importance: 0.5 },
          { id: 'm1', type: 'metric', text: 'Handled', value: '128', importance: 0.8 },
        ],
        copy: { cta: 'relay.app' },
      },
    ],
    ...overrides,
  });
}

async function build(sb: Storyboard) {
  const runtimeDir = await fakeRuntime();
  const outDir = await mkdtemp(join(tmpdir(), 'urlume-film-'));
  return compile({ storyboard: sb, outDir, runtimeDir });
}

describe('compiler output', () => {
  let result: Awaited<ReturnType<typeof build>>;

  beforeAll(async () => {
    result = await build(film());
  });

  it('writes index.html, timeline.js and the assets', async () => {
    const html = await readFile(join(result.outDir, 'index.html'), 'utf8');
    expect(html).toBe(result.html);
    expect(result.files.some((f) => f.endsWith('sfx.js'))).toBe(true);
    expect(result.files.some((f) => f.endsWith('explainer.css'))).toBe(true);
  });

  it('emits a syntactically valid timeline', () => {
    // `new Function` compiles without invoking, so this is a pure syntax check on
    // code that was assembled by interpolation.
    expect(() => new Function(result.timeline)).not.toThrow();
  });

  it('inlines the SVG filter defs in the same document', () => {
    // `backdrop-filter: url(#lens)` only resolves against a filter in the same
    // tree — never an external file.
    expect(result.html).toContain('<filter id="lens">');
  });

  it('puts no motion in the markup', () => {
    // Under frame-by-frame export the CSS clock does not advance, so a
    // transition or keyframe freezes at its initial value while the timeline
    // moves everything around it.
    //
    // Comments are stripped first: the compiler documents the film-grade rule
    // in prose that names `@keyframes`, and a comment animates nothing.
    const markup = stripComments(result.html);
    for (const pattern of MOTION_CSS) {
      expect(markup, `matched ${pattern}`).not.toMatch(pattern);
    }
  });

  it('keeps the cursor and ring outside every scene', () => {
    // Inside a scene, the cut takes the cursor with it.
    const lastSceneClose = result.html.lastIndexOf('</section>');
    const cursor = result.html.indexOf('data-el="cursor"');
    const ring = result.html.indexOf('data-el="ring"');
    expect(lastSceneClose).toBeGreaterThan(-1);
    expect(cursor).toBeGreaterThan(lastSceneClose);
    expect(ring).toBeGreaterThan(lastSceneClose);
  });

  it('makes every positioned element actually positioned', () => {
    // `.scene` is the positioning context, but the component classes are not
    // positioned: `.card` sets background and padding, `.btn` is an inline-flex,
    // `.rows` a bare flex column. A `left`/`top` written onto one of those without
    // `.abs` is ignored, and the element lands in normal flow on top of whatever
    // else the scene holds — a silent layout collapse with nothing in the console.
    //
    // Scoped to scene markup on purpose. The cursor and ring also carry `left:0`,
    // but they are engine-owned props that components.css positions itself
    // (`.cursor`, `.click-ring`), and they live outside every scene.
    const scenes = result.html.match(/<section class="scene"[\s\S]*?<\/section>/g) ?? [];
    expect(scenes.length).toBeGreaterThan(0);

    const positioned = scenes.join('\n').match(/<[a-z]+ class="([^"]*)"[^>]*style="left:/g) ?? [];
    expect(positioned.length).toBeGreaterThan(0);
    for (const tag of positioned) {
      expect(tag, `not absolutely positioned: ${tag}`).toMatch(/class="[^"]*\babs\b/);
    }
  });

  it('keeps the row column clear of the copy block', async () => {
    // The generic path, which `capture` scenes and any unrecognised type still take.
    // Copy starts at 30% of stage height; rows go below it rather than at the scene
    // origin, which is where a bare `.rows` would sit.
    const sb = film();
    sb.scenes[1]!.type = 'capture';
    const built = await build(sb);
    const rows = /class="abs rows"[\s\S]*?style="left:(\d+)px; top:(\d+)px;/.exec(built.html);
    expect(rows).not.toBeNull();
    expect(Number(rows![2])).toBeGreaterThan(1080 * 0.3);
  });

  it('positions the row column once, not once per row', () => {
    // A model gives every row its own x/y — they are elements like any other. If
    // both the container and the rows were positioned, flexbox would stack them
    // *below* the container's own offset and a column starting at y=250 would run
    // off the bottom of the frame.
    const rowItems = result.html.match(/class="row-item"[^>]*>/g) ?? [];
    expect(rowItems.length).toBeGreaterThan(0);
    for (const item of rowItems) {
      expect(item, `a row carries its own coordinate: ${item}`).not.toMatch(/style="left:/);
    }
  });

  it('keeps a wide row column inside the frame', async () => {
    // x=520 with width=880 on a 1920 stage means "a wide column, roughly centred",
    // not "40px of it past the right edge".
    const sb = film();
    sb.scenes[1]!.type = 'capture';
    sb.scenes[1]!.elements = [
      { id: 'r1', type: 'row', text: 'wide', x: 520, y: 300, width: 880, importance: 0.5 },
    ];
    const built = await build(sb);
    const rows = /class="abs rows"[\s\S]*?style="left:(\d+)px; top:(\d+)px; width:(\d+)px;/.exec(
      built.html
    );
    expect(rows).not.toBeNull();
    const [left, width] = [Number(rows![1]), Number(rows![3])];
    expect(left + width).toBeLessThanOrEqual(1920);
  });

  it('puts the background inside the stage, behind the camera', () => {
    // The renderer strips every body child that does not contain `.stage`, so a
    // background outside it looks right in preview and is absent from every
    // exported frame — which reads as a flat black field and leaves the glass with
    // nothing to refract. Behind `.camera` so a push-in does not scale it.
    const stage = result.html.indexOf('class="stage"');
    const aurora = result.html.indexOf('class="bg-aurora"');
    const camera = result.html.indexOf('class="camera"');
    expect(stage).toBeGreaterThan(-1);
    expect(aurora).toBeGreaterThan(stage);
    expect(aurora).toBeLessThan(camera);
  });

  it('retires the cursor before cutting away from UI', () => {
    // cursorTo only fades the cursor in. One pair serves the whole film, so
    // without an explicit exit it stays parked on the payoff and the end card.
    expect(result.timeline).toMatch(/\[data-el="cursor"\][\s\S]*opacity: \[1, 0\]/);
  });

  it('loads sfx, then the engine, then the film', () => {
    const sfx = result.html.indexOf('assets/sfx.js');
    const engine = result.html.indexOf('assets/timeline.js');
    const filmScript = result.html.indexOf('src="timeline.js"');
    expect(sfx).toBeLessThan(engine);
    expect(engine).toBeLessThan(filmScript);
  });

  it('writes every scene time into the SCENES table once', () => {
    expect(result.timeline).toContain('"hook": [0, 5000]');
    expect(result.timeline).toContain('"how": [4700, 6400]');
  });

  it('offsets cursor, camera and cue times by the scene start', () => {
    // Animation times are scene-relative because the scene helper adds `start`;
    // these three go on the raw timeline and must be absolute.
    expect(result.timeline).toContain('at: 6160'); // cursor 4700 + 1460
    expect(result.timeline).toContain('at: 5900'); // camera 4700 + 1200
    expect(result.timeline).toContain("tl.cue('chime', 7300"); // cue 4700 + 2600
  });

  it('reads a small camera x/y as an offset from centre', async () => {
    // A model writes `x: -40, y: 60` meaning "a touch left and down" — which is how
    // every craft rule about avoiding dead centre is phrased. Read as an absolute
    // stage point, that -40 becomes 1180px of translation and pushes the whole film
    // out of frame, with no error anywhere.
    const sb = film();
    sb.scenes[1]!.camera = { x: -40, y: 60, zoom: 1.18, at: 400, dur: 1200, ease: 'inOutCubic' };
    const built = await build(sb);
    // Aim point is centre + offset (920, 600), so translation stays small.
    expect(built.timeline).toMatch(/1\.18 \* \(960 - p_1\.x\)/);
    expect(built.timeline).toMatch(/\{ x: 920, y: 600 \}/);
  });

  it('still reads a large camera x/y as an absolute stage point', async () => {
    const sb = film();
    sb.scenes[1]!.camera = { x: 1400, y: 820, zoom: 1.4, at: 400, dur: 1200, ease: 'inOutCubic' };
    const built = await build(sb);
    expect(built.timeline).toMatch(/\{ x: 1400, y: 820 \}/);
  });

  it('multiplies the camera translation by the scale', () => {
    // CSS applies the rightmost transform first, so the target is scaled about
    // the stage centre before it is translated. Without the multiply a push
    // leaves the target far off centre.
    //
    // 1.2 rather than the storyboard's 1.8: a dashboard frame is 1500px wide and
    // cannot afford a 1.8x push (see maxZoomFor).
    expect(result.timeline).toMatch(/1\.2 \* \(960 - p_1\.x\)/);
  });

  it('caps zoom to what the scene\'s own layout can survive', async () => {
    // The craft rules cap zoom at 2.5x for rasterisation reasons, which is a
    // different limit from "the subject still fits in frame". A 1500px dashboard
    // panel pushed to 1.5x loses 500px of its own width, and the result reads as a
    // rendering fault rather than as a camera move.
    const sb = film();
    sb.scenes[1]!.type = 'dashboard';
    sb.scenes[1]!.camera = { zoom: 2.4, at: 200, dur: 1000, ease: 'inOutCubic' };
    const built = await build(sb);
    expect(built.timeline).toMatch(/scale: \[1, 1\.2\]/);
    expect(built.timeline).not.toMatch(/scale: \[1, 2\.4\]/);
  });

  it('clamps a camera move so the stage edge never enters shot', async () => {
    const sb = film();
    sb.scenes[1]!.type = 'device';
    sb.scenes[1]!.camera = { x: 900, y: 500, zoom: 1.5, at: 200, dur: 1000, ease: 'inOutCubic' };
    const built = await build(sb);
    // At 1.5x the frame may travel (1920 * 0.5) / 2 = 480px horizontally.
    expect(built.timeline).toMatch(/Math\.max\(-480\.0, Math\.min\(480\.0/);
  });
});

describe('the model cannot escape the string it lands in', () => {
  it('survives a scene id that is not a legal identifier', async () => {
    // The realistic case, and the one that used to emit `SCENES.scene-1`.
    const sb = film();
    sb.scenes[0]!.id = 'scene-1';
    sb.scenes[1]!.id = 'scene-2';
    const built = await build(sb);

    expect(() => new Function(built.timeline)).not.toThrow();
    expect(built.timeline).toContain('"scene-1": [0, 5000]');
  });

  it('neutralises a quote in a scene id', async () => {
    const sb = film();
    sb.scenes[0]!.id = `x'); alert(1); //`;
    const built = await build(sb);
    expect(() => new Function(built.timeline)).not.toThrow();
  });

  it('neutralises a quote in a selector', async () => {
    const sb = film();
    sb.scenes[0]!.animations[0]!.target = `[data-el="a"]'); alert(1); //`;
    const built = await build(sb);
    expect(() => new Function(built.timeline)).not.toThrow();
  });

  it('escapes an element id on its way into an attribute', async () => {
    const sb = film();
    sb.scenes[1]!.elements[1]!.id = 'm1" onload="alert(1)';
    const built = await build(sb);
    expect(built.html).not.toContain('onload="alert(1)"');
    expect(built.html).toContain('&quot;');
  });
});
