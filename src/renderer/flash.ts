/**
 * Photosensitive-epilepsy flash analysis.
 *
 * Note this is a *different* concern from `hazards.ts`, which despite the name
 * guards determinism — pinning CSS animations and decoding images so two renders
 * agree. Nothing there looks at whether the film is safe to watch.
 *
 * The criteria are common to three documents that were written independently
 * and agree on the numbers:
 *
 * - **ITU-R BT.1702** — guidance for reducing photosensitive-epilepsy risk in
 *   television.
 * - **Ofcom Broadcasting Code §2.12** and its accompanying guidance, which
 *   adopts the Harding criteria for UK broadcast.
 * - **WCAG 2.2 SC 2.3.1** (Three Flashes or Below Threshold, Level A), which
 *   restates the same thresholds for the web.
 *
 * A *flash* is a pair of opposing luminance changes, not a single one: a fade to
 * white is not a flash, white-black-white is two. The change must be at least
 * 10% of full-scale relative luminance, the darker of the two states must be
 * below 0.8, and — the condition that stops a small sparkle from failing a film
 * — the flashing region must cover at least a quarter of the screen.
 *
 * Saturated red is tested separately and more strictly, because it provokes a
 * response at luminance changes that would otherwise sit below threshold.
 *
 * Implementation: ffmpeg box-averages every frame down to a 32x32 grid of RGB
 * and writes it raw to stdout. That gives 1024 cells of exactly 1/1024 of the
 * frame area each — so "25% of the screen" is 256 cells, exactly, at any aspect
 * ratio — and needs no PNG decoder. A 900-frame film is about 2.7MB of pixels.
 */

import { spawn } from 'node:child_process';
import { ffmpegPath } from './encode.js';
import { FLASH } from '../shared/broadcast.js';
import { EncodeError } from './errors.js';

/** Cells per side of the analysis grid. 32x32 = 1024 cells. */
const GRID = 32;
const CELLS = GRID * GRID;
const BYTES_PER_FRAME = CELLS * 3;

export interface FlashViolation {
  /** Frame the failing one-second window starts at. */
  frame: number;
  timeMs: number;
  /** Flashes counted inside that window. */
  count: number;
  kind: 'luminance' | 'red';
}

export interface FlashReport {
  frames: number;
  /** Highest flash count seen in any one-second window. */
  peakLuminanceFlashes: number;
  peakRedFlashes: number;
  violations: FlashViolation[];
  /** True when the film is within BT.1702 / WCAG 2.3.1 limits. */
  pass: boolean;
  /** Present when analysis could not run; the film is then unassessed rather
   *  than passing. */
  skipped?: string;
}

/* ------------------------------------------------------------------ *
 * Pixels
 * ------------------------------------------------------------------ */

/** sRGB channel to linear light. The same curve as `shared/contrast.ts`; kept
 *  separate because this one runs 3 million times and takes bytes, not hex. */
function linear(channel: number): number {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/**
 * Per-frame summary: mean relative luminance of every cell, and whether each
 * cell is saturated red.
 */
interface FrameStats {
  luma: Float32Array;
  red: Uint8Array;
}

function summarise(buf: Buffer): FrameStats {
  const luma = new Float32Array(CELLS);
  const red = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) {
    const r = buf[i * 3]!;
    const g = buf[i * 3 + 1]!;
    const b = buf[i * 3 + 2]!;
    luma[i] = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    // BT.1702's saturated red, in the digital approximation everyone uses:
    // red dominates the sum and is bright enough to matter.
    const sum = r + g + b;
    red[i] = sum > 0 && r / sum >= FLASH.redFraction && r >= FLASH.redMinimum ? 1 : 0;
  }
  return { luma, red };
}

/* ------------------------------------------------------------------ *
 * Analysis
 * ------------------------------------------------------------------ */

/**
 * Count screen-level transitions and pair them into flashes.
 *
 * A cell transitions when its luminance moves by at least the threshold and the
 * darker end is below 0.8. A *screen* transitions when at least a quarter of
 * cells transition the same way on the same frame. Two consecutive screen
 * transitions in opposite directions are one flash.
 */
function analyse(frames: FrameStats[], fps: number): Omit<FlashReport, 'frames' | 'skipped'> {
  const violations: FlashViolation[] = [];
  const required = Math.ceil(CELLS * FLASH.areaFraction);

  // Frame index -> direction of the screen-level transition at that frame.
  const lumaEvents: { frame: number; dir: 1 | -1 }[] = [];
  const redEvents: { frame: number; dir: 1 | -1 }[] = [];

  for (let f = 1; f < frames.length; f++) {
    const prev = frames[f - 1]!;
    const cur = frames[f]!;
    let up = 0;
    let down = 0;
    let redUp = 0;
    let redDown = 0;

    for (let i = 0; i < CELLS; i++) {
      const a = prev.luma[i]!;
      const b = cur.luma[i]!;
      const delta = b - a;
      if (Math.abs(delta) < FLASH.luminanceDelta) continue;
      // The rule does not apply when both states are bright — a change between
      // two near-white images is not a provocative flash.
      if (Math.min(a, b) >= FLASH.darkerBelow) continue;

      if (delta > 0) up++;
      else down++;

      // A red flash is a transition to or from saturated red.
      if (prev.red[i] !== cur.red[i]) {
        if (delta > 0) redUp++;
        else redDown++;
      }
    }

    if (up >= required) lumaEvents.push({ frame: f, dir: 1 });
    else if (down >= required) lumaEvents.push({ frame: f, dir: -1 });

    if (redUp >= required) redEvents.push({ frame: f, dir: 1 });
    else if (redDown >= required) redEvents.push({ frame: f, dir: -1 });
  }

  /** Opposing consecutive transitions make a flash; same-direction ones do not. */
  const toFlashes = (events: { frame: number; dir: 1 | -1 }[]): number[] => {
    const flashes: number[] = [];
    for (let i = 1; i < events.length; i++) {
      if (events[i]!.dir !== events[i - 1]!.dir) flashes.push(events[i]!.frame);
    }
    return flashes;
  };

  const countWindows = (flashes: number[], kind: 'luminance' | 'red'): number => {
    let peak = 0;
    // Sliding one-second window over flash positions.
    for (let i = 0; i < flashes.length; i++) {
      const start = flashes[i]!;
      let count = 0;
      for (let j = i; j < flashes.length && flashes[j]! < start + fps; j++) count++;
      if (count > peak) peak = count;
      if (count > FLASH.maxPerSecond) {
        violations.push({
          frame: start,
          timeMs: Math.round((start / fps) * 1000),
          count,
          kind,
        });
      }
    }
    return peak;
  };

  const peakLuminanceFlashes = countWindows(toFlashes(lumaEvents), 'luminance');
  const peakRedFlashes = countWindows(toFlashes(redEvents), 'red');

  // Report the worst window per contiguous run rather than one per flash.
  const deduped: FlashViolation[] = [];
  for (const v of violations) {
    const last = deduped[deduped.length - 1];
    if (last && last.kind === v.kind && v.frame - last.frame < fps) {
      if (v.count > last.count) deduped[deduped.length - 1] = v;
      continue;
    }
    deduped.push(v);
  }

  return {
    peakLuminanceFlashes,
    peakRedFlashes,
    violations: deduped,
    pass: deduped.length === 0,
  };
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export interface FlashInput {
  /** ffmpeg input arguments — either `['-i', 'film.mp4']` or the PNG-sequence
   *  form, so the check can run before or after encoding. */
  inputArgs: string[];
  fps: number;
}

/**
 * Run the analysis. Never throws for content reasons: a film that fails is a
 * report with `pass: false`, and a film that could not be analysed is a report
 * with `skipped` set — which is deliberately not the same as passing.
 */
export async function analyseFlashes(input: FlashInput): Promise<FlashReport> {
  let bin: string;
  try {
    bin = await ffmpegPath();
  } catch (err) {
    return {
      frames: 0,
      peakLuminanceFlashes: 0,
      peakRedFlashes: 0,
      violations: [],
      pass: false,
      skipped: err instanceof EncodeError ? err.message : String(err),
    };
  }

  const args = [
    '-hide_banner',
    '-nostats',
    '-v',
    'error',
    ...input.inputArgs,
    // Box-average, not sample: a one-pixel-wide strobe must still register in
    // the cell mean rather than being missed between sample points.
    '-vf',
    `scale=${GRID}:${GRID}:flags=area`,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    '-',
  ];

  const chunks: Buffer[] = [];
  const failure = await new Promise<string | null>((done) => {
    const proc = spawn(bin, args, { windowsHide: true });
    let err = '';
    proc.stdout.on('data', (c: Buffer) => chunks.push(c));
    proc.stderr.on('data', (c: Buffer) => {
      err += c.toString();
      if (err.length > 16_000) err = err.slice(-8_000);
    });
    proc.on('error', (e) => done(e.message));
    proc.on('close', (code) => done(code === 0 ? null : err || `ffmpeg exited ${code}`));
  });

  if (failure) {
    return {
      frames: 0,
      peakLuminanceFlashes: 0,
      peakRedFlashes: 0,
      violations: [],
      pass: false,
      skipped: `flash analysis could not run: ${failure}`,
    };
  }

  const raw = Buffer.concat(chunks);
  const total = Math.floor(raw.length / BYTES_PER_FRAME);
  if (total < 2) {
    return {
      frames: total,
      peakLuminanceFlashes: 0,
      peakRedFlashes: 0,
      violations: [],
      pass: true,
    };
  }

  const frames: FrameStats[] = [];
  for (let f = 0; f < total; f++) {
    frames.push(summarise(raw.subarray(f * BYTES_PER_FRAME, (f + 1) * BYTES_PER_FRAME)));
  }

  return { frames: total, ...analyse(frames, input.fps) };
}

/** Human-readable summary for the CLI. */
export function describeFlashReport(report: FlashReport): string[] {
  if (report.skipped) return [`flash safety: not assessed — ${report.skipped}`];
  if (report.pass) {
    return [
      `flash safety: pass (peak ${report.peakLuminanceFlashes} luminance / ` +
        `${report.peakRedFlashes} red flashes per second, limit ${FLASH.maxPerSecond})`,
    ];
  }
  return [
    `flash safety: FAIL — ${report.violations.length} window(s) over ` +
      `${FLASH.maxPerSecond} flashes/second (ITU-R BT.1702, Ofcom §2.12, WCAG 2.3.1)`,
    ...report.violations
      .slice(0, 5)
      .map(
        (v) =>
          `  ${(v.timeMs / 1000).toFixed(2)}s: ${v.count} ${v.kind} flashes in one second`
      ),
  ];
}
