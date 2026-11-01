/**
 * Craft rules — the skill library compiled into executable checks.
 *
 * Making the skills *available* to a model is not enough. A model that has read
 * "cut, do not dissolve" will still emit a storyboard where every transition is
 * a crossfade, because nothing stopped it. These rules are what bind: every
 * generated storyboard is checked, violations are either repaired in place or
 * sent back to the model with the specific rule it broke, and a storyboard that
 * still fails an `error` rule never reaches the renderer.
 *
 * Each rule cites the skill section it derives from, so a rule can be traced
 * back to the craft reasoning that justifies it and neither can drift from the
 * other silently.
 *
 * Only mechanically checkable rules live here. "The hook should show the pain
 * rather than state it" is a real rule and is not in this file, because no
 * function can decide it — that one is enforced by injecting the beat-sheet
 * section into the prompt instead.
 */

import type { Scene, Storyboard } from './schema.js';
import { sceneEnd } from './schema.js';

export type Severity = 'error' | 'warning';

export interface Violation {
  rule: string;
  severity: Severity;
  message: string;
  /** JSON path into the storyboard, e.g. `scenes[2].transition.fade`. */
  path: string;
  /** Skill and section this rule comes from. */
  source: string;
  /** True when `repair()` can fix this without a judgement call. */
  repairable: boolean;
}

export interface CraftRule {
  id: string;
  severity: Severity;
  source: string;
  /** One line, for the prompt sent back to the model on a re-ask. */
  summary: string;
  check(sb: Storyboard): Violation[];
  /** Mutates a draft in place. Only defined where the fix is unambiguous. */
  repair?(sb: Storyboard, violations: Violation[]): void;
}

const CORE = 'saas-explainer-motion';

function v(
  rule: CraftRule,
  path: string,
  message: string,
  repairable = false
): Violation {
  return {
    rule: rule.id,
    severity: rule.severity,
    message,
    path,
    source: rule.source,
    repairable,
  };
}

/** Scenes whose motion is a frame move rather than an element entrance. */
const isMoving = (a: { x?: unknown; y?: unknown; scale?: unknown; rotate?: unknown }) =>
  a.x !== undefined || a.y !== undefined || a.scale !== undefined || a.rotate !== undefined;

/* ------------------------------------------------------------------ *
 * Rules
 * ------------------------------------------------------------------ */

/**
 * A crossfade says "unrelated image now", which reads as slideshow. Worse, a
 * scene at opacity < 1 becomes a backdrop root, so every glass panel inside it
 * goes flat for the length of the fade — at exactly the moment the viewer is
 * looking at the transition.
 */
const cutsNotCrossfades: CraftRule = {
  id: 'cuts-not-crossfades',
  severity: 'error',
  source: `${CORE} § Choosing the transition`,
  summary:
    'Hard cuts by default. At most two dissolves per film, and never on a scene containing glass.',
  check(sb) {
    const out: Violation[] = [];
    const dissolves = sb.scenes
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.transition.kind === 'dissolve' || s.transition.fade > 0);

    if (dissolves.length > 2) {
      for (const { s, i } of dissolves.slice(2)) {
        out.push(
          v(
            cutsNotCrossfades,
            `scenes[${i}].transition`,
            `scene "${s.id}" is the ${dissolves.indexOf(dissolves.find((d) => d.i === i)!) + 1}th dissolve; ` +
              `at most 2 per film. Crossfading every cut reads as a slideshow, and a fading ` +
              `scene becomes a backdrop root that flattens its own glass.`,
            true
          )
        );
      }
    }
    return out;
  },
  repair(sb, violations) {
    for (const violation of violations) {
      const m = /^scenes\[(\d+)\]/.exec(violation.path);
      if (!m) continue;
      const scene = sb.scenes[Number(m[1])];
      if (scene) scene.transition = { kind: 'cut', fade: 0 };
    }
  },
};

/**
 * Linear motion does not exist in the physical world; every object accelerates
 * and decelerates. It is correct only for continuous loops and typewriters,
 * where there is no start or stop to shape.
 */
const noLinearOnMotion: CraftRule = {
  id: 'no-linear-on-motion',
  severity: 'error',
  source: `${CORE} § Easing`,
  summary:
    'Never `linear` on a moving element — it is the most recognisable amateur tell. Entrances ease out.',
  check(sb) {
    const out: Violation[] = [];
    sb.scenes.forEach((scene, si) => {
      scene.animations.forEach((a, ai) => {
        if (a.ease === 'linear' && isMoving(a)) {
          out.push(
            v(
              noLinearOnMotion,
              `scenes[${si}].animations[${ai}].ease`,
              `"${a.target}" moves on a linear ease. Use \`outQuint\` for a general ` +
                `entrance or \`outExpo\` for a hero move; linear is for loops only.`,
              true
            )
          );
        }
      });
      if (scene.camera?.ease === 'linear') {
        out.push(
          v(
            noLinearOnMotion,
            `scenes[${si}].camera.ease`,
            `camera move in "${scene.id}" is linear. A camera has mass — use \`inOutCubic\`.`,
            true
          )
        );
      }
    });
    return out;
  },
  repair(sb, violations) {
    for (const violation of violations) {
      const m = /^scenes\[(\d+)\]\.(animations\[(\d+)\]|camera)/.exec(violation.path);
      if (!m) continue;
      const scene = sb.scenes[Number(m[1])];
      if (!scene) continue;
      if (m[2] === 'camera') {
        if (scene.camera) scene.camera.ease = 'inOutCubic';
      } else {
        const a = scene.animations[Number(m[3])];
        if (a) a.ease = 'outQuint';
      }
    }
  },
};

/**
 * A film is one continuous move, not N animations played in sequence. If every
 * scene eases to a halt, sits in dead air, then the next starts from zero, the
 * result feels templated. Ranges overlap so the outgoing scene is still
 * resolving as the incoming one begins; the engine narrows the paint window
 * separately so nothing double-paints.
 */
const scenesOverlap: CraftRule = {
  id: 'scenes-overlap',
  severity: 'warning',
  source: `${CORE} § Continuity`,
  summary:
    'Consecutive scene ranges must overlap by ~200-400ms so motion carries across the cut.',
  check(sb) {
    const out: Violation[] = [];
    for (let i = 1; i < sb.scenes.length; i++) {
      const prev = sb.scenes[i - 1]!;
      const cur = sb.scenes[i]!;
      const overlap = sceneEnd(prev) - cur.start;
      if (overlap < 120) {
        out.push(
          v(
            scenesOverlap,
            `scenes[${i}].start`,
            `"${prev.id}" -> "${cur.id}" overlap is ${overlap}ms. Below ~120ms the outgoing ` +
              `scene comes to a dead stop before the cut. Start "${cur.id}" ~300ms earlier.`,
            true
          )
        );
      }
    }
    return out;
  },
  repair(sb, violations) {
    for (const violation of violations) {
      const m = /^scenes\[(\d+)\]/.exec(violation.path);
      if (!m) continue;
      const i = Number(m[1]);
      const prev = sb.scenes[i - 1];
      const cur = sb.scenes[i];
      if (!prev || !cur) continue;
      const shift = 300 - (sceneEnd(prev) - cur.start);
      if (shift <= 0) continue;
      // Pull this scene and everything after it earlier by the shortfall, so the
      // overlap opens without changing any scene's own duration.
      for (let k = i; k < sb.scenes.length; k++) {
        sb.scenes[k]!.start = Math.max(0, sb.scenes[k]!.start - shift);
      }
    }
  },
};

/** 60-120ms. Under 50 reads as simultaneous and the sense of sequence is lost;
 *  over 200 and the last item feels forgotten. */
const staggerRange: CraftRule = {
  id: 'stagger-range',
  severity: 'warning',
  source: `${CORE} § Stagger`,
  summary: 'Stagger between siblings belongs in the 60-120ms band.',
  check(sb) {
    const out: Violation[] = [];
    sb.scenes.forEach((scene, si) => {
      scene.animations.forEach((a, ai) => {
        if (a.stagger === undefined || a.stagger === 0) return;
        if (a.stagger < 50 || a.stagger > 200) {
          out.push(
            v(
              staggerRange,
              `scenes[${si}].animations[${ai}].stagger`,
              `stagger ${a.stagger}ms on "${a.target}" is outside 60-120ms. ` +
                (a.stagger < 50
                  ? 'Below ~50ms the elements read as simultaneous.'
                  : 'Above ~200ms the last item feels forgotten.'),
              true
            )
          );
        }
      });
    });
    return out;
  },
  repair(sb, violations) {
    for (const violation of violations) {
      const m = /^scenes\[(\d+)\]\.animations\[(\d+)\]/.exec(violation.path);
      if (!m) continue;
      const a = sb.scenes[Number(m[1])]?.animations[Number(m[2])];
      if (a) a.stagger = Math.min(120, Math.max(60, a.stagger ?? 90));
    }
  },
};

/** Random order on text destroys reading direction. */
const noRandomStaggerOnText: CraftRule = {
  id: 'no-random-stagger-on-text',
  severity: 'error',
  source: `${CORE} § Stagger`,
  summary: '`staggerFrom: random` must never be used on text.',
  check(sb) {
    const out: Violation[] = [];
    const textish = new Set(['heading', 'hero', 'feature', 'badge']);
    sb.scenes.forEach((scene, si) => {
      scene.animations.forEach((a, ai) => {
        if (a.staggerFrom !== 'random') return;
        const el = scene.elements.find((e) => a.target.includes(e.id));
        if (el && textish.has(el.type)) {
          out.push(
            v(
              noRandomStaggerOnText,
              `scenes[${si}].animations[${ai}].staggerFrom`,
              `random stagger on text "${a.target}" destroys reading direction. Use \`start\`.`,
              true
            )
          );
        }
      });
    });
    return out;
  },
  repair(sb, violations) {
    for (const violation of violations) {
      const m = /^scenes\[(\d+)\]\.animations\[(\d+)\]/.exec(violation.path);
      if (!m) continue;
      const a = sb.scenes[Number(m[1])]?.animations[Number(m[2])];
      if (a) a.staggerFrom = 'start';
    }
  },
};

/** One push per beat. If two things need attention at once, that is two scenes.
 *  Past ~2.5x on a 1920 stage, text rasterises soft and glass edges get chunky. */
const cameraDiscipline: CraftRule = {
  id: 'camera-discipline',
  severity: 'error',
  source: `${CORE} § Camera`,
  summary: 'One camera move per scene, zoom at most 2.5x, and it leads the cursor.',
  check(sb) {
    const out: Violation[] = [];
    sb.scenes.forEach((scene, si) => {
      const cam = scene.camera;
      if (!cam) return;

      if (cam.zoom > 2.5) {
        out.push(
          v(
            cameraDiscipline,
            `scenes[${si}].camera.zoom`,
            `zoom ${cam.zoom}x in "${scene.id}" exceeds 2.5x; text rasterises soft past that.`,
            true
          )
        );
      }
      if (cam.at + cam.dur > scene.duration + 400) {
        out.push(
          v(
            cameraDiscipline,
            `scenes[${si}].camera`,
            `camera move in "${scene.id}" runs past the end of the scene.`
          )
        );
      }
      // The camera should start ~200-300ms BEFORE the cursor arrives; moving in
      // lockstep reads mechanical, a slight lead reads like anticipation.
      const firstCursor = scene.cursor[0];
      if (firstCursor && cam.at > firstCursor.at) {
        out.push(
          v(
            cameraDiscipline,
            `scenes[${si}].camera.at`,
            `camera starts after the cursor in "${scene.id}". Lead the cursor by 200-300ms.`,
            true
          )
        );
      }
    });
    return out;
  },
  repair(sb, violations) {
    for (const violation of violations) {
      const m = /^scenes\[(\d+)\]\.camera/.exec(violation.path);
      if (!m) continue;
      const scene = sb.scenes[Number(m[1])];
      if (!scene?.camera) continue;
      scene.camera.zoom = Math.min(2.5, scene.camera.zoom);
      const firstCursor = scene.cursor[0];
      if (firstCursor && scene.camera.at > firstCursor.at) {
        scene.camera.at = Math.max(0, firstCursor.at - 260);
      }
    }
  },
};

/**
 * The payoff is the moment the promise is kept, and the most commonly rushed
 * beat. Cutting away from it is like landing a joke and talking over the laugh.
 */
const payoffHold: CraftRule = {
  id: 'payoff-hold',
  severity: 'warning',
  source: `${CORE} § Holds`,
  summary: 'The payoff beat holds 600-900ms of stillness before the cut.',
  check(sb) {
    const out: Violation[] = [];
    sb.scenes.forEach((scene, si) => {
      if (scene.beat !== 'payoff') return;
      if (scene.hold < 600) {
        out.push(
          v(
            payoffHold,
            `scenes[${si}].hold`,
            `payoff scene "${scene.id}" holds ${scene.hold}ms. Give it 600-900ms — ` +
              `a cut landing the instant motion stops feels clipped.`,
            true
          )
        );
      }
    });
    return out;
  },
  repair(sb, violations) {
    for (const violation of violations) {
      const m = /^scenes\[(\d+)\]/.exec(violation.path);
      if (!m) continue;
      const scene = sb.scenes[Number(m[1])];
      if (scene) scene.hold = 750;
    }
  },
};

/** A viewer given two choices frequently makes neither. */
const singleCta: CraftRule = {
  id: 'single-cta',
  severity: 'error',
  source: `${CORE} § End card`,
  summary: 'Exactly one call to action in the whole film.',
  check(sb) {
    const ctas: string[] = [];
    sb.scenes.forEach((scene) => {
      if (scene.copy?.cta) ctas.push(`${scene.id}: "${scene.copy.cta}"`);
    });
    if (ctas.length === 1) return [];
    if (ctas.length === 0) {
      return [
        v(singleCta, 'scenes', 'No call to action. The film needs exactly one.'),
      ];
    }
    return [
      v(
        singleCta,
        'scenes',
        `${ctas.length} calls to action (${ctas.join(', ')}). Keep one — ` +
          `a viewer given two choices frequently makes neither.`
      ),
    ];
  },
};

/**
 * An unattributed statistic is worse than no statistic: it reads as marketing
 * noise and quietly discounts everything else on screen.
 */
const attributedStats: CraftRule = {
  id: 'attributed-stats',
  severity: 'error',
  source: `${CORE} § Proof`,
  summary: 'Every on-screen statistic carries its source, or is cut.',
  check(sb) {
    const out: Violation[] = [];
    // A number with a unit or multiplier is a claim; a bare small integer
    // (a row count, a step number) is not.
    const claim = /\d\s*(%|x|×|\bhours?\b|\bmins?\b|\bdays?\b|k\b|m\b|bn\b)/i;
    sb.scenes.forEach((scene, si) => {
      scene.elements.forEach((el, ei) => {
        const text = `${el.value ?? ''} ${el.text ?? ''}`.trim();
        if (!text || !claim.test(text)) return;
        if (!el.attribution) {
          out.push(
            v(
              attributedStats,
              `scenes[${si}].elements[${ei}].attribution`,
              `"${text}" in "${scene.id}" is an unsourced claim. Add an attribution ` +
                `("internal data, 240 teams, Q2 2025") or use a qualitative beat instead.`
            )
          );
        }
      });
    });
    return out;
  },
};

/** Beats of identical length are hypnotic in the bad way. */
const varyBeatLength: CraftRule = {
  id: 'vary-beat-length',
  severity: 'warning',
  source: `${CORE} § Pacing`,
  summary: 'No two adjacent scenes share a duration.',
  check(sb) {
    const out: Violation[] = [];
    for (let i = 1; i < sb.scenes.length; i++) {
      const prev = sb.scenes[i - 1]!;
      const cur = sb.scenes[i]!;
      if (Math.abs(prev.duration - cur.duration) < 150) {
        out.push(
          v(
            varyBeatLength,
            `scenes[${i}].duration`,
            `"${prev.id}" and "${cur.id}" are both ~${cur.duration}ms. Length should follow ` +
              `what the beat is doing, never a template.`
          )
        );
      }
    }
    return out;
  },
};

/** Film type is much larger than UI type. Text at 16px is a cheap tell. */
const readableType: CraftRule = {
  id: 'readable-type',
  severity: 'warning',
  source: `${CORE} § Typography`,
  summary: 'Body copy is at least 24px on a 1920-wide stage.',
  check(sb) {
    const out: Violation[] = [];
    const scale = sb.resolution.width / 1920;
    const floor = Math.round(24 * scale);
    sb.scenes.forEach((scene, si) => {
      const size = scene.copy?.bodySize;
      if (size !== undefined && size < floor) {
        out.push(
          v(
            readableType,
            `scenes[${si}].copy.bodySize`,
            `body copy at ${size}px in "${scene.id}"; the floor is ${floor}px at this ` +
              `resolution. Small type is the clearest tell of a template.`,
            true
          )
        );
      }
    });
    return out;
  },
  repair(sb, violations) {
    const floor = Math.round(24 * (sb.resolution.width / 1920));
    for (const violation of violations) {
      const m = /^scenes\[(\d+)\]/.exec(violation.path);
      if (!m) continue;
      const scene = sb.scenes[Number(m[1])];
      if (scene?.copy) scene.copy.bodySize = floor;
    }
  },
};

/**
 * Film runs 1.5-2.5x slower than the same move in a shipping app, because when
 * something appears across a 1920px frame the viewer's gaze needs 200-300ms just
 * to arrive. Animate it in 250ms and they register a flicker, not a movement.
 */
const filmClock: CraftRule = {
  id: 'film-clock',
  severity: 'warning',
  source: `${CORE} § Timing: two clocks`,
  summary: 'Entrances run on the film clock (400ms+), not UI timings.',
  check(sb) {
    const out: Violation[] = [];
    // The engine's own gesture timing, from `cursorTo`: travel, a `settle` beat,
    // then `press`, and only then does the UI react — `respondAt = at + travel +
    // settle + press + latency`. Neither settle nor press is in the storyboard
    // vocabulary, so their engine defaults are mirrored here. Using
    // `at + travel + latency` instead puts this window 210ms early, which flags
    // exactly the responses that were placed correctly.
    const SETTLE = 120;
    const PRESS = 90;

    sb.scenes.forEach((scene, si) => {
      scene.animations.forEach((a, ai) => {
        // Product UI reacting to a cursor is the deliberate exception: a fake
        // button clicked by a fake cursor must respond on the UI clock.
        const isUiResponse = scene.cursor.some(
          (c) => Math.abs(c.at + c.travel + SETTLE + PRESS + c.latency - a.at) < 200
        );
        if (!isUiResponse && a.dur < 320 && isMoving(a)) {
          out.push(
            v(
              filmClock,
              `scenes[${si}].animations[${ai}].dur`,
              `"${a.target}" moves in ${a.dur}ms. On a 1920px stage the eye needs ` +
                `200-300ms just to travel there — under ~320ms it reads as a flicker. ` +
                `Film entrances are 400-600ms.`,
              true
            )
          );
        }
      });
    });
    return out;
  },
  repair(sb, violations) {
    for (const violation of violations) {
      const m = /^scenes\[(\d+)\]\.animations\[(\d+)\]/.exec(violation.path);
      if (!m) continue;
      const a = sb.scenes[Number(m[1])]?.animations[Number(m[2])];
      if (a) a.dur = Math.max(a.dur, 480);
    }
  },
};

/**
 * Strictly sequential animation with dead air between beats is the single
 * clearest tell of an amateur explainer. Start the next element while the
 * previous is 60-70% through.
 */
const overlapNotQueue: CraftRule = {
  id: 'overlap-not-queue',
  severity: 'warning',
  source: `${CORE} § Overlap, do not queue`,
  summary: 'Motion overlaps at 60-70%; never queue one move strictly after another.',
  check(sb) {
    const out: Violation[] = [];
    sb.scenes.forEach((scene, si) => {
      const sorted = [...scene.animations].sort((a, b) => a.at - b.at);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]!;
        const cur = sorted[i]!;
        const gap = cur.at - (prev.at + prev.dur);
        if (gap > 200) {
          out.push(
            v(
              overlapNotQueue,
              `scenes[${si}].animations`,
              `${gap}ms of dead air between "${prev.target}" and "${cur.target}" in ` +
                `"${scene.id}". Start the next move at ~65% of the previous one.`
            )
          );
        }
      }
    });
    return out;
  },
};

export const CRAFT_RULES: readonly CraftRule[] = [
  cutsNotCrossfades,
  noLinearOnMotion,
  scenesOverlap,
  staggerRange,
  noRandomStaggerOnText,
  cameraDiscipline,
  payoffHold,
  singleCta,
  attributedStats,
  varyBeatLength,
  readableType,
  filmClock,
  overlapNotQueue,
];

export interface CraftReport {
  violations: Violation[];
  errors: Violation[];
  warnings: Violation[];
  ok: boolean;
}

export function checkCraft(sb: Storyboard): CraftReport {
  const violations = CRAFT_RULES.flatMap((rule) => rule.check(sb));
  const errors = violations.filter((x) => x.severity === 'error');
  return {
    violations,
    errors,
    warnings: violations.filter((x) => x.severity === 'warning'),
    ok: errors.length === 0,
  };
}

/**
 * Repair what can be repaired without a judgement call, then re-check.
 *
 * Anything left is something only the model can fix — a second call to action
 * is a *content* decision, and silently deleting one would be worse than asking.
 * Those come back as `remaining`, to be sent to the model with the rule text.
 */
export function repairCraft(sb: Storyboard): {
  storyboard: Storyboard;
  repaired: Violation[];
  remaining: Violation[];
} {
  const draft: Storyboard = structuredClone(sb);
  const before = checkCraft(draft).violations;

  for (const rule of CRAFT_RULES) {
    if (!rule.repair) continue;
    const mine = before.filter((x) => x.rule === rule.id && x.repairable);
    if (mine.length) rule.repair(draft, mine);
  }

  const after = checkCraft(draft);
  const stillThere = new Set(after.violations.map((x) => `${x.rule}@${x.path}`));
  return {
    storyboard: draft,
    repaired: before.filter((x) => !stillThere.has(`${x.rule}@${x.path}`)),
    remaining: after.violations,
  };
}

/** Violations rendered for a model re-ask: the rule, why it exists, and where. */
export function formatForModel(violations: Violation[]): string {
  if (!violations.length) return '';
  const byRule = new Map<string, Violation[]>();
  for (const x of violations) {
    const list = byRule.get(x.rule) ?? [];
    list.push(x);
    byRule.set(x.rule, list);
  }

  const lines: string[] = [
    'The storyboard violates these craft rules. Fix each and return the corrected JSON.',
    '',
  ];
  for (const [id, group] of byRule) {
    const rule = CRAFT_RULES.find((r) => r.id === id);
    lines.push(`## ${id} (${group[0]!.severity})`);
    if (rule) lines.push(`${rule.summary}  — ${rule.source}`);
    for (const x of group) lines.push(`  - ${x.path}: ${x.message}`);
    lines.push('');
  }
  return lines.join('\n');
}
