/**
 * Encoding — PNG sequence + WAV -> MP4.
 *
 * ffmpeg comes from `ffmpeg-static`, a bundled binary, because a system ffmpeg
 * cannot be assumed (this machine has none) and asking a user to install one
 * before their first render is a bad first minute.
 *
 * Every flag below is load-bearing; the comments say why, because the failure
 * modes are all silent — a file that plays fine locally and stalls on the web,
 * plays in Chrome and shows a black frame in QuickTime, or passes a technical
 * review and comes back from a broadcaster's QC with a colour-matrix fault.
 *
 * `src/shared/broadcast.ts` owns the numbers. Nothing here should hardcode a
 * loudness target or a colour primary; the delivery profile decides.
 */

import { spawn } from 'node:child_process';
import { EncodeError } from './errors.js';
import {
  COLOUR,
  deliverySpec,
  h264Level,
  rationalFps,
  type AchievedLoudness,
  type DeliveryProfile,
  type LoudnessTarget,
} from '../shared/broadcast.js';

export interface EncodeOptions {
  framesDir: string;
  /** printf pattern matching the frame files, e.g. `%06d.png`. */
  pattern: string;
  /** First frame number, so a partial range encodes without renumbering. */
  startNumber: number;
  audio: string | null;
  output: string;
  fps: number;
  width: number;
  height: number;
  quality: 'draft' | 'high' | 'master';
  /** Delivery target. Decides loudness, cadence expectations and GOP structure.
   *  Defaults to `web`. */
  profile?: DeliveryProfile;
  /** Measured loudness from pass one, when normalising. */
  measured?: LoudnessMeasurement | null;
  /** Burn a caption/subtitle file into the picture. Broadcast usually wants a
   *  sidecar instead; social feeds need it burned in because most players never
   *  show a sidecar. */
  burnCaptions?: string | null;
}

/**
 * CRF for screen content, which is flat colour and hard type rather than film
 * grain — it compresses far better than camera footage at the same CRF.
 *
 * 18 is visually lossless for UI. 23 is noticeably soft on 1px rim highlights,
 * which is exactly where the glass material lives.
 */
const CRF: Record<EncodeOptions['quality'], number> = {
  draft: 26,
  high: 18,
  master: 14,
};

const PRESET: Record<EncodeOptions['quality'], string> = {
  draft: 'veryfast',
  high: 'slow',
  master: 'veryslow',
};

export async function ffmpegPath(): Promise<string> {
  const mod = (await import('ffmpeg-static')) as unknown as { default: string | null };
  const path = mod.default;
  if (!path) {
    throw new EncodeError(
      'No ffmpeg binary available.',
      'ffmpeg-static resolved to null, which usually means the postinstall ' +
        'download was skipped or blocked.\nReinstall with: npm rebuild ffmpeg-static',
      null
    );
  }
  return path;
}

/* ------------------------------------------------------------------ *
 * Loudness
 * ------------------------------------------------------------------ */

export interface LoudnessMeasurement {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
  /**
   * What pass one predicts the normalised programme will measure, and how it
   * will get there. Present in ffmpeg's JSON and previously discarded along
   * with the rest of the report.
   *
   * Pass one's prediction is what pass two then applies, so it is the achieved
   * figure — reading it avoids a third full decode to measure the output.
   */
  output_i?: string;
  output_tp?: string;
  output_lra?: string;
  /** `linear` or `dynamic`. Dynamic means loudnorm chose to ride the level. */
  normalization_type?: string;
}

function loudnormFilter(target: LoudnessTarget, measured?: LoudnessMeasurement | null): string {
  const base = `loudnorm=I=${target.integrated}:TP=${target.truePeak}:LRA=${target.range}`;
  if (!measured) return `${base}:print_format=json`;

  // Second pass. `linear=true` applies one gain to the whole programme rather
  // than riding it dynamically, which is what a broadcaster means by
  // "normalised" — dynamic mode would compress the mix and change the balance
  // the sound design was built on.
  return (
    `${base}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}` +
    `:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}` +
    `:offset=${measured.target_offset}:linear=true:print_format=summary`
  );
}

/**
 * Pass one of EBU R128 / ATSC A/85 normalisation: measure, do not change.
 *
 * One-pass `loudnorm` exists and is a dynamic compressor with a look-ahead; it
 * hits the target but alters the mix. Two-pass measures the whole programme,
 * then applies a single gain, which is the only version that can honestly be
 * called normalisation.
 */
export async function measureLoudness(
  audio: string,
  target: LoudnessTarget
): Promise<LoudnessMeasurement | null> {
  const bin = await ffmpegPath();
  const args = ['-hide_banner', '-nostats', '-i', audio, '-af', loudnormFilter(target), '-f', 'null', '-'];

  const stderr = await new Promise<string>((done, fail) => {
    const proc = spawn(bin, args, { windowsHide: true });
    let buf = '';
    proc.stderr.on('data', (c: Buffer) => {
      buf += c.toString();
      if (buf.length > 256_000) buf = buf.slice(-128_000);
    });
    proc.on('error', (e) => fail(new EncodeError('Could not run ffmpeg to measure loudness', e.message, null)));
    proc.on('close', (code) =>
      code === 0 ? done(buf) : fail(new EncodeError('Loudness measurement failed', buf, code))
    );
  });

  // loudnorm prints its JSON as the last object in the stderr stream. Anchoring
  // on the last `{` rather than the first avoids picking up a JSON-shaped line
  // from an unrelated filter.
  const open = stderr.lastIndexOf('{');
  const close = stderr.lastIndexOf('}');
  if (open === -1 || close <= open) return null;

  try {
    const parsed = JSON.parse(stderr.slice(open, close + 1)) as Partial<LoudnessMeasurement>;
    if (
      parsed.input_i === undefined ||
      parsed.input_tp === undefined ||
      parsed.input_lra === undefined ||
      parsed.input_thresh === undefined ||
      parsed.target_offset === undefined
    ) {
      return null;
    }
    // A silent track measures as -inf, and feeding -inf back into pass two makes
    // ffmpeg fail rather than leave the silence alone.
    if (!Number.isFinite(Number(parsed.input_i))) return null;
    return parsed as LoudnessMeasurement;
  } catch {
    // Normalisation is an improvement, not a requirement. Losing it should not
    // lose the render.
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Arguments
 * ------------------------------------------------------------------ */

export function buildArgs(opts: EncodeOptions): string[] {
  const spec = deliverySpec(opts.profile ?? 'web', opts.fps);
  const args: string[] = ['-y'];

  // -framerate BEFORE -i sets the rate the input is interpreted at. The same
  // number after -i would resample instead, silently dropping or duplicating
  // frames to hit the target — which is how a 30fps render becomes 30fps of
  // stutter.
  //
  // The rational form is not cosmetic. `-framerate 29.97` gives a 100-tick
  // timebase; US broadcast delivery is 30000/1001 and QC tools reject the
  // approximation.
  args.push('-framerate', rationalFps(opts.fps));
  args.push('-start_number', String(opts.startNumber));
  args.push('-i', `${opts.framesDir}/${opts.pattern}`);

  if (opts.audio) args.push('-i', opts.audio);

  args.push('-c:v', 'libx264');
  args.push('-preset', PRESET[opts.quality]);
  args.push('-crf', String(CRF[opts.quality]));

  // Screen content: flat regions, hard edges, no grain. `stillimage` weights
  // the encoder toward preserving sharp edges over temporal smoothness.
  args.push('-tune', 'stillimage');

  // A decoder may refuse a stream that overruns its declared level, and the
  // level is a function of resolution times frame rate rather than a taste
  // decision — 1080p50 does not fit in Level 4.0.
  args.push('-profile:v', spec.h264Profile);
  args.push('-level:v', h264Level(opts.width, opts.height, opts.fps));

  // A two-second GOP is the streaming norm; broadcast additionally wants closed
  // GOPs so an edit can cut on any keyframe without a decode dependency
  // reaching backward across the cut.
  const gop = Math.round(2 * opts.fps);
  args.push('-g', String(gop), '-keyint_min', String(gop));
  if (spec.profile.startsWith('broadcast')) args.push('-flags', '+cgop');

  // A delivery contract specifies a maximum bitrate, and CRF alone honours no
  // ceiling — it holds quality and lets the rate go where the picture needs it.
  // Web delivery wants exactly that; a broadcaster rejects the whole programme
  // for one shot that spikes past the spec. `shared/broadcast.ts` owns the
  // numbers, and returns null where no ceiling applies.
  if (spec.maxrateKbps !== null && spec.bufsizeKbps !== null) {
    args.push('-maxrate', `${spec.maxrateKbps}k`, '-bufsize', `${spec.bufsizeKbps}k`);
  }

  /* ---- Colour ---------------------------------------------------- *
   * Two halves, and doing only one is worse than doing neither.
   *
   * The scale filter forces the RGB->YUV conversion to use BT.709
   * coefficients. swscale otherwise picks by heuristic and frequently chooses
   * BT.601, which shifts every saturated colour — a brand accent near the
   * gamut edge visibly changes hue between the preview and the MP4.
   *
   * The -color_* flags then tag the container so a player does not have to
   * guess. Tagging BT.709 while having converted with BT.601 produces a file
   * that is wrong twice and looks correct in whichever player shares the bug.
   */
  const filters: string[] = [];
  const even = opts.width % 2 !== 0 || opts.height % 2 !== 0;
  filters.push(
    'scale=' +
      (even ? 'trunc(iw/2)*2:trunc(ih/2)*2:' : '') +
      `in_range=full:out_range=${COLOUR.range}` +
      `:in_color_matrix=${COLOUR.matrix}:out_color_matrix=${COLOUR.matrix}` +
      ':flags=lanczos'
  );

  // Burned-in captions, for the feeds that never show a sidecar. After the
  // scale so the type is rasterised at final size rather than resampled.
  if (opts.burnCaptions) {
    filters.push(`subtitles=${ffmpegEscapePath(opts.burnCaptions)}`);
  }

  args.push('-vf', filters.join(','));

  // yuv420p is the only chroma format with universal decoder support. Safari and
  // QuickTime refuse yuv444p outright — the file appears to play, with no video.
  args.push('-pix_fmt', 'yuv420p');
  args.push('-color_primaries', COLOUR.primaries);
  args.push('-color_trc', COLOUR.transfer);
  args.push('-colorspace', COLOUR.matrix);
  args.push('-color_range', COLOUR.range);

  if (opts.audio) {
    // 48kHz stereo is the delivery standard in both regions. 44.1 is a
    // consumer-CD rate and gets resampled by whoever receives it.
    args.push('-c:a', 'aac', '-b:a', '192k');
    args.push('-ar', String(spec.sampleRate), '-ac', String(spec.channels));
    args.push('-af', loudnormFilter(spec.loudness, opts.measured ?? null));
    // The procedural soundtrack carries a ~1.2s tail past the last cue; without
    // this the video would be padded out to match it.
    args.push('-shortest');
  }

  // Moves the moov atom to the front. Without it a browser must download the
  // whole file before it can start playing — the classic "hosted video that
  // spins forever" bug.
  args.push('-movflags', '+faststart');

  // A slow audio filter (loudnorm is one) can stall the muxer's video queue on a
  // long render. The default limit of 1024 packets is reached at around a minute
  // of 1080p; raising it costs memory and prevents a late hard failure.
  args.push('-max_muxing_queue_size', '4096');

  args.push(opts.output);
  return args;
}

/** ffmpeg's filter parser needs `:` and `\` escaped inside a filter argument,
 *  which on Windows means every drive letter in a path. */
export function ffmpegEscapePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

/**
 * What the encode achieved, for the caller to report and check.
 *
 * `loudness` is null when the film is silent, or when the measurement could not
 * be read — normalisation is an improvement rather than a requirement, and
 * losing it must not lose the render. A null here means "not measured", never
 * "measured and fine".
 */
export interface EncodeResult {
  loudness: AchievedLoudness | null;
}

export async function encode(opts: EncodeOptions): Promise<EncodeResult> {
  const bin = await ffmpegPath();

  // Two-pass loudness: measure the programme, then apply one gain. Skipped when
  // there is no audio, and degraded to "encode without normalising" rather than
  // failing if the measurement cannot be read.
  let measured = opts.measured ?? null;
  if (opts.audio && !measured) {
    const spec = deliverySpec(opts.profile ?? 'web', opts.fps);
    measured = await measureLoudness(opts.audio, spec.loudness);
  }

  const args = buildArgs({ ...opts, measured });

  await new Promise<void>((resolvePromise, reject) => {
    const proc = spawn(bin, args, { windowsHide: true });
    let stderr = '';

    // ffmpeg writes everything, including progress, to stderr. Keep only the
    // tail: a long render produces megabytes of it.
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000);
    });

    proc.on('error', (err) => {
      reject(new EncodeError(`Could not run ffmpeg at ${bin}`, err.message, null));
    });

    proc.on('close', (code) => {
      if (code === 0) return resolvePromise();
      reject(
        new EncodeError(
          `ffmpeg exited with code ${code} while writing ${opts.output}`,
          stderr,
          code
        )
      );
    });
  });

  return { loudness: achievedLoudness(measured) };
}

/**
 * Pass one's `output_*` fields are what pass two then applies, so they are the
 * achieved figures. Returns null rather than a partial reading: a loudness
 * report missing its true peak is worse than an honest "not measured", because
 * the gap reads as a pass.
 */
export function achievedLoudness(m: LoudnessMeasurement | null): AchievedLoudness | null {
  if (!m) return null;
  const integrated = Number(m.output_i);
  const truePeak = Number(m.output_tp);
  const range = Number(m.output_lra);
  if (!Number.isFinite(integrated) || !Number.isFinite(truePeak)) return null;
  return {
    integrated,
    truePeak,
    range: Number.isFinite(range) ? range : 0,
    // Absent means ffmpeg did not say, and linear is what was requested —
    // `linear=true` is on the pass-two filter — so absence is not evidence of
    // the fallback having happened.
    linear: m.normalization_type !== 'dynamic',
  };
}

/**
 * Read back what was actually written, rather than trusting the encode.
 *
 * Tries ffprobe first because it reports the exact frame-rate rational, and
 * falls back to ffmpeg's own banner — which is the normal path, since
 * `ffmpeg-static` ships ffmpeg alone. The ffprobe error is preserved and
 * rethrown if both fail, because that is the one that says why.
 */
export async function probe(file: string): Promise<ProbeResult> {
  try {
    return await probeWithFfprobe(file);
  } catch (err) {
    try {
      return await probeWithFfmpeg(file);
    } catch {
      throw err;
    }
  }
}

export interface ProbeResult {
  width: number;
  height: number;
  fps: number;
  /** Exactly as the container declares it, e.g. `30000/1001`. */
  frameRate: string;
  /** False when `frameRate` came from ffmpeg's rounded banner. */
  frameRateExact: boolean;
  duration: number;
  pixFmt: string;
  hasAudio: boolean;
  colourPrimaries: string;
  colourTransfer: string;
  colourMatrix: string;
  colourRange: string;
  audioSampleRate: number;
  audioChannels: number;
  /** Which tool produced this, so a caller can say what it could not check. */
  source: 'ffprobe' | 'ffmpeg';
}

async function probeWithFfprobe(file: string): Promise<ProbeResult> {
  const bin = (await ffmpegPath()).replace(/ffmpeg(\.exe)?$/, (m) =>
    m.replace('ffmpeg', 'ffprobe')
  );

  const json = await new Promise<string>((resolvePromise, reject) => {
    const proc = spawn(
      bin,
      ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', file],
      { windowsHide: true }
    );
    let out = '';
    let err = '';
    proc.stdout.on('data', (c: Buffer) => (out += c.toString()));
    proc.stderr.on('data', (c: Buffer) => (err += c.toString()));
    proc.on('error', (e) =>
      reject(
        new EncodeError(
          'ffprobe is not available alongside ffmpeg-static; cannot verify output.',
          e.message,
          null
        )
      )
    );
    proc.on('close', (code) =>
      code === 0 ? resolvePromise(out) : reject(new EncodeError('ffprobe failed', err, code))
    );
  });

  const parsed = JSON.parse(json) as {
    streams: {
      codec_type: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      pix_fmt?: string;
      color_primaries?: string;
      color_transfer?: string;
      color_space?: string;
      color_range?: string;
      sample_rate?: string;
      channels?: number;
    }[];
    format: { duration?: string };
  };

  const video = parsed.streams.find((s) => s.codec_type === 'video');
  if (!video) throw new EncodeError(`${file} has no video stream`, json, null);
  const audio = parsed.streams.find((s) => s.codec_type === 'audio');

  const rate = video.r_frame_rate ?? '0/1';
  const [num, den] = rate.split('/').map(Number);
  return {
    width: video.width ?? 0,
    height: video.height ?? 0,
    fps: den ? (num ?? 0) / den : 0,
    frameRate: rate,
    frameRateExact: true,
    duration: Number(parsed.format.duration ?? 0),
    pixFmt: video.pix_fmt ?? 'unknown',
    hasAudio: audio !== undefined,
    colourPrimaries: video.color_primaries ?? 'unset',
    colourTransfer: video.color_transfer ?? 'unset',
    colourMatrix: video.color_space ?? 'unset',
    colourRange: video.color_range ?? 'unset',
    audioSampleRate: Number(audio?.sample_rate ?? 0),
    audioChannels: audio?.channels ?? 0,
    source: 'ffprobe',
  };
}

/**
 * Read the file with ffmpeg itself, for the default install where ffprobe is
 * absent.
 *
 * `ffmpeg -i FILE -f null -` prints the stream banner to stderr and exits
 * non-zero only if the file is unreadable, so the parse target is a line like:
 *
 *   Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661),
 *     yuv420p(tv, bt709/bt709/bt709), 1920x1080, 4646 kb/s, 29.97 fps, ...
 *
 * Everything `verifyDelivery` checks is in there except the exact rational —
 * the banner rounds to two decimals, and 2997/100 and 30000/1001 both print as
 * `29.97 fps`. That is precisely the distinction US delivery turns on, so the
 * result is marked inexact rather than reported as if it had been confirmed.
 */
async function probeWithFfmpeg(file: string): Promise<ProbeResult> {
  const bin = await ffmpegPath();

  const banner = await new Promise<string>((resolvePromise, reject) => {
    const proc = spawn(bin, ['-hide_banner', '-i', file, '-f', 'null', '-'], {
      windowsHide: true,
    });
    let err = '';
    proc.stderr.on('data', (c: Buffer) => {
      err += c.toString();
      if (err.length > 256_000) err = err.slice(-128_000);
    });
    proc.on('error', (e) =>
      reject(new EncodeError(`Could not run ffmpeg to inspect ${file}`, e.message, null))
    );
    // A decodable file exits 0; a broken one still prints why, so the banner is
    // worth reading either way.
    proc.on('close', () => resolvePromise(err));
  });

  const videoLine = /^\s*Stream #.*: Video: (.*)$/m.exec(banner)?.[1] ?? '';
  const audioLine = /^\s*Stream #.*: Audio: (.*)$/m.exec(banner)?.[1] ?? '';
  if (!videoLine) {
    throw new EncodeError(`${file} has no readable video stream`, banner.slice(-4000), null);
  }

  const fps = Number(/([\d.]+) fps/.exec(videoLine)?.[1] ?? 0);
  const size = /(\d{2,5})x(\d{2,5})/.exec(videoLine);

  /**
   * Anchored on a known pixel-format token rather than a loose `\w+`.
   *
   * The line reads `h264 (High) (avc1 / 0x31637661), yuv420p(progressive), ...`
   * — a generic word match picks up `High` from the *codec profile* and reports
   * it as the pixel format, which is how a correct file gets flagged as
   * yuv444p. The format names are a closed set, so match the set.
   */
  const pixFmt =
    /\b(yuvj420p|yuv420p10le|yuv420p|yuv422p10le|yuv422p|yuv444p10le|yuv444p|yuv420p12le|nv12|gbrp|rgb24|rgba|bgra|pal8)\b/.exec(
      videoLine
    )?.[1] ?? 'unknown';

  const duration = /Duration: (\d+):(\d+):([\d.]+)/.exec(banner);

  return {
    width: Number(size?.[1] ?? 0),
    height: Number(size?.[2] ?? 0),
    fps,
    // Printed rounded; `frameRateExact: false` says so rather than fabricating
    // a rational the banner does not contain.
    frameRate: String(fps),
    frameRateExact: false,
    duration: duration
      ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
      : 0,
    pixFmt,
    hasAudio: audioLine !== '',
    /**
     * Three fields reported as unverified rather than read, and this is not
     * laziness — ffmpeg's banner genuinely does not print them. `ffmpeg -i`
     * shows the *decoded* pixel format with its chroma location
     * (`yuv420p(progressive)`) and omits the colour tags entirely, whether or
     * not the file is tagged. Determining that a stream carries no
     * `color_primaries` requires `ffprobe -show_streams`, which ffmpeg-static
     * does not ship.
     *
     * So the honest answer is "I could not look", not "unset". Reporting
     * `unset` here would fire a BT.601 warning on every correctly-tagged file
     * rendered on a default install, and a check that cries wolf is worse than
     * one that says what it did not cover.
     */
    colourPrimaries: 'unverified',
    colourTransfer: 'unverified',
    colourMatrix: 'unverified',
    colourRange: 'unverified',
    audioSampleRate: Number(/(\d+) Hz/.exec(audioLine)?.[1] ?? 0),
    audioChannels: /\bstereo\b/.test(audioLine)
      ? 2
      : /\bmono\b/.test(audioLine)
        ? 1
        : Number(/(\d+) channels/.exec(audioLine)?.[1] ?? 0),
    source: 'ffmpeg',
  };
}
