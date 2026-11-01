#!/usr/bin/env node
/**
 * `urlume` — the entry point.
 *
 * §23's subcommands, with `create` as the one that does what the product promises:
 * a URL and a sentence in, an MP4 out. Every stage is independently runnable
 * against what the previous one left in `.urlume/` (§23.1), so a bad film can be
 * diagnosed as a bad storyboard (`check`) or a bad compile (`preview`) without
 * rendering nine hundred frames to find out.
 *
 * With no arguments it opens the interactive interface, which is the primary
 * experience; the subcommands exist for scripting and for CI, where there is no TTY.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command, Option } from 'commander';

import { runPipeline, type PipelineEvent } from './pipeline.js';
import { validateStoryboard } from './storyboard/generate.js';
import { ASPECTS, type Aspect, PRESETS } from './storyboard/schema.js';
import {
  DELIVERY_PROFILES,
  deliverySpec,
  FPS_VALUES,
  type DeliveryProfile,
} from './shared/broadcast.js';
import {
  listAllModels,
  listCredentials,
  setCredential,
  removeCredential,
  maskKey,
  getCredential,
  storePath,
  STORAGE_NOTICE,
  PROVIDER_IDS,
  PROVIDER_NAMES,
  ProviderError,
} from './providers/index.js';
import { loadSkills, renderIndex, renderContents, readSection } from './skills/library.js';
import { RenderError, redact } from './renderer/errors.js';
import { describeFlashReport } from './renderer/flash.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/* ------------------------------------------------------------------ *
 * Progress reporting
 * ------------------------------------------------------------------ */

/**
 * Plain-text progress.
 *
 * The Ink TUI (§25) is a separate surface; this is what a non-TTY sees, and it is
 * also what a CI log should contain. Frame lines are throttled rather than emitted
 * 588 times.
 */
function reporter(): (e: PipelineEvent) => void {
  let lastFrame = 0;
  const started = Date.now();

  return (e) => {
    switch (e.type) {
      case 'stage':
        console.log(`\n[${e.name}]${e.detail ? ` ${e.detail}` : ''}`);
        break;

      case 'provider':
        console.log(`  ${e.provider} / ${e.model}  (key from ${e.origin === 'env' ? 'environment' : 'credential store'})`);
        break;

      case 'routes':
        console.log(`  found ${e.routes.length}: ${e.routes.join(', ')}`);
        if (e.skipped) console.log(`  skipped ${e.skipped} (legal, auth, off-origin, or failed)`);
        break;

      case 'analysed':
        console.log(`  ${e.route}: ${e.elements} ranked element(s)`);
        break;

      case 'generate': {
        const g = e.event;
        if (g.type === 'prompt') console.log(`  prompt ~${g.tokensEstimate} tokens`);
        if (g.type === 'attempt' && g.n > 1) console.log(`  attempt ${g.n} of ${g.of}`);
        if (g.type === 'received') console.log(`  received ${g.chars} chars`);
        if (g.type === 'schema-failed') {
          console.log(`  schema rejected it:`);
          for (const issue of g.issues.slice(0, 6)) console.log(`    ${issue}`);
        }
        if (g.type === 'repaired') {
          console.log(`  repaired ${g.violations.length} mechanical violation(s):`);
          for (const v of g.violations.slice(0, 8)) console.log(`    ${v.rule} at ${v.path}`);
        }
        if (g.type === 'reask') {
          console.log(`  ${g.violations.length} content violation(s) — asking the model to fix:`);
          for (const v of g.violations) console.log(`    ${v.rule}: ${v.message.split('.')[0]}`);
        }
        break;
      }

      case 'storyboard': {
        const sb = e.storyboard;
        console.log(`  "${sb.product}" — ${sb.scenes.length} scenes, ${secs(sb.duration)}`);
        if (sb.thesis) console.log(`  thesis: ${sb.thesis}`);
        for (const scene of sb.scenes) {
          console.log(`    ${scene.beat.padEnd(7)} ${String(scene.duration).padStart(5)}ms  ${scene.copy?.headline ?? scene.id}`);
        }
        if (e.warnings.length) {
          console.log(`  ${e.warnings.length} warning(s), not blocking:`);
          for (const w of e.warnings.slice(0, 6)) console.log(`    ${w.rule} at ${w.path}`);
        }
        break;
      }

      case 'compiled':
        console.log(`  ${e.files} files -> ${relative(process.cwd(), e.outDir)}`);
        for (const note of e.notes) console.log(`    ${note}`);
        break;

      /**
       * Delivery conformance, pre-render. Errors are printed as errors because
       * an unusable master is not a stylistic note — a 30fps film delivered to a
       * UK broadcaster comes back from QC.
       */
      case 'conformance': {
        const errors = e.notes.filter((n) => n.severity === 'error');
        const warnings = e.notes.filter((n) => n.severity === 'warning');
        if (!e.notes.length) {
          console.log(`  delivery: ${e.profile} — conforms`);
          break;
        }
        console.log(`  delivery: ${e.profile} — ${errors.length} error(s), ${warnings.length} warning(s)`);
        for (const n of e.notes) {
          if (n.severity === 'info') continue;
          const label = n.severity === 'error' ? 'ERROR' : 'warn';
          const write = n.severity === 'error' ? console.error : console.warn;
          write(`    ${label} [${n.area}] ${n.message}`);
          write(`          standard: ${n.standard}`);
        }
        break;
      }

      case 'render': {
        const r = e.event;
        if (r.type === 'ready') {
          console.log(`  ${r.film.width}x${r.film.height}, ${r.film.frames} frames at ${r.film.fps}fps`);
        }
        if (r.type === 'frame') {
          const now = Date.now();
          if (now - lastFrame < 500 && r.frame !== r.total) break;
          lastFrame = now;
          const pct = Math.round((r.frame / r.total) * 100);
          const rate = r.frame / Math.max(1, (now - started) / 1000);
          process.stdout.write(`\r  ${String(pct).padStart(3)}%  ${r.frame}/${r.total} frames  ${rate.toFixed(1)} fps   `);
          if (r.frame === r.total) process.stdout.write('\n');
        }
        if (r.type === 'encode') console.log('  encoding...');
        if (r.type === 'warn') console.warn(`  warning: ${redact(r.message)}`);
        /**
         * Text outside the safe box, measured before any frame was captured.
         * An error for broadcast, where an overscanning display crops it; a
         * warning for social, where the platform's own UI covers it.
         */
        if (r.type === 'safe-area') {
          for (const n of r.notes) {
            const write = n.severity === 'error' ? console.error : console.warn;
            write(`    ${n.severity === 'error' ? 'ERROR' : 'warn'} [safe-area] ${n.message}`);
          }
          console.warn(`          standard: ${r.notes[0]!.standard}`);
        }
        /**
         * What the encoded file actually is, checked against the profile it was
         * declared for. Printed unconditionally, because the failure this
         * catches — a correct-looking master with the wrong cadence, an
         * untagged colour space, audio at the wrong sample rate — cannot be
         * seen in the picture and cannot be caught by anything upstream.
         */
        if (r.type === 'verified') {
          console.log(`  wrote  ${r.summary}`);
          const bad = r.notes.filter((n) => n.severity !== 'info');
          if (!bad.length) {
            console.log(`  delivery: ${r.profile} — verified`);
          } else {
            for (const n of bad) {
              const label = n.severity === 'error' ? 'ERROR' : 'warn';
              const write = n.severity === 'error' ? console.error : console.warn;
              write(`    ${label} [${n.area}] ${n.message}`);
              write(`          standard: ${n.standard}`);
            }
          }
          // An info note is a limit on the check itself, printed only when it
          // applies so a clean web render stays quiet.
          for (const n of r.notes.filter((x) => x.severity === 'info')) {
            console.log(`    note [${n.area}] ${n.message}`);
          }
        }
        /**
         * Photosensitivity, measured on the encoded file. A film that could
         * trigger a seizure must not be able to ship silently, so an unsafe
         * result and an *unassessed* one are both printed — the renderer skips
         * analysis rather than failing the render, and silence would read as a
         * pass.
         */
        if (r.type === 'flash') {
          const f = r.report;
          const write = f.skipped ? console.warn : f.pass ? console.log : console.error;
          for (const line of describeFlashReport(f)) write(`  ${line}`);
        }
        break;
      }

      case 'done':
        console.log(`\nWrote ${relative(process.cwd(), e.output)}`);
        break;
    }
  };
}

/* ------------------------------------------------------------------ *
 * Shared option parsing
 * ------------------------------------------------------------------ */

function parseAspect(value: string): Aspect {
  if (!(ASPECTS as readonly string[]).includes(value)) {
    throw new Error(`--aspect must be one of ${ASPECTS.join(', ')}`);
  }
  return value as Aspect;
}

function parseSeconds(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 3 || n > 180) {
    throw new Error('--duration must be between 3 and 180 seconds');
  }
  return Math.round(n * 1000);
}

function parseDelivery(value: string): DeliveryProfile {
  if (!(DELIVERY_PROFILES as readonly string[]).includes(value)) {
    throw new Error(`--delivery must be one of ${DELIVERY_PROFILES.join(', ')}`);
  }
  return value as DeliveryProfile;
}

function parseFps(value: string): number {
  const n = Number(value);
  if (!FPS_VALUES.includes(n)) {
    throw new Error(`--fps must be one of ${FPS_VALUES.join(', ')}`);
  }
  return n;
}

interface CreateFlags {
  url?: string;
  prompt?: string;
  out?: string;
  duration?: number;
  aspect?: Aspect;
  preset?: string;
  delivery?: DeliveryProfile;
  fps?: number;
  provider?: string;
  model?: string;
  route?: string[];
  quality: 'draft' | 'high' | 'master';
  audio: boolean;
  cache: boolean;
  burnCaptions?: boolean;
  strict?: boolean;
  force?: boolean;
  draft?: boolean;
}

async function create(urlArg: string | undefined, flags: CreateFlags, stopAfter: boolean): Promise<void> {
  const url = urlArg ?? flags.url;
  if (!url) {
    console.error(
      '\nA URL is required.\n\n' +
        '  urlume create https://example.com --prompt "30s launch film"\n\n' +
        'urlume does not guess what to film (§43.3).\n'
    );
    process.exit(1);
  }

  const controller = new AbortController();
  process.once('SIGINT', () => {
    console.log('\nCancelling...');
    controller.abort();
  });

  const result = await runPipeline({
    url,
    ...(flags.prompt !== undefined ? { prompt: flags.prompt } : {}),
    ...(flags.out !== undefined ? { output: flags.out } : {}),
    ...(flags.duration !== undefined ? { durationMs: flags.duration } : {}),
    ...(flags.aspect !== undefined ? { aspect: flags.aspect } : {}),
    ...(flags.preset !== undefined ? { preset: flags.preset } : {}),
    ...(flags.delivery !== undefined ? { delivery: flags.delivery } : {}),
    ...(flags.fps !== undefined ? { fps: flags.fps } : {}),
    ...(flags.provider !== undefined ? { provider: flags.provider } : {}),
    ...(flags.model !== undefined ? { model: flags.model } : {}),
    ...(flags.route?.length ? { routes: flags.route } : {}),
    ...(flags.burnCaptions ? { burnCaptions: true } : {}),
    ...(flags.strict ? { strict: true } : {}),
    ...(flags.force ? { force: true } : {}),
    quality: flags.draft ? 'draft' : flags.quality,
    audio: flags.audio,
    cache: flags.cache,
    stopAfterStoryboard: stopAfter,
    signal: controller.signal,
    onEvent: reporter(),
  });

  if (stopAfter) {
    console.log(
      `\nStoryboard saved to .urlume/storyboard/main.json\n` +
        `Delivery: ${result.storyboard.delivery} · ${result.storyboard.fps}fps` +
        ` — ${deliverySpec(result.storyboard.delivery).description}\n` +
        `Preview:  ${join(result.filmDir, 'index.html')}\n` +
        `Render:   urlume render\n`
    );
  }
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

const program = new Command()
  .name('urlume')
  .description('An AI video agent that turns a SaaS website into a cinematic product film')
  .version('0.1.0');

// Shared flags, attached to both `create` and `storyboard`.
const sharedOptions = [
  new Option('--prompt <text>', 'what you want, in your own words'),
  new Option('--duration <seconds>', 'target length').argParser(parseSeconds),
  new Option('--aspect <ratio>', `one of ${ASPECTS.join(', ')}`).argParser(parseAspect),
  new Option('--preset <name>', `one of ${PRESETS.join(', ')}`),
  /**
   * Delivery is a first-class flag rather than something the model is asked to
   * infer, because it is a fact about the destination rather than a creative
   * decision — and because without it the whole `shared/broadcast.ts` layer was
   * unreachable: every film was checked and encoded as `web` no matter who it
   * was for.
   */
  new Option(
    '--delivery <profile>',
    `${DELIVERY_PROFILES.join(' | ')} — decides cadence, loudness and GOP structure`
  ).argParser(parseDelivery),
  new Option('--fps <rate>', `one of ${FPS_VALUES.join(', ')}; defaults to the delivery profile's`).argParser(parseFps),
  new Option('--burn-captions', 'burn captions into the picture (default on for social)'),
  new Option('--provider <id>', `one of ${PROVIDER_IDS.join(', ')}`),
  new Option('--model <id>', 'model id; defaults per provider'),
  new Option('--route <path...>', 'analyse these routes instead of crawling'),
  new Option('--no-cache', 're-analyse rather than reusing .urlume/captures'),
];

const createCmd = program
  .command('create')
  .description('the whole pipeline: analyse -> storyboard -> compile -> MP4')
  .argument('[url]', 'the website to film')
  .option('--out <file>', 'MP4 output path')
  .option('--quality <q>', 'draft | high | master', 'high')
  .option('--draft', 'shorthand for --quality draft')
  .option('--no-audio', 'silent MP4')
  .option('--strict', 'refuse to render a film that fails its delivery conformance check')
  .option('--force', 'render anyway, despite conformance errors')
  .action(async (url: string | undefined, flags: CreateFlags) => {
    await create(url, flags, false);
  });
for (const option of sharedOptions) createCmd.addOption(option);

const storyboardCmd = program
  .command('storyboard')
  .description('generate and validate a storyboard, then stop')
  .argument('[url]', 'the website to film')
  .action(async (url: string | undefined, flags: CreateFlags) => {
    await create(url, { ...flags, quality: 'high', audio: true }, true);
  });
for (const option of sharedOptions) storyboardCmd.addOption(option);

program
  .command('check')
  .description('run the craft rules against a saved storyboard')
  .argument('[file]', 'storyboard JSON', '.urlume/storyboard/main.json')
  .action(async (file: string) => {
    const path = resolve(file);
    if (!existsSync(path)) {
      console.error(`\nNo storyboard at ${file}\nGenerate one: urlume storyboard <url>\n`);
      process.exit(1);
    }

    const result = validateStoryboard(JSON.parse(await readFile(path, 'utf8')));

    if (result.issues.length) {
      console.error(`\n${file} does not match the schema:\n`);
      for (const issue of result.issues) console.error(`  ${issue}`);
      process.exit(1);
    }

    const errors = result.violations.filter((v) => v.severity === 'error');
    const warnings = result.violations.filter((v) => v.severity === 'warning');

    for (const v of result.violations) {
      console.log(`${v.severity === 'error' ? 'ERROR  ' : 'warning'} ${v.rule} at ${v.path}`);
      console.log(`        ${v.message}`);
      console.log(`        source: ${v.source}`);
    }

    const sb = result.storyboard!;
    console.log(
      `\n"${sb.product}" — ${sb.scenes.length} scenes, ${secs(sb.duration)}, ` +
        `${errors.length} error(s), ${warnings.length} warning(s)`
    );
    if (errors.length) process.exit(1);
  });

const renderCmd = program
  .command('render')
  .description('render a compiled film to MP4')
  .argument('[film]', "the film's index.html", '.urlume/film/index.html')
  .option('--out <file>', 'MP4 output path', '.urlume/renders/film.mp4')
  .option('--from <frame>', 'inclusive start frame')
  .option('--to <frame>', 'exclusive end frame')
  .option('--quality <q>', 'draft | high | master', 'high')
  .option('--burn-captions', 'burn captions into the picture')
  .option('--no-audio', 'silent MP4')
  .option('--no-verify', 'skip the read-back of the encoded file');

renderCmd.addOption(
  new Option('--fps <rate>', `one of ${FPS_VALUES.join(', ')} — re-times the capture`).argParser(parseFps)
);
renderCmd.addOption(
  new Option(
    '--profile <profile>',
    `${DELIVERY_PROFILES.join(' | ')} — loudness target and GOP structure. ` +
      "Defaults to the storyboard's own delivery target when one is saved beside the film."
  ).argParser(parseDelivery)
);

renderCmd.action(async (film: string, flags: {
    out: string;
    from?: string;
    to?: string;
    quality: 'draft' | 'high' | 'master';
    fps?: number;
    profile?: DeliveryProfile;
    burnCaptions?: boolean;
    audio: boolean;
    verify: boolean;
  }) => {
    const path = resolve(film);
    if (!existsSync(path)) {
      console.error(`\nNo film at ${film}\nCompile one: urlume storyboard <url>\n`);
      process.exit(1);
    }

    /**
     * Prefer the profile written beside the film. A `render` run against an
     * existing build is the stage that has no storyboard in hand, and silently
     * reverting to `web` is exactly the bug this flag exists to close.
     */
    const profile = flags.profile ?? (await profileBesideFilm(path));

    const { render } = await import('./renderer/index.js');
    const output = resolve(flags.out);
    await mkdir(dirname(output), { recursive: true });

    const controller = new AbortController();
    process.once('SIGINT', () => controller.abort());
    const report = reporter();

    await render({
      film: path,
      output,
      quality: flags.quality,
      audio: flags.audio,
      verify: flags.verify,
      ...(profile !== undefined ? { profile } : {}),
      ...(flags.burnCaptions ? { burnCaptions: true } : {}),
      ...(flags.from !== undefined ? { from: Number(flags.from) } : {}),
      ...(flags.to !== undefined ? { to: Number(flags.to) } : {}),
      ...(flags.fps !== undefined ? { fps: flags.fps } : {}),
      signal: controller.signal,
      onEvent: (event) => report({ type: 'render', event }),
    });
    console.log(`\nWrote ${relative(process.cwd(), output)}`);
  });

/**
 * The storyboard sits two directories above the film (`.urlume/storyboard/`
 * against `.urlume/film/`), and it is the only place the delivery target is
 * recorded. Read defensively: a film compiled by hand has no storyboard, and
 * neither a missing file nor a malformed one should stop a render.
 */
async function profileBesideFilm(filmPath: string): Promise<DeliveryProfile | undefined> {
  try {
    const storyboardPath = resolve(dirname(filmPath), '..', 'storyboard', 'main.json');
    if (!existsSync(storyboardPath)) return undefined;
    const parsed = JSON.parse(await readFile(storyboardPath, 'utf8')) as { delivery?: string };
    return (DELIVERY_PROFILES as readonly string[]).includes(parsed.delivery ?? '')
      ? (parsed.delivery as DeliveryProfile)
      : undefined;
  } catch {
    return undefined;
  }
}

program
  .command('providers')
  .description('show configured providers and where each key came from')
  .action(async () => {
    const configured = await listCredentials();
    if (!configured.length) {
      console.log(
        '\nNo provider configured.\n\n' +
          'Export a key:\n' +
          '  ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY\n\n' +
          'Or store one:\n' +
          '  urlume config --provider anthropic --key <key>\n'
      );
      return;
    }

    console.log('');
    for (const source of configured) {
      const credential = await getCredential(source.provider);
      const name = PROVIDER_NAMES[source.provider as keyof typeof PROVIDER_NAMES] ?? source.provider;
      console.log(
        `  ${source.provider.padEnd(10)} ${maskKey(credential?.key ?? '')}  ` +
          `${source.origin === 'env' ? source.detail : 'credential store'}  (${name})`
      );
    }
    console.log(`\n${STORAGE_NOTICE}\n`);
  });

program
  .command('models')
  .description('list models reachable with the configured keys')
  .action(async () => {
    const groups = await listAllModels();
    if (!groups.length) {
      console.log('\nNo provider configured. See: urlume doctor\n');
      return;
    }
    for (const group of groups) {
      console.log(`\n${group.provider}`);
      if (group.error) {
        console.log(`  unreachable: ${group.error}`);
        continue;
      }
      for (const model of group.models) {
        const flags = [
          model.vision ? 'vision' : '',
          model.structuredOutput ? 'json' : '',
          model.contextWindow ? `${Math.round(model.contextWindow / 1000)}k` : '',
        ].filter(Boolean);
        console.log(`  ${model.id.padEnd(28)} ${flags.join('  ')}`);
      }
    }
    console.log('');
  });

program
  .command('config')
  .description('store a provider key, model or base URL')
  .requiredOption('--provider <id>', `one of ${PROVIDER_IDS.join(', ')}`)
  .option('--key <key>', 'API key')
  .option('--model <id>', 'default model for this provider')
  .option('--base-url <url>', 'for an OpenAI-compatible endpoint')
  .option(
    '--header <header...>',
    'extra request header, "Name: value". Some gateways only accept known clients'
  )
  .option('--remove', 'forget this provider')
  .action(async (flags: { provider: string; key?: string; model?: string; baseUrl?: string; header?: string[]; remove?: boolean }) => {
    if (flags.remove) {
      const removed = await removeCredential(flags.provider);
      console.log(removed ? `\nRemoved ${flags.provider}.\n` : `\n${flags.provider} was not stored.\n`);
      return;
    }

    const existing = await getCredential(flags.provider);
    const key = flags.key ?? existing?.key;
    if (!key) {
      console.error(`\nNo key for ${flags.provider}. Pass --key.\n`);
      process.exit(1);
    }

    // Headers merge onto whatever is stored, so setting one does not silently drop
    // another set earlier.
    let headers = existing?.headers;
    if (flags.header?.length) {
      headers = { ...headers };
      for (const raw of flags.header) {
        const split = raw.indexOf(':');
        if (split === -1) {
          console.error(`\n--header must be "Name: value" (got "${raw}")\n`);
          process.exit(1);
        }
        headers[raw.slice(0, split).trim()] = raw.slice(split + 1).trim();
      }
    }

    await setCredential({
      provider: flags.provider,
      key,
      ...(flags.model !== undefined ? { defaultModel: flags.model } : existing?.defaultModel !== undefined ? { defaultModel: existing.defaultModel } : {}),
      ...(flags.baseUrl !== undefined ? { baseUrl: flags.baseUrl } : existing?.baseUrl !== undefined ? { baseUrl: existing.baseUrl } : {}),
      ...(headers && Object.keys(headers).length ? { headers } : {}),
    });

    console.log(`\nStored ${flags.provider} in ${storePath()}\n${STORAGE_NOTICE}\n`);
  });

program
  .command('skills')
  .description('list the craft library, or read one section')
  .argument('[skill]', 'skill name')
  .argument('[section]', 'section heading')
  .action(async (skill: string | undefined, section: string | undefined) => {
    const lib = await loadSkills({ packagedDir: join(ROOT, 'Skills') });

    if (!skill) {
      console.log(`\n${renderIndex(lib)}\n`);
      if (lib.errors.length) {
        console.log('Failed to load:');
        for (const e of lib.errors) console.log(`  ${e.path}: ${e.reason}`);
      }
      return;
    }

    if (!section) {
      const contents = renderContents(lib, skill);
      console.log(contents ? `\n${contents}\n` : `\nNo skill named "${skill}".\n`);
      return;
    }

    const result = readSection(lib, { skill, section });
    if ('error' in result) {
      console.error(`\n${result.error}\n`);
      process.exit(1);
    }
    console.log(`\n## ${result.title}\n\n${result.body}\n`);
  });

program
  .command('doctor')
  .description('check Chromium, ffmpeg and API keys')
  .action(async () => {
    const { doctor } = await import('./tui/index.js');
    console.log('');
    for (const line of await doctor()) console.log(line.text);
    console.log('');
  });

// `urlume` with no subcommand opens the interactive interface (§4, §25). Imported
// lazily so a `render` never pays to load React and Ink.
program.action(async () => {
  const { startTui } = await import('./tui/index.js');
  await startTui(program.version() ?? '0.1.0');
});

program.parseAsync().catch((err: unknown) => {
  if (err instanceof ProviderError) {
    console.error(`\n${redact(err.format())}\n`);
  } else if (err instanceof RenderError) {
    console.error(`\n${redact(err.format())}\n`);
  } else {
    console.error(`\n${redact(err instanceof Error ? err.message : String(err))}\n`);
  }
  process.exit(1);
});
