/**
 * The skill library: loading, indexing, and retrieval.
 *
 * Skills are markdown files with YAML frontmatter. The core skill alone runs to
 * thousands of lines, so nothing here ever hands a whole file to a model by
 * default — files are indexed by their `##` headings at load time and retrieved
 * one section at a time.
 *
 * Four tiers, in increasing cost:
 *
 *   Tier 0  LAWS         always resident, ~2k tokens          (laws.ts)
 *   Tier 1  index        always resident, ~400 tokens         (renderIndex)
 *   Tier 2  retrieval    on request, ~1k tokens per section   (readSection)
 *   Tier 3  policy       injected per pipeline stage          (policy.ts)
 *
 * Resolution order is packaged -> user -> project, later overriding earlier, so
 * a user can extend or replace any shipped skill without editing the package.
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';

export interface SkillSection {
  /** Heading text with the leading `## ` stripped. */
  title: string;
  /** Lower-cased, punctuation-stripped, for lookup. */
  slug: string;
  body: string;
  /** Line offset in the source file, for error messages. */
  line: number;
}

export interface Skill {
  name: string;
  description: string;
  /** Absolute path to the file this was loaded from. */
  path: string;
  /** Where it came from, for diagnosing an unexpected override. */
  origin: 'packaged' | 'user' | 'project';
  /** Everything before the first `##`, which is usually the skill's premise. */
  preamble: string;
  sections: SkillSection[];
  raw: string;
}

export interface SkillLibrary {
  skills: Map<string, Skill>;
  /** Skills that failed to load, with the reason. Never thrown — a malformed
   *  third-party skill must not stop the pipeline. */
  errors: { path: string; reason: string }[];
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Parse frontmatter without a YAML dependency.
 *
 * Skill frontmatter is two flat string fields by convention. Pulling in a YAML
 * parser to read them would be the wrong trade — but that means anything more
 * structured than `key: value` is not supported, and this returns null rather
 * than guessing.
 */
function parseFrontmatter(raw: string): Record<string, string> | null {
  if (!raw.startsWith('---')) return null;
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return null;

  const block = raw.slice(raw.indexOf('\n') + 1, end);
  const out: Record<string, string> = {};
  let key: string | null = null;

  for (const line of block.split('\n')) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1]!;
      out[key] = kv[2]!.trim().replace(/^["']|["']$/g, '');
    } else if (key && /^\s+\S/.test(line)) {
      // Folded continuation of the previous value.
      out[key] = `${out[key]} ${line.trim()}`.trim();
    }
  }
  return out;
}

/** Split a skill body on `##` headings. `###` stays inside its parent section,
 *  because a subsection alone usually lacks the context to be useful. */
function parseSections(body: string, startLine: number): SkillSection[] {
  const lines = body.split('\n');
  const sections: SkillSection[] = [];
  let current: { title: string; line: number; buf: string[] } | null = null;
  let inFence = false;
  let fence = '';

  for (const [i, line] of lines.entries()) {
    // Headings inside a fenced code block are code, not structure.
    const fenceMatch = /^(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fence = fenceMatch[1]!;
      } else if (line.trimEnd().startsWith(fence)) {
        inFence = false;
      }
    }

    const heading = !inFence && /^##\s+(.+?)\s*$/.exec(line);
    if (heading && !line.startsWith('###')) {
      if (current) {
        sections.push({
          title: current.title,
          slug: slugify(current.title),
          body: current.buf.join('\n').trim(),
          line: current.line,
        });
      }
      current = { title: heading[1]!, line: startLine + i, buf: [] };
      continue;
    }
    if (current) current.buf.push(line);
  }

  if (current) {
    sections.push({
      title: current.title,
      slug: slugify(current.title),
      body: current.buf.join('\n').trim(),
      line: current.line,
    });
  }
  return sections;
}

async function loadSkillFile(
  path: string,
  origin: Skill['origin']
): Promise<Skill | { path: string; reason: string }> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    return { path, reason: `unreadable: ${(err as Error).message}` };
  }

  const fm = parseFrontmatter(raw);
  if (!fm) {
    return { path, reason: 'missing YAML frontmatter (--- name: ... ---)' };
  }
  if (!fm.name) return { path, reason: 'frontmatter has no `name`' };
  if (!fm.description) {
    return { path, reason: `skill "${fm.name}" has no \`description\`` };
  }

  const fmEnd = raw.indexOf('\n---', 3);
  const bodyStart = raw.indexOf('\n', fmEnd + 1) + 1;
  const body = raw.slice(bodyStart);
  const startLine = raw.slice(0, bodyStart).split('\n').length;

  const sections = parseSections(body, startLine);
  const firstHeading = body.search(/^##\s+/m);
  const preamble = (firstHeading === -1 ? body : body.slice(0, firstHeading))
    .replace(/^#\s+.+$/m, '')
    .trim();

  const name = fm.name;
  // A `name` that disagrees with the filename makes retrieval unpredictable,
  // since callers reach for whichever they happened to see.
  const stem = basename(path).replace(/\.md$/, '');
  if (name !== stem) {
    return {
      path,
      reason: `frontmatter name "${name}" does not match filename "${stem}"`,
    };
  }

  return { name, description: fm.description, path, origin, preamble, sections, raw };
}

async function loadDir(
  dir: string,
  origin: Skill['origin'],
  into: SkillLibrary
): Promise<void> {
  if (!existsSync(dir)) return;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.md') || entry === 'README.md') continue;
    const result = await loadSkillFile(join(dir, entry), origin);
    if ('reason' in result) into.errors.push(result);
    else into.skills.set(result.name, result); // later origin wins
  }
}

export interface LoadOptions {
  /** Where the package's own `Skills/` lives. */
  packagedDir: string;
  /** Defaults to `~/.urlume/skills`. */
  userDir?: string;
  /** Defaults to `<cwd>/.urlume/skills`. */
  projectDir?: string;
}

export async function loadSkills(opts: LoadOptions): Promise<SkillLibrary> {
  const lib: SkillLibrary = { skills: new Map(), errors: [] };
  await loadDir(opts.packagedDir, 'packaged', lib);
  await loadDir(opts.userDir ?? join(homedir(), '.urlume', 'skills'), 'user', lib);
  await loadDir(
    opts.projectDir ?? join(process.cwd(), '.urlume', 'skills'),
    'project',
    lib
  );
  return lib;
}

/* ------------------------------------------------------------------ *
 * Tier 1 — the index
 * ------------------------------------------------------------------ */

/**
 * Every skill's name and description, and nothing else. This is what tells the
 * model what exists and is therefore what makes Tier 2 retrieval possible: a
 * model cannot ask for a section of a skill it does not know about.
 */
export function renderIndex(lib: SkillLibrary): string {
  const lines = [
    '# Skill library',
    '',
    'Retrieve a section with `readSkill(name, section)`. Section titles are the',
    '`##` headings within each skill.',
    '',
  ];
  for (const skill of [...lib.skills.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`- **${skill.name}** — ${skill.description}`);
  }
  return lines.join('\n');
}

/** Section titles for one skill, so a model can pick before it fetches. */
export function renderContents(lib: SkillLibrary, name: string): string | null {
  const skill = lib.skills.get(name);
  if (!skill) return null;
  return [
    `# ${skill.name}`,
    skill.description,
    '',
    ...skill.sections.map((s) => `- ${s.title}`),
  ].join('\n');
}

/* ------------------------------------------------------------------ *
 * Tier 2 — retrieval
 * ------------------------------------------------------------------ */

export interface SectionRequest {
  skill: string;
  /** Matched case-insensitively against title and slug, then by substring.
   *
   *  `| undefined` is explicit because these come straight from a Zod
   *  `.optional()`, which yields `string | undefined` rather than an absent key.
   *  Under `exactOptionalPropertyTypes` those are different types, and the
   *  distinction is meaningless here — `readSection` tests falsiness, so an
   *  absent section and an undefined one take the same branch. */
  section?: string | undefined;
}

export interface SectionResult {
  skill: string;
  title: string;
  body: string;
}

/**
 * One section of one skill.
 *
 * With no `section`, returns the preamble and a contents list rather than the
 * whole file — handing back 60k tokens because the caller omitted an argument
 * is exactly the failure this tier exists to prevent.
 */
export function readSection(
  lib: SkillLibrary,
  req: SectionRequest
): SectionResult | { error: string } {
  const skill = lib.skills.get(req.skill);
  if (!skill) {
    const near = [...lib.skills.keys()].filter((k) => k.includes(req.skill.split('-')[0] ?? ''));
    return {
      error:
        `No skill named "${req.skill}".` +
        (near.length ? ` Did you mean: ${near.join(', ')}?` : ''),
    };
  }

  if (!req.section) {
    return {
      skill: skill.name,
      title: 'Contents',
      body: [skill.preamble, '', '## Sections', ...skill.sections.map((s) => `- ${s.title}`)]
        .join('\n')
        .trim(),
    };
  }

  const want = req.section.toLowerCase();
  const slug = slugify(req.section);
  const found =
    skill.sections.find((s) => s.slug === slug) ??
    skill.sections.find((s) => s.title.toLowerCase() === want) ??
    skill.sections.find((s) => s.title.toLowerCase().includes(want));

  if (!found) {
    return {
      error:
        `Skill "${skill.name}" has no section "${req.section}". Available:\n` +
        skill.sections.map((s) => `  - ${s.title}`).join('\n'),
    };
  }

  return { skill: skill.name, title: found.title, body: found.body };
}

/** Concatenate several sections, for Tier 3 policy injection. */
export function collectSections(
  lib: SkillLibrary,
  refs: readonly SectionRequest[]
): string {
  const parts: string[] = [];
  for (const ref of refs) {
    const result = readSection(lib, ref);
    if ('error' in result) continue; // a missing optional section is not fatal
    parts.push(`## ${result.skill} — ${result.title}\n\n${result.body}`);
  }
  return parts.join('\n\n---\n\n');
}
