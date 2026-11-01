/**
 * Storyboard generation — the one place a model is allowed to make a decision.
 *
 * This is the funnel §58 describes. A model emits JSON; Zod checks its shape; the
 * craft rules check its judgement; mechanical faults are repaired in place and
 * content faults go back to the model with the rule text. Nothing reaches the
 * compiler until it is clean, and no AI runs below that line (§29.2) — which is
 * what makes a render reproducible.
 *
 * The loop is bounded on purpose (§29.1). After a few attempts on the same
 * violation urlume reports it rather than looping: a user would rather read "this
 * film has two calls to action" than watch a spinner burn tokens.
 */

import { z } from 'zod';

import type { AIProvider } from '../providers/types.js';
import { extractJson, ProviderError } from '../providers/types.js';
import { LAWS } from '../skills/laws.js';
import { policyFor, type Stage } from '../skills/policy.js';
import { renderIndex, type SkillLibrary } from '../skills/library.js';
import type { RouteAnalysis } from '../browser/analyze.js';
import { rankFeatures } from '../browser/features.js';
import {
  storyboardSchema,
  ASPECT_DIMENSIONS,
  BEATS,
  SCENE_TYPES,
  EASES,
  ELEMENT_TYPES,
  PRESETS,
  type Aspect,
  type Storyboard,
} from './schema.js';
import {
  DELIVERY_PROFILES,
  deliverySpec,
  type DeliveryProfile,
} from '../shared/broadcast.js';
import {
  checkCraft,
  repairCraft,
  formatForModel,
  type Violation,
} from './craft-rules.js';

export interface GenerateStoryboardOptions {
  provider: AIProvider;
  model: string;
  skills: SkillLibrary;
  /** Ranked pages from the analyzer. The first is treated as the primary. */
  analysis: RouteAnalysis[];
  /** What the user asked for, in their own words. */
  prompt?: string | undefined;
  durationMs?: number | undefined;
  aspect?: Aspect | undefined;
  preset?: string | undefined;
  /**
   * Where the film is going. Decides the loudness target and the expected
   * cadence at encode time, so it has to be settled before the storyboard is
   * written rather than patched onto the MP4 afterwards — a UK master is 25fps
   * from the first frame, not 30fps conformed later.
   */
  delivery?: DeliveryProfile | undefined;
  /** Overrides the delivery profile's native cadence. Rarely what you want. */
  fps?: number | undefined;
  /** Attempts at the *whole* generation, including re-asks. */
  maxAttempts?: number | undefined;
  signal?: AbortSignal | undefined;
  onEvent?: ((e: GenerateEvent) => void) | undefined;
}

export type GenerateEvent =
  | { type: 'prompt'; tokensEstimate: number }
  | { type: 'attempt'; n: number; of: number }
  | { type: 'received'; chars: number }
  | { type: 'schema-failed'; issues: string[] }
  | { type: 'repaired'; violations: Violation[] }
  | { type: 'reask'; violations: Violation[] }
  | { type: 'ok'; storyboard: Storyboard; warnings: Violation[] };

export interface GenerateResult {
  storyboard: Storyboard;
  /** Survived repair and are being accepted. Warnings never block (§57.2). */
  warnings: Violation[];
  repaired: Violation[];
  attempts: number;
}

/* ------------------------------------------------------------------ *
 * The prompt
 * ------------------------------------------------------------------ */

/**
 * The output contract, written as a compact vocabulary listing rather than as a
 * JSON Schema.
 *
 * A generated JSON Schema for `storyboardSchema` runs to thousands of tokens and
 * models follow it no better than they follow this. What actually prevents invalid
 * output is that every enum is stated exhaustively — a model inventing `easeOut`
 * is the single most common failure, and it costs a full round trip.
 */
function contract(sb: {
  duration: number;
  aspect: Aspect;
  width: number;
  height: number;
  preset: string;
  fps: number;
  delivery: DeliveryProfile;
}): string {
  return `# Output contract

Return ONE JSON object and nothing else. No prose, no code fence.

\`\`\`
{
  "product":    string,
  "thesis":     string   — the single idea the film carries, one sentence
  "duration":   ${sb.duration},
  "fps":        ${sb.fps},
  "delivery":   "${sb.delivery}",
  "aspect":     "${sb.aspect}",
  "resolution": { "width": ${sb.width}, "height": ${sb.height} },
  "preset":     "${sb.preset}",
  "brand": {
    "accent":      "#RRGGBB",
    "scheme":      "dark" | "light",
    "productName": string,
    "tagline":     string?
  },
  "scenes": [ Scene, ... ]
}

Scene {
  "id":         string   — lowercase, a-z0-9 and dashes
  "beat":       ${BEATS.map((b) => `"${b}"`).join(' | ')}
  "type":       ${SCENE_TYPES.map((t) => `"${t}"`).join(' | ')}
  "start":      int ms, absolute on the film timeline
  "duration":   int ms, 400..20000
  "hold":       int ms, 0..2000    — stillness before the cut
  "copy":       { "eyebrow"?, "headline"?, "body"?, "cta"?, "bodySize"? int px }
  "elements":   [ Element, ... ]
  "animations": [ Animation, ... ]
  "cursor":     [ Cursor, ... ]
  "cues":       [ { "name": string, "at": int ms, "gain"? 0..2 } ]
  "camera":     Camera?
  "notes":      string?  — why this beat exists
}

Element {
  "id":          string   — unique within the scene
  "type":        ${ELEMENT_TYPES.map((t) => `"${t}"`).join(' | ')}
  "text":        string?
  "secondary":   string?
  "value":       string?  — for a metric
  "attribution": string?  — REQUIRED on any number with a unit or multiplier
  "x": int?, "y": int?, "width": int?, "height": int?   — stage px
  "importance":  0..1
}

Animation {
  "target":  string   — a CSS selector: '[data-el="id"]' or '.row-item'
  "at":      int ms   — SCENE-RELATIVE
  "dur":     int ms, 60..6000
  "ease":    ${EASES.map((e) => `"${e}"`).join(' | ')}
  "stagger": int ms 0..400?,  "staggerFrom": "start"|"end"|"center"|"edges"|"random"?
  "opacity" | "x" | "y" | "scale" | "rotate" | "blur": [from, to]?
}

Cursor { "target": selector, "at": int ms scene-relative, "travel": 200..1400,
         "click": bool, "latency": 60..220 }

Camera { "target": selector?, "x": int?, "y": int?, "zoom": 1..2.5,
         "at": int ms scene-relative, "dur": 200..4000, "ease": ease }
  Prefer "target" — the engine resolves the element's real position, so the aim
  stays right if the layout moves. Use "x"/"y" only for a nudge away from dead
  centre (-200..200); they are an OFFSET from the frame centre, not a stage
  coordinate.
\`\`\`

Hard requirements — these are validated and a failure costs a retry:

1. Scenes in ascending \`start\` order, and the last one must end at or before
   ${sb.duration}ms.
2. Consecutive scenes OVERLAP: each \`start\` is ~300ms before the previous scene
   ends, so motion carries across the cut.
3. Exactly ONE scene carries \`copy.cta\` in the entire film.
4. Any number with a unit or multiplier ("4.2x", "40%", "14 hours") carries
   \`attribution\`. If you have no source, do not put the number on screen.
5. No two adjacent scenes within 150ms of the same \`duration\`.
6. Never \`"linear"\` on anything with x, y, scale or rotate.
7. \`bodySize\` >= 24. Entrance \`dur\` >= 400 unless it is UI reacting to a click.
8. A camera \`at\` is EARLIER than the cursor \`at\` in the same scene, by 200-300ms.
9. The payoff beat has \`hold\` between 600 and 900.
10. \`transition\` defaults to a hard cut. Do not set a dissolve.

Selectors: use \`[data-el="<element id>"]\` for a specific element, \`.row-item\`
for all rows in the scene, \`.card\` for all cards. Animation targets are scoped to
their own scene automatically.

\`copy\` and \`elements\` are two different layers, and text belongs in exactly one
of them. \`copy.headline\` and \`copy.body\` are already laid out and styled for you,
centred at film scale — so do NOT also add a \`hero\` or \`heading\` element repeating
the same words. It renders twice, in two places, at two sizes. Use \`elements\` for
the things a headline cannot be: rows, cards, metrics, buttons, badges.

Row elements are a single stacked list. Give the FIRST row an \`x\`/\`y\`; the rest
stack below it automatically, so per-row coordinates are ignored.

# Scene types are real layouts — choose them, do not default to one

Each \`type\` renders a different composition, built from real components and
positioned for you. You do not need \`x\`/\`y\` for any of these; supply the content
and the layout places it. **A film that uses two types looks like a template. Vary
them deliberately.**

| type | what it renders | give it |
|---|---|---|
| \`text\` | large type, optionally over a stack of accented lines | \`copy\`, and \`row\` elements for the "again and again" beat |
| \`device\` | a phone frame with an alternating message thread, tilted in 3D | \`row\`/\`card\` elements as the conversation, alternating sides automatically |
| \`dashboard\` | a browser window, tilted, with metric tiles and a data list inside | \`metric\` elements, \`row\` elements, one \`button\` |
| \`feature\` | a 2/3-column grid of icon cells | 2-6 \`feature\` elements, each with \`text\` and \`secondary\` |
| \`scroll\` | a long page moving inside a window frame | up to 8 elements, any type |
| \`hero\` | the logo lockup at large size with a headline under it | \`copy.headline\`, \`copy.body\` |
| \`logo\` | the logo alone, centred | \`copy\` optional |
| \`cta\` | end card: logo, headline, one accent button | \`copy.headline\`, \`copy.cta\`, or one \`button\` element |

The logo is extracted from the site and drawn automatically in \`hero\`, \`logo\` and
\`cta\` — do not add a \`logo\` element or repeat the product name as a \`hero\`
element.

**Icons are automatic.** Every \`feature\` cell, \`row\` and \`scroll\` block gets one,
chosen from the element's own \`text\`/\`secondary\` wording — so write labels that name
the thing ("WhatsApp", "Auto booking", "Revenue", "2.4s reply") and the right glyph
appears in the brand accent. There is no icon field to set.

**Depth is automatic** in \`device\`, \`dashboard\`, \`scroll\`, \`feature\`, \`hero\` and
\`cta\`: frames tilt in real CSS 3D and the field behind them is built from the
brand's accent. Animate \`scale\`, \`y\` and \`opacity\` on top of that; do not try to
write rotation matrices.

**Sound.** Put 2-5 \`cues\` in the film, on the beat where something lands — a
\`click\` on a cursor press, \`appear\` or \`pop\` as a card arrives, \`success\` or
\`chime\` on the payoff, \`riser\` under a build, \`transition\` or \`whoosh\` across a
cut, \`impact\` on a hard reveal. Only the names in the Scene table above exist; an
invented name fails validation.`;
}

/** What the analyzer found, compressed to what a storyboard decision needs. */
function describeAnalysis(analysis: RouteAnalysis[]): string {
  const parts: string[] = ['# The product, as analysed'];

  const primary = analysis[0];
  if (primary?.brand) {
    const b = primary.brand;
    parts.push(
      '',
      '## Brand',
      `- product name: ${b.productName ?? '(not found — infer from the copy)'}`,
      `- tagline: ${b.tagline ?? '(none found)'}`,
      `- accent: ${b.accent ?? '(none found — pick one from the screenshot)'}`,
      `- scheme: ${b.scheme}`,
      ...(b.fontDisplay ? [`- display face: ${b.fontDisplay}`] : []),
      ...(b.ctaLabels.length ? [`- the site's own CTA labels: ${b.ctaLabels.slice(0, 4).join(' / ')}`] : []),
      ...(b.headings.length
        ? ['', '## Their own headlines (use their language, not marketing filler)',
           ...b.headings.slice(0, 8).map((h) => `- ${h}`)]
        : [])
    );
  }

  // What the product does, which element ranking never finds: prominence on a
  // marketing page means the nav and the hero, so a film built from ranked
  // elements alone talks about a problem and never shows the product.
  const found = primary?.features;
  if (found) {
    const features = rankFeatures(found, 10);
    if (features.length) {
      parts.push('', '## What the product does — the film must SHOW these');
      for (const f of features) {
        parts.push(`- **${f.title}**${f.detail ? ` — ${f.detail}` : ''}`);
      }
    }

    if (found.metrics.length) {
      parts.push(
        '',
        '## Numbers the site publishes (attribute them, or leave them out)'
      );
      for (const m of found.metrics.slice(0, 8)) {
        parts.push(`- ${m.value}${m.label ? ` — ${m.label}` : ''}`);
      }
    }

    if (found.integrations.length) {
      parts.push('', `## Connects to: ${found.integrations.slice(0, 12).join(', ')}`);
    }

    if (found.sections.length) {
      parts.push(
        '',
        "## The page's own narrative order (a good spine for the beats)",
        ...found.sections.slice(0, 12).map((s, i) => `${i + 1}. ${s}`)
      );
    }

    if (found.ctas.length) {
      parts.push('', `## Their real CTA wording: ${found.ctas.slice(0, 4).join(' / ')}`);
    }

    if (found.quotes.length) {
      parts.push('', '## Customer quotes', ...found.quotes.slice(0, 2).map((q) => `- "${q}"`));
    }
  }

  for (const route of analysis) {
    parts.push('', `## Ranked on-screen elements — ${route.route}`);
    // Ranked, and truncated: forty elements is not a decision aid, it is a dump.
    for (const el of route.elements.slice(0, 10)) {
      const text = el.text ? ` "${el.text.slice(0, 70)}"` : '';
      parts.push(`- ${el.type}${text}  [importance ${el.importance.toFixed(2)}]`);
    }
  }

  return parts.join('\n');
}

function buildMessages(opts: {
  contract: string;
  analysis: string;
  policy: string;
  index: string;
  prompt: string | undefined;
  durationMs: number;
}): { system: string; user: string } {
  const system = [
    LAWS,
    '',
    '---',
    '',
    opts.index,
    '',
    '---',
    '',
    opts.policy,
  ].join('\n');

  const user = [
    '# Task',
    '',
    `Write the storyboard for a ${(opts.durationMs / 1000).toFixed(0)}-second product`,
    'film about the product described below.',
    '',
    opts.prompt
      ? `The person asking for this film said:\n\n> ${opts.prompt}\n`
      : '',
    'This is a SaaS PRODUCT film. More than half of it must show the product doing',
    'its job — the features listed below, on screen, working. A film that states a',
    'problem and then asserts a solution is a slide deck; the viewer has to SEE the',
    'thing operate or nothing was demonstrated.',
    '',
    'Work in this order, and put your reasoning in each scene\'s `notes`:',
    '',
    '1. State the thesis — the one thing a viewer should believe afterwards.',
    '2. Choose the beats. Problem first, and keep it SHORT — one beat, 3-4 seconds.',
    '   A viewer who has not felt the problem has nowhere to put the product, but a',
    '   viewer still watching the problem at second ten has left.',
    '3. Spend the middle on the product. Show the interface (`dashboard`), the thing',
    '   happening (`device`), and the capability set (`feature`) — at minimum three',
    '   different product beats using three different scene types.',
    '4. For each beat, decide what is ON SCREEN, then what MOVES, then when the',
    '   copy lands — the visual leads the words by ~600ms.',
    '5. Use the product\'s own language from the sections and features above, not',
    '   invented marketing copy.',
    '',
    'Write the JSON directly. Do not plan or explain first, and keep each `notes`',
    'to one short sentence — the reasoning belongs in the choices, not in prose',
    'beside them. Reasoning models routinely spend an entire output budget',
    'thinking about a film of this size and return nothing at all.',
    '',
    opts.analysis,
    '',
    '---',
    '',
    opts.contract,
  ]
    .filter(Boolean)
    .join('\n');

  return { system, user };
}

/* ------------------------------------------------------------------ *
 * The loop
 * ------------------------------------------------------------------ */

/** Zod issues as lines a model can act on. */
function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
}

export async function generateStoryboard(
  opts: GenerateStoryboardOptions
): Promise<GenerateResult> {
  const emit = opts.onEvent ?? (() => {});
  const maxAttempts = opts.maxAttempts ?? 3;
  const aspect: Aspect = opts.aspect ?? '16:9';
  const dimensions = ASPECT_DIMENSIONS[aspect];
  const durationMs = opts.durationMs ?? 20_000;
  const preset = (PRESETS as readonly string[]).includes(opts.preset ?? '')
    ? opts.preset!
    : 'apple';

  /**
   * Cadence follows delivery unless it is overridden.
   *
   * The schema's own default is 30, which `FRAME_RATES` records as a broadcast
   * cadence in neither region. So asking for a UK master and getting 30fps was
   * a guaranteed `conformance()` error with nothing the caller could do about
   * it — there was no way to set the frame rate at all. Deriving it from the
   * profile makes the request sufficient.
   */
  const delivery: DeliveryProfile = (DELIVERY_PROFILES as readonly string[]).includes(
    opts.delivery ?? ''
  )
    ? opts.delivery!
    : 'web';
  const fps = opts.fps ?? deliverySpec(delivery).fps;

  const stage: Stage = 'storyboard';
  const { system, user } = buildMessages({
    contract: contract({
      duration: durationMs,
      aspect,
      width: dimensions.width,
      height: dimensions.height,
      preset,
      fps,
      delivery,
    }),
    analysis: describeAnalysis(opts.analysis),
    policy: policyFor(opts.skills, stage),
    index: renderIndex(opts.skills),
    prompt: opts.prompt,
    durationMs,
  });

  emit({ type: 'prompt', tokensEstimate: Math.ceil((system.length + user.length) / 4) });

  // The transcript grows across attempts: a re-ask has to carry what was wrong
  // with the previous answer, and the model needs its own output to correct.
  const transcript: { role: 'user' | 'assistant'; content: string }[] = [
    { role: 'user', content: user },
  ];

  let lastViolations: Violation[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    emit({ type: 'attempt', n: attempt, of: maxAttempts });

    // A reasoning model can spend its whole output budget thinking and return
    // nothing — and gateways commonly cap that budget far below what we ask for, so
    // it is not something `maxTokens` can always fix. It is also not deterministic:
    // the same prompt usually answers on a second attempt. So it consumes an
    // attempt rather than aborting the run.
    let response: Awaited<ReturnType<typeof opts.provider.generate>>;
    try {
      response = await opts.provider.generate({
        model: opts.model,
        messages: [{ role: 'system', content: system }, ...transcript],
        // A storyboard for a 20s film is 4-6k tokens of JSON. The rest is headroom
        // for a reasoning model, which spends output budget on internal thinking
        // before emitting a token of the answer. Note that a gateway may cap this
        // far lower than requested and not say so.
        maxTokens: 32_000,
        // Low, deliberately. The film is the creative artefact; the JSON is a
        // structured document and creativity here shows up as invalid enums.
        temperature: 0.4,
        json: true,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    } catch (err) {
      // An empty answer from an exhausted budget is retryable and common; anything
      // else (auth, a malformed request) will fail identically next time.
      const exhausted =
        err instanceof ProviderError && /entire output budget|empty response/i.test(err.message);
      if (!exhausted || attempt === maxAttempts) throw err;
      emit({ type: 'attempt', n: attempt + 1, of: maxAttempts });
      continue;
    }

    emit({ type: 'received', chars: response.text.length });

    if (response.stopReason === 'length' && response.text.length > 0) {
      throw new ProviderError({
        provider: opts.provider.id,
        model: opts.model,
        message: 'The storyboard was cut off mid-document.',
        hints: [
          'The model hit its output limit. Ask for a shorter film, or fewer scenes.',
        ],
      });
    }

    let parsed: unknown;
    try {
      parsed = extractJson(response.text);
    } catch (err) {
      // Not retryable by re-asking with rule text — the model produced no JSON at
      // all, so send the raw complaint back instead.
      if (attempt === maxAttempts) throw err;
      transcript.push(
        { role: 'assistant', content: response.text.slice(0, 2000) },
        {
          role: 'user',
          content:
            `That was not parseable as JSON: ${err instanceof Error ? err.message : String(err)}\n\n` +
            'Return one JSON object and nothing else.',
        }
      );
      continue;
    }

    const result = storyboardSchema.safeParse(parsed);
    if (!result.success) {
      const issues = formatIssues(result.error);
      emit({ type: 'schema-failed', issues });

      if (attempt === maxAttempts) {
        throw new ProviderError({
          provider: opts.provider.id,
          model: opts.model,
          message: `The storyboard still failed validation after ${maxAttempts} attempts.`,
          hints: ['Last issues:', ...issues.slice(0, 12).map((i) => `  ${i}`)],
        });
      }

      transcript.push(
        { role: 'assistant', content: JSON.stringify(parsed).slice(0, 12_000) },
        {
          role: 'user',
          content: [
            'That JSON does not match the contract. Fix exactly these and return the',
            'corrected object:',
            '',
            ...issues.map((i) => `- ${i}`),
          ].join('\n'),
        }
      );
      continue;
    }

    // Shape is right. Now judgement: repair the mechanical, re-ask the rest.
    const { storyboard, repaired, remaining } = repairCraft(result.data);
    if (repaired.length) emit({ type: 'repaired', violations: repaired });

    const errors = remaining.filter((v) => v.severity === 'error');
    const warnings = remaining.filter((v) => v.severity === 'warning');

    if (!errors.length) {
      // Brand facts the analyser measured are merged back in, rather than being
      // asked of the model. A logo is a blob of SVG no model should be made to
      // transcribe, and radius and typeface are measurements — asking for them
      // invites invention, and a hallucinated brand is worse than a plain one.
      const measured = opts.analysis[0]?.brand;
      if (measured) {
        if (measured.logoSvg && !storyboard.brand.logoSvg) {
          storyboard.brand.logoSvg = measured.logoSvg;
        }
        if (measured.radius !== null && storyboard.brand.radius === undefined) {
          storyboard.brand.radius = measured.radius;
        }
        if (measured.fontDisplay && !storyboard.brand.fontDisplay) {
          storyboard.brand.fontDisplay = measured.fontDisplay;
        }
        if (measured.fontText && !storyboard.brand.fontText) {
          storyboard.brand.fontText = measured.fontText;
        }
        if (measured.background && !storyboard.brand.background) {
          storyboard.brand.background = measured.background;
        }
      }

      /**
       * Delivery is the caller's decision, not the model's, for the same reason
       * the brand is: the model is *told* it in the contract and has no basis
       * for revising it. Applied after validation so it always holds, and
       * before the emit so what reaches `.urlume/` is what gets rendered.
       *
       * Cadence follows only when it was asked for or the profile pins it —
       * deliberately not on `web`, where 24/30/60 are all legitimate and a
       * model choosing 24 for a cinematic cut is making a creative call rather
       * than an error.
       */
      storyboard.delivery = delivery;
      if (opts.fps !== undefined || delivery !== 'web') storyboard.fps = fps;

      emit({ type: 'ok', storyboard, warnings });
      return { storyboard, warnings, repaired, attempts: attempt };
    }

    lastViolations = errors;
    emit({ type: 'reask', violations: errors });

    if (attempt === maxAttempts) break;

    transcript.push(
      { role: 'assistant', content: JSON.stringify(storyboard).slice(0, 12_000) },
      { role: 'user', content: formatForModel(errors) }
    );
  }

  // Bounded, per §29.1: report the violation rather than loop forever. The user
  // reads what is wrong, which is more useful than a spinner.
  throw new ProviderError({
    provider: opts.provider.id,
    model: opts.model,
    message: `The storyboard still breaks ${lastViolations.length} craft rule(s) after ${maxAttempts} attempts.`,
    hints: [
      'These need a content decision rather than a mechanical fix:',
      '',
      ...formatForModel(lastViolations).split('\n'),
    ],
  });
}

/** Re-validate a hand-edited or stored storyboard. Used by `urlume check`. */
export function validateStoryboard(value: unknown): {
  ok: boolean;
  storyboard?: Storyboard;
  issues: string[];
  violations: Violation[];
} {
  const parsed = storyboardSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, issues: formatIssues(parsed.error), violations: [] };
  }
  const report = checkCraft(parsed.data);
  return {
    ok: report.ok,
    storyboard: parsed.data,
    issues: [],
    violations: report.violations,
  };
}
