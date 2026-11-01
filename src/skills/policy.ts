/**
 * Tier 3 — stage policy.
 *
 * Sections that are injected whether or not the model asks for them, keyed by
 * what the pipeline is doing at that moment.
 *
 * The reasoning: Tier 2 retrieval only fires when a model recognises that it
 * needs something. That works for a question it knows it has ("how do I morph a
 * path?") and fails for the rules it does not know it is about to break. A model
 * writing a camera move does not think to ask about backdrop roots — so the
 * camera section is injected at scene-compile time, every time, at a cost of
 * about a thousand tokens.
 *
 * Keep each stage's list short. Injecting everything is the same as injecting
 * nothing: the rules that matter here get lost in the ones that do not.
 */

import type { SectionRequest, SkillLibrary } from './library.js';
import { collectSections } from './library.js';

export type Stage =
  | 'analyze'
  | 'storyboard'
  | 'compile'
  | 'style'
  | 'audio'
  | 'edit';

const CORE = 'saas-explainer-motion';

/**
 * Section titles are matched case-insensitively and by substring, so these
 * survive a heading being reworded. A section that no longer resolves is
 * skipped silently rather than failing the stage — but `verifyPolicy()` reports
 * it, and the test suite asserts every reference resolves.
 */
export const POLICY: Record<Stage, readonly SectionRequest[]> = {
  /** Choosing what in the product is worth filming. */
  analyze: [
    { skill: CORE, section: 'THE INPUTS THAT CHANGE THE BUILD' },
    { skill: 'brand-extraction', section: 'What to extract' },
  ],

  /** Turning ranked UI into a beat sheet. The largest injection, because this
   *  is where a film's structure is decided and structure is unrecoverable
   *  later — no amount of polish saves a film with no spine.
   *
   *  Pacing lives inside the beat-sheet section as a `###`, so it arrives with
   *  it; the loader keeps subsections attached to their parent deliberately,
   *  because a subsection alone usually lacks the context to be useful. */
  storyboard: [
    { skill: CORE, section: 'WRITE THE BEAT SHEET BEFORE THE CODE' },
    { skill: CORE, section: 'Timing: two clocks' },
    { skill: CORE, section: 'Continuity' },
    { skill: CORE, section: 'Tells: cheap vs premium' },
    { skill: 'storyboard-schema', section: 'Craft rules' },
  ],

  /** Emitting markup and records for one scene.
   *
   *  The camera rules live inside `Cursor choreography` — the two are one topic
   *  in the source, since the camera follows the cursor. */
  compile: [
    { skill: CORE, section: 'Cursor choreography' },
    { skill: CORE, section: 'Liquid Glass' },
    { skill: CORE, section: 'Precedence' },
    { skill: 'ui-mockup-rebuild', section: 'The component vocabulary' },
  ],

  /** Preset, palette and typeface. The preset table is a `###` inside
   *  `Liquid Glass`, which is the right unit to inject anyway — a preset is a
   *  colour and material decision. */
  style: [
    { skill: CORE, section: 'Liquid Glass' },
    { skill: CORE, section: 'Typography' },
    { skill: 'brand-extraction', section: 'Contrast' },
  ],

  /** Cue placement and the music bed. */
  audio: [
    { skill: 'motion-audio', section: 'Design for silence first' },
    { skill: 'motion-audio', section: 'Sound effects' },
    { skill: CORE, section: 'Sound' },
  ],

  /** Conversational revision of an existing storyboard.
   *
   *  The pacing rules an edit needs — vary beat length, breathe after density,
   *  overlap rather than queue — are a `###` inside the beat-sheet section, so
   *  the parent is what has to be named here. Promoting `### Pacing` to a `##`
   *  in the skill would resolve this reference and silently drop pacing out of
   *  the `storyboard` injection above, which is the worse trade. */
  edit: [
    { skill: CORE, section: 'WRITE THE BEAT SHEET BEFORE THE CODE' },
    { skill: CORE, section: 'Continuity' },
  ],
};

/** The Tier 3 payload for a stage, ready to append to a system prompt. */
export function policyFor(lib: SkillLibrary, stage: Stage): string {
  const refs = POLICY[stage];
  const body = collectSections(lib, refs);
  if (!body) return '';
  return `# Craft guidance for this step\n\n${body}`;
}

/**
 * Which policy references do not resolve against the loaded library.
 *
 * A silently-skipped section is a rule that quietly stopped being enforced, and
 * the failure is invisible: films keep rendering, they just get slightly worse.
 * The test suite asserts this returns empty.
 */
export function verifyPolicy(lib: SkillLibrary): {
  stage: Stage;
  ref: SectionRequest;
  reason: string;
}[] {
  const problems: { stage: Stage; ref: SectionRequest; reason: string }[] = [];

  for (const stage of Object.keys(POLICY) as Stage[]) {
    for (const ref of POLICY[stage]) {
      const skill = lib.skills.get(ref.skill);
      if (!skill) {
        problems.push({ stage, ref, reason: `no skill named "${ref.skill}"` });
        continue;
      }
      if (!ref.section) continue;

      const want = ref.section.toLowerCase();
      const hit = skill.sections.some(
        (s) => s.title.toLowerCase() === want || s.title.toLowerCase().includes(want)
      );
      if (!hit) {
        problems.push({
          stage,
          ref,
          reason: `skill "${ref.skill}" has no section matching "${ref.section}"`,
        });
      }
    }
  }
  return problems;
}
