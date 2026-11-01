/**
 * The pipeline: URL + prompt -> MP4.
 *
 * The §55.2 milestone diagram, as one function. Every stage writes its output to
 * `.urlume/` so any stage can be re-run alone (§23.1) — which is both a debugging
 * property and the reason `urlume render` could be built before any of this existed.
 *
 *   analyse (crawl + rank + brand)   [cached]
 *     -> storyboard   (AI; validated, repaired, re-asked)
 *     -> compile      (deterministic; no AI below this line)
 *     -> render       (seek + screenshot + ffmpeg)
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSkills } from './skills/library.js';
import { analyzeRoutes, type RouteAnalysis } from './browser/analyze.js';
import { crawlRoutes } from './browser/crawl.js';
import { generateStoryboard, type GenerateEvent } from './storyboard/generate.js';
import { ASPECT_DIMENSIONS, type Aspect, type Storyboard } from './storyboard/schema.js';
import { compile } from './compiler/index.js';
import { render, type RenderEvent } from './renderer/index.js';
import { resolveProvider } from './providers/index.js';
import { conformance, type ConformanceNote, type DeliveryProfile } from './shared/broadcast.js';
import type { Violation } from './storyboard/craft-rules.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

export type PipelineEvent =
  | { type: 'stage'; name: string; detail?: string }
  | { type: 'provider'; provider: string; model: string; origin: 'env' | 'file' }
  | { type: 'routes'; routes: string[]; skipped: number }
  | { type: 'analysed'; route: string; elements: number }
  | { type: 'generate'; event: GenerateEvent }
  | { type: 'storyboard'; storyboard: Storyboard; warnings: Violation[] }
  | { type: 'compiled'; outDir: string; files: number; notes: string[] }
  | { type: 'conformance'; profile: string; notes: ConformanceNote[] }
  | { type: 'render'; event: RenderEvent }
  | { type: 'done'; output: string };

export interface PipelineOptions {
  /** A URL for remote mode (§43). Local project mode is not wired yet. */
  url: string;
  prompt?: string | undefined;
  /** Where `.urlume/` lives. Defaults to the cwd. */
  workDir?: string | undefined;
  output?: string | undefined;
  durationMs?: number | undefined;
  aspect?: Aspect | undefined;
  preset?: string | undefined;
  /** Where the film is going. Decides cadence and loudness, and is reported
   *  against by `conformance()` before a frame is rendered. Defaults to `web`. */
  delivery?: DeliveryProfile | undefined;
  /** Overrides the delivery profile's native cadence. */
  fps?: number | undefined;
  /** Burn captions into the picture. Defaults to on for `social`, where most
   *  players never show a sidecar, and off otherwise. */
  burnCaptions?: boolean | undefined;
  /** Treat a conformance error as fatal rather than advisory. A 30fps film
   *  bound for a UK broadcaster is not a master, and `--quality master` on one
   *  is a slow way to produce something that fails QC. */
  strict?: boolean | undefined;
  /** Render despite conformance errors. The escape hatch from `strict`. */
  force?: boolean | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  /** Routes to analyse. Skips the crawl when supplied. */
  routes?: readonly string[] | undefined;
  /** Reuse a cached analysis rather than re-driving the browser. */
  cache?: boolean | undefined;
  /** Stop after the storyboard — for review before spending render time. */
  stopAfterStoryboard?: boolean | undefined;
  quality?: 'draft' | 'high' | 'master' | undefined;
  from?: number | undefined;
  to?: number | undefined;
  audio?: boolean | undefined;
  signal?: AbortSignal | undefined;
  onEvent?: ((e: PipelineEvent) => void) | undefined;
}

export interface PipelineResult {
  storyboard: Storyboard;
  warnings: Violation[];
  filmDir: string;
  output: string | null;
}

interface Paths {
  root: string;
  analysis: string;
  storyboard: string;
  film: string;
  renders: string;
}

function paths(workDir: string): Paths {
  const root = join(workDir, '.urlume');
  return {
    root,
    analysis: join(root, 'captures', 'analysis.json'),
    storyboard: join(root, 'storyboard', 'main.json'),
    film: join(root, 'film'),
    renders: join(root, 'renders'),
  };
}

/**
 * Analysis is cached because it is the slowest stage that does not change: a crawl
 * plus a browser pass over several routes costs far more than a re-generation, and
 * the site does not move between two runs a minute apart.
 *
 * Screenshots are dropped from the cached copy. They are base64 PNGs at 1440x900 —
 * megabytes each — and nothing downstream of generation reads them yet (the vision
 * re-rank that would is not built).
 */
async function loadCachedAnalysis(path: string): Promise<RouteAnalysis[] | null> {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as RouteAnalysis[];
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch {
    return null;
  }
}

export async function runPipeline(opts: PipelineOptions): Promise<PipelineResult> {
  const emit = opts.onEvent ?? (() => {});
  const workDir = resolve(opts.workDir ?? process.cwd());
  const p = paths(workDir);

  // §43.3: a URL is passed deliberately, and is validated before a browser starts.
  let target: URL;
  try {
    target = new URL(opts.url);
  } catch {
    throw new Error(`Not a valid URL: ${opts.url}`);
  }
  if (!/^https?:$/.test(target.protocol)) {
    throw new Error(`Only http and https are supported (got ${target.protocol}).`);
  }

  // Provider first. Failing here costs nothing, whereas discovering a missing key
  // after a two-minute analysis is the worst possible ordering.
  emit({ type: 'stage', name: 'provider' });
  const { provider, model, origin } = await resolveProvider({
    ...(opts.provider !== undefined ? { provider: opts.provider } : {}),
    ...(opts.model !== undefined ? { model: opts.model } : {}),
  });
  emit({ type: 'provider', provider: provider.id, model, origin });

  const skills = await loadSkills({ packagedDir: join(ROOT, 'Skills') });

  /* ---------------- analyse ---------------- */

  let analysis: RouteAnalysis[] | null = opts.cache === false ? null : await loadCachedAnalysis(p.analysis);

  if (analysis) {
    emit({ type: 'stage', name: 'analyse', detail: 'using cached analysis' });
  } else {
    let routes: string[];
    if (opts.routes?.length) {
      routes = [...opts.routes];
    } else {
      emit({ type: 'stage', name: 'crawl', detail: target.origin });
      const crawl = await crawlRoutes({
        url: target.href,
        maxRoutes: 8,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      routes = crawl.routes;
      emit({ type: 'routes', routes, skipped: crawl.skipped.length });
    }

    // A crawl that finds nothing still has the page the user named.
    if (!routes.length) routes = [target.pathname || '/'];
    // Analysing eight pages to film three beats is wasted time; the first few
    // ranked routes carry the marketing story.
    routes = routes.slice(0, 4);

    emit({ type: 'stage', name: 'analyse', detail: `${routes.length} route(s)` });
    analysis = await analyzeRoutes(target.origin, routes, (route) => {
      emit({ type: 'stage', name: 'analyse', detail: route });
    });

    for (const route of analysis) {
      emit({ type: 'analysed', route: route.route, elements: route.elements.length });
    }

    await mkdir(dirname(p.analysis), { recursive: true });
    await writeFile(
      p.analysis,
      // Screenshots stripped: see loadCachedAnalysis.
      JSON.stringify(analysis.map((a) => ({ ...a, screenshot: '' })), null, 2),
      'utf8'
    );
  }

  /* ---------------- storyboard ---------------- */

  emit({ type: 'stage', name: 'storyboard' });
  const generated = await generateStoryboard({
    provider,
    model,
    skills,
    analysis,
    ...(opts.prompt !== undefined ? { prompt: opts.prompt } : {}),
    ...(opts.durationMs !== undefined ? { durationMs: opts.durationMs } : {}),
    ...(opts.aspect !== undefined ? { aspect: opts.aspect } : {}),
    ...(opts.preset !== undefined ? { preset: opts.preset } : {}),
    ...(opts.delivery !== undefined ? { delivery: opts.delivery } : {}),
    ...(opts.fps !== undefined ? { fps: opts.fps } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
    onEvent: (event) => emit({ type: 'generate', event }),
  });

  await mkdir(dirname(p.storyboard), { recursive: true });
  await writeFile(p.storyboard, JSON.stringify(generated.storyboard, null, 2), 'utf8');
  emit({
    type: 'storyboard',
    storyboard: generated.storyboard,
    warnings: generated.warnings,
  });

  /* ---------------- compile ---------------- */

  emit({ type: 'stage', name: 'compile' });
  const compiled = await compile({
    storyboard: generated.storyboard,
    outDir: p.film,
    runtimeDir: join(ROOT, 'runtime'),
    controls: true,
  });
  emit({
    type: 'compiled',
    outDir: p.film,
    files: compiled.files.length,
    notes: compiled.notes,
  });

  /* ---------------- conformance ---------------- */

  /**
   * Declared properties against the delivery profile, before a browser opens.
   * The expensive mismatches — a 30fps film bound for a UK broadcaster, a
   * silent programme, a landscape cut going to a vertical feed — are all
   * knowable here, and all cost nine hundred rendered frames to discover
   * afterwards.
   *
   * Reported, never thrown. Whether a warning blocks delivery is the caller's
   * call, and §60's own evidence is that a check nobody sees is not a check.
   */
  const sb = generated.storyboard;
  const notes = conformance({
    profile: sb.delivery,
    fps: sb.fps,
    width: sb.resolution.width,
    height: sb.resolution.height,
    // Intent, not outcome: the encoded track is probed after the fact, but a
    // film that never asked for audio cannot grow one at encode time.
    hasAudio: opts.audio !== false && sb.audio.enabled,
    hasCaptions: compiled.files.some((f) => f.endsWith('.vtt')),
  });
  emit({ type: 'conformance', profile: sb.delivery, notes });

  /**
   * A conformance **error** means the master is unusable for what it was
   * declared to be — a 25fps film is not a US broadcast deliverable, and a
   * silent programme is not a UK one. Rendering nine hundred frames to produce
   * one is worse than stopping, so an error stops unless the caller says
   * otherwise.
   *
   * Scoped to errors on purpose. Warnings are advice — a landscape cut going to
   * a feed still has a right to be rendered — and blocking on them would make
   * `--strict` unusable in practice.
   */
  const errors = notes.filter((n) => n.severity === 'error');
  if (errors.length && opts.strict && !opts.force) {
    throw new Error(
      `This film does not conform to ${sb.delivery}: ${errors.length} error(s).\n` +
        errors.map((n) => `  - ${n.message}`).join('\n') +
        `\n\nFix the storyboard, or render it anyway with --force.\n`
    );
  }

  if (opts.stopAfterStoryboard) {
    return {
      storyboard: generated.storyboard,
      warnings: generated.warnings,
      filmDir: p.film,
      output: null,
    };
  }

  /* ---------------- render ---------------- */

  const slug = generated.storyboard.product
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'film';
  const output = resolve(opts.output ?? join(p.renders, `${slug}.mp4`));
  await mkdir(dirname(output), { recursive: true });

  emit({ type: 'stage', name: 'render' });
  await render({
    film: join(p.film, 'index.html'),
    output,
    quality: opts.quality ?? 'high',
    ...(opts.audio !== undefined ? { audio: opts.audio } : {}),
    ...(opts.from !== undefined ? { from: opts.from } : {}),
    ...(opts.to !== undefined ? { to: opts.to } : {}),
    /**
     * The storyboard's declared delivery target, carried through to the
     * encoder.
     *
     * This is the whole point of §60's compliance layer and it was the one
     * wire missing: `conformance()` read `sb.delivery` and reported against
     * it, and then `encode()` was called without a profile and fell back to
     * `web`. So a film declared for UK broadcast was *checked* as a UK master
     * and *written* at -14 LUFS with no closed GOPs — a file that passes its
     * own conformance report and fails QC, which is the worst of both.
     */
    profile: sb.delivery,
    ...(opts.burnCaptions === true || sb.delivery === 'social' ? { burnCaptions: true } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
    onEvent: (event) => emit({ type: 'render', event }),
  });

  emit({ type: 'done', output });

  return {
    storyboard: generated.storyboard,
    warnings: generated.warnings,
    filmDir: p.film,
    output,
  };
}

export { ASPECT_DIMENSIONS };
