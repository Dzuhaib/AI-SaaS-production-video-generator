#!/usr/bin/env node
/**
 * `urlume compile` — the compile stage, runnable alone.
 *
 * §23.1 makes every stage independently runnable, and this is what that property
 * is for: a hand-written storyboard through compile -> render exercises the entire
 * deterministic half of the pipeline before one line of provider code exists.
 * Nothing here calls a model.
 *
 *   tsx src/compiler/cli.ts examples/demo-film/storyboard.json
 *
 * Craft rules run before the compile rather than after. A storyboard that fails an
 * `error` rule must never reach the renderer (§57), and finding that out after
 * nine hundred frames is the wrong end of the loop.
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';

import { storyboardSchema, frameCount } from '../storyboard/schema.js';
import { checkCraft } from '../storyboard/craft-rules.js';
import { compile } from './index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** src/compiler -> repo root. Holds under tsx and under dist/ after a build. */
const ROOT = resolve(HERE, '..', '..');

interface Options {
  out?: string;
  runtime: string;
  controls: boolean;
  allowViolations?: boolean;
}

async function main(): Promise<void> {
  const program = new Command()
    .name('urlume-compile')
    .description('Compile a storyboard JSON into a playable, exportable film')
    .argument('<storyboard>', 'path to a storyboard JSON file')
    .option('--out <dir>', "output directory (default: the storyboard's own folder)")
    .option('--runtime <dir>', 'path to runtime/', join(ROOT, 'runtime'))
    .option('--no-controls', 'omit the preview scrub bar')
    .option('--allow-violations', 'compile even if a craft rule fails')
    .parse();

  const storyboardPath = resolve(program.args[0]!);
  const opts = program.opts<Options>();
  const outDir = resolve(opts.out ?? dirname(storyboardPath));

  const raw = await readFile(storyboardPath, 'utf8');
  const parsed = storyboardSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    console.error(`\n${storyboardPath} is not a valid storyboard:\n`);
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    process.exit(1);
  }

  const sb = parsed.data;
  const report = checkCraft(sb);

  for (const violation of report.violations) {
    const tag = violation.severity === 'error' ? 'ERROR  ' : 'warning';
    console.error(`  ${tag} ${violation.rule} at ${violation.path}`);
    console.error(`          ${violation.message}`);
  }

  if (report.errors.length && !opts.allowViolations) {
    console.error(
      `\n${report.errors.length} craft rule error(s). A storyboard that fails an ` +
        `error rule does not reach the renderer (§57).\n` +
        `Fix the storyboard, or pass --allow-violations to compile anyway.\n`
    );
    process.exit(1);
  }

  const result = await compile({
    storyboard: sb,
    outDir,
    runtimeDir: resolve(opts.runtime),
    controls: opts.controls,
  });

  const frames = frameCount(sb);
  console.log(`\nCompiled ${sb.product} -> ${relative(process.cwd(), outDir) || '.'}`);
  console.log(`  ${sb.scenes.length} scenes, ${sb.duration}ms, ${frames} frames at ${sb.fps}fps`);
  console.log(`  ${result.files.length} files written`);
  if (report.warnings.length) {
    console.log(`  ${report.warnings.length} craft warning(s) above — not fatal`);
  }
  console.log(`\nPreview:  ${join(outDir, 'index.html')}`);
  console.log(`Render:   tsx src/renderer/cli.ts "${join(outDir, 'index.html')}" --out film.mp4\n`);
}

main().catch((err: unknown) => {
  console.error(`\ncompile failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
