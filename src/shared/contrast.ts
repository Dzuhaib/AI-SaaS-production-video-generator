/**
 * WCAG contrast arithmetic.
 *
 * Lives in `shared/` because two directories need it and neither should import
 * the other: `browser/brand.ts` reports what a site's contrast *is*, and
 * `compiler/theme.ts` repairs the accent before emitting it. Previously this
 * lived in `brand.ts` alone and had no callers at all — the repair existed and
 * never ran, so a mid-tone accent extracted against a white page went straight
 * onto the film's near-black field.
 *
 * The relative-luminance formula is WCAG 2.x §Relative luminance; the 4.5:1
 * default is 1.4.3 (AA) for normal-size text.
 */

function toRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function rel(hex: string): number {
  const [r, g, b] = toRgb(hex);
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [rel(a), rel(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * A site's accent is chosen against that site's background. The film's
 * background is usually near-black, so an accent that passed on a white page can
 * land at 2:1 here and become unreadable.
 *
 * This lightens or darkens toward the accent's own hue rather than substituting
 * a different colour — the brand should still be recognisable. Per
 * `brand-extraction` §Contrast, the adjustment is reported so a designer can see
 * that their blue was lightened rather than discovering it in the film.
 */
export function ensureContrast(
  accent: string,
  background: string,
  target = 4.5
): { colour: string; adjusted: boolean; ratio: number } {
  const original = contrastRatio(accent, background);
  if (original >= target) {
    return { colour: accent, adjusted: false, ratio: Math.round(original * 100) / 100 };
  }

  const bgLum = rel(background);
  const towardLight = bgLum < 0.5;
  let [r, g, b] = toRgb(accent);

  // Step in 4% increments; 40 steps covers the full range from any starting point.
  for (let i = 0; i < 40; i++) {
    r = towardLight ? r + (255 - r) * 0.04 : r * 0.96;
    g = towardLight ? g + (255 - g) * 0.04 : g * 0.96;
    b = towardLight ? b + (255 - b) * 0.04 : b * 0.96;
    const hex =
      '#' + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
    const ratio = contrastRatio(hex, background);
    if (ratio >= target) {
      return { colour: hex, adjusted: true, ratio: Math.round(ratio * 100) / 100 };
    }
  }

  // Some accents cannot reach the target against some backgrounds without
  // becoming a different colour. Returning the original with `adjusted: false`
  // lets the caller warn rather than silently shipping an unreadable near-white.
  return { colour: accent, adjusted: false, ratio: Math.round(original * 100) / 100 };
}
