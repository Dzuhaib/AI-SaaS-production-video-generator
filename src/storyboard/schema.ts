/**
 * The storyboard schema — the contract between AI intelligence and deterministic
 * rendering.
 *
 * The AI decides WHAT, WHEN and WHY, and emits nothing but a value that parses
 * here. The compiler and engine decide HOW: markup, records, interpolation,
 * frames, encoding. That separation is what makes a render reproducible, and it
 * is why the model is never allowed to emit CSS, HTML or timing code.
 *
 * All times are milliseconds. All positions are pixels in the film's own fixed
 * stage space (1920x1080 by default), never viewport units and never percentages
 * of something responsive.
 */

import { z } from 'zod';

import { DELIVERY_PROFILES, FPS_VALUES, exactFps } from '../shared/broadcast.js';

/** Bump when a change would stop an existing storyboard from rendering. */
export const SCHEMA_VERSION = 1;

/* ------------------------------------------------------------------ *
 * Vocabularies
 * ------------------------------------------------------------------ */

/**
 * Beats, in the order that works. The order is problem-first on purpose: a
 * viewer who has not yet felt the problem has no slot to put the product into,
 * so the product must arrive as relief rather than as a feature list.
 */
export const BEATS = [
  'hook', // show the pain, no narration, no headline first
  'stakes', // one number going the wrong way
  'reveal', // hard cut; product name + one line
  'how', // the only beat with real UI, and only a crop of it
  'payoff', // it worked; let the moment land
  'proof', // counted numbers, attributed
  'end', // one action, held long enough to read
] as const;
export type Beat = (typeof BEATS)[number];

/** Scene renderers. Each owns its markup and its records in the compiler. */
export const SCENE_TYPES = [
  'hero',
  'dashboard',
  'feature',
  'scroll',
  'zoom',
  'device',
  'text',
  'logo',
  'cta',
  'transition',
  'capture',
] as const;
export type SceneType = (typeof SCENE_TYPES)[number];

/**
 * `rebuild` reconstructs the UI from glass components using content harvested
 * from the real site: it can zoom, respond to a cursor, and animate a row in.
 * `capture` composites real captured frames — pixel-exact, but flat. It goes
 * soft past about 1.5x push-in and cannot respond to a cursor, so it is the
 * fallback for pages too custom to rebuild faithfully, not the default.
 */
export const SCENE_MODES = ['rebuild', 'capture'] as const;

export const TRANSITIONS = ['cut', 'dissolve', 'match', 'whip'] as const;
export type TransitionKind = (typeof TRANSITIONS)[number];

/** Every ease the engine resolves. An unknown name silently degrades to
 *  `outQuint`, so the schema rejects unknown names rather than let a typo
 *  produce motion that looks *almost* right. */
export const EASES = [
  'linear',
  'outExpo',
  'outQuint',
  'outQuart',
  'outCubic',
  'outCirc',
  'outBack',
  'inExpo',
  'inCubic',
  'inQuart',
  'inOutCubic',
  'inOutQuart',
  'inOutQuint',
  'inOutCirc',
  'softLand',
  'standard',
  'uiOut',
  'uiInOut',
  'spring',
  'springSoft',
  'springSnappy',
] as const;
export type Ease = (typeof EASES)[number];

export const ELEMENT_TYPES = [
  'hero',
  'heading',
  'button',
  'card',
  'chart',
  'image',
  'video',
  'navigation',
  'dashboard',
  'form',
  'table',
  'modal',
  'feature',
  'logo',
  'metric',
  'row',
  'badge',
  'toast',
] as const;

export const PRESETS = ['apple', 'light', 'midnight', 'warm', 'mono'] as const;
export const ASPECTS = ['16:9', '1:1', '9:16', '4:5'] as const;
export type Aspect = (typeof ASPECTS)[number];

/** Canonical pixel dimensions per aspect. The Timeline constructor and the
 *  `data-aspect` attribute must agree or the preview centres correctly while
 *  the export crops wrongly. */
export const ASPECT_DIMENSIONS: Record<Aspect, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '4:5': { width: 1080, height: 1350 },
};

/* ------------------------------------------------------------------ *
 * Leaf schemas
 * ------------------------------------------------------------------ */

const hexColour = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'expected a hex colour');

/**
 * A font family name, as measured from a site's computed style.
 *
 * Constrained at the schema rather than trusted, because this value is written
 * into a CSS custom property (`compiler/theme.ts`) where the escaping that
 * protects HTML text does not apply: a `;` or `}` in a family name closes the
 * declaration and everything after it is attacker-authored CSS. The character
 * set here is what a real family name uses and nothing else.
 */
const fontFamily = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[A-Za-z0-9 _.-]+$/,
    'a font family may contain only letters, digits, spaces, underscores, dots and hyphens'
  );

/**
 * Inline SVG for the logo.
 *
 * `browser/svg-sanitize.ts` is what makes this safe, and it runs at the browser
 * boundary. This is the second gate, for the paths that do not come through the
 * crawler at all — a hand-edited `.urlume/storyboard/main.json`, a storyboard
 * from `urlume check`, or a model that decided to invent one. It rejects the
 * constructs that carry script; it does not attempt to re-implement the
 * sanitiser.
 */
const inlineSvg = z
  .string()
  .max(24_000)
  .refine((s) => /^\s*<svg[\s>]/i.test(s), 'must be an inline <svg> element')
  .refine(
    (s) => !/<\s*(script|foreignObject|iframe|object|embed|use|image|animate|set)\b/i.test(s),
    'contains an element that can execute or fetch (script, foreignObject, use, image, animate, …)'
  )
  .refine((s) => !/\son[a-z]+\s*=/i.test(s), 'contains an event handler attribute')
  .refine((s) => !/xlink:href|javascript:|data:|vbscript:/i.test(s), 'contains an external or scripted reference');

export const brandSchema = z.object({
  accent: hexColour,
  accentSecondary: hexColour.optional(),
  background: hexColour.optional(),
  scheme: z.enum(['light', 'dark']).default('dark'),
  fontDisplay: fontFamily.optional(),
  fontText: fontFamily.optional(),
  /** Modal border-radius across the site's components, in px. */
  radius: z.number().int().min(0).max(64).optional(),
  logoSvg: inlineSvg.optional(),
  productName: z.string().min(1),
  tagline: z.string().optional(),
});
export type Brand = z.infer<typeof brandSchema>;

/**
 * A camera move. Exactly one per beat: if two things need attention at once,
 * that is two scenes. `target` names an element the compiler resolves to a
 * stage coordinate, so no film hand-writes camera arithmetic.
 */
export const cameraSchema = z.object({
  target: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  /** 1.4-2.2 is the useful range; past ~2.5 text rasterises soft. */
  zoom: z.number().min(1).max(2.5).default(1),
  at: z.number().int().min(0),
  dur: z.number().int().min(200).max(4000).default(1000),
  /** A camera has mass. `inOutCubic` accelerates and decelerates; `outExpo` is
   *  right for a UI element snapping in and wrong for a frame move. */
  ease: z.enum(EASES).default('inOutCubic'),
});
export type CameraMove = z.infer<typeof cameraSchema>;

export const elementSchema = z.object({
  id: z.string().min(1),
  type: z.enum(ELEMENT_TYPES),
  /** Selector on the *real* site this element was harvested from, for
   *  traceability. The film never queries it. */
  sourceSelector: z.string().optional(),
  text: z.string().optional(),
  secondary: z.string().optional(),
  value: z.string().optional(),
  /** Attribution for a statistic. Enforced by the craft rules: an unsourced
   *  number reads as marketing noise and discounts everything around it. */
  attribution: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  /** 0..1, from the analyzer's heuristic ranking. */
  importance: z.number().min(0).max(1).default(0.5),
});
export type StoryboardElement = z.infer<typeof elementSchema>;

export const animationSchema = z.object({
  target: z.string().min(1),
  at: z.number().int().min(0),
  dur: z.number().int().min(60).max(6000),
  ease: z.enum(EASES),
  /** 60-120ms. Under 50 reads as simultaneous; over 200 and the last item
   *  feels forgotten. */
  stagger: z.number().int().min(0).max(400).optional(),
  staggerFrom: z.enum(['start', 'end', 'center', 'edges', 'random']).optional(),
  opacity: z.tuple([z.number(), z.number()]).optional(),
  x: z.tuple([z.number(), z.number()]).optional(),
  y: z.tuple([z.number(), z.number()]).optional(),
  scale: z.tuple([z.number(), z.number()]).optional(),
  rotate: z.tuple([z.number(), z.number()]).optional(),
  blur: z.tuple([z.number(), z.number()]).optional(),
  /**
   * Real 3D rotation, in degrees. The engine has always interpolated these; the
   * schema simply never exposed them, so a film could not tilt a panel into frame
   * and every entrance was a flat slide.
   *
   * Bounded well inside legibility: past ~35 degrees a text panel is being read
   * edge-on and the type stops being readable, which is worse than no depth.
   */
  rotateY: z.tuple([z.number().min(-60).max(60), z.number().min(-60).max(60)]).optional(),
  rotateX: z.tuple([z.number().min(-60).max(60), z.number().min(-60).max(60)]).optional(),
  /** Z translation, px. Needs a `.scene-3d` ancestor to foreshorten. */
  z: z.tuple([z.number(), z.number()]).optional(),
});
export type Animation = z.infer<typeof animationSchema>;

export const cueSchema = z.object({
  name: z.enum([
    'click',
    'tick',
    'key',
    'pop',
    'whoosh',
    'thump',
    'chime',
    'success',
    'error',
    'riser',
    'toggle',
    'pad',
    'transition',
    'impact',
    'notify',
    'appear',
  ]),
  at: z.number().int().min(0),
  gain: z.number().min(0).max(2).optional(),
  pitch: z.number().min(0.25).max(4).optional(),
});

/** A cursor gesture: travel on an arc, settle, press, release, and the UI
 *  responds one beat later. This is what turns a mockup into a demonstration. */
export const cursorSchema = z.object({
  target: z.string().min(1),
  at: z.number().int().min(0),
  travel: z.number().int().min(200).max(1400).default(620),
  click: z.boolean().default(true),
  /** 80-140ms. Instant response reads as fake; real software has latency. */
  latency: z.number().int().min(60).max(220).default(110),
});

export const copySchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string().optional(),
  body: z.string().optional(),
  cta: z.string().optional(),
  /** px. Film type is much larger than UI type; the craft rules floor body
   *  copy at 24px because text at 16px is a cheap tell. */
  bodySize: z.number().int().min(14).max(160).optional(),
});

/**
 * What is said, or what a caption should say where nothing is said.
 *
 * This is the only source a caption file can be built from, which is why it is
 * a first-class field rather than something inferred from `copy`: a headline is
 * a design element that happens to be words, and captioning it verbatim
 * produces the redundant "[on-screen text repeated]" track that access-services
 * reviewers reject.
 *
 * Timings are relative to the scene, so a scene can be moved without rewriting
 * its narration. Omitting them spans the scene.
 */
export const narrationSchema = z.object({
  text: z.string().min(1).max(1000),
  /** Offset from scene start, ms. */
  at: z.number().int().min(0).default(0),
  /** Ms. Defaults to the rest of the scene. */
  dur: z.number().int().min(400).max(20000).optional(),
  /** Non-speech audio worth captioning: "[soft chime]". Rendered in brackets,
   *  per both Ofcom and FCC convention. */
  sound: z.boolean().default(false),
  /** Who is speaking, when it is not obvious. */
  speaker: z.string().max(60).optional(),
});
export type Narration = z.infer<typeof narrationSchema>;

/* ------------------------------------------------------------------ *
 * Scene
 * ------------------------------------------------------------------ */

export const sceneSchema = z.object({
  id: z.string().min(1),
  beat: z.enum(BEATS),
  type: z.enum(SCENE_TYPES),
  mode: z.enum(SCENE_MODES).default('rebuild'),
  /** Absolute start on the film timeline. Scene ranges deliberately *overlap*
   *  so motion carries across a cut — the engine derives an exclusive paint
   *  window separately, so an overlap never double-paints. */
  start: z.number().int().min(0),
  duration: z.number().int().min(400).max(20000),
  /** Route on the analyzed project this scene draws its content from. */
  route: z.string().optional(),
  transition: z
    .object({
      kind: z.enum(TRANSITIONS).default('cut'),
      /** 0 is a hard cut, and the default. A scene at opacity < 1 becomes a
       *  backdrop root, so a dissolve silently flattens its own glass. */
      fade: z.number().int().min(0).max(1200).default(0),
    })
    .default({ kind: 'cut', fade: 0 }),
  camera: cameraSchema.optional(),
  copy: copySchema.optional(),
  /** Spoken or captioned lines for this scene. The only source a caption
   *  sidecar is built from — see `renderer/captions.ts`. */
  narration: z.array(narrationSchema).default([]),
  elements: z.array(elementSchema).default([]),
  animations: z.array(animationSchema).default([]),
  cursor: z.array(cursorSchema).default([]),
  cues: z.array(cueSchema).default([]),
  /** Stillness before the cut. Dead air is a feature: a cut landing the instant
   *  motion stops feels clipped. */
  hold: z.number().int().min(0).max(2000).default(0),
  notes: z.string().optional(),
});
export type Scene = z.infer<typeof sceneSchema>;

/* ------------------------------------------------------------------ *
 * Storyboard
 * ------------------------------------------------------------------ */

export const storyboardSchema = z
  .object({
    version: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
    product: z.string().min(1),
    /** The single idea the film carries. If you cannot write it, the film has
     *  no spine and no amount of motion will give it one. */
    thesis: z.string().min(1).optional(),
    duration: z.number().int().min(3000).max(180000),
    /**
     * Frame rate.
     *
     * The set spans both regions rather than only the web-native integers: 25
     * and 50 are the UK/EU broadcast cadences, 23.976/29.97/59.94 the US ones.
     * A label here is a *name* — the exact rate is the rational in
     * `shared/broadcast.ts`, and it is that rational, not this decimal, that
     * reaches ffmpeg and the engine.
     */
    fps: z
      .number()
      .refine((v) => FPS_VALUES.includes(v), {
        message: `fps must be one of ${FPS_VALUES.join(', ')}`,
      })
      .default(30),
    /**
     * Where the film is going. Decides loudness target, expected cadence and
     * GOP structure at encode time; reported against by `conformance()` before
     * a frame is rendered.
     */
    delivery: z.enum(DELIVERY_PROFILES).default('web'),
    aspect: z.enum(ASPECTS).default('16:9'),
    resolution: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    preset: z.enum(PRESETS).default('apple'),
    brand: brandSchema,
    scenes: z.array(sceneSchema).min(1),
    audio: z
      .object({
        enabled: z.boolean().default(true),
        bed: z.enum(['none', 'dark_glass_synth', 'upbeat_corporate', 'minimal_chill']).default('none'),
      })
      .default({ enabled: true, bed: 'none' }),
  })
  .superRefine((sb, ctx) => {
    // The engine derives frame count from `duration`, and `data-aspect` sets the
    // canvas on first paint. A mismatch gives a correctly-centred preview and a
    // wrongly-cropped video, which is the kind of bug you only find in the export.
    const expected = ASPECT_DIMENSIONS[sb.aspect];
    if (
      sb.resolution.width !== expected.width ||
      sb.resolution.height !== expected.height
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['resolution'],
        message:
          `resolution ${sb.resolution.width}x${sb.resolution.height} does not match ` +
          `aspect ${sb.aspect} (expected ${expected.width}x${expected.height}). ` +
          `The preview would centre correctly and the export would crop wrongly.`,
      });
    }

    // H.264 cannot encode odd dimensions without a scale filter.
    if (sb.resolution.width % 2 !== 0 || sb.resolution.height % 2 !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['resolution'],
        message: 'width and height must both be even for H.264 encoding',
      });
    }

    // Scenes must be in timeline order so a paint window can be derived from
    // neighbours.
    for (let i = 1; i < sb.scenes.length; i++) {
      const prev = sb.scenes[i - 1]!;
      const cur = sb.scenes[i]!;
      if (cur.start < prev.start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scenes', i, 'start'],
          message: `scene "${cur.id}" starts before "${prev.id}"; scenes must be in timeline order`,
        });
      }
    }

    const last = sb.scenes[sb.scenes.length - 1]!;
    const end = last.start + last.duration;
    if (end > sb.duration) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['duration'],
        message:
          `scenes run to ${end}ms but duration is ${sb.duration}ms; ` +
          `the last ${end - sb.duration}ms would be cut off`,
      });
    }

    const ids = new Set<string>();
    for (const [i, scene] of sb.scenes.entries()) {
      if (ids.has(scene.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scenes', i, 'id'],
          message: `duplicate scene id "${scene.id}"`,
        });
      }
      ids.add(scene.id);
    }
  });

export type Storyboard = z.infer<typeof storyboardSchema>;

/** Frame count the renderer will produce. Derived from duration, never counted.
 *  Uses the *exact* rate — at 29.97 the difference from the decimal is a frame
 *  every 17 minutes, which is a sync fault rather than a rounding detail. */
export function frameCount(sb: Pick<Storyboard, 'duration' | 'fps'>): number {
  return Math.round((sb.duration / 1000) * exactFps(sb.fps));
}

/** End of a scene's declared range. Distinct from its paint window, which the
 *  engine narrows to the moment the next non-overlay scene starts. */
export function sceneEnd(scene: Pick<Scene, 'start' | 'duration'>): number {
  return scene.start + scene.duration;
}
