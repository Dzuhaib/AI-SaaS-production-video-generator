/**
 * Delivery-compliance tests: broadcast constants, contrast, captions.
 *
 * These modules are almost entirely *numbers with citations* — loudness targets,
 * frame-rate rationals, WCAG ratios, Ofcom reading speeds. That shape fails in a
 * particular way: nothing throws, nothing looks wrong in a preview, and the
 * rejection arrives from a QC report or an access-services reviewer weeks later.
 *
 * So the assertions here are mostly about *drift* rather than about behaviour:
 *
 * 1. The exact rationals, because `29.97` and `30000/1001` are different numbers
 *    and only one of them is a legal NTSC cadence.
 * 2. That the tables agree with each other — a delivery profile with no loudness
 *    target is a runtime `undefined` reaching ffmpeg's `loudnorm`.
 * 3. That `conformance()` actually fires on the mismatches it documents, since
 *    it was exported and left uncalled for a whole session.
 */

import { describe, it, expect } from 'vitest';

import {
  FRAME_RATES,
  FPS_VALUES,
  LOUDNESS,
  DELIVERY_PROFILES,
  SAFE_AREA,
  frameRate,
  exactFps,
  rationalFps,
  deliverySpec,
  h264Level,
  titleSafe,
  actionSafe,
  conformance,
  verifyDelivery,
  checkLoudness,
  type MeasuredFile,
  type DeliveryProfile,
} from '../../src/shared/broadcast.js';
import { buildArgs, achievedLoudness } from '../../src/renderer/encode.js';
import { contrastRatio, ensureContrast } from '../../src/shared/contrast.js';
import {
  CAPTION,
  wrapCaption,
  readingTimeMs,
  buildCues,
  toWebVtt,
  toSrt,
  reviewCaptions,
  type Cue,
} from '../../src/renderer/captions.js';
import { storyboardSchema, type Storyboard } from '../../src/storyboard/schema.js';

/* ------------------------------------------------------------------ *
 * Frame rate
 * ------------------------------------------------------------------ */

describe('frame rates', () => {
  it('stores NTSC rates as 1000/1001 rationals, not their decimal names', () => {
    // The whole reason the table exists. `-framerate 29.97` is 2997/100 to
    // ffmpeg, which is not a legal MP4 cadence for US delivery.
    expect(frameRate(29.97)).toMatchObject({ num: 30000, den: 1001 });
    expect(frameRate(23.976)).toMatchObject({ num: 24000, den: 1001 });
    expect(frameRate(59.94)).toMatchObject({ num: 60000, den: 1001 });

    expect(exactFps(29.97)).not.toBe(29.97);
    expect(exactFps(29.97)).toBeCloseTo(29.970029, 5);
  });

  it('keeps PAL and integer rates exact', () => {
    expect(frameRate(25)).toMatchObject({ num: 25, den: 1, family: 'pal' });
    expect(exactFps(25)).toBe(25);
    expect(exactFps(30)).toBe(30);
  });

  it('formats rationals the way ffmpeg wants them', () => {
    expect(rationalFps(29.97)).toBe('30000/1001');
    expect(rationalFps(25)).toBe('25');
    expect(rationalFps(30)).toBe('30');
  });

  it('rejects a rate that is not in the table', () => {
    // Silently accepting 48 would produce a film nobody can conform.
    expect(() => frameRate(48)).toThrow(RangeError);
    expect(() => frameRate(29.976)).toThrow(/not a supported frame rate/);
  });

  it('names 25 as UK-native and 29.97 as US-native', () => {
    expect(frameRate(25).native).toContain('UK');
    expect(frameRate(29.97).native).toContain('US');
    // 30 is web-only; claiming it as broadcast-native is the mistake
    // `conformance()` exists to catch.
    expect(frameRate(30).native).toEqual([]);
  });

  it('derives FPS_VALUES from the table, with no duplicates', () => {
    expect(FPS_VALUES).toEqual(FRAME_RATES.map((r) => r.label));
    expect(new Set(FPS_VALUES).size).toBe(FPS_VALUES.length);
  });
});

/* ------------------------------------------------------------------ *
 * Delivery profiles
 * ------------------------------------------------------------------ */

describe('delivery profiles', () => {
  it('has a loudness target for every profile', () => {
    // Drift guard. A profile missing from LOUDNESS reaches `loudnorm` as
    // `undefined` and the encode either fails or silently skips normalisation.
    for (const profile of DELIVERY_PROFILES) {
      expect(LOUDNESS[profile], `no loudness target for ${profile}`).toBeDefined();
    }
    expect(Object.keys(LOUDNESS).sort()).toEqual([...DELIVERY_PROFILES].sort());
  });

  it('has a spec for every profile, with a real description', () => {
    for (const profile of DELIVERY_PROFILES) {
      const spec = deliverySpec(profile);
      expect(spec.profile).toBe(profile);
      expect(spec.description.length).toBeGreaterThan(10);
      expect(FPS_VALUES).toContain(spec.fps);
      expect(spec.sampleRate).toBe(48_000);
    }
  });

  it('keeps the US and UK loudness targets apart', () => {
    // Averaging these is the bug the module was written to prevent: -23 to a US
    // network is 1 LU hot for ATSC A/85.
    expect(LOUDNESS['broadcast-uk'].integrated).toBe(-23);
    expect(LOUDNESS['broadcast-us'].integrated).toBe(-24);
    expect(LOUDNESS.web.integrated).toBe(-14);
    expect(LOUDNESS.social.integrated).toBe(-14);
  });

  it('never allows a true peak at or above 0 dBTP', () => {
    // A sample-peak-legal signal still clips on lossy reconstruction.
    for (const profile of DELIVERY_PROFILES) {
      expect(LOUDNESS[profile].truePeak).toBeLessThan(0);
    }
  });

  it('defaults each broadcast profile to its region cadence', () => {
    expect(deliverySpec('broadcast-uk').fps).toBe(25);
    expect(deliverySpec('broadcast-us').fps).toBe(29.97);
    expect(deliverySpec('web').fps).toBe(30);
  });

  it('lets an explicit fps override the profile default', () => {
    expect(deliverySpec('broadcast-uk', 50).fps).toBe(50);
  });
});

/* ------------------------------------------------------------------ *
 * H.264 level
 * ------------------------------------------------------------------ */

describe('h264Level', () => {
  it('stays at 4.0 for 1080p up to 30fps', () => {
    expect(h264Level(1920, 1080, 24)).toBe('4.0');
    expect(h264Level(1920, 1080, 25)).toBe('4.0');
    expect(h264Level(1920, 1080, 30)).toBe('4.0');
  });

  it('escalates to 4.2 when 1080p exceeds the Level 4.0 macroblock rate', () => {
    // A decoder may refuse a stream that overruns its declared level.
    expect(h264Level(1920, 1080, 50)).toBe('4.2');
    expect(h264Level(1920, 1080, 60)).toBe('4.2');
  });

  it('uses the exact rate, so 59.94 is treated like 60 and not like 30', () => {
    expect(h264Level(1920, 1080, 59.94)).toBe('4.2');
  });

  it('keeps a vertical 1080x1920 film at the same level as its landscape twin', () => {
    expect(h264Level(1080, 1920, 30)).toBe(h264Level(1920, 1080, 30));
  });
});

/* ------------------------------------------------------------------ *
 * Safe areas
 * ------------------------------------------------------------------ */

describe('safe areas', () => {
  it('insets title-safe by 5% and action-safe by 3.5%', () => {
    const title = titleSafe(1920, 1080);
    expect(title.left).toBe(96); // 5% of 1920
    expect(title.top).toBe(54); // 5% of 1080
    expect(title.width).toBe(1920 - 96 * 2);
    expect(title.height).toBe(1080 - 54 * 2);

    const action = actionSafe(1920, 1080);
    expect(action.left).toBe(67); // 3.5% of 1920, rounded
    expect(action.top).toBe(38);
  });

  it('keeps title-safe strictly inside action-safe', () => {
    // Text is the more fragile of the two, so its box must be the smaller one.
    const title = titleSafe(1920, 1080);
    const action = actionSafe(1920, 1080);
    expect(title.left).toBeGreaterThan(action.left);
    expect(title.top).toBeGreaterThan(action.top);
    expect(title.width).toBeLessThan(action.width);
    expect(title.height).toBeLessThan(action.height);
    expect(SAFE_AREA.title).toBeGreaterThan(SAFE_AREA.action);
  });

  it('stays symmetric, so a centred composition stays centred', () => {
    for (const [w, h] of [[1920, 1080], [1080, 1920], [1080, 1350]] as const) {
      const box = titleSafe(w, h);
      expect(w - box.right).toBe(box.left);
      expect(h - box.bottom).toBe(box.top);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Conformance
 * ------------------------------------------------------------------ */

/** A conforming baseline, so each test changes exactly one thing. */
function check(overrides: Partial<Parameters<typeof conformance>[0]> = {}) {
  return conformance({
    profile: 'web',
    fps: 30,
    width: 1920,
    height: 1080,
    hasAudio: true,
    hasCaptions: true,
    ...overrides,
  });
}

describe('conformance', () => {
  it('passes a fully-specified web film with nothing to say', () => {
    expect(check()).toEqual([]);
  });

  it('rejects a web cadence sent to a UK broadcaster', () => {
    const notes = check({ profile: 'broadcast-uk', fps: 30 });
    const cadence = notes.find((n) => n.area === 'cadence');
    expect(cadence?.severity).toBe('error');
    expect(cadence?.message).toContain('25fps');
  });

  it('accepts 25fps for UK and 29.97 for US', () => {
    expect(check({ profile: 'broadcast-uk', fps: 25 })).toEqual([]);
    expect(check({ profile: 'broadcast-us', fps: 29.97 })).toEqual([]);
  });

  it('rejects a UK cadence sent to a US broadcaster', () => {
    // The mirror case, and the one most likely to survive a review because
    // 25 "looks like" a normal number.
    const notes = check({ profile: 'broadcast-us', fps: 25 });
    expect(notes.find((n) => n.area === 'cadence')?.severity).toBe('error');
  });

  it('treats a missing audio track as fatal for broadcast and a warning for web', () => {
    // A silent track passes QC; a missing one does not.
    expect(check({ profile: 'broadcast-uk', fps: 25, hasAudio: false })
      .find((n) => n.area === 'loudness')?.severity).toBe('error');
    expect(check({ hasAudio: false }).find((n) => n.area === 'loudness')?.severity)
      .toBe('warning');
  });

  it('warns about a missing caption sidecar and cites the standard', () => {
    const note = check({ hasCaptions: false }).find((n) => n.area === 'captions');
    expect(note?.severity).toBe('warning');
    expect(note?.standard).toMatch(/WCAG/);
  });

  it('warns when a landscape film is bound for a vertical feed', () => {
    expect(check({ profile: 'social' }).find((n) => n.area === 'safe-area')).toBeDefined();
    expect(check({ profile: 'social', width: 1080, height: 1920 })
      .find((n) => n.area === 'safe-area')).toBeUndefined();
  });

  it('gives every note a traceable standard', () => {
    const notes = check({
      profile: 'broadcast-us',
      fps: 30,
      hasAudio: false,
      hasCaptions: false,
    });
    expect(notes.length).toBeGreaterThan(2);
    for (const note of notes) {
      expect(note.standard.length, `${note.area} has no standard`).toBeGreaterThan(3);
      expect(note.message.length).toBeGreaterThan(20);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Output verification
 * ------------------------------------------------------------------ */

/**
 * `conformance()` checks intent before a frame is rendered; `verifyDelivery()`
 * checks the file that came out. Both exist because the gap between them is
 * where this project's most expensive bug lived: the delivery profile was read,
 * reported against, and then never passed to the encoder, so a UK master was
 * *checked* as UK and *written* as web.
 */

/** A correctly-encoded 1080p file, as ffprobe would report it. */
function measured(over: Partial<MeasuredFile> = {}): MeasuredFile {
  return {
    width: 1920,
    height: 1080,
    frameRate: '30',
    frameRateExact: true,
    pixFmt: 'yuv420p',
    colourPrimaries: 'bt709',
    colourTransfer: 'bt709',
    colourMatrix: 'bt709',
    hasAudio: true,
    audioSampleRate: 48_000,
    audioChannels: 2,
    ...over,
  };
}

describe('verifyDelivery', () => {
  it('passes a correct web file with nothing to say', () => {
    expect(verifyDelivery(measured(), 'web', 30)).toEqual([]);
  });

  it('passes a correct UK master at 25fps', () => {
    expect(verifyDelivery(measured({ frameRate: '25' }), 'broadcast-uk', 25)).toEqual([]);
  });

  it('catches a file written at the wrong speed', () => {
    const note = verifyDelivery(measured({ frameRate: '30' }), 'broadcast-uk', 25)
      .find((n) => n.area === 'cadence');
    expect(note?.severity).toBe('error');
    expect(note?.message).toContain('25fps');
  });

  it('catches the right speed at the wrong rational', () => {
    // 2997/100 plays at very nearly the right speed and fails US QC outright.
    // This is the failure the whole FrameRate table exists to prevent.
    const note = verifyDelivery(
      measured({ frameRate: '2997/100' }),
      'broadcast-us',
      29.97
    ).find((n) => n.area === 'cadence');
    expect(note?.severity).toBe('error');
    expect(note?.message).toContain('30000/1001');
  });

  it('accepts the exact NTSC rational', () => {
    expect(
      verifyDelivery(measured({ frameRate: '30000/1001' }), 'broadcast-us', 29.97)
    ).toEqual([]);
  });

  it('downgrades an unconfirmable NTSC rational to info rather than claiming a pass', () => {
    // ffmpeg's banner prints `29.97 fps` for both 2997/100 and 30000/1001, so
    // with no ffprobe the distinction cannot be settled. Saying so beats both
    // asserting a pass and crying wolf.
    const notes = verifyDelivery(
      measured({ frameRate: '29.97', frameRateExact: false }),
      'broadcast-us',
      29.97
    );
    const cadence = notes.find((n) => n.area === 'cadence');
    expect(cadence?.severity).toBe('info');
    expect(cadence?.message).toMatch(/ffprobe/);
  });

  it('does not raise an exactness note for an integer cadence', () => {
    // 25 is 25. There is nothing a rational could disambiguate.
    const notes = verifyDelivery(
      measured({ frameRate: '25', frameRateExact: false }),
      'broadcast-uk',
      25
    );
    expect(notes.find((n) => n.area === 'cadence')).toBeUndefined();
  });

  it('rejects a chroma format Safari refuses', () => {
    // yuv444p produces a file that opens, shows controls, and plays no video —
    // which reads as a corrupt render rather than a format problem.
    const note = verifyDelivery(measured({ pixFmt: 'yuv444p' }), 'web', 30)
      .find((n) => n.area === 'container');
    expect(note?.severity).toBe('error');
  });

  it('treats untagged colour as a failure, because the player guesses BT.601', () => {
    const notes = verifyDelivery(
      measured({ colourPrimaries: 'unset', colourTransfer: 'unset', colourMatrix: 'unset' }),
      'web',
      30
    );
    expect(notes.filter((n) => n.area === 'colour')).toHaveLength(3);
    expect(notes.find((n) => n.area === 'colour')?.message).toMatch(/BT\.601/);
  });

  it('reports unverified colour once, as info, not as three warnings', () => {
    // The default install has no ffprobe and ffmpeg prints no colour metadata.
    // Reporting `unset` there would fire on every correct file.
    const notes = verifyDelivery(
      measured({
        colourPrimaries: 'unverified',
        colourTransfer: 'unverified',
        colourMatrix: 'unverified',
      }),
      'web',
      30
    );
    const colour = notes.filter((n) => n.area === 'colour');
    expect(colour).toHaveLength(1);
    expect(colour[0]!.severity).toBe('info');
  });

  it('catches a consumer sample rate on a broadcast master', () => {
    const note = verifyDelivery(measured({ audioSampleRate: 44_100 }), 'broadcast-uk', 30)
      .find((n) => n.area === 'loudness');
    expect(note?.severity).toBe('error');
  });

  it('treats a missing audio track as fatal only for broadcast', () => {
    expect(
      verifyDelivery(measured({ hasAudio: false }), 'broadcast-us', 29.97)
        .find((n) => n.area === 'loudness')?.severity
    ).toBe('error');
    expect(
      verifyDelivery(measured({ hasAudio: false }), 'web', 30)
        .find((n) => n.area === 'loudness')
    ).toBeUndefined();
  });

  it('rejects an odd dimension', () => {
    expect(
      verifyDelivery(measured({ height: 1081 }), 'web', 30)
        .find((n) => n.area === 'container')?.severity
    ).toBe('error');
  });

  it('gives every note a traceable standard', () => {
    const notes = verifyDelivery(
      measured({ frameRate: '30', pixFmt: 'yuv444p', audioSampleRate: 44_100 }),
      'broadcast-uk',
      25
    );
    expect(notes.length).toBeGreaterThan(2);
    for (const note of notes) {
      expect(note.standard.length, `${note.area} has no standard`).toBeGreaterThan(3);
      expect(note.message.length).toBeGreaterThan(20);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Loudness
 * ------------------------------------------------------------------ */

describe('checkLoudness', () => {
  const ok = { integrated: -23, truePeak: -1.5, range: 5, linear: true };

  it('accepts a programme on target', () => {
    expect(checkLoudness(ok, 'broadcast-uk')).toEqual([]);
  });

  it('applies each standard its own tolerance, not an average', () => {
    // -22 LUFS is 1 LU hot. EBU R128 allows ±0.5 and rejects it; ATSC A/85
    // allows ±2 and does not. A single tolerance would be wrong in both
    // directions.
    //
    // The US peak is set explicitly here: the UK ceiling is -1 dBTP and the US
    // one is -2, so reusing a UK-legal peak would trip the peak check and
    // decide this test for the wrong reason.
    expect(
      checkLoudness({ ...ok, integrated: -22 }, 'broadcast-uk')
        .some((n) => n.severity === 'error')
    ).toBe(true);
    expect(checkLoudness({ ...ok, integrated: -23, truePeak: -2.5 }, 'broadcast-us')).toEqual([]);
  });

  it('reports how far out the programme is, with a sign', () => {
    const note = checkLoudness({ ...ok, integrated: -20 }, 'broadcast-uk')[0];
    expect(note?.message).toContain('-20.0 LUFS');
    expect(note?.message).toContain('+3.0 LU');
  });

  it('catches a true peak above the ceiling', () => {
    // Inter-sample peaks clip once a lossy codec reconstructs between samples,
    // which is why the limit is below 0 rather than at it.
    const note = checkLoudness({ ...ok, truePeak: -0.2 }, 'broadcast-uk')
      .find((n) => n.message.includes('True peak'));
    expect(note?.severity).toBe('error');
  });

  it('flags a fall back to dynamic normalisation, which compresses the mix', () => {
    // loudnorm switches modes on its own when one gain would breach the peak
    // ceiling. It still hits the target, so nothing looks wrong — but the
    // balance the sound design was built on has changed.
    const note = checkLoudness({ ...ok, linear: false }, 'broadcast-uk')
      .find((n) => n.message.includes('dynamic'));
    expect(note?.severity).toBe('warning');
    expect(checkLoudness({ ...ok, integrated: -14, linear: false }, 'web')
      .find((n) => n.message.includes('dynamic'))?.severity).toBe('info');
  });

  it('is a warning rather than an error off broadcast', () => {
    expect(
      checkLoudness({ ...ok, integrated: -30 }, 'web')
        .find((n) => n.area === 'loudness')?.severity
    ).toBe('warning');
  });
});

describe('achievedLoudness', () => {
  it('reads the output figures pass one predicts', () => {
    expect(
      achievedLoudness({
        input_i: '-21.75',
        input_tp: '-18.06',
        input_lra: '0.00',
        input_thresh: '-31.75',
        target_offset: '-0.05',
        output_i: '-22.95',
        output_tp: '-19.27',
        output_lra: '1.20',
        normalization_type: 'linear',
      })
    ).toEqual({ integrated: -22.95, truePeak: -19.27, range: 1.2, linear: true });
  });

  it('returns null rather than a partial reading', () => {
    // A loudness report missing its true peak is worse than an honest "not
    // measured", because the gap reads as a pass.
    expect(achievedLoudness(null)).toBeNull();
    expect(
      achievedLoudness({
        input_i: '-21',
        input_tp: '-18',
        input_lra: '0',
        input_thresh: '-31',
        target_offset: '0',
      })
    ).toBeNull();
  });

  it('does not infer the dynamic fallback from a missing field', () => {
    // `linear=true` is what pass two asks for, so silence is not evidence the
    // fallback fired.
    expect(
      achievedLoudness({
        input_i: '-21',
        input_tp: '-18',
        input_lra: '0',
        input_thresh: '-31',
        target_offset: '0',
        output_i: '-23',
        output_tp: '-2',
      })?.linear
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Encoder arguments
 * ------------------------------------------------------------------ */

/**
 * The flags are the delivery decision made concrete. Asserted here rather than
 * trusted, because every failure in this area is silent: a file that plays
 * locally and stalls when hosted, or passes review and fails a QC report.
 */
describe('buildArgs', () => {
  const args = (profile: DeliveryProfile, fps: number, over = {}) =>
    buildArgs({
      framesDir: '/f',
      pattern: '%06d.png',
      startNumber: 0,
      audio: '/a.wav',
      output: '/o.mp4',
      fps,
      width: 1920,
      height: 1080,
      quality: 'high',
      profile,
      ...over,
    });

  const valueAfter = (list: string[], flag: string) => list[list.indexOf(flag) + 1];

  it('sets -framerate before -i, so the rate is interpreted not resampled', () => {
    const list = args('web', 30);
    expect(list.indexOf('-framerate')).toBeLessThan(list.indexOf('-i'));
  });

  it('writes the exact rational for NTSC rather than its decimal name', () => {
    expect(valueAfter(args('broadcast-us', 29.97), '-framerate')).toBe('30000/1001');
    expect(valueAfter(args('broadcast-uk', 25), '-framerate')).toBe('25');
  });

  it('carries each profile its own loudness target', () => {
    const target = (p: DeliveryProfile, fps: number) =>
      args(p, fps).find((a) => a.startsWith('loudnorm='));
    expect(target('web', 30)).toContain('I=-14');
    expect(target('broadcast-uk', 25)).toContain('I=-23');
    expect(target('broadcast-us', 29.97)).toContain('I=-24');
    // The US peak ceiling is 1 dB lower than the UK one.
    expect(target('broadcast-us', 29.97)).toContain('TP=-2');
  });

  it('closes the GOP for broadcast only', () => {
    expect(args('broadcast-uk', 25)).toContain('+cgop');
    expect(args('web', 30)).not.toContain('+cgop');
  });

  it('bounds the bitrate for broadcast and leaves web on pure CRF', () => {
    // CRF holds quality and lets the rate go where the picture needs it, which
    // is right for the web and a rejection against a delivery contract.
    expect(args('broadcast-uk', 25)).toContain('-maxrate');
    expect(args('broadcast-uk', 25)).toContain('-bufsize');
    expect(args('web', 30)).not.toContain('-maxrate');
  });

  it('derives the H.264 level from resolution times frame rate', () => {
    // 1080p50 exceeds the macroblock rate Level 4.0 permits, and a decoder may
    // refuse a stream that overruns its declared level.
    expect(valueAfter(args('broadcast-uk', 25), '-level:v')).toBe('4.0');
    expect(valueAfter(args('broadcast-uk', 50), '-level:v')).toBe('4.2');
  });

  it('always writes yuv420p and tags BT.709 at both ends', () => {
    const list = args('web', 30);
    expect(valueAfter(list, '-pix_fmt')).toBe('yuv420p');
    expect(valueAfter(list, '-colorspace')).toBe('bt709');
    // Tagging without forcing the conversion produces a file that is wrong
    // twice, so the matrix is pinned at the scaler too.
    expect(list.find((a) => a.startsWith('scale='))).toContain('out_color_matrix=bt709');
  });

  it('moves the moov atom to the front, or a hosted file spins forever', () => {
    expect(valueAfter(args('web', 30), '-movflags')).toBe('+faststart');
  });

  it('burns in captions after the scale, so type is not resampled', () => {
    const list = args('social', 30, { burnCaptions: '/c.srt' });
    const filters = valueAfter(list, '-vf')!;
    expect(filters.indexOf('scale=')).toBeLessThan(filters.indexOf('subtitles='));
  });
});

/* ------------------------------------------------------------------ *
 * Contrast
 * ------------------------------------------------------------------ */
describe('contrast', () => {
  it('computes the WCAG anchors exactly', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#000000', '#000000')).toBeCloseTo(1, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('is symmetric in its arguments', () => {
    expect(contrastRatio('#0a84ff', '#0b0b0f')).toBeCloseTo(
      contrastRatio('#0b0b0f', '#0a84ff'),
      10
    );
  });

  it('expands three-digit hex', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#f00', '#ff0000')).toBeCloseTo(1, 5);
  });

  it('leaves an accent alone when it already passes', () => {
    const result = ensureContrast('#ffffff', '#000000');
    expect(result.adjusted).toBe(false);
    expect(result.colour).toBe('#ffffff');
    expect(result.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('lightens a mid-tone accent against a near-black film background', () => {
    // The exact failure the module documents: an accent chosen against a white
    // marketing page landing on the film's dark field.
    const result = ensureContrast('#0b5cd5', '#0b0b0f');
    expect(result.adjusted).toBe(true);
    expect(result.ratio).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(result.colour, '#0b0b0f')).toBeGreaterThanOrEqual(4.5);
  });

  it('darkens against a light background instead of lightening', () => {
    const result = ensureContrast('#7ac0ff', '#ffffff');
    expect(result.adjusted).toBe(true);
    expect(contrastRatio(result.colour, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('honours a custom target', () => {
    const aa = ensureContrast('#0b5cd5', '#0b0b0f', 4.5);
    const aaa = ensureContrast('#0b5cd5', '#0b0b0f', 7);
    expect(aaa.ratio).toBeGreaterThanOrEqual(7);
    expect(aaa.ratio).toBeGreaterThan(aa.ratio);
  });

  it('reports failure rather than shipping an unreachable near-white', () => {
    // Mid-grey cannot reach 21:1 against anything. The caller needs to know that
    // rather than receive a silently-unchanged colour that looks adjusted.
    const result = ensureContrast('#808080', '#7f7f7f', 21);
    expect(result.adjusted).toBe(false);
    expect(result.colour).toBe('#808080');
  });
});

/* ------------------------------------------------------------------ *
 * Captions
 * ------------------------------------------------------------------ */

describe('wrapCaption', () => {
  it('leaves a short line on one line', () => {
    expect(wrapCaption('Book in thirty seconds.')).toEqual(['Book in thirty seconds.']);
  });

  it('never exceeds the line length and never breaks mid-word', () => {
    // 70 characters: fits two 37-char lines with room, so this exercises the
    // balanced path rather than the hard-wrap fallback below.
    const text = 'Every enquiry answered in under a minute, without touching a keyboard.';
    const lines = wrapCaption(text);
    expect(lines.length).toBeLessThanOrEqual(CAPTION.maxLines);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(CAPTION.maxCharsPerLine);
    }
    // Round-tripping the words proves nothing was cut or duplicated.
    expect(lines.join(' ').split(/\s+/)).toEqual(text.split(/\s+/));
  });

  it('balances the two lines rather than greedily filling the first', () => {
    const lines = wrapCaption('Answer every enquiry in under a minute flat today');
    expect(lines).toHaveLength(2);
    expect(Math.abs(lines[0]!.length - lines[1]!.length)).toBeLessThan(
      CAPTION.maxCharsPerLine / 2
    );
  });

  it('collapses whitespace', () => {
    expect(wrapCaption('  Book   in\nthirty  seconds. ')).toEqual([
      'Book in thirty seconds.',
    ]);
  });

  it('hard-wraps past two lines so the caller can split into more cues', () => {
    const long = Array.from({ length: 30 }, () => 'word').join(' ');
    const lines = wrapCaption(long);
    expect(lines.length).toBeGreaterThan(CAPTION.maxLines);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(CAPTION.maxCharsPerLine);
    }
  });
});

describe('readingTimeMs', () => {
  it('never returns less than the minimum hold', () => {
    // Under a second a caption registers as a flicker, not as text.
    expect(readingTimeMs('Go')).toBe(CAPTION.minDurationMs);
  });

  it('scales with word count at the Ofcom rate', () => {
    const sixteen = Array.from({ length: 16 }, () => 'word').join(' ');
    // 16 words at 160wpm is six seconds.
    expect(readingTimeMs(sixteen)).toBe(6000);
  });
});

/** A storyboard whose narration is the point; geometry is incidental. */
function narrated(lines: Array<{ at: number; text: string; dur?: number; sound?: boolean; speaker?: string }>): Storyboard {
  return storyboardSchema.parse({
    product: 'Relay',
    duration: 12_000,
    fps: 30,
    aspect: '16:9',
    resolution: { width: 1920, height: 1080 },
    brand: { accent: '#0A84FF', scheme: 'dark', productName: 'Relay' },
    scenes: [
      {
        id: 'hook',
        beat: 'hook',
        type: 'text',
        start: 0,
        duration: 12_000,
        copy: { headline: 'Relay' },
        narration: lines,
      },
    ],
  });
}

describe('buildCues', () => {
  it('produces nothing when there is no narration', () => {
    // An empty caption file asserts "this has been captioned" and is worse than
    // its absence.
    expect(buildCues(narrated([]))).toEqual([]);
  });

  it('numbers cues from 1, consecutively', () => {
    const cues = buildCues(
      narrated([
        { at: 0, text: 'Every enquiry answered in under a minute.', dur: 3000 },
        { at: 4000, text: 'Without anyone touching a keyboard.', dur: 3000 },
      ])
    );
    expect(cues.length).toBeGreaterThanOrEqual(2);
    expect(cues.map((c) => c.index)).toEqual(cues.map((_, i) => i + 1));
  });

  it('never overlaps two cues', () => {
    // Both formats show one and silently drop the other.
    const cues = buildCues(
      narrated([
        { at: 0, text: 'One two three four five six seven.', dur: 5000 },
        { at: 1000, text: 'Overlapping deliberately, right here.', dur: 5000 },
        { at: 1500, text: 'And a third one on top of those.', dur: 5000 },
      ])
    );
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i]!.startMs).toBeGreaterThanOrEqual(cues[i - 1]!.endMs);
    }
  });

  it('never runs a cue past the end of the film', () => {
    const cues = buildCues(
      narrated([{ at: 11_000, text: 'A late line that would overrun the film.', dur: 6000 }])
    );
    for (const cue of cues) {
      expect(cue.endMs).toBeLessThanOrEqual(12_000);
      expect(cue.endMs).toBeGreaterThan(cue.startMs);
    }
  });

  it('keeps every cue within the two-line limit', () => {
    const cues = buildCues(
      narrated([
        {
          at: 0,
          text:
            'A single narration line long enough that it cannot possibly fit ' +
            'inside two subtitle lines at thirty-seven characters each.',
          dur: 8000,
        },
      ])
    );
    expect(cues.length).toBeGreaterThan(1);
    for (const cue of cues) {
      expect(cue.lines.length).toBeLessThanOrEqual(CAPTION.maxLines);
    }
  });

  it('brackets non-speech audio', () => {
    const cues = buildCues(narrated([{ at: 0, text: 'soft chime', sound: true, dur: 2000 }]));
    expect(cues[0]!.lines.join(' ')).toBe('[soft chime]');
  });

  it('does not double-bracket text that already carries brackets', () => {
    const cues = buildCues(narrated([{ at: 0, text: '[soft chime]', sound: true, dur: 2000 }]));
    expect(cues[0]!.lines.join(' ')).toBe('[soft chime]');
  });

  it('prefixes a named speaker', () => {
    const cues = buildCues(
      narrated([{ at: 0, text: 'We answer instantly.', speaker: 'Ana', dur: 2500 }])
    );
    expect(cues[0]!.lines.join(' ')).toContain('Ana:');
  });

  it('offsets cues by their scene start', () => {
    const sb = storyboardSchema.parse({
      product: 'Relay',
      duration: 12_000,
      fps: 30,
      aspect: '16:9',
      resolution: { width: 1920, height: 1080 },
      brand: { accent: '#0A84FF', scheme: 'dark', productName: 'Relay' },
      scenes: [
        { id: 'a', beat: 'hook', type: 'text', start: 0, duration: 6000, copy: { headline: 'A' } },
        {
          id: 'b',
          beat: 'payoff',
          type: 'text',
          start: 6000,
          duration: 6000,
          copy: { headline: 'B' },
          narration: [{ at: 500, text: 'Spoken in the second scene.', dur: 2000 }],
        },
      ],
    });
    expect(buildCues(sb)[0]!.startMs).toBe(6500);
  });
});

describe('caption serialisation', () => {
  const cues: Cue[] = [
    { index: 1, startMs: 0, endMs: 2500, lines: ['Every enquiry answered', 'in under a minute.'] },
    { index: 2, startMs: 3_661_000, endMs: 3_662_000, lines: ['An hour in.'] },
  ];

  it('writes WebVTT with a header and dot-separated timestamps', () => {
    const vtt = toWebVtt(cues);
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true);
    expect(vtt).toContain('00:00:00.000 --> 00:00:02.500');
    expect(vtt).not.toContain(',500 -->');
  });

  it('writes SubRip with comma-separated timestamps and CRLF', () => {
    // Several hardware players reject LF-only SRT.
    const srt = toSrt(cues);
    expect(srt).toContain('00:00:00,000 --> 00:00:02,500');
    expect(srt).toContain('\r\n');
    expect(srt.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('carries the hour field past 60 minutes', () => {
    // `3_661_000ms` is 01:01:01 — a naive implementation writes 00:61:01.
    expect(toWebVtt(cues)).toContain('01:01:01.000');
    expect(toSrt(cues)).toContain('01:01:01,000');
  });

  it('keeps line breaks inside a cue', () => {
    expect(toWebVtt(cues)).toContain('Every enquiry answered\nin under a minute.');
    expect(toSrt(cues)).toContain('Every enquiry answered\r\nin under a minute.');
  });

  it('round-trips every cue index into both formats', () => {
    for (const cue of cues) {
      expect(toWebVtt(cues)).toContain(`${cue.index}\n`);
      expect(toSrt(cues)).toContain(`${cue.index}\r\n`);
    }
  });
});

describe('reviewCaptions', () => {
  it('says nothing about a comfortable cue', () => {
    expect(
      reviewCaptions([{ index: 1, startMs: 0, endMs: 3000, lines: ['Answered instantly.'] }])
    ).toEqual([]);
  });

  it('flags a cue that is on screen for less time than it takes to read', () => {
    const issues = reviewCaptions([
      {
        index: 1,
        startMs: 0,
        endMs: 1000,
        lines: ['Every single enquiry answered', 'in well under one minute flat.'],
      },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('160wpm');
  });

  it('flags a cue held long enough to read as stuck', () => {
    const issues = reviewCaptions([
      { index: 1, startMs: 0, endMs: 9000, lines: ['Held far too long.'] },
    ]);
    expect(issues.some((i) => /stuck/.test(i.message))).toBe(true);
  });

  it('flags an over-long line against Ofcom guidance', () => {
    const issues = reviewCaptions([
      {
        index: 1,
        startMs: 0,
        endMs: 6000,
        lines: ['x'.repeat(CAPTION.maxCharsPerLine + 1)],
      },
    ]);
    expect(issues.some((i) => /Ofcom guidance/.test(i.message))).toBe(true);
  });

  it('passes everything buildCues produces from ordinary narration', () => {
    // The generator and the reviewer must agree, or every film ships with
    // self-inflicted warnings.
    const cues = buildCues(
      narrated([
        { at: 0, text: 'Every enquiry answered in under a minute.', dur: 4000 },
        { at: 5000, text: 'Without anyone touching a keyboard.', dur: 4000 },
      ])
    );
    expect(reviewCaptions(cues)).toEqual([]);
  });
});
