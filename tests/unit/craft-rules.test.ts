/**
 * Craft rule tests.
 *
 * The point of the craft validator is that it rejects storyboards a model would
 * plausibly produce. So the fixtures here are not adversarial nonsense — they
 * are the specific mistakes a competent model makes when nothing stops it:
 * crossfading every cut, using linear easing, queueing animations with dead air
 * between them, and putting two calls to action in the same film.
 */

import { describe, it, expect } from 'vitest';
import { storyboardSchema, type Storyboard } from '../../src/storyboard/schema.js';
import {
  checkCraft,
  repairCraft,
  formatForModel,
  CRAFT_RULES,
} from '../../src/storyboard/craft-rules.js';

/** A film that follows the craft rules. */
function goodFilm(): Storyboard {
  return storyboardSchema.parse({
    product: 'Relay',
    thesis: 'A support lead should believe Relay stops them answering tickets by hand.',
    duration: 22_000,
    fps: 30,
    aspect: '16:9',
    resolution: { width: 1920, height: 1080 },
    preset: 'apple',
    brand: { accent: '#0A84FF', scheme: 'dark', productName: 'Relay' },
    scenes: [
      {
        id: 's1',
        beat: 'hook',
        type: 'text',
        start: 0,
        duration: 5200,
        copy: { headline: 'You have answered this 400 times.', bodySize: 34 },
        animations: [
          { target: '[data-el="ticket"]', at: 300, dur: 620, ease: 'outExpo', stagger: 90, opacity: [0, 1], y: [26, 0] },
          { target: '[data-el="headline"]', at: 700, dur: 800, ease: 'outQuint', opacity: [0, 1], y: [20, 0] },
        ],
      },
      {
        id: 's2',
        beat: 'reveal',
        type: 'hero',
        start: 4900,
        duration: 4200,
        copy: { headline: 'Relay', body: 'Every password reset, handled.', bodySize: 28 },
        animations: [
          { target: '[data-el="hero"]', at: 0, dur: 1000, ease: 'softLand', scale: [0.94, 1], opacity: [0, 1] },
        ],
      },
      {
        id: 's3',
        beat: 'how',
        type: 'dashboard',
        start: 8800,
        duration: 6400,
        route: '/dashboard',
        camera: { target: '[data-el="send"]', zoom: 1.8, at: 1200, dur: 900, ease: 'inOutCubic' },
        cursor: [{ target: '[data-el="send"]', at: 1460, travel: 620, click: true, latency: 110 }],
        animations: [
          { target: '[data-el="row"]', at: 200, dur: 640, ease: 'outQuint', stagger: 90, opacity: [0, 1], y: [20, 0] },
          { target: '[data-el="draft"]', at: 2300, dur: 620, ease: 'outQuart', opacity: [0, 1], y: [16, 0] },
        ],
      },
      {
        id: 's4',
        beat: 'payoff',
        type: 'feature',
        start: 14_900,
        duration: 3400,
        hold: 750,
        animations: [
          { target: '[data-el="toast"]', at: 200, dur: 560, ease: 'outBack', opacity: [0, 1], y: [24, 0] },
        ],
      },
      {
        id: 's5',
        beat: 'end',
        type: 'cta',
        start: 18_000,
        duration: 3900,
        copy: { headline: 'Start free trial', cta: 'relay.app', bodySize: 28 },
        animations: [
          { target: '[data-el="lockup"]', at: 200, dur: 900, ease: 'outExpo', opacity: [0, 1], scale: [0.96, 1] },
        ],
      },
    ],
  });
}

describe('schema', () => {
  it('accepts a well-formed film', () => {
    expect(() => goodFilm()).not.toThrow();
  });

  it('rejects a resolution that disagrees with the aspect', () => {
    // The preview would centre correctly and the export would crop wrongly —
    // a bug you only find after a full render.
    const bad = { ...goodFilm(), aspect: '9:16' as const };
    const result = storyboardSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /does not match aspect/.test(i.message))).toBe(true);
    }
  });

  it('rejects odd dimensions that H.264 cannot encode', () => {
    const result = storyboardSchema.safeParse({
      ...goodFilm(),
      resolution: { width: 1921, height: 1080 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects scenes that run past the declared duration', () => {
    const film = goodFilm();
    const result = storyboardSchema.safeParse({ ...film, duration: 10_000 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /would be cut off/.test(i.message))).toBe(true);
    }
  });

  it('rejects an unknown ease rather than letting it degrade silently', () => {
    // The engine falls back to outQuint on an unknown name, so a typo would
    // produce motion that looks almost right.
    const film = goodFilm();
    film.scenes[0]!.animations[0]!.ease = 'outExpoo' as never;
    expect(storyboardSchema.safeParse(film).success).toBe(false);
  });
});

describe('craft rules', () => {
  it('passes a film that follows them', () => {
    const report = checkCraft(goodFilm());
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('rejects crossfading every cut', () => {
    const film = goodFilm();
    for (const scene of film.scenes) {
      scene.transition = { kind: 'dissolve', fade: 400 };
    }
    const report = checkCraft(film);
    expect(report.errors.some((v) => v.rule === 'cuts-not-crossfades')).toBe(true);
  });

  it('allows up to two dissolves', () => {
    const film = goodFilm();
    film.scenes[1]!.transition = { kind: 'dissolve', fade: 400 };
    film.scenes[3]!.transition = { kind: 'dissolve', fade: 400 };
    expect(checkCraft(film).errors.some((v) => v.rule === 'cuts-not-crossfades')).toBe(false);
  });

  it('rejects linear easing on a moving element', () => {
    const film = goodFilm();
    film.scenes[0]!.animations[0]!.ease = 'linear';
    const report = checkCraft(film);
    expect(report.errors.some((v) => v.rule === 'no-linear-on-motion')).toBe(true);
  });

  it('allows linear on a pure opacity fade', () => {
    // Linear is only a tell on something that moves; a fade has no start or
    // stop to shape.
    const film = goodFilm();
    film.scenes[1]!.animations = [
      { target: '[data-el="x"]', at: 0, dur: 400, ease: 'linear', opacity: [0, 1] },
    ];
    expect(checkCraft(film).errors.some((v) => v.rule === 'no-linear-on-motion')).toBe(false);
  });

  it('flags scenes that do not overlap', () => {
    const film = goodFilm();
    // Butt-join every scene: each eases to a dead halt before the next starts.
    let t = 0;
    for (const scene of film.scenes) {
      scene.start = t;
      t += scene.duration;
    }
    const report = checkCraft(film);
    expect(report.violations.filter((v) => v.rule === 'scenes-overlap').length).toBeGreaterThan(0);
  });

  it('rejects more than one call to action', () => {
    const film = goodFilm();
    film.scenes[1]!.copy = { ...film.scenes[1]!.copy, cta: 'Book a demo' };
    const report = checkCraft(film);
    expect(report.errors.some((v) => v.rule === 'single-cta')).toBe(true);
  });

  it('rejects a film with no call to action', () => {
    const film = goodFilm();
    delete film.scenes[4]!.copy!.cta;
    expect(checkCraft(film).errors.some((v) => v.rule === 'single-cta')).toBe(true);
  });

  it('rejects an unsourced statistic', () => {
    const film = goodFilm();
    film.scenes[3]!.elements = [
      { id: 'm1', type: 'metric', value: '3.2x faster responses', importance: 0.9 },
    ];
    const report = checkCraft(film);
    expect(report.errors.some((v) => v.rule === 'attributed-stats')).toBe(true);
  });

  it('accepts a statistic that carries its source', () => {
    const film = goodFilm();
    film.scenes[3]!.elements = [
      {
        id: 'm1',
        type: 'metric',
        value: '3.2x faster responses',
        attribution: 'internal data, 240 teams, Q2 2025',
        importance: 0.9,
      },
    ];
    expect(checkCraft(film).errors.some((v) => v.rule === 'attributed-stats')).toBe(false);
  });

  it('does not treat a plain row count as a claim', () => {
    const film = goodFilm();
    film.scenes[2]!.elements = [{ id: 'r1', type: 'row', text: 'Ticket 4', importance: 0.4 }];
    expect(checkCraft(film).errors.some((v) => v.rule === 'attributed-stats')).toBe(false);
  });

  it('flags UI-clock timings on film motion', () => {
    const film = goodFilm();
    film.scenes[0]!.animations[0]!.dur = 200;
    const report = checkCraft(film);
    expect(report.violations.some((v) => v.rule === 'film-clock')).toBe(true);
  });

  it('exempts UI responding to a cursor click from the film clock', () => {
    // A fake button clicked by a fake cursor must respond on the UI clock,
    // because the viewer knows what software feels like.
    //
    // The response goes where the engine actually puts it: `cursorTo` returns
    // `respondAt = at + travel + settle(120) + press(90) + latency`. Placing it at
    // `at + travel + latency` would be 210ms early — the mistake the rule itself
    // used to make.
    const film = goodFilm();
    const scene = film.scenes[2]!;
    const cursor = scene.cursor[0]!;
    const respondAt = cursor.at + cursor.travel + 120 + 90 + cursor.latency;
    scene.animations.push({
      target: '[data-el="send"]',
      at: respondAt,
      dur: 110,
      ease: 'outCubic',
      scale: [1.04, 0.96],
    });
    expect(checkCraft(film).violations.some((v) => v.rule === 'film-clock')).toBe(false);
  });

  it('rejects a camera zoom past 2.5x', () => {
    const film = goodFilm();
    film.scenes[2]!.camera!.zoom = 3.2;
    expect(checkCraft(film).errors.some((v) => v.rule === 'camera-discipline')).toBe(true);
  });

  it('requires the camera to lead the cursor', () => {
    const film = goodFilm();
    film.scenes[2]!.camera!.at = film.scenes[2]!.cursor[0]!.at + 300;
    expect(checkCraft(film).errors.some((v) => v.rule === 'camera-discipline')).toBe(true);
  });

  it('wants a hold after the payoff', () => {
    const film = goodFilm();
    film.scenes[3]!.hold = 0;
    expect(checkCraft(film).violations.some((v) => v.rule === 'payoff-hold')).toBe(true);
  });

  it('flags dead air between queued animations', () => {
    const film = goodFilm();
    film.scenes[0]!.animations = [
      { target: '[data-el="a"]', at: 0, dur: 600, ease: 'outQuint', y: [20, 0] },
      { target: '[data-el="b"]', at: 1400, dur: 600, ease: 'outQuint', y: [20, 0] },
    ];
    expect(checkCraft(film).violations.some((v) => v.rule === 'overlap-not-queue')).toBe(true);
  });
});

describe('repair', () => {
  it('fixes what it can and leaves content decisions alone', () => {
    const film = goodFilm();
    film.scenes[0]!.animations[0]!.ease = 'linear'; // repairable
    film.scenes[2]!.camera!.zoom = 3.2; // repairable
    film.scenes[3]!.hold = 0; // repairable
    film.scenes[1]!.copy = { ...film.scenes[1]!.copy, cta: 'Book a demo' }; // NOT repairable

    const { storyboard, repaired, remaining } = repairCraft(film);

    expect(storyboard.scenes[0]!.animations[0]!.ease).toBe('outQuint');
    expect(storyboard.scenes[2]!.camera!.zoom).toBe(2.5);
    expect(storyboard.scenes[3]!.hold).toBeGreaterThanOrEqual(600);
    expect(repaired.length).toBeGreaterThan(0);

    // Deleting one of two CTAs would be a content decision, so it must come
    // back for the model to resolve rather than being silently picked.
    expect(remaining.some((v) => v.rule === 'single-cta')).toBe(true);
  });

  it('does not mutate the input', () => {
    const film = goodFilm();
    film.scenes[0]!.animations[0]!.ease = 'linear';
    const before = structuredClone(film);
    repairCraft(film);
    expect(film).toEqual(before);
  });

  it('opens scene overlap without changing any scene duration', () => {
    const film = goodFilm();
    const durations = film.scenes.map((s) => s.duration);
    let t = 0;
    for (const scene of film.scenes) {
      scene.start = t;
      t += scene.duration;
    }
    const { storyboard } = repairCraft(film);
    expect(storyboard.scenes.map((s) => s.duration)).toEqual(durations);
  });
});

describe('rule metadata', () => {
  it('every rule cites the skill section it comes from', () => {
    // A rule without a source cannot be traced back to the craft reasoning, and
    // the two drift apart silently.
    for (const rule of CRAFT_RULES) {
      expect(rule.source, `${rule.id} has no source`).toMatch(/\S+\s+§\s+\S+/);
      expect(rule.summary.length, `${rule.id} has no summary`).toBeGreaterThan(20);
    }
  });

  it('rule ids are unique', () => {
    const ids = CRAFT_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('formats violations with the rule, the reason and the path', () => {
    const film = goodFilm();
    film.scenes[0]!.animations[0]!.ease = 'linear';
    const text = formatForModel(checkCraft(film).violations);
    expect(text).toContain('no-linear-on-motion');
    expect(text).toContain('§');
    expect(text).toMatch(/scenes\[0\]/);
  });
});
