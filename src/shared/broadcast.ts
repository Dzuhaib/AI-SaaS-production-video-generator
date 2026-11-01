/**
 * US and UK delivery standards.
 *
 * Everything a film has to satisfy to be *deliverable* rather than merely
 * playable, in one place, because these constants are the kind that get
 * copied into a command line once and then drift: the encoder, the compiler,
 * the caption writer and the craft rules all need the same numbers, and a
 * disagreement between any two of them is a conformance failure nobody sees
 * until a broadcaster's QC report comes back.
 *
 * Sources are cited per constant. Where the US and UK figures differ they are
 * both kept rather than averaged — a film delivered at -23 LUFS to a US network
 * is 1 LU hot for ATSC A/85, and one delivered at 29.97 to a UK broadcaster is
 * the wrong cadence entirely.
 */

/* ------------------------------------------------------------------ *
 * Frame rate
 * ------------------------------------------------------------------ */

/**
 * The broadcast rates are not the numbers they are named after.
 *
 * NTSC's colour subcarrier forced a 1000/1001 pulldown in 1953, so "30fps" US
 * video is 30000/1001 = 29.970029970... and "24fps" film transferred to it is
 * 24000/1001. PAL never had that problem, so UK/EU rates are exact integers.
 *
 * Storing the rational rather than the decimal matters at both ends. ffmpeg
 * parses `-framerate 29.97` as exactly 2997/100 and writes a 100-tick timebase,
 * which is not a legal MP4 cadence for US delivery and which QC tools flag; and
 * the engine's `seek(f * 1000 / fps)` wants the exact divisor so a two-hour
 * conform lands on the same frame the encoder does.
 */
export interface FrameRate {
  /** The name people use, and what the storyboard stores. */
  readonly label: number;
  /** Exact rate = num / den. */
  readonly num: number;
  readonly den: number;
  readonly family: 'ntsc' | 'pal' | 'integer';
  /** Regions where this cadence is the native broadcast one. */
  readonly native: readonly ('US' | 'UK')[];
  readonly note: string;
}

export const FRAME_RATES: readonly FrameRate[] = [
  {
    label: 23.976,
    num: 24000,
    den: 1001,
    family: 'ntsc',
    native: ['US'],
    note: '24fps film pulled down for NTSC delivery',
  },
  {
    label: 24,
    num: 24,
    den: 1,
    family: 'integer',
    native: ['US', 'UK'],
    note: 'digital cinema; the cadence audiences read as "film"',
  },
  {
    label: 25,
    num: 25,
    den: 1,
    family: 'pal',
    native: ['UK'],
    note: 'UK/EU broadcast (PAL heritage). The correct default for Ofcom delivery',
  },
  {
    label: 29.97,
    num: 30000,
    den: 1001,
    family: 'ntsc',
    native: ['US'],
    note: 'US broadcast (NTSC). 30000/1001, never 29.97 exactly',
  },
  {
    label: 30,
    num: 30,
    den: 1,
    family: 'integer',
    native: [],
    note: 'web and social. Not a broadcast cadence in either region',
  },
  {
    label: 50,
    num: 50,
    den: 1,
    family: 'pal',
    native: ['UK'],
    note: 'UK/EU high-frame-rate broadcast',
  },
  {
    label: 59.94,
    num: 60000,
    den: 1001,
    family: 'ntsc',
    native: ['US'],
    note: 'US high-frame-rate broadcast',
  },
  {
    label: 60,
    num: 60,
    den: 1,
    family: 'integer',
    native: [],
    note: 'web and social at high frame rate',
  },
] as const;

/** Every rate the schema accepts, as labels. */
export const FPS_VALUES = FRAME_RATES.map((r) => r.label);

export function frameRate(label: number): FrameRate {
  const found = FRAME_RATES.find((r) => r.label === label);
  if (!found) {
    throw new RangeError(
      `${label} is not a supported frame rate. Use one of ${FPS_VALUES.join(', ')}.`
    );
  }
  return found;
}

/** Exact rate as a float, for frame-count arithmetic. */
export function exactFps(label: number): number {
  const r = frameRate(label);
  return r.num / r.den;
}

/** `30000/1001` — what ffmpeg and the generated timeline should both receive. */
export function rationalFps(label: number): string {
  const r = frameRate(label);
  return r.den === 1 ? String(r.num) : `${r.num}/${r.den}`;
}

/* ------------------------------------------------------------------ *
 * Loudness
 * ------------------------------------------------------------------ */

/**
 * Programme loudness targets.
 *
 * A film mixed by ear and delivered without measurement is the single most
 * common technical rejection, and the targets genuinely differ:
 *
 * - **EBU R128** (UK/EU, and what Ofcom expects of UK broadcasters): -23 LUFS
 *   integrated, ±0.5 LU for programmes that can be normalised, true peak at
 *   most -1 dBTP.
 * - **ATSC A/85** (US broadcast, mandated by the CALM Act 2010): -24 LKFS,
 *   ±2 LU. LKFS and LUFS are the same unit under different names.
 * - **Web/social**: platforms normalise to about -14 LUFS (YouTube, Spotify,
 *   Meta). Delivering -23 there means the viewer reaches for the volume, and
 *   delivering louder than -14 means the platform turns it down anyway — which
 *   costs dynamic range for nothing.
 *
 * True peak is below 0 in every case because a sample-peak-legal signal can
 * still clip once a lossy codec reconstructs it between samples.
 */
export interface LoudnessTarget {
  /** Integrated programme loudness, LUFS (== LKFS). */
  readonly integrated: number;
  /** Maximum true peak, dBTP. */
  readonly truePeak: number;
  /** Loudness range target, LU. */
  readonly range: number;
  /**
   * Permitted deviation from `integrated`, LU.
   *
   * Genuinely different between the two standards, and not a detail: EBU R128
   * allows ±0.5 LU for a programme that can be normalised, while ATSC A/85
   * allows ±2. A master at -22 LUFS is a pass in the US and a rejection in the
   * UK, so a single averaged tolerance would be wrong in both directions.
   */
  readonly tolerance: number;
  readonly standard: string;
}

export const LOUDNESS: Record<DeliveryProfile, LoudnessTarget> = {
  'web': {
    integrated: -14,
    truePeak: -1,
    range: 7,
    // Platforms normalise on ingest, so the target is a sensible delivery
    // level rather than a contracted one. Wide, because nothing rejects on it.
    tolerance: 2,
    standard: 'streaming platform normalisation (YouTube/Meta/Spotify ~-14 LUFS)',
  },
  'social': {
    integrated: -14,
    truePeak: -1,
    range: 6,
    tolerance: 2,
    standard: 'social platform normalisation (~-14 LUFS, tighter range for phone speakers)',
  },
  'broadcast-uk': {
    integrated: -23,
    truePeak: -1,
    range: 7,
    tolerance: 0.5,
    standard: 'EBU R128 (UK/EU broadcast)',
  },
  'broadcast-us': {
    integrated: -24,
    truePeak: -2,
    range: 7,
    tolerance: 2,
    standard: 'ATSC A/85 / CALM Act (US broadcast)',
  },
};

/* ------------------------------------------------------------------ *
 * Delivery profiles
 * ------------------------------------------------------------------ */

/**
 * A named bundle of every delivery decision. Choosing one is how a caller says
 * "this is going to a UK broadcaster" without having to know that that implies
 * 25fps, -23 LUFS and -1 dBTP.
 *
 * Declared as a tuple with the union derived from it, rather than the reverse:
 * a widened `readonly DeliveryProfile[]` loses the literal members `z.enum`
 * needs to build the schema, and a hand-kept union can drift from the list the
 * schema actually validates against.
 */
export const DELIVERY_PROFILES = [
  'web',
  'social',
  'broadcast-us',
  'broadcast-uk',
] as const;

export type DeliveryProfile = (typeof DELIVERY_PROFILES)[number];

export interface DeliverySpec {
  readonly profile: DeliveryProfile;
  /** The cadence this profile expects. A film at another rate still encodes;
   *  `conformance()` reports the mismatch rather than silently resampling. */
  readonly fps: number;
  readonly loudness: LoudnessTarget;
  /** Audio sample rate. 48kHz is the broadcast and web standard; 44.1 is a
   *  consumer-CD rate and gets resampled downstream. */
  readonly sampleRate: number;
  readonly channels: number;
  /** H.264 profile and level. High@4.0 covers 1080p at up to 30fps; 4.2 is
   *  needed for 1080p50/60. */
  readonly h264Profile: 'high';
  /**
   * VBV ceiling in kbit/s, or null for unconstrained CRF.
   *
   * CRF alone has no bitrate ceiling: it holds quality and lets the rate go
   * where it needs to, which is right for the web and wrong for a delivery
   * contract. A broadcaster specifies a maximum, and a master that spikes past
   * it on one complex shot is rejected for the whole programme — so broadcast
   * profiles get `-maxrate`/`-bufsize` and web/social do not.
   *
   * 1080p H.264 contribution specs cluster around 50 Mbit/s (EBU 3348 for
   * AVC-I-adjacent long-GOP delivery, and the common figure in US network
   * specs). It is deliberately well above what screen content at CRF 18
   * actually produces — the ceiling exists to bound the worst case, not to
   * constrain the encode, and setting it near the average would force the
   * encoder to spend quality holding a limit nothing was near.
   */
  readonly maxrateKbps: number | null;
  /** VBV buffer, in kbit. One second of the ceiling is the usual choice: it
   *  bounds the rate over any one-second window, which is what a hardware
   *  decoder's input buffer models. */
  readonly bufsizeKbps: number | null;
  readonly description: string;
}

export function deliverySpec(profile: DeliveryProfile, fps?: number): DeliverySpec {
  const defaults: Record<DeliveryProfile, number> = {
    'web': 30,
    'social': 30,
    'broadcast-uk': 25,
    'broadcast-us': 29.97,
  };
  const descriptions: Record<DeliveryProfile, string> = {
    'web': 'web embed and owned channels — -14 LUFS, any cadence',
    'social': 'social feeds — -14 LUFS, tight range, vertical-friendly',
    'broadcast-uk': 'UK broadcast — EBU R128 -23 LUFS, 25fps, BT.709',
    'broadcast-us': 'US broadcast — ATSC A/85 -24 LKFS, 29.97fps, BT.709',
  };
  const ceiling = profile.startsWith('broadcast') ? 50_000 : null;
  return {
    profile,
    fps: fps ?? defaults[profile],
    loudness: LOUDNESS[profile],
    sampleRate: 48_000,
    channels: 2,
    h264Profile: 'high',
    maxrateKbps: ceiling,
    bufsizeKbps: ceiling,
    description: descriptions[profile],
  };
}

/** H.264 level, which is a function of resolution and frame rate rather than a
 *  free choice: 1080p above 30fps exceeds the macroblock rate Level 4.0 allows,
 *  and a decoder is entitled to refuse a stream that overruns its declared level. */
export function h264Level(width: number, height: number, fps: number): string {
  const macroblocksPerSecond = Math.ceil(width / 16) * Math.ceil(height / 16) * exactFps(fps);
  // Level 4.0 allows 245,760 MB/s; 4.2 allows 522,240.
  if (macroblocksPerSecond > 245_760) return '4.2';
  return '4.0';
}

/* ------------------------------------------------------------------ *
 * Colour
 * ------------------------------------------------------------------ */

/**
 * BT.709 is the colour space for HD in both regions (and the one a browser
 * screenshot in sRGB is closest to — sRGB and BT.709 share primaries and white
 * point, differing only in transfer function).
 *
 * Tagging is not decoration. An untagged H.264 file is interpreted by the
 * player's guess, and the common guess for anything it is unsure about is
 * BT.601 — which shifts every saturated colour, most visibly in greens and in
 * brand accents near the gamut edge. The same failure happens in reverse if the
 * file is *tagged* BT.709 but *converted* with BT.601 coefficients, which is
 * swscale's default for some input shapes. So the matrix has to be forced at the
 * scaler as well as declared in the container.
 */
export const COLOUR = {
  primaries: 'bt709',
  transfer: 'bt709',
  matrix: 'bt709',
  /** Limited ("TV") range, 16-235 for luma. The broadcast norm in both regions,
   *  and what an RGB->YUV conversion produces by default. */
  range: 'tv',
} as const;

/* ------------------------------------------------------------------ *
 * Safe areas
 * ------------------------------------------------------------------ */

/**
 * EBU R95 (UK/EU) and SMPTE RP 218 (US) agree for 16:9 HD, which is a mercy:
 *
 * - **Action / graphics safe**: 3.5% in from each edge. Anything important
 *   happens inside this.
 * - **Title / text safe**: 5% in from each edge. Text outside it can be cropped
 *   by an overscanning display or by a platform's own chrome.
 *
 * Social platforms are the harsher constraint in practice: a 9:16 story has
 * roughly the top 12% and bottom 20% covered by the app's own UI, so text there
 * has to sit further in than any broadcast standard requires.
 */
export const SAFE_AREA = {
  /** Fraction of width/height inset from each edge. */
  action: 0.035,
  title: 0.05,
  /** Extra insets for feed/story UI, as a fraction of height. */
  socialTop: 0.12,
  socialBottom: 0.2,
} as const;

export interface SafeBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** The title-safe rectangle in stage pixels. */
export function titleSafe(width: number, height: number): SafeBox {
  const x = Math.round(width * SAFE_AREA.title);
  const y = Math.round(height * SAFE_AREA.title);
  return {
    left: x,
    top: y,
    right: width - x,
    bottom: height - y,
    width: width - x * 2,
    height: height - y * 2,
  };
}

/** The action-safe rectangle in stage pixels. */
export function actionSafe(width: number, height: number): SafeBox {
  const x = Math.round(width * SAFE_AREA.action);
  const y = Math.round(height * SAFE_AREA.action);
  return {
    left: x,
    top: y,
    right: width - x,
    bottom: height - y,
    width: width - x * 2,
    height: height - y * 2,
  };
}

/* ------------------------------------------------------------------ *
 * Flash safety (photosensitive epilepsy)
 * ------------------------------------------------------------------ */

/**
 * Thresholds from ITU-R BT.1702, the Ofcom Broadcasting Code §2.12 guidance
 * (which adopts the Harding criteria), and WCAG 2.2 SC 2.3.1 — which agree on
 * the numbers even though they were written for different media.
 *
 * A "flash" is a *pair* of opposing luminance changes. A single fade to white is
 * not a flash; a white-black-white sequence is two. The screen-area condition
 * exists because a flash in a small corner of the frame is not a risk — the
 * rule only bites once the flashing region covers about a quarter of the image.
 *
 * The red rule is separate and stricter because saturated red provokes a
 * response at luminance changes that would otherwise be below threshold.
 */
export const FLASH = {
  /** Maximum flashes in any one-second window. Above this the sequence fails. */
  maxPerSecond: 3,
  /** Minimum relative-luminance change that counts, 0..1. */
  luminanceDelta: 0.1,
  /** The rule only applies when the darker state is below this luminance. */
  darkerBelow: 0.8,
  /** Fraction of the frame that must be flashing for the rule to apply. */
  areaFraction: 0.25,
  /** Saturated-red test: R/(R+G+B) at or above this, with R at least this
   *  absolute value, is "saturated red" for BT.1702 purposes. */
  redFraction: 0.8,
  redMinimum: 85,
} as const;

/* ------------------------------------------------------------------ *
 * Conformance reporting
 * ------------------------------------------------------------------ */

export interface ConformanceNote {
  readonly area:
    | 'cadence'
    | 'loudness'
    | 'colour'
    | 'safe-area'
    | 'flash'
    | 'captions'
    | 'container';
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
  /** The standard this derives from, so a note can be traced. */
  readonly standard: string;
}

/**
 * Check a film's declared properties against a delivery profile, before
 * anything is rendered. Cheap, and it catches the mismatches that are expensive
 * to discover after nine hundred frames.
 */
export function conformance(opts: {
  profile: DeliveryProfile;
  fps: number;
  width: number;
  height: number;
  hasAudio: boolean;
  hasCaptions: boolean;
}): ConformanceNote[] {
  const notes: ConformanceNote[] = [];
  const spec = deliverySpec(opts.profile);
  const rate = frameRate(opts.fps);
  const region = opts.profile === 'broadcast-uk' ? 'UK' : opts.profile === 'broadcast-us' ? 'US' : null;

  if (region && !rate.native.includes(region)) {
    notes.push({
      area: 'cadence',
      severity: 'error',
      message:
        `${opts.fps}fps is not a ${region} broadcast cadence (${rate.note}). ` +
        `Use ${spec.fps}fps for ${opts.profile}; converting later means dropped or ` +
        `duplicated frames on every pan.`,
      standard: region === 'UK' ? 'EBU/PAL 25fps' : 'ATSC/NTSC 30000/1001',
    });
  }

  if (!opts.hasAudio) {
    notes.push({
      area: 'loudness',
      severity: opts.profile.startsWith('broadcast') ? 'error' : 'warning',
      message:
        'The film has no audio track. Broadcast delivery requires one even when ' +
        'the programme is silent — a missing track is a QC failure, a silent track is not.',
      standard: spec.loudness.standard,
    });
  }

  if (!opts.hasCaptions) {
    notes.push({
      area: 'captions',
      severity: 'warning',
      message:
        'No caption sidecar. US: ADA title III and FCC rules for redistributed ' +
        'broadcast content; UK: Equality Act 2010 reasonable adjustment and Ofcom ' +
        'access-services quotas. Also the reason most feed video works muted.',
      standard: 'WCAG 2.2 SC 1.2.2 (Captions, Level A)',
    });
  }

  if (opts.profile === 'social' && opts.width > opts.height) {
    notes.push({
      area: 'safe-area',
      severity: 'warning',
      message:
        'A landscape film in a social profile will be letterboxed into a vertical ' +
        'feed, which costs about half the pixel height. Consider 9:16 or 4:5.',
      standard: 'platform feed geometry',
    });
  }

  return notes;
}

/* ------------------------------------------------------------------ *
 * Output verification
 * ------------------------------------------------------------------ */

/**
 * What a read-back of the encoded file reports. Structural rather than imported
 * from the renderer, because `shared/` depends on nothing (§27) — and because
 * the check should work against any probe, not only ours.
 */
export interface MeasuredFile {
  readonly width: number;
  readonly height: number;
  /** Exactly as the container declares it, e.g. `30000/1001`. */
  readonly frameRate: string;
  /**
   * Whether `frameRate` is the container's declared rational or a rounded
   * human-readable value. False when it came from parsing ffmpeg's banner,
   * which prints `29.97 fps` for both 2997/100 and 30000/1001 — so the
   * distinction US delivery turns on cannot be settled from it.
   */
  readonly frameRateExact?: boolean;
  readonly pixFmt: string;
  readonly colourPrimaries: string;
  readonly colourTransfer: string;
  readonly colourMatrix: string;
  readonly hasAudio: boolean;
  readonly audioSampleRate: number;
  readonly audioChannels: number;
}

/** `30000/1001` or `25` -> a number. 0 when unparseable. */
function rateValue(rational: string): number {
  const [rawNum, rawDen] = rational.split('/');
  const num = Number(rawNum);
  if (!Number.isFinite(num)) return 0;
  if (rawDen === undefined) return num;
  const den = Number(rawDen);
  return Number.isFinite(den) && den !== 0 ? num / den : 0;
}

/**
 * Check what was actually written against what the profile requires.
 *
 * `conformance()` checks *intent* before a frame is rendered; this checks
 * *outcome* after the encode. Both are needed, and for a reason this codebase
 * has already paid for twice: the flags were correct and the value never
 * arrived. An encoder invoked with `-colorspace bt709` still writes an untagged
 * file if the filter chain dropped the side data, and a profile that never
 * reached `encode()` produces a technically perfect master at the wrong
 * loudness — which nothing in the picture reveals.
 *
 * Loudness is deliberately absent: reading integrated LUFS back out requires a
 * second full decode pass, so it is measured during the encode (two-pass
 * `loudnorm`) rather than asserted here. What is checked is everything a
 * container read can settle cheaply.
 */
export function verifyDelivery(
  file: MeasuredFile,
  profile: DeliveryProfile,
  expectedFps: number
): ConformanceNote[] {
  const notes: ConformanceNote[] = [];
  const spec = deliverySpec(profile, expectedFps);
  const wanted = rationalFps(expectedFps);
  const broadcast = profile.startsWith('broadcast');

  /* ---- Cadence ----------------------------------------------------- *
   * Two distinct failures, and only the second needs an exact read:
   *
   *   wrong speed     — 25fps written where 29.97 was asked for. Visible, and
   *                     catchable from any rounded value.
   *   right speed,
   *   wrong rational  — 2997/100 instead of 30000/1001. Plays at very nearly
   *                     the right speed and fails US QC outright.
   */
  const wantedValue = exactFps(expectedFps);
  const actualValue = rateValue(file.frameRate);
  const exact = file.frameRateExact !== false;

  if (Math.abs(actualValue - wantedValue) > 0.01) {
    notes.push({
      area: 'cadence',
      severity: broadcast ? 'error' : 'warning',
      message:
        `The file runs at ${file.frameRate}; the film was rendered for ` +
        `${expectedFps}fps (${wanted}). Conforming it later means dropped or ` +
        'duplicated frames on every pan.',
      standard: 'ITU-R BT.470 / SMPTE 12M cadence',
    });
  } else if (exact && file.frameRate !== wanted && file.frameRate !== `${wanted}/1`) {
    notes.push({
      area: 'cadence',
      severity: broadcast ? 'error' : 'warning',
      message:
        `The file declares ${file.frameRate}; ${expectedFps}fps is ${wanted}. ` +
        'A near-miss rational is the classic NTSC delivery rejection.',
      standard: 'ITU-R BT.470 / SMPTE 12M cadence',
    });
  } else if (!exact && frameRate(expectedFps).den !== 1) {
    notes.push({
      area: 'cadence',
      severity: 'info',
      message:
        `Cadence reads ${file.frameRate}, which is right to two decimal places, ` +
        `but ${wanted} could not be confirmed exactly — ffmpeg's banner rounds ` +
        'and ffprobe is not installed. Install ffprobe to verify a US master.',
      standard: 'ITU-R BT.470 / SMPTE 12M cadence',
    });
  }

  if (file.pixFmt !== 'yuv420p') {
    notes.push({
      area: 'container',
      severity: 'error',
      message:
        `Chroma format is ${file.pixFmt}, not yuv420p. Safari and QuickTime ` +
        'refuse yuv444p outright — the file opens, shows controls, and plays no video.',
      standard: 'H.264 High profile, 4:2:0 8-bit',
    });
  }

  /* ---- Colour ------------------------------------------------------ *
   * An untagged file is interpreted by the player's guess, and the common
   * guess is BT.601 — which shifts every saturated colour. So `unset` is as
   * much a failure as a wrong value, and it is the one that looks fine locally.
   *
   * `unverified` is neither: it means the probe could not read the tags at all
   * (ffmpeg's banner does not print them, and ffmpeg-static ships no ffprobe).
   * Reporting that as `unset` would fire a warning on every correct file on a
   * default install, so it is surfaced once, as info, saying what was skipped.
   */
  const colour: [string, string][] = [
    ['primaries', file.colourPrimaries],
    ['transfer', file.colourTransfer],
    ['matrix', file.colourMatrix],
  ];
  if (colour.every(([, v]) => v === 'unverified')) {
    notes.push({
      area: 'colour',
      severity: 'info',
      message:
        'Colour tagging was not verified — ffmpeg reports no colour metadata and ' +
        'ffprobe is not installed. The encoder sets BT.709 explicitly; install ' +
        'ffprobe to confirm it reached the file.',
      standard: 'ITU-R BT.709 (HD, both regions)',
    });
  } else {
    for (const [name, value] of colour) {
      if (value === 'unverified' || value === COLOUR.primaries) continue;
      notes.push({
        area: 'colour',
        severity: 'warning',
        message:
          `Colour ${name} reads "${value}", expected "${COLOUR.primaries}". ` +
          (value === 'unset'
            ? 'An untagged stream is guessed at, usually as BT.601.'
            : 'A mis-tagged stream shifts hue on every compliant player.'),
        standard: 'ITU-R BT.709 (HD, both regions)',
      });
    }
  }

  if (file.hasAudio) {
    if (file.audioSampleRate !== spec.sampleRate) {
      notes.push({
        area: 'loudness',
        severity: broadcast ? 'error' : 'warning',
        message:
          `Audio is ${file.audioSampleRate}Hz; delivery is ${spec.sampleRate}Hz. ` +
          '44.1k is a consumer-CD rate and gets resampled by whoever receives it.',
        standard: 'EBU R128 / ATSC A/85 delivery (48kHz)',
      });
    }
    if (file.audioChannels !== spec.channels) {
      notes.push({
        area: 'loudness',
        severity: 'warning',
        message: `Audio is ${file.audioChannels} channel(s); delivery expects ${spec.channels}.`,
        standard: spec.loudness.standard,
      });
    }
  } else if (broadcast) {
    notes.push({
      area: 'loudness',
      severity: 'error',
      message:
        'The encoded file has no audio track. Broadcast delivery requires one ' +
        'even for a silent programme.',
      standard: spec.loudness.standard,
    });
  }

  if (file.width % 2 !== 0 || file.height % 2 !== 0) {
    notes.push({
      area: 'container',
      severity: 'error',
      message: `${file.width}x${file.height} has an odd dimension; H.264 cannot encode it.`,
      standard: 'H.264 macroblock alignment',
    });
  }

  return notes;
}

/**
 * What normalisation actually achieved, as `loudnorm` reports it.
 *
 * All LUFS/dBTP. `linear` records whether one gain was applied to the whole
 * programme or the level was ridden dynamically — see `checkLoudness`.
 */
export interface AchievedLoudness {
  readonly integrated: number;
  readonly truePeak: number;
  readonly range: number;
  readonly linear: boolean;
}

/**
 * Check the loudness the encode actually produced against the profile's target.
 *
 * Worth stating why this is separate from `verifyDelivery`: integrated loudness
 * cannot be read back out of a finished MP4 without a second full decode pass,
 * so it is not part of a container read. It comes from the encoder, which
 * measured it on the way past.
 *
 * This is the first number a broadcaster checks, and until now it was computed
 * for pass two and thrown away.
 */
export function checkLoudness(
  achieved: AchievedLoudness,
  profile: DeliveryProfile
): ConformanceNote[] {
  const notes: ConformanceNote[] = [];
  const target = LOUDNESS[profile];
  const broadcast = profile.startsWith('broadcast');
  const drift = achieved.integrated - target.integrated;

  if (Math.abs(drift) > target.tolerance) {
    notes.push({
      area: 'loudness',
      severity: broadcast ? 'error' : 'warning',
      message:
        `Programme loudness is ${achieved.integrated.toFixed(1)} LUFS; ` +
        `${target.standard} wants ${target.integrated} ±${target.tolerance} LU ` +
        `(${drift > 0 ? '+' : ''}${drift.toFixed(1)} LU out).`,
      standard: target.standard,
    });
  }

  // A sample-peak-legal signal can still clip once a lossy codec reconstructs
  // it between samples, which is the whole reason the limit is below 0.
  if (achieved.truePeak > target.truePeak) {
    notes.push({
      area: 'loudness',
      severity: broadcast ? 'error' : 'warning',
      message:
        `True peak is ${achieved.truePeak.toFixed(1)} dBTP, above the ` +
        `${target.truePeak} dBTP ceiling. Inter-sample peaks clip on decode.`,
      standard: target.standard,
    });
  }

  /**
   * `loudnorm` falls back from linear to dynamic mode on its own when one gain
   * would push the true peak past the ceiling. It hits the target either way,
   * so nothing looks wrong — but dynamic mode is a compressor with look-ahead,
   * and it changes the balance the sound design was built on. A broadcaster
   * asking for a normalised master means the linear kind.
   */
  if (!achieved.linear) {
    notes.push({
      area: 'loudness',
      severity: broadcast ? 'warning' : 'info',
      message:
        'Normalisation fell back to dynamic mode, which rides the level rather ' +
        'than applying one gain — it compresses the mix. Usually means the ' +
        'source is too hot for the true-peak ceiling; lower the bed and re-render.',
      standard: target.standard,
    });
  }

  return notes;
}
