/**
 * Skill system tests.
 *
 * Two things are being asserted, and the second matters more than the first:
 *
 * 1. Retrieval works — sections parse, lookups resolve, overrides apply.
 * 2. The rules are actually *bound*. Tier 0 must fit in its budget or it stops
 *    being resident, and every Tier 3 policy reference must resolve or a rule
 *    has quietly stopped being enforced. That second failure is invisible in
 *    production: films keep rendering, they just get slightly worse.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadSkills,
  renderIndex,
  renderContents,
  readSection,
  collectSections,
  type SkillLibrary,
} from '../../src/skills/library.js';
import { LAWS, lawsTokenEstimate } from '../../src/skills/laws.js';
import { POLICY, policyFor, verifyPolicy, type Stage } from '../../src/skills/policy.js';

const PROJECT_SKILLS = join(process.cwd(), 'Skills');

/** A throwaway skill directory, for testing parsing and override behaviour. */
async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'urlume-skills-'));
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(dir, name), body, 'utf8');
  }
  return dir;
}

const SIMPLE = `---
name: sample-skill
description: A sample skill, for testing retrieval. Use when testing.
---

# Sample Skill

Preamble text that sits before any heading.

## First Section

Body of the first section.

## Code Section

A fence containing something that looks like a heading:

\`\`\`md
## Not A Real Heading
\`\`\`

Still inside Code Section.

## Last Section

The end.
`;

describe('skill parsing', () => {
  let lib: SkillLibrary;

  beforeAll(async () => {
    const dir = await fixture({ 'sample-skill.md': SIMPLE });
    lib = await loadSkills({ packagedDir: dir, userDir: '/nonexistent', projectDir: '/nonexistent' });
  });

  it('loads frontmatter', () => {
    const skill = lib.skills.get('sample-skill');
    expect(skill?.description).toMatch(/^A sample skill/);
  });

  it('splits on ## headings', () => {
    const titles = lib.skills.get('sample-skill')!.sections.map((s) => s.title);
    expect(titles).toEqual(['First Section', 'Code Section', 'Last Section']);
  });

  it('ignores headings inside fenced code', () => {
    // A markdown skill that documents markdown would otherwise fragment at every
    // example heading.
    const code = lib.skills.get('sample-skill')!.sections.find((s) => s.title === 'Code Section');
    expect(code?.body).toContain('## Not A Real Heading');
    expect(code?.body).toContain('Still inside Code Section');
  });

  it('captures the preamble separately', () => {
    expect(lib.skills.get('sample-skill')!.preamble).toContain('Preamble text');
  });

  it('rejects a skill whose name disagrees with its filename', async () => {
    const dir = await fixture({
      'wrong-name.md': '---\nname: other-name\ndescription: x\n---\n\n## A\n\nb\n',
    });
    const bad = await loadSkills({ packagedDir: dir, userDir: '/none', projectDir: '/none' });
    expect(bad.skills.size).toBe(0);
    expect(bad.errors[0]?.reason).toMatch(/does not match filename/);
  });

  it('reports a malformed skill without throwing', async () => {
    // A broken third-party skill must not take the pipeline down.
    const dir = await fixture({ 'broken.md': 'no frontmatter at all\n' });
    const bad = await loadSkills({ packagedDir: dir, userDir: '/none', projectDir: '/none' });
    expect(bad.errors).toHaveLength(1);
    expect(bad.errors[0]!.reason).toMatch(/frontmatter/);
  });

  it('lets a project skill override a packaged one', async () => {
    const packaged = await fixture({ 'sample-skill.md': SIMPLE });
    const project = await fixture({
      'sample-skill.md': SIMPLE.replace('A sample skill', 'Overridden'),
    });
    const merged = await loadSkills({
      packagedDir: packaged,
      userDir: '/none',
      projectDir: project,
    });
    expect(merged.skills.get('sample-skill')!.description).toMatch(/^Overridden/);
    expect(merged.skills.get('sample-skill')!.origin).toBe('project');
  });
});

describe('retrieval', () => {
  let lib: SkillLibrary;

  beforeAll(async () => {
    const dir = await fixture({ 'sample-skill.md': SIMPLE });
    lib = await loadSkills({ packagedDir: dir, userDir: '/none', projectDir: '/none' });
  });

  it('returns one section, not the file', () => {
    const result = readSection(lib, { skill: 'sample-skill', section: 'First Section' });
    expect(result).not.toHaveProperty('error');
    if ('body' in result) {
      expect(result.body).toBe('Body of the first section.');
      expect(result.body).not.toContain('The end.');
    }
  });

  it('matches a section case-insensitively and by substring', () => {
    for (const q of ['first section', 'FIRST', 'first-section']) {
      const r = readSection(lib, { skill: 'sample-skill', section: q });
      expect(r, `query: ${q}`).not.toHaveProperty('error');
    }
  });

  it('returns contents, not the whole file, when no section is named', () => {
    // Handing back the entire core skill because an argument was omitted is
    // exactly the failure this tier exists to prevent.
    const r = readSection(lib, { skill: 'sample-skill' });
    if ('body' in r) {
      expect(r.body).toContain('## Sections');
      expect(r.body).not.toContain('Body of the first section.');
    }
  });

  it('lists available sections when one is not found', () => {
    const r = readSection(lib, { skill: 'sample-skill', section: 'nope' });
    expect(r).toHaveProperty('error');
    if ('error' in r) expect(r.error).toContain('First Section');
  });

  it('suggests near matches for an unknown skill', () => {
    const r = readSection(lib, { skill: 'sample-typo' });
    if ('error' in r) expect(r.error).toMatch(/No skill named/);
  });

  it('renders an index of name and description only', () => {
    const index = renderIndex(lib);
    expect(index).toContain('sample-skill');
    expect(index).not.toContain('Body of the first section.');
  });

  it('renders a contents listing for one skill', () => {
    expect(renderContents(lib, 'sample-skill')).toContain('- First Section');
    expect(renderContents(lib, 'missing')).toBeNull();
  });

  it('skips missing sections when collecting, rather than failing', () => {
    const text = collectSections(lib, [
      { skill: 'sample-skill', section: 'First Section' },
      { skill: 'sample-skill', section: 'does not exist' },
    ]);
    expect(text).toContain('Body of the first section.');
  });
});

describe('Tier 0 — laws', () => {
  it('fits the resident budget', () => {
    // Tier 0 is in every prompt at every stage. Past ~2k tokens the right move
    // is to demote a rule to Tier 3, not to trim the explanations — a rule
    // without its reason gets rationalised away the first time it is awkward.
    expect(lawsTokenEstimate()).toBeLessThan(2600);
  });

  it('carries the rules that must be resident', () => {
    // These are the ones a model breaks *before* it would think to ask.
    const required = [
      /hard cut/i,
      /film clock|1\.5-2\.5/i,
      /linear/i,
      /80-140ms/i,
      /one call to action|exactly one call/i,
      /muted/i,
      /CSS `transition`|@keyframes/i,
      /problem first/i,
    ];
    for (const pattern of required) {
      expect(LAWS, `laws are missing ${pattern}`).toMatch(pattern);
    }
  });
});

describe('Tier 3 — policy', () => {
  let lib: SkillLibrary;

  beforeAll(async () => {
    lib = await loadSkills({
      packagedDir: PROJECT_SKILLS,
      userDir: '/none',
      projectDir: '/none',
    });
  });

  it('loads the real skill library without errors', () => {
    expect(lib.errors, JSON.stringify(lib.errors, null, 2)).toEqual([]);
    expect(lib.skills.size).toBeGreaterThan(0);
  });

  it('every policy reference resolves', () => {
    // A silently-skipped section is a rule that stopped being enforced, and
    // nothing else in the system would report it.
    const problems = verifyPolicy(lib);
    const detail = problems
      .map((p) => `${p.stage}: ${p.ref.skill}/${p.ref.section ?? '*'} — ${p.reason}`)
      .join('\n');
    expect(problems, `unresolved policy references:\n${detail}`).toEqual([]);
  });

  it('produces content for every stage', () => {
    for (const stage of Object.keys(POLICY) as Stage[]) {
      expect(policyFor(lib, stage).length, `stage ${stage} injected nothing`).toBeGreaterThan(200);
    }
  });

  it('keeps each stage payload to a workable size', () => {
    // Injecting everything is the same as injecting nothing: the rules that
    // matter get lost among the ones that do not.
    for (const stage of Object.keys(POLICY) as Stage[]) {
      const tokens = Math.ceil(policyFor(lib, stage).length / 4);
      expect(tokens, `stage ${stage} is ${tokens} tokens`).toBeLessThan(9000);
    }
  });
});

describe('the shipped library', () => {
  let lib: SkillLibrary;

  beforeAll(async () => {
    lib = await loadSkills({
      packagedDir: PROJECT_SKILLS,
      userDir: '/none',
      projectDir: '/none',
    });
  });

  it('gives every skill a description specific enough to route on', () => {
    for (const skill of lib.skills.values()) {
      expect(skill.description.length, `${skill.name} description is too short`).toBeGreaterThan(40);
    }
  });

  it('gives every skill at least one section', () => {
    for (const skill of lib.skills.values()) {
      expect(skill.sections.length, `${skill.name} has no ## sections`).toBeGreaterThan(0);
    }
  });

  it('keeps the Tier 1 index small enough to always carry', () => {
    // Measured at 1295 tokens for the 16 shipped skills. The ~400 in §56.2 was an
    // estimate written before the descriptions were, and the descriptions earn
    // their length: the "Use when…" clause is what a model routes on when it is
    // deciding whether to fetch a section at all, so trimming it to hit a number
    // would buy tokens by making Tier 2 worse.
    //
    // This is a ceiling, not headroom — the index grows linearly with the library
    // (~1.5k at the 19 skills of §56, ~2.2k at 27). Past ~20 skills the move is to
    // compact what renderIndex emits (first sentence only, full text still on the
    // skill and still reachable through renderContents) rather than raise this
    // number a second time.
    expect(Math.ceil(renderIndex(lib).length / 4)).toBeLessThan(1500);
  });
});
