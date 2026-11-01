/**
 * The render harness.
 *
 * The engine's half of this contract is fixed and documented; this is the other
 * half. A compiled film publishes `window.__EXPLAINER__`, and because every
 * visual is a pure function of `t`, rendering is not a recording — it is a loop
 * of `seek(frame)` followed by a screenshot. Nothing accumulates, so nothing
 * drifts, and frame ranges are independent.
 *
 *   file://film/index.html?render=1
 *     -> wait for __EXPLAINER__.ready   (gated on document.fonts.ready)
 *     -> resize viewport to the film's native size
 *     -> strip everything outside .stage
 *     -> for f in [from, to): seekFrame(f), captureScreenshot -> PNG
 *     -> renderAudio() -> base64 WAV -> disk
 *     -> ffmpeg(PNG sequence + WAV) -> MP4
 */

import { mkdir, writeFile, rm, readFile, copyFile } from 'node:fs/promises';
import { join, resolve, dirname, basename, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Browser, Page } from 'playwright-core';

import { installNameShim } from '../browser/shim.js';
import { applyHazardGuards, verifyFonts } from './hazards.js';
import { encode, probe, type EncodeOptions } from './encode.js';
import { analyseFlashes, type FlashReport } from './flash.js';
import { checkSafeAreas, describeSafeArea } from './safe-area.js';
import {
  exactFps,
  checkLoudness,
  verifyDelivery,
  type AchievedLoudness,
  type ConformanceNote,
  type DeliveryProfile,
} from '../shared/broadcast.js';
import { RenderError } from './errors.js';

/** Shape the engine publishes. Mirrored here so the harness type-checks against
 *  the contract rather than against `any`. */
export interface ExplainerHandle {
  version: number;
  ready: boolean;
  duration: number;
  fps: number;
  width: number;
  height: number;
  frames: number;
  cues: unknown[];
}

export type RenderEvent =
  | { type: 'launch' }
  | { type: 'ready'; film: ExplainerHandle }
  | { type: 'frame'; frame: number; total: number; scene?: string }
  | { type: 'audio'; bytes: number }
  | { type: 'encode'; stage: string }
  | { type: 'flash'; report: FlashReport }
  /** Text measured outside the profile's safe box, before any frame is
   *  captured. Empty reports are not emitted. */
  | { type: 'safe-area'; profile: DeliveryProfile; notes: ConformanceNote[] }
  /** What the encoded file actually is, read back and checked against the
   *  delivery profile. `source` says which tool could be used, because ffmpeg's
   *  banner cannot confirm an exact NTSC rational. */
  | {
      type: 'verified';
      profile: DeliveryProfile;
      notes: ConformanceNote[];
      summary: string;
      source: 'ffprobe' | 'ffmpeg';
      /** What normalisation achieved. Absent when the film is silent or the
       *  measurement could not be read — never a substitute for "fine". */
      loudness?: AchievedLoudness;
    }
  | { type: 'done'; output: string; frames: number; ms: number }
  | { type: 'warn'; message: string };

export interface RenderOptions {
  /** Path to the film's index.html. */
  film: string;
  output: string;
  /** Inclusive start frame. Defaults to 0. */
  from?: number;
  /** Exclusive end frame. Defaults to the film's frame count. */
  to?: number;
  /**
   * Re-time the capture to this rate.
   *
   * This genuinely re-times: frame `f` is sampled at `f / fps` seconds of film
   * time, and the frame count is recomputed. Passing it used to relabel the
   * encode only, so `--fps 60` on a 30fps film produced 900 frames of 33ms
   * spacing played at 60 — a film at double speed, with the audio cut in half
   * by `-shortest`.
   */
  fps?: number;
  scale?: number;
  audio?: boolean;
  /** Keep the PNG sequence after encoding, for debugging a bad frame. */
  keepFrames?: boolean;
  quality?: EncodeOptions['quality'];
  /** Delivery target — decides loudness normalisation and GOP structure. */
  profile?: DeliveryProfile;
  /** Burn the film's captions into the picture rather than only writing a
   *  sidecar. Social feeds need this; broadcast wants the sidecar. */
  burnCaptions?: boolean;
  /** Run the photosensitivity check on the encoded file. On by default. */
  checkFlashes?: boolean;
  /** Read the encoded file back and check it against the delivery profile.
   *  On by default; costs one ffmpeg invocation. */
  verify?: boolean;
  onEvent?: (e: RenderEvent) => void;
  signal?: AbortSignal;
}

const noop = () => {};

/**
 * `__EXPLAINER__.ready` flips only after `document.fonts.ready` resolves, so
 * polling it is the correct gate for *timing*. It is not sufficient for
 * *correctness* — see verifyFonts, which catches the case where loading
 * finished by failing.
 */
async function waitForReady(page: Page, timeoutMs = 30_000): Promise<ExplainerHandle> {
  try {
    await page.waitForFunction(
      () => {
        const w = window as unknown as { __EXPLAINER__?: { ready?: boolean } };
        return w.__EXPLAINER__?.ready === true;
      },
      undefined,
      { timeout: timeoutMs }
    );
  } catch {
    const present = await page.evaluate(
      () => typeof (window as unknown as { __EXPLAINER__?: unknown }).__EXPLAINER__
    );
    throw new RenderError(
      present === 'undefined'
        ? 'The film never published `window.__EXPLAINER__`.'
        : 'The film published `__EXPLAINER__` but `ready` never became true.',
      present === 'undefined'
        ? [
            'The most common cause is script order. `timeline.js` must load in this order:',
            '  1. assets/sfx.js',
            '  2. assets/timeline.js   (the engine)',
            '  3. timeline.js          (the film)',
            'Check the browser console by re-running with --headed.',
          ]
        : [
            '`ready` is gated on `document.fonts.ready`. A webfont that never resolves',
            'will hang it. Self-host the woff2 next to the film rather than fetching it.',
          ]
    );
  }

  return page.evaluate(() => {
    const e = (window as unknown as { __EXPLAINER__: ExplainerHandle }).__EXPLAINER__;
    return {
      version: e.version,
      ready: e.ready,
      duration: e.duration,
      fps: e.fps,
      width: e.width,
      height: e.height,
      frames: e.frames,
      cues: e.cues,
    };
  }) as Promise<ExplainerHandle>;
}

/**
 * Remove preview chrome.
 *
 * The engine hides `.preview-ui` in render mode, but a film that builds its own
 * control bar without that class would still export it. Removing everything
 * outside `.stage` structurally is the guarantee that does not depend on a film
 * having remembered a class name.
 */
async function stripChrome(page: Page): Promise<void> {
  await page.evaluate(() => {
    const stage = document.querySelector('.stage');
    if (!stage) return;
    for (const node of Array.from(document.body.children)) {
      // Keep the ancestor chain of .stage and the inline SVG filter defs, which
      // backdrop-filter: url(#lens) resolves against in this same document.
      if (node.contains(stage)) continue;
      if (node.tagName === 'SVG' && node.querySelector('filter')) continue;
      node.remove();
    }
  });
}

/** Pull the procedurally-rendered soundtrack across CDP as base64. */
async function renderAudio(page: Page, dir: string): Promise<string | null> {
  const base64 = await page.evaluate(async () => {
    const e = (window as unknown as {
      __EXPLAINER__: { renderAudio(rate?: number): Promise<string | null> };
    }).__EXPLAINER__;
    if (typeof e.renderAudio !== 'function') return null;
    return e.renderAudio(48_000);
  });
  if (!base64) return null;

  const path = join(dir, 'audio.wav');
  await writeFile(path, Buffer.from(base64, 'base64'));
  return path;
}

export async function render(opts: RenderOptions): Promise<string> {
  const emit = opts.onEvent ?? noop;
  const started = Date.now();
  const filmPath = resolve(opts.film);
  const output = resolve(opts.output);
  const workDir = join(dirname(output), `.urlume-frames-${process.pid}`);

  // playwright-core carries no browsers; the full `playwright` package (a
  // devDependency) does. Importing lazily keeps the CLI's cold start off it.
  const { chromium } = await import('playwright-core');

  let browser: Browser | undefined;
  try {
    emit({ type: 'launch' });
    browser = await chromium.launch({
      args: [
        '--hide-scrollbars',
        '--force-color-profile=srgb',
        '--disable-lcd-text', // subpixel AA differs between machines
        '--font-render-hinting=none',
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: opts.scale ?? 1,
      // Headless can report `reduce`, and the film's CSS neutralises .camera
      // when it does — every push-in would silently vanish from the export.
      reducedMotion: 'no-preference',
      // Deliberately no `colorScheme`. Forcing `dark` here made every film dark
      // regardless of the brand: a light-scheme site got a light preset from the
      // compiler and then rendered against a dark `prefers-color-scheme`, so any
      // `@media` branch in the stylesheet took the wrong side. The film declares
      // its own theme through `data-preset` and the brand tokens, and the browser
      // should have no opinion.
    });

    const page = await context.newPage();

    // See browser/shim.ts. Without it, any evaluate callback holding a named inner
    // function dies with `__name is not defined` — first hit here by verifyFonts'
    // `const probe = ...`.
    await installNameShim(page);
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    const url = `${pathToFileURL(filmPath).href}?render=1`;
    await page.goto(url, { waitUntil: 'load' });

    const film = await waitForReady(page);
    emit({ type: 'ready', film });

    if (film.version !== 1) {
      emit({
        type: 'warn',
        message: `film reports engine contract v${film.version}; this renderer implements v1`,
      });
    }

    // Rasterise at native size rather than upscaling a smaller frame.
    await page.setViewportSize({ width: film.width, height: film.height });

    for (const warning of await verifyFonts(page)) {
      emit({ type: 'warn', message: warning });
    }
    await applyHazardGuards(page);
    await stripChrome(page);

    /* ---- Cadence ---------------------------------------------------- *
     * `--fps` re-times the capture rather than relabelling it.
     *
     * It used to reach `encode()` alone while the loop still seeked at the
     * film's own rate, so `--fps 60` on a 30fps film captured 900 frames at
     * 33ms spacing and played them at 60 — the film at double speed, with
     * `-shortest` cutting the audio at its halfway point. Sampling by absolute
     * time instead makes the override mean what it says.
     */
    const fps = opts.fps ?? film.fps;
    const retimed = fps !== film.fps;
    const rate = exactFps(fps);
    const totalFrames = retimed
      ? Math.round((film.duration / 1000) * rate)
      : film.frames;

    if (retimed) {
      emit({
        type: 'warn',
        message:
          `re-timing capture from ${film.fps}fps to ${fps}fps: ` +
          `${totalFrames} frames instead of ${film.frames}`,
      });
    }

    const from = Math.max(0, opts.from ?? 0);
    const to = Math.min(totalFrames, opts.to ?? totalFrames);
    if (to <= from) {
      throw new RenderError(`Empty frame range [${from}, ${to}).`, [
        `The film is ${totalFrames} frames at ${fps}fps.`,
      ]);
    }

    /* ---- Safe areas -------------------------------------------------- *
     * Measured here — after the hazard guards have settled the page and
     * before a single frame is captured — because it is the cheapest check
     * that can fail a delivery: sixteen seeks and no screenshots.
     *
     * Skipped for `web`, where nothing crops the frame and a margin rule
     * would be an aesthetic opinion rather than a standard.
     */
    if (opts.profile && opts.profile !== 'web') {
      const report = await checkSafeAreas({
        page,
        profile: opts.profile,
        width: film.width,
        height: film.height,
        durationMs: film.duration,
      });
      const notes = describeSafeArea(report, opts.profile);
      if (notes.length) emit({ type: 'safe-area', profile: opts.profile, notes });
    }

    await mkdir(workDir, { recursive: true });

    // A raw CDP session skips a layer of Playwright's screenshot plumbing, which
    // matters when it runs once per frame.
    const cdp = await context.newCDPSession(page);

    for (let f = from; f < to; f++) {
      if (opts.signal?.aborted) throw new RenderError('Render cancelled.', []);

      // Seek by absolute time, computed from the exact rational rate. At 29.97
      // the decimal would drift a frame every seventeen minutes; the engine
      // recomputes `t` from `f` each time, so nothing accumulates either way.
      await page.evaluate(
        ({ frame, hz }) => {
          (window as unknown as {
            __EXPLAINER__: { seek(ms: number): number };
          }).__EXPLAINER__.seek((frame * 1000) / hz);
        },
        { frame: f, hz: rate }
      );

      const shot = (await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
        fromSurface: true,
      })) as { data: string };

      await writeFile(
        join(workDir, `${String(f).padStart(6, '0')}.png`),
        Buffer.from(shot.data, 'base64')
      );
      emit({ type: 'frame', frame: f - from + 1, total: to - from });
    }

    let audioPath: string | null = null;
    if (opts.audio !== false) {
      audioPath = await renderAudio(page, workDir);
      if (audioPath) emit({ type: 'audio', bytes: 0 });
    }

    if (consoleErrors.length) {
      emit({
        type: 'warn',
        message: `${consoleErrors.length} console error(s) during render; first: ${consoleErrors[0]}`,
      });
    }

    await browser.close();
    browser = undefined;

    /* ---- Captions --------------------------------------------------- *
     * The compiler writes `captions.vtt` and `captions.srt` beside the film,
     * because it is the stage that holds the storyboard. The renderer's job is
     * to carry the sidecar to wherever the MP4 lands — a caption file that
     * stays in a build directory helps nobody — and to burn it in when asked.
     */
    const filmDir = dirname(filmPath);
    const vttSource = join(filmDir, 'captions.vtt');
    const srtSource = join(filmDir, 'captions.srt');

    let burn: string | null = null;
    if (opts.burnCaptions) {
      burn = await readFile(srtSource, 'utf8').then(
        () => srtSource,
        () => {
          emit({
            type: 'warn',
            message: 'no captions.srt beside the film; nothing to burn in',
          });
          return null;
        }
      );
    }

    emit({ type: 'encode', stage: 'encoding' });
    const encoded = await encode({
      framesDir: workDir,
      pattern: '%06d.png',
      startNumber: from,
      audio: audioPath,
      output,
      fps,
      width: film.width,
      height: film.height,
      quality: opts.quality ?? 'high',
      ...(opts.profile !== undefined ? { profile: opts.profile } : {}),
      ...(burn ? { burnCaptions: burn } : {}),
    });

    // Sidecar next to the MP4, named to match it, which is what every player
    // and every platform uploader looks for.
    const stem = basename(output, extname(output));
    await copyFile(vttSource, join(dirname(output), `${stem}.vtt`)).catch(() => {});
    await copyFile(srtSource, join(dirname(output), `${stem}.srt`)).catch(() => {});

    if (!opts.keepFrames) await rm(workDir, { recursive: true, force: true });

    /* ---- Delivery verification -------------------------------------- *
     * `conformance()` checked intent before the browser opened; this checks
     * outcome. Both are needed, and this codebase has paid twice for the gap
     * between them: an encoder can be invoked with every correct flag and
     * still write an untagged file, and a delivery profile that never reached
     * `encode()` produces a technically perfect master at the wrong loudness.
     * Nothing in the picture reveals either one.
     *
     * Reported, never thrown — the MP4 is already written, and a caller that
     * wants a hard gate has the notes to apply one.
     */
    if (opts.verify !== false) {
      const profile = opts.profile ?? 'web';
      /**
       * Loudness comes from the encoder rather than from a container read: an
       * integrated LUFS figure cannot be recovered from a finished MP4 without
       * decoding it again. It is the first number a broadcaster checks, and
       * until now `measureLoudness` computed it for pass two and dropped it.
       */
      const loudnessNotes = encoded.loudness
        ? checkLoudness(encoded.loudness, profile)
        : audioPath
          ? [
              {
                area: 'loudness' as const,
                severity: (profile.startsWith('broadcast') ? 'warning' : 'info') as
                  | 'warning'
                  | 'info',
                message:
                  'Loudness was not measured, so the programme level is unverified. ' +
                  'The track is present but normalisation could not be read back.',
                standard: 'EBU R128 / ATSC A/85',
              },
            ]
          : [];

      try {
        const info = await probe(output);
        emit({
          type: 'verified',
          profile,
          source: info.source,
          summary:
            `${info.width}x${info.height}, ${info.fps.toFixed(2)}fps, ` +
            `${info.duration.toFixed(2)}s, ${info.pixFmt}` +
            `${info.hasAudio ? `, ${info.audioChannels}ch @ ${info.audioSampleRate}Hz` : ', silent'}` +
            `${encoded.loudness ? `, ${encoded.loudness.integrated.toFixed(1)} LUFS` : ''}`,
          notes: [...verifyDelivery(info, profile, fps), ...loudnessNotes],
          ...(encoded.loudness ? { loudness: encoded.loudness } : {}),
        });
      } catch (err) {
        // The container read failed, but the loudness figure came from the
        // encoder and is still worth reporting — it does not depend on ffprobe.
        emit({
          type: 'warn',
          message: `could not read the encoded file back: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
        if (loudnessNotes.length || encoded.loudness) {
          emit({
            type: 'verified',
            profile,
            source: 'ffmpeg',
            summary: encoded.loudness
              ? `${encoded.loudness.integrated.toFixed(1)} LUFS (picture unverified)`
              : 'picture and loudness unverified',
            notes: loudnessNotes,
            ...(encoded.loudness ? { loudness: encoded.loudness } : {}),
          });
        }
      }
    }

    /* ---- Photosensitivity ------------------------------------------- *
     * Run on the encoded file rather than the PNGs, so what is assessed is
     * what actually ships. A failure is reported, not thrown: the caller
     * decides whether an unsafe film blocks, and a report the user never sees
     * is worse than one they can act on.
     */
    if (opts.checkFlashes !== false) {
      const report = await analyseFlashes({ inputArgs: ['-i', output], fps });
      emit({ type: 'flash', report });
    }

    emit({
      type: 'done',
      output,
      frames: to - from,
      ms: Date.now() - started,
    });
    return output;
  } finally {
    await browser?.close().catch(() => {});
  }
}
