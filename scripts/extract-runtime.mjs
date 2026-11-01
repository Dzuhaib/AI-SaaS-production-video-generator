#!/usr/bin/env node
/**
 * extract-runtime.mjs — pull the vendored engine out of the core skill.
 *
 * `Skills/saas-explainer-motion.md` carries seven verbatim source blocks under a
 * `## SOURCE FILES` heading. They are the engine: ~3800 lines of CSS and classic
 * JS that every compiled film loads. The skill says to copy them verbatim and
 * never retype them, so this script is the only thing allowed to produce
 * `runtime/`.
 *
 * Run: node scripts/extract-runtime.mjs [--check]
 *
 *   --check   verify runtime/ matches the skill and exit non-zero if it drifted.
 *             Use in CI. Writes nothing.
 *
 * The layout under runtime/ mirrors what a compiled film expects, so shipping a
 * film is a straight directory copy of runtime/assets -> film/assets, and the
 * starter's own `../assets/` paths resolve without rewriting.
 */

import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = join(ROOT, 'runtime');

/** The skill file. The published name fixes the `explaner` typo in the original. */
const SKILL_CANDIDATES = [
  join(ROOT, 'Skills', 'saas-explainer-motion.md'),
  join(ROOT, 'Skills', 'saas-explaner-motion.md'),
];

/**
 * Heading path -> destination under runtime/.
 * Any heading in the skill that is not listed here is a new source block someone
 * added; we fail rather than silently ignore it.
 */
const DESTINATIONS = new Map([
  ['assets/explainer.css', 'assets/explainer.css'],
  ['assets/components.css', 'assets/components.css'],
  ['assets/timeline.js', 'assets/timeline.js'],
  ['assets/sfx.js', 'assets/sfx.js'],
  ['templates/glass-filters.svg', 'assets/glass-filters.svg'],
  ['templates/starter.html', 'templates/starter.html'],
  ['templates/starter.timeline.js', 'templates/starter.timeline.js'],
]);

/**
 * Parse ```` ### `some/path` ```` headings followed by a fenced block.
 *
 * Fences are matched by length, not by the bare ``` marker: a CSS block that
 * contains a ``` in a comment would otherwise terminate the block early and
 * truncate the engine without anyone noticing until a film failed to animate.
 */
function extractBlocks(markdown) {
  const lines = markdown.split(/\r?\n/);
  const blocks = [];

  for (let i = 0; i < lines.length; i++) {
    const heading = /^###\s+`([^`]+)`\s*$/.exec(lines[i]);
    if (!heading) continue;

    // Find the opening fence. Only a blank line may sit between it and the
    // heading; anything else means this heading is prose, not a source block.
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;

    const open = /^(`{3,})\s*([A-Za-z0-9_-]*)\s*$/.exec(lines[j] ?? '');
    if (!open) continue;

    const fence = open[1];
    const start = j + 1;
    let end = -1;
    for (let k = start; k < lines.length; k++) {
      if (lines[k].trimEnd() === fence) { end = k; break; }
    }
    if (end === -1) {
      throw new Error(
        `Unterminated code fence for "${heading[1]}" (opened at line ${j + 1}).`
      );
    }

    blocks.push({
      path: heading[1],
      lang: open[2] || '',
      body: lines.slice(start, end).join('\n'),
      line: j + 1,
      lines: end - start,
    });
    i = end;
  }

  return blocks;
}

async function main() {
  const check = process.argv.includes('--check');

  const skillPath = SKILL_CANDIDATES.find((p) => existsSync(p));
  if (!skillPath) {
    throw new Error(
      `Core skill not found. Looked for:\n  ${SKILL_CANDIDATES.join('\n  ')}`
    );
  }

  const markdown = await readFile(skillPath, 'utf8');
  const all = extractBlocks(markdown);
  const sourceBlocks = all.filter((b) => DESTINATIONS.has(b.path));

  // A block we do not recognise is a new engine file, not something to skip.
  const known = new Set(DESTINATIONS.keys());
  const unknown = all.filter(
    (b) => !known.has(b.path) && /^(assets|templates)\//.test(b.path)
  );
  if (unknown.length) {
    throw new Error(
      `Unrecognised source block(s) in the skill:\n` +
        unknown.map((b) => `  ${b.path} (line ${b.line})`).join('\n') +
        `\nAdd them to DESTINATIONS in scripts/extract-runtime.mjs.`
    );
  }

  const missing = [...known].filter((p) => !sourceBlocks.some((b) => b.path === p));
  if (missing.length) {
    throw new Error(
      `The skill is missing expected source block(s):\n  ${missing.join('\n  ')}`
    );
  }

  // Rebuild from scratch so a block deleted from the skill cannot linger on disk.
  if (!check && existsSync(RUNTIME)) {
    for (const entry of await readdir(RUNTIME, { withFileTypes: true })) {
      if (entry.name === 'README.md') continue;
      await rm(join(RUNTIME, entry.name), { recursive: true, force: true });
    }
  }

  let drifted = 0;
  const report = [];

  for (const block of sourceBlocks) {
    const dest = join(RUNTIME, DESTINATIONS.get(block.path));
    const contents = block.body.endsWith('\n') ? block.body : block.body + '\n';

    if (check) {
      const current = existsSync(dest) ? await readFile(dest, 'utf8') : null;
      const ok = current === contents;
      if (!ok) drifted++;
      report.push(`  ${ok ? 'ok  ' : 'DRIFT'}  ${DESTINATIONS.get(block.path)}`);
      continue;
    }

    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, contents, 'utf8');
    report.push(
      `  ${String(block.lines).padStart(5)} lines  ${DESTINATIONS.get(block.path)}`
    );
  }

  const total = sourceBlocks.reduce((n, b) => n + b.lines, 0);

  if (check) {
    console.log(`Checked runtime/ against ${skillPath}:`);
    console.log(report.join('\n'));
    if (drifted) {
      console.error(
        `\n${drifted} file(s) drifted from the skill. ` +
          `Run: node scripts/extract-runtime.mjs`
      );
      process.exit(1);
    }
    console.log(`\nruntime/ is in sync (${total} lines).`);
    return;
  }

  console.log(`Extracted ${sourceBlocks.length} files from ${skillPath}:`);
  console.log(report.join('\n'));
  console.log(`  ${String(total).padStart(5)} lines total`);
}

main().catch((err) => {
  console.error(`\nextract-runtime failed: ${err.message}\n`);
  process.exit(1);
});
