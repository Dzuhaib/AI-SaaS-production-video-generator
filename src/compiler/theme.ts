/**
 * Brand -> film theme.
 *
 * The engine ships five presets and a hardcoded aurora: blue, purple, cyan on a
 * near-black field. That is a good look, and it is the *same* look for every film —
 * so a teal-on-white clinic SaaS and a dark developer tool came out looking like
 * siblings, which is the single loudest tell that a video was generated.
 *
 * So the preset is chosen from the extracted brand rather than defaulted, and the
 * background field is derived from the accent instead of being fixed. Everything
 * here is a pure function of the storyboard's `brand`, so it stays deterministic.
 */

import type { Storyboard } from '../storyboard/schema.js';
import { ensureContrast } from '../shared/contrast.js';

/**
 * `--bg-base` per preset, from `runtime/assets/explainer.css`.
 *
 * Duplicated here because the contrast repair has to know what the accent will
 * actually sit on, and the stylesheet is not parsed at compile time. Kept next to
 * the preset list so the two are edited together; a preset added to the stylesheet
 * without a line here falls back to the `apple` value, which is the darkest case
 * and therefore the safe direction to be wrong in.
 */
const PRESET_BACKGROUND: Record<string, string> = {
  apple: '#000000',
  light: '#F5F5F7',
  midnight: '#06070D',
  warm: '#0F0C0A',
  mono: '#000000',
};

export interface Theme {
  /** `data-preset` value. */
  preset: string;
  /** Inline custom properties on `<body>`. */
  vars: Record<string, string>;
  /** The background field, as markup. */
  backdrop: string;
  /**
   * The film grade, as markup: a sibling of `.camera` that tints the finished
   * picture without flattening its glass. Emitted by the compiler so the
   * light/dark split and the transparent-accent hue live in one place.
   */
  grade: string;
  /** Set when the accent was lightened or darkened to reach 4.5:1. */
  contrast?: {
    from: string;
    to: string;
    ratio: number;
    background: string;
  };
}

/* ------------------------------------------------------------------ *
 * Colour
 * ------------------------------------------------------------------ */

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function hexToHsl(hex: string): Hsl | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;

  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return { h: 0, s: 0, l: l * 100 };

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return { h: h * 360, s: s * 100, l: l * 100 };
}

/**
 * Which preset the brand belongs in.
 *
 * The scheme decides first, because a light film on a dark preset is unreadable
 * rather than merely off-brand. Within dark, hue picks the field: `warm` for reds
 * and oranges, `mono` where the accent is essentially grey (a colourful aurora
 * behind a monochrome brand looks borrowed), `midnight` for blues and purples,
 * `apple` otherwise.
 */
export function presetFor(brand: Storyboard['brand']): string {
  if (brand.scheme === 'light') return 'light';

  const hsl = brand.accent ? hexToHsl(brand.accent) : null;
  if (!hsl) return 'apple';

  if (hsl.s < 12) return 'mono';
  if (hsl.h < 45 || hsl.h > 330) return 'warm';
  if (hsl.h >= 200 && hsl.h <= 280) return 'midnight';
  return 'apple';
}

/**
 * The background field, built from the accent.
 *
 * Three blooms on an analogous triad — the accent, and two neighbours ±40° around
 * the wheel. That keeps the field unmistakably *this* brand's while still having
 * the colour separation that stops it reading as a flat vignette.
 *
 * Opacity is much lower on light schemes: the same 0.30 that reads as a soft bloom
 * on near-black turns a white page into a tie-dye.
 */
function auroraFor(brand: Storyboard['brand']): string {
  const hsl = brand.accent ? hexToHsl(brand.accent) : null;
  const light = brand.scheme === 'light';

  // No usable accent: fall back to the preset's own field rather than inventing one.
  if (!hsl) return '';

  const h = Math.round(hsl.h);
  // A higher floor on saturation and a mid-high lightness keep the blooms from
  // washing to grey. On dark schemes the old 0.3/0.24/0.16 left most of the
  // frame as black — a product frame with dead space reads as an empty screen
  // rather than as a deliberate dark field, so the dark blooms are raised too.
  const s = Math.round(Math.max(52, Math.min(95, hsl.s)));
  const l = Math.round(Math.max(50, Math.min(66, hsl.l)));

  const a1 = light ? 0.4 : 0.42;
  const a2 = light ? 0.3 : 0.32;
  const a3 = light ? 0.22 : 0.24;

  const wrap = (deg: number): number => ((deg % 360) + 360) % 360;

  return (
    `radial-gradient(38% 44% at 22% 26%, hsl(${h} ${s}% ${l}% / ${a1}), transparent 70%), ` +
    `radial-gradient(32% 40% at 78% 30%, hsl(${wrap(h + 40)} ${s}% ${l}% / ${a2}), transparent 70%), ` +
    `radial-gradient(46% 50% at 60% 84%, hsl(${wrap(h - 40)} ${s}% ${l}% / ${a3}), transparent 72%)`
  );
}

/**
 * Backdrop markup.
 *
 * Inside `.stage` because that is what gets rasterised — the renderer strips every
 * body child that does not contain it — and behind `.camera` so a push-in does not
 * scale the field with the scene.
 */
function backdropFor(brand: Storyboard['brand']): string {
  const aurora = auroraFor(brand);
  const light = brand.scheme === 'light';

  // A light film needs a much weaker vignette: the stock one is a 62% black wash at
  // the edges, which on white reads as a dirty smudge rather than as depth. So the
  // light vignette is a soft warm-grey falloff. It still needs to be present, or the
  // strengthened aurora above reads as flat paper rather than as a graded field.
  const vignette = light
    ? `<div class="bg-vignette" aria-hidden="true"
     style="background:radial-gradient(78% 68% at 50% 46%, transparent 45%, rgba(20,28,32,.16) 100%);"></div>`
    : `<div class="bg-vignette" aria-hidden="true"></div>`;

  const auroraDiv = aurora
    ? `<div class="bg-aurora" aria-hidden="true" style="background:${aurora};"></div>`
    : `<div class="bg-aurora" aria-hidden="true"></div>`;

  return `${auroraDiv}\n  ${vignette}`;
}

/**
 * The grade: a gelatin that sits over the finished picture.
 *
 * The engine's stock look is pure flat colour — saturated accent on near-black,
 * no texture, no warmth. At 24fps that reads as a sequence of screenshots. A
 * film grade is the thing that makes the same frames read as *photographed*.
 *
 * Two layers, both pure background so neither animates:
 *  - a soft colour cast from the accent at low alpha, so the whole film sits
 *    inside the brand hue rather than just its UI;
 *  - a vignette + edge falloff that grounds the frame.
 *
 * See the markup comment in `compiler/index.ts` for why this must be a sibling
 * of `.camera`, never an ancestor: an opacity < 1 ancestor flattens glass.
 */
function gradeFor(brand: Storyboard['brand']): string {
  const light = brand.scheme === 'light';
  const hsl = brand.accent ? hexToHsl(brand.accent) : null;
  const hue = hsl ? Math.round(hsl.h) : 220;
  const tint = light ? 0.055 : 0.05;

  return `<div class="film-grade" aria-hidden="true"
     style="background:
        radial-gradient(120% 120% at 50% 42%, transparent 55%, rgba(${
          light ? '20,28,32' : '0,0,0'
        }, ${light ? 0.22 : 0.34}) 100%),
        linear-gradient(${hue}deg, hsla(${hue} 70% 60% / ${tint}), hsla(${
    (hue + 40) % 360
  } 70% 55% / ${tint * 0.6}), hsla(${(hue + 320) % 360} 70% 50% / ${tint * 0.8}));
     "></div>`;
}

/* ------------------------------------------------------------------ *
 * Type
 * ------------------------------------------------------------------ */

/**
 * Fallback faces for scripts the Latin system stack cannot draw.
 *
 * Without these, filming a Japanese or Russian site on a machine whose first
 * fallback lacks the glyphs produces tofu boxes (□□) — and it does so silently,
 * because `hazards.verifyFonts` probes whether the *declared family* is loaded,
 * not whether it covers the glyphs actually on screen, and `document.fonts.ready`
 * resolves even when loading finished by failing. The encode succeeds and the MP4
 * is garbage.
 *
 * These are names, not bundled files, so this narrows the failure rather than
 * closing it: it works when the render machine has any of them (Windows and macOS
 * both ship several) and does not when it has none. Bundling Noto subsets is the
 * real fix and is a much larger change; `hazards.verifyGlyphCoverage` is what
 * reports the remaining gap rather than letting it ship unnoticed.
 */
const SCRIPT_FALLBACKS = [
  // CJK
  '"Noto Sans CJK JP"', '"Noto Sans JP"', '"Hiragino Sans"', '"Yu Gothic"', '"Meiryo"',
  '"Microsoft YaHei"', '"PingFang SC"', '"Malgun Gothic"',
  // Cyrillic and Greek are covered by the Latin system faces above.
  // Arabic / Hebrew
  '"Noto Sans Arabic"', '"Geeza Pro"', '"Segoe UI Historic"', '"Noto Sans Hebrew"',
  // Indic and SE Asian
  '"Noto Sans Devanagari"', '"Nirmala UI"', '"Noto Sans Thai"', '"Leelawadee UI"',
  // Emoji last: it must never win for text, only for glyphs nothing else has.
  '"Apple Color Emoji"', '"Segoe UI Emoji"', '"Noto Color Emoji"',
].join(', ');

const SYSTEM_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/**
 * Build a CSS font stack from an extracted family name.
 *
 * The family is always quoted. It reaches here having passed `fontFamily` in the
 * storyboard schema, so it cannot contain a quote, semicolon or brace — this
 * previously fell back to emitting an unrecognised name *unquoted*, which meant a
 * hostile `font-family` from a crawled page closed the declaration and injected
 * arbitrary CSS. Validation rejects rather than passes through, and quoting here
 * is the second half of that.
 */
function stack(family: string): string {
  return `"${family}", ${SYSTEM_STACK}, ${SCRIPT_FALLBACKS}`;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export function themeFor(sb: Storyboard): Theme {
  const brand = sb.brand;

  // An explicit non-default preset in the storyboard is a deliberate art-direction
  // choice and wins. `apple` is the schema default, so it is treated as "unset"
  // rather than as a decision.
  const preset = sb.preset && sb.preset !== 'apple' ? sb.preset : presetFor(brand);

  /**
   * Contrast repair, per `brand-extraction` §Contrast: check before using.
   *
   * The accent arrives having been chosen by the source site's designer against
   * *their* background — usually white. The film's is usually near-black, and
   * `layouts.ts` puts `color: var(--accent)` directly on icon labels and row text,
   * so an accent that passed 4.5:1 on white can land near 2:1 here and be
   * unreadable. The repair steps toward the accent's own hue rather than
   * substituting a colour, so the brand stays recognisable.
   *
   * The background it checks against is whatever will actually be painted: an
   * explicit `brand.background` if the storyboard set one, otherwise the chosen
   * preset's `--bg-base`.
   */
  const background = brand.background ?? PRESET_BACKGROUND[preset] ?? PRESET_BACKGROUND.apple!;
  const repaired = ensureContrast(brand.accent, background, 4.5);

  const vars: Record<string, string> = { '--accent': repaired.colour };

  if (brand.accentSecondary) vars['--accent-2'] = brand.accentSecondary;
  if (brand.background) vars['--bg-base'] = brand.background;

  // The site's own corner radius is one of the strongest brand signals there is —
  // a 4px-radius product and a 20px-radius product do not look related even in the
  // same colours.
  if (brand.radius !== undefined) {
    vars['--r-sm'] = `${Math.round(brand.radius * 0.75)}px`;
    vars['--r-md'] = `${brand.radius}px`;
    vars['--r-lg'] = `${Math.round(brand.radius * 1.6)}px`;
  }

  // Always emitted, even with no extracted family. The engine's own preset stacks
  // (explainer.css) are Latin-only, so a film that inherited them would draw tofu
  // for any non-Latin copy; going through `stack()` in both cases means the script
  // fallbacks apply whether or not the site had a recognisable typeface.
  vars['--font-display'] = brand.fontDisplay
    ? stack(brand.fontDisplay)
    : `${SYSTEM_STACK}, ${SCRIPT_FALLBACKS}`;
  vars['--font-text'] = brand.fontText
    ? stack(brand.fontText)
    : `${SYSTEM_STACK}, ${SCRIPT_FALLBACKS}`;

  // The backdrop is derived from the repaired accent too, so the aurora and the
  // type it sits behind stay in the same hue family.
  const effective = { ...brand, accent: repaired.colour };

  return {
    preset,
    vars,
    backdrop: backdropFor(effective),
    grade: gradeFor(effective),
    ...(repaired.adjusted
      ? {
          contrast: {
            from: brand.accent,
            to: repaired.colour,
            ratio: repaired.ratio,
            background,
          },
        }
      : {}),
  };
}
