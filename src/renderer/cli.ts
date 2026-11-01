#!/usr/bin/env node
/**
 * `urlume render` — the render stage, runnable alone.
 *
 * The stage that §23.1 says exercised the whole capture pipeline on a hand-written
 * storyboard before any AI code existed. It takes a compiled film and produces an
 * MP4, and it reads the result back with ffprobe rather than trusting the encode —
 * a file that exists is not a file that plays.
 *
 *   tsx src/renderer/cli.ts examples/demo-film/index.html --out out/demo.mp4
 *   tsx src/renderer/cli.ts film/index.html --out beat.mp4 --from 120 --to 240
 */

import { mkdir } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';

import { Command } from 'commander';

import { render, type RenderEvent } from './index.js';
import { probe } from './encode.js';
import { RenderError, redact } from './errors.js';

interface Options {
  out: string;
  from?: string;
  to?: string;
  fps?: string;
  scale?: string;
  quality: 'draft' | 'high' | 'master';
  audio: boolean;
  keepFrames?: boolean;
  verify: boolean;
}

/** Seconds, to one decimal — for a duration a person reads, not a timestamp. */
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

function onEvent(started: number): (e: RenderEvent) => void {
  let lastDrawn = 0;

  return (e) => {
    switch (e.type) {
      case 'launch':
        console.log('Launching Chromium...');
        break;

      case 'ready':
        console.log(
          `Film ready: ${e.film.width}x${e.film.height}, ` +
            `${e.film.frames} frames at ${e.film.fps}fps (${secs(e.film.duration)})`
        );
        break;

      case 'frame': {
        // Throttled: one line per 250ms, not one per frame. A 900-frame render
        // would otherwise emit 900 lines into a log nobody can read.
        const now = Date.now();
        if (now - lastDrawn < 250 && e.frame !== e.total) break;
        lastDrawn = now;
        const pct = Math.round((e.frame / e.total) * 100);
        const rate = e.frame / Math.max(1, (now - started) / 1000);
        const eta = (e.total - e.frame) / Math.max(0.01, rate);
        process.stdout.write(
          `\r  ${String(pct).padStart(3)}%  frame ${e.frame}/${e.total}  ` +
            `${rate.toFixed(1)} fps  eta ${secs(eta * 1000)}   `
        );
        if (e.frame === e.total) process.stdout.write('\n');
        break;
      }

      case 'audio':
        console.log('Rendered the procedural soundtrack.');
        break;

      case 'encode':
        console.log('Encoding with ffmpeg...');
        break;

      case 'warn':
        console.warn(`  warning: ${redact(e.message)}`);
        break;

      case 'done':
        console.log(`\nWrote ${relative(process.cwd(), e.output)} in ${secs(e.ms)}`);
        break;
    }
  };
}

async function main(): Promise<void> {
  const program = new Command()
    .name('urlume-render')
    .description("Render a compiled film's frames to an MP4")
    .argument('<film>', "path to the film's index.html")
    .requiredOption('--out <file>', 'MP4 output path')
    .option('--from <frame>', 'inclusive start frame')
    .option('--to <frame>', 'exclusive end frame')
    .option('--fps <n>', "override the film's own fps")
    .option('--scale <n>', 'device scale factor (2 for a retina master)')
    .option('--quality <q>', 'draft | high | master', 'high')
    .option('--no-audio', 'silent MP4')
    .option('--keep-frames', 'keep the PNG sequence, to inspect a bad frame')
    .option('--no-verify', 'skip the ffprobe read-back')
    .parse();

  const film = resolve(program.args[0]!);
  const opts = program.opts<Options>();
  const output = resolve(opts.out);

  if (!['draft', 'high', 'master'].includes(opts.quality)) {
    console.error(`--quality must be draft, high or master (got "${opts.quality}")`);
    process.exit(1);
  }

  await mkdir(dirname(output), { recursive: true });

  // Cancellation has to reach the frame loop, or ctrl-c leaves a Chromium behind.
  const controller = new AbortController();
  process.once('SIGINT', () => {
    console.log('\nCancelling...');
    controller.abort();
  });

  const started = Date.now();

  // Built by spread rather than by assigning undefined: exactOptionalPropertyTypes
  // makes `{ from: undefined }` a different thing from an absent `from`.
  await render({
    film,
    output,
    quality: opts.quality,
    audio: opts.audio,
    onEvent: onEvent(started),
    signal: controller.signal,
    ...(opts.from !== undefined ? { from: Number(opts.from) } : {}),
    ...(opts.to !== undefined ? { to: Number(opts.to) } : {}),
    ...(opts.fps !== undefined ? { fps: Number(opts.fps) } : {}),
    ...(opts.scale !== undefined ? { scale: Number(opts.scale) } : {}),
    ...(opts.keepFrames ? { keepFrames: true } : {}),
  });

  if (!opts.verify) return;

  // Read back what was actually written. An MP4 can exist, be the right size, and
  // still carry a chroma format Safari refuses to show.
  try {
    const info = await probe(output);
    console.log(
      `Verified: ${info.width}x${info.height}, ${info.fps.toFixed(2)}fps, ` +
        `${info.duration.toFixed(2)}s, ${info.pixFmt}` +
        `${info.hasAudio ? ', with audio' : ', silent'}`
    );
    if (info.pixFmt !== 'yuv420p') {
      console.warn(
        `  warning: ${info.pixFmt} is not universally decodable; Safari and ` +
          `QuickTime show no video for yuv444p.`
      );
    }
  } catch (err) {
    // ffmpeg-static ships ffmpeg alone, so this is an expected miss rather than a
    // failed render. The MP4 is already written.
    console.warn(
      `  could not verify with ffprobe: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

main().catch((err: unknown) => {
  if (err instanceof RenderError) {
    console.error(`\n${redact(err.format())}\n`);
  } else {
    console.error(`\nrender failed: ${redact(err instanceof Error ? err.message : String(err))}\n`);
  }
  process.exit(1);
});
