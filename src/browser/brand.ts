/**
 * Brand extraction.
 *
 * Everything here runs in the page, because the only reliable source for what a
 * site looks like is the computed style of the elements that actually rendered.
 * A stylesheet says what was declared; `getComputedStyle` says what won.
 *
 * The output feeds two consumers: the preset chooser (which picks a colour
 * scheme) and the rebuild (which needs real labels and real copy). The rule
 * throughout is that the site supplies truth — the product's own words, its own
 * accent, its own nav labels — and nothing here invents or improves any of it.
 */

import type { Page } from 'playwright-core';

import { sanitizeLogoSvg } from './svg-sanitize.js';

export interface ExtractedBrand {
  productName: string | null;
  tagline: string | null;
  accent: string | null;
  accentCandidates: { colour: string; weight: number }[];
  background: string | null;
  scheme: 'light' | 'dark';
  fontDisplay: string | null;
  fontText: string | null;
  /** Modal radius across components, px. */
  radius: number | null;
  hasShadows: boolean;
  navLabels: string[];
  headings: string[];
  ctaLabels: string[];
  logoSvg: string | null;
  /** Faces declared but not actually loaded — they will export differently. */
  fontWarnings: string[];
}

/**
 * The extraction runs as one `page.evaluate` rather than a dozen round trips.
 * It is long, but every part of it needs the live DOM, and splitting it would
 * mean re-querying the same elements repeatedly.
 */
export async function extractBrand(page: Page): Promise<ExtractedBrand> {
  const raw = await page.evaluate(() => {
    /* ---------- colour helpers ---------- */

    const parseRgb = (value: string): [number, number, number, number] | null => {
      const m = /rgba?\(([^)]+)\)/.exec(value);
      if (!m) return null;
      const parts = m[1]!.split(/[,\s/]+/).filter(Boolean).map(Number);
      const [r, g, b] = parts;
      if (r === undefined || g === undefined || b === undefined) return null;
      return [r, g, b, parts[3] ?? 1];
    };

    const toHex = (r: number, g: number, b: number) =>
      '#' + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');

    /** Relative luminance, WCAG definition. */
    const luminance = (r: number, g: number, b: number) => {
      const f = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };

    /** HSL saturation. Greys sit near 0 and must never be taken as an accent —
     *  this is the check that stops "the most common colour" returning #fff. */
    const saturation = (r: number, g: number, b: number) => {
      const max = Math.max(r, g, b) / 255;
      const min = Math.min(r, g, b) / 255;
      if (max === min) return 0;
      const l = (max + min) / 2;
      return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
    };

    const isVisible = (el: Element): boolean => {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (Number(style.opacity) < 0.05) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    /* ---------- accent ---------- */

    /**
     * Weight candidate colours by where they appear rather than how often.
     *
     * Naively counting colours always returns the background, because the
     * background is most of the pixels. What identifies a brand is the colour on
     * the elements a designer chose to emphasise: primary buttons first, then
     * links and active nav items.
     */
    const weights = new Map<string, number>();
    const bump = (colour: string, weight: number) => {
      weights.set(colour, (weights.get(colour) ?? 0) + weight);
    };

    const consider = (el: Element, weight: number) => {
      if (!isVisible(el)) return;
      const style = getComputedStyle(el);
      for (const [prop, factor] of [
        [style.backgroundColor, 1],
        [style.color, 0.6],
        [style.borderColor, 0.3],
      ] as const) {
        const rgb = parseRgb(prop);
        if (!rgb) continue;
        const [r, g, b, a] = rgb;
        if (a < 0.5) continue;
        // Saturation gate: this is what keeps greys, whites and near-blacks out.
        if (saturation(r, g, b) < 0.18) continue;
        const lum = luminance(r, g, b);
        if (lum > 0.94 || lum < 0.03) continue;
        bump(toHex(r, g, b), weight * factor);
      }
    };

    // Primary buttons carry the accent most reliably.
    document
      .querySelectorAll('button, a[class*="btn"], a[class*="button"], [role="button"]')
      .forEach((el) => consider(el, 3));
    document.querySelectorAll('a').forEach((el) => consider(el, 1));
    document
      .querySelectorAll('nav [aria-current], nav .active, nav [class*="active"]')
      .forEach((el) => consider(el, 2));
    document.querySelectorAll('svg, [class*="logo"]').forEach((el) => consider(el, 2));

    const accentCandidates = [...weights.entries()]
      .map(([colour, weight]) => ({ colour, weight: Math.round(weight * 10) / 10 }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 6);

    /* ---------- background and scheme ---------- */

    const bodyBg = parseRgb(getComputedStyle(document.body).backgroundColor) ??
      parseRgb(getComputedStyle(document.documentElement).backgroundColor);
    const background = bodyBg ? toHex(bodyBg[0], bodyBg[1], bodyBg[2]) : null;
    const scheme: 'light' | 'dark' =
      bodyBg && luminance(bodyBg[0], bodyBg[1], bodyBg[2]) < 0.4 ? 'dark' : 'light';

    /* ---------- typography ---------- */

    /**
     * The computed `font-family` is the declared *stack*, not the face that
     * rendered. `document.fonts.check()` asks whether the first family is
     * actually usable, which is the question that matters for an export.
     */
    const fontWarnings: string[] = [];
    const familyOf = (el: Element | null): string | null => {
      if (!el) return null;
      const style = getComputedStyle(el);
      const first = style.fontFamily.split(',')[0]?.trim().replace(/^["']|["']$/g, '');
      if (!first) return null;
      const generic = /^(system-ui|sans-serif|serif|monospace|-apple-system|ui-\w+)$/i;
      if (!generic.test(first) && !document.fonts.check(`${style.fontWeight} 16px "${first}"`)) {
        fontWarnings.push(`"${first}" is declared but not loaded on this page`);
      }
      return first;
    };

    const firstHeading =
      document.querySelector('h1') ?? document.querySelector('h2') ?? null;
    const fontDisplay = familyOf(firstHeading);
    const fontText = familyOf(document.querySelector('p') ?? document.body);

    /* ---------- radius and shadow ---------- */

    /**
     * Modal, not mean. A site with mostly 12px corners and one 9999px pill
     * averages to something it never uses; the mode is a value that actually
     * appears in the design.
     */
    const radii = new Map<number, number>();
    let shadowCount = 0;
    let boxCount = 0;

    document
      .querySelectorAll('button, [class*="card"], [class*="panel"], input, [class*="btn"]')
      .forEach((el) => {
        if (!isVisible(el)) return;
        boxCount++;
        const style = getComputedStyle(el);
        const r = Math.round(parseFloat(style.borderTopLeftRadius) || 0);
        // A pill radius describes the shape, not the design system's scale.
        if (r > 0 && r < 40) radii.set(r, (radii.get(r) ?? 0) + 1);
        if (style.boxShadow && style.boxShadow !== 'none') shadowCount++;
      });

    const radius =
      [...radii.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    /* ---------- copy ---------- */

    const clean = (s: string | null | undefined) =>
      (s ?? '').replace(/\s+/g, ' ').trim();

    const productName =
      clean(document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')) ||
      clean(document.querySelector('[class*="logo"]')?.textContent).slice(0, 40) ||
      clean(document.title.split(/[|\-–—]/)[0]) ||
      null;

    const tagline =
      clean(document.querySelector('meta[name="description"]')?.getAttribute('content')) ||
      clean(document.querySelector('h1 + p, h1 ~ p')?.textContent) ||
      null;

    const navLabels = Array.from(
      document.querySelectorAll('nav a, [role="navigation"] a, header a')
    )
      .filter(isVisible)
      .map((el) => clean(el.textContent))
      .filter((t) => t.length > 0 && t.length < 24)
      .slice(0, 12);

    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
      .filter(isVisible)
      .map((el) => clean(el.textContent))
      .filter((t) => t.length > 2 && t.length < 120)
      .slice(0, 20);

    const ctaLabels = Array.from(
      document.querySelectorAll('button, a[class*="btn"], a[class*="button"]')
    )
      .filter(isVisible)
      .map((el) => clean(el.textContent))
      .filter((t) => t.length > 1 && t.length < 32)
      .slice(0, 10);

    /* ---------- logo ---------- */

    /**
     * Inline SVG only. A raster logo cannot be recoloured or scaled for a hero
     * shot, and redrawing a logo by hand always looks wrong — better to have
     * none and use a text lockup.
     *
     * The naive "first svg in the header" pick is why films used to open on a
     * hamburger. `<header>` contains the nav toggle first in DOM order, and a
     * single selector list returns the *first match in document order across the
     * whole list*, so an 18px menu icon placed before the real logo always won.
     *
     * So we collect every plausible candidate and score it. The score is about
     * geometry and where the SVG lives, not about redrawing anything: a logo is
     * a large, roughly steady-aspect mark in a brand container; a menu icon is
     * a tiny square inside a `<button>`, `nav`, or `<a>`. An explicit
     * `[class*="logo"]` container is treated as definitive and short-circuits.
     */
    const isHidden = (el: Element): boolean => {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return true;
      if (Number(style.opacity) < 0.05) return true;
      const r = el.getBoundingClientRect();
      return r.width < 1 || r.height < 1;
    };

    const scored: { el: Element; score: number }[] = [];

    const preferContainer = (selector: string): Element[] => {
      const out: Element[] = [];
      document.querySelectorAll(selector).forEach((c) => {
        if (isHidden(c)) return;
        const svgs = c.querySelectorAll('svg');
        svgs.forEach((s) => out.push(s));
        // A container that *is itself* the logo (an <a> wrapping an svg with no
        // other text, e.g. `<a class="logo" href="/"><svg>…</svg></a>`).
        if (c.tagName.toLowerCase() === 'svg') out.push(c);
      });
      return out;
    };

    // Explicit logo containers are definitive: if one holds an svg, that is the
    // mark, whatever else the header contains.
    const explicit = preferContainer('[class*="logo" i], a[aria-label*="logo" i], a[aria-label*="home" i]');
    if (explicit.length) {
      for (const el of explicit) scored.push({ el, score: 1000 });
    }

    // Otherwise sweep the header and the nav brand region for anything that
    // could plausibly be a logo, then rank by geometry below.
    if (!scored.length) {
      const regions = [
        ...Array.from(document.querySelectorAll('header svg, header svg, [class*="header"] svg')),
        ...Array.from(document.querySelectorAll('nav svg, a[href="/"] svg, a[href^="/"] svg')),
      ];
      for (const el of new Set<Element>(regions)) scored.push({ el, score: 0 });
    }

    let chosen: Element | null = null;
    let best = -Infinity;

    for (const { el, score } of scored) {
      if (isHidden(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 36 || r.height < 20) continue; // a menu icon is 16-24px
      let s = score;

      // Aspect ratio: a hamburger is near-square and exactly as tall as it is
      // wide. Real marks are wider than tall, or at least not a <=1.15 box.
      const ratio = r.width / Math.max(1, r.height);
      if (ratio < 1.15) {
        // Only a genuinely unusual mark is near-square AND large; don't score
        // the box up just for being squarish. Leave it neutral.
      } else {
        s += Math.min(60, (ratio - 1.15) * 30);
      }

      // Absolute size. A 40px logo in a 64px header slot is normal; a 300px
      // hero mark is stronger than the header's hamburger.
      s += Math.min(80, r.width / 12);

      // Placement penalties: nav toggles, icon buttons, links — that is where a
      // hamburger lives. Being directly inside a brand container holds no
      // penalty (it already earned +1000 above).
      const container = el.parentElement;
      if (container) {
        const cls = (container.className?.toString() ?? '') +
          (container.getAttribute('aria-label') ?? '') +
          (container.getAttribute('role') ?? '') +
          (container.getAttribute('title') ?? '');
        if (/\b(menu|toggle|nav|burger|hamburger|open|icon|social|search|cart|account)\b/i.test(cls)) {
          s -= 200;
        }
      }
      // A link is suspicious too: "logo-link" is fine, but a plain nav link
      // wrapping an svg is usually an icon.
      if (container?.tagName === 'A') {
        const cls = (container.className?.toString() ?? '') + (container.getAttribute('aria-label') ?? '');
        if (!/logo|brand|home|href\s*=\s*"\/"/i.test(cls) && container.getAttribute('href') !== '/') {
          s -= 120;
        }
        if (container.getAttribute('href') === '/') s += 40;
      }

      if (s > best) {
        best = s;
        chosen = el;
      }
    }

    let logoSvg: string | null = null;
    if (chosen && chosen.outerHTML.length < 24_000) {
      logoSvg = chosen.outerHTML;
    }

    return {
      productName,
      tagline,
      accent: accentCandidates[0]?.colour ?? null,
      accentCandidates,
      background,
      scheme,
      fontDisplay,
      fontText,
      radius,
      hasShadows: boxCount > 0 && shadowCount / boxCount > 0.3,
      navLabels: [...new Set(navLabels)],
      headings: [...new Set(headings)],
      ctaLabels: [...new Set(ctaLabels)],
      logoSvg,
      fontWarnings: [...new Set(fontWarnings)],
    };
  });

  /**
   * The logo is sanitised here, on the way out of the page, rather than at the
   * point it is written into markup.
   *
   * This is the trust boundary: everything above this line came from a
   * third-party site, and everything below treats `ExtractedBrand` as data it
   * can emit. Cleaning at the boundary means a future consumer of `logoSvg`
   * cannot reintroduce the hole by forgetting to call the sanitiser — and there
   * is already one such consumer (`compiler/layouts.ts`) that interpolates it
   * raw, because a logo cannot be HTML-escaped and still draw.
   */
  const cleanLogo = sanitizeLogoSvg(raw.logoSvg);
  const warnings = [...raw.fontWarnings];
  if (raw.logoSvg && !cleanLogo) {
    warnings.push(
      'The extracted logo contained markup that cannot be safely inlined ' +
        '(script, event handlers, external references, or animation) and was ' +
        'dropped. The film uses a wordmark instead.'
    );
  }

  return { ...raw, logoSvg: cleanLogo, fontWarnings: warnings };
}

/* ------------------------------------------------------------------ *
 * Contrast
 * ------------------------------------------------------------------ */

/**
 * Re-exported from `shared/contrast.ts`, which is where the arithmetic lives now
 * that `compiler/theme.ts` needs it too. Kept exported here because this is where
 * a reader looking for brand-related contrast logic will come first.
 */
export { contrastRatio, ensureContrast } from '../shared/contrast.js';
