/**
 * Page analysis: which parts of a real interface are worth filming.
 *
 * The ranking is a deterministic heuristic, not a model call. Two reasons: the
 * pipeline has to work with no vision model configured, and a heuristic gives the
 * same answer twice, which matters when a re-render should produce the same film.
 * A vision pass can re-rank on top, but it is never the only source.
 *
 * "Importance" here means *worth putting on screen in a product film*, which is
 * not the same as visually prominent. A cookie banner is prominent and worthless.
 */

import type { Browser, Page } from 'playwright-core';
import { extractBrand, type ExtractedBrand } from './brand.js';
import { extractFeatures, type SiteFeatures } from './features.js';
import { installNameShim } from './shim.js';

export interface AnalyzedElement {
  /** Selector that identifies it on the real page, for traceability. */
  selector: string;
  type: string;
  text: string | null;
  bounds: { x: number; y: number; width: number; height: number };
  /** 0..1. See `scoreOf` for what feeds it. */
  importance: number;
}

export interface RouteAnalysis {
  route: string;
  title: string;
  elements: AnalyzedElement[];
  brand: ExtractedBrand;
  /** base64 PNG, for a vision re-rank or for `capture` mode. */
  screenshot: string;
  /**
   * What the product actually does.
   *
   * Element ranking finds what is visually prominent, which on a marketing page is
   * the nav, the hero and the buttons — never the feature grid. Without this a film
   * gets built from a headline and a CTA while the product's substance goes
   * unmentioned, which is why one read like a slide about a problem rather than a
   * product video.
   */
  features?: SiteFeatures;
}

/** Chrome that is prominent and worthless in a product film. */
const JUNK = [
  'cookie',
  'consent',
  'gdpr',
  'newsletter',
  'chat-widget',
  'intercom',
  'drift',
  'banner',
  'announcement',
  'skip-link',
];

/**
 * A stable-ish selector for an element.
 *
 * Preference order is deliberate: `data-testid` is authored for automation and
 * survives refactors; an `id` is unique but often generated; a class chain is
 * fragile but readable. This is for traceability only — the film never queries
 * the real page — so fragility is acceptable.
 */
function selectorFor(el: Element): string {
  const testid = el.getAttribute('data-testid') ?? el.getAttribute('data-test');
  if (testid) return `[data-testid="${testid}"]`;
  if (el.id && !/^[0-9]/.test(el.id) && !/[:\s]/.test(el.id)) return `#${el.id}`;

  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (node && node.nodeType === 1 && depth < 4) {
    let part = node.tagName.toLowerCase();
    const cls = (node.className || '')
      .toString()
      .trim()
      .split(/\s+/)
      .filter((c) => c && !/^(is-|has-)/.test(c) && c.length < 24)[0];
    if (cls) part += `.${cls}`;
    parts.unshift(part);
    if (node.id) {
      parts[0] = `#${node.id}`;
      break;
    }
    node = node.parentElement;
    depth++;
  }
  return parts.join(' > ');
}

export async function analyzePageInPlace(page: Page, route: string): Promise<RouteAnalysis> {
  const collected = await page.evaluate(
    ({ junkWords, selectorSrc }) => {
      // `selectorFor` is defined at module scope in Node, and Playwright ships only
      // this callback's source to the page — so the helper has to be carried across
      // as a string and installed here. An indirect eval evaluates in global scope,
      // which is what makes the assignment visible; a direct `eval()` of a function
      // *statement* would bind the name in this callback's own scope and collide
      // with the local below (`Identifier 'selectorFor' has already been declared`).
      const install = eval;
      install(`globalThis.__selectorFor = ${selectorSrc}`);
      const selectorFor = (globalThis as unknown as { __selectorFor(el: Element): string })
        .__selectorFor;

      const vh = window.innerHeight;
      const vw = window.innerWidth;

      const isJunk = (el: Element): boolean => {
        const hay = `${el.className} ${el.id} ${el.getAttribute('aria-label') ?? ''}`.toLowerCase();
        return junkWords.some((w) => hay.includes(w));
      };

      const visible = (el: Element): boolean => {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (Number(style.opacity) < 0.1) return false;
        const r = el.getBoundingClientRect();
        return r.width >= 40 && r.height >= 20;
      };

      /** Classify by role and shape, not by class name. */
      const classify = (el: Element): string | null => {
        const tag = el.tagName.toLowerCase();
        const cls = (el.className || '').toString().toLowerCase();

        if (tag === 'nav' || el.getAttribute('role') === 'navigation') return 'navigation';
        if (tag === 'h1') return 'hero';
        if (tag === 'h2' || tag === 'h3') return 'heading';
        if (tag === 'button' || (tag === 'a' && /btn|button|cta/.test(cls))) return 'button';
        if (tag === 'table' || el.querySelector('table')) return 'table';
        if (tag === 'form' || el.querySelector('input, textarea')) return 'form';
        if (tag === 'video') return 'video';
        if (tag === 'img' || tag === 'picture') return 'image';
        if (tag === 'svg' && /logo|brand/.test(cls)) return 'logo';
        // An SVG with a path but no logo hint, at chart proportions, is a chart.
        if (tag === 'svg' && el.querySelector('path, rect, circle')) {
          const r = el.getBoundingClientRect();
          if (r.width > 180 && r.height > 90) return 'chart';
        }
        if (/card|panel|tile/.test(cls)) return 'card';
        if (/metric|stat|kpi/.test(cls)) return 'metric';
        if (/dashboard/.test(cls)) return 'dashboard';
        if (/feature/.test(cls)) return 'feature';
        if (/badge|chip|tag|pill/.test(cls)) return 'badge';
        if (tag === 'li' || /row|item/.test(cls)) return 'row';
        return null;
      };

      const out: {
        selector: string;
        type: string;
        text: string | null;
        bounds: { x: number; y: number; width: number; height: number };
        area: number;
        aboveFold: boolean;
        interactive: boolean;
        textLength: number;
      }[] = [];

      const seen = new Set<Element>();

      for (const el of Array.from(document.querySelectorAll('*'))) {
        if (seen.has(el) || isJunk(el) || !visible(el)) continue;
        const type = classify(el);
        if (!type) continue;

        // Skip an element whose parent was already collected as the same type —
        // otherwise a card and its inner wrapper both appear.
        let ancestor = el.parentElement;
        let nested = false;
        while (ancestor) {
          if (seen.has(ancestor) && classify(ancestor) === type) { nested = true; break; }
          ancestor = ancestor.parentElement;
        }
        if (nested) continue;

        seen.add(el);
        const r = el.getBoundingClientRect();
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();

        out.push({
          selector: selectorFor(el),
          type,
          text: text ? text.slice(0, 160) : null,
          bounds: { x: Math.round(r.x), y: Math.round(r.y + window.scrollY),
                    width: Math.round(r.width), height: Math.round(r.height) },
          area: (r.width * r.height) / (vw * vh),
          aboveFold: r.top < vh && r.bottom > 0,
          interactive: ['button', 'a', 'input', 'select'].includes(el.tagName.toLowerCase()),
          textLength: text.length,
        });

        if (out.length > 400) break;
      }

      return { title: document.title, elements: out };
    },
    // `Function.prototype.toString` gives the real source of the module-scope
    // helper, so the selector logic lives in one typechecked place rather than in
    // a string literal that no compiler ever reads.
    { junkWords: JUNK, selectorSrc: selectorFor.toString() }
  );

  /**
   * Score for film-worthiness.
   *
   * Weights are judgement, not measurement. The ordering they produce is what
   * matters: a hero heading above the fold outranks a nav item, and a chart
   * outranks a paragraph.
   */
  const scoreOf = (e: (typeof collected.elements)[number]): number => {
    let score = 0;

    // Type carries most of it. These are the things a product film shows.
    const typeWeight: Record<string, number> = {
      hero: 1.0,
      dashboard: 0.95,
      chart: 0.9,
      metric: 0.85,
      feature: 0.8,
      table: 0.7,
      card: 0.7,
      button: 0.65,
      form: 0.6,
      heading: 0.55,
      image: 0.5,
      video: 0.5,
      row: 0.4,
      badge: 0.3,
      navigation: 0.3,
      logo: 0.3,
    };
    score += (typeWeight[e.type] ?? 0.2) * 0.5;

    // Above the fold is what a visitor saw, so it is what the product leads with.
    if (e.aboveFold) score += 0.15;

    // Area, with diminishing returns — a full-bleed wrapper is not 10x a card.
    score += Math.min(Math.sqrt(e.area) * 0.5, 0.15);

    // A CTA is a deliberate design decision about what matters.
    if (e.interactive && e.textLength > 0 && e.textLength < 32) score += 0.1;

    // A wall of text does not read on screen.
    if (e.textLength > 400) score -= 0.15;
    if (e.textLength === 0 && e.type !== 'image' && e.type !== 'chart') score -= 0.1;

    return Math.max(0, Math.min(1, score));
  };

  const elements: AnalyzedElement[] = collected.elements
    .map((e) => ({
      selector: e.selector,
      type: e.type,
      text: e.text,
      bounds: e.bounds,
      importance: scoreOf(e),
    }))
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 60);

  const brand = await extractBrand(page);
  const features = await extractFeatures(page);
  const shot = await page.screenshot({ type: 'png' });

  return {
    route,
    title: collected.title,
    elements,
    brand,
    features,
    screenshot: shot.toString('base64'),
  };
}

/**
 * Analyze one route, managing the browser lifecycle.
 *
 * For several routes, prefer `analyzeRoutes` — it reuses one browser rather than
 * paying launch cost per page.
 */
export async function analyzeRoute(baseUrl: string, route: string): Promise<RouteAnalysis> {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch();
  try {
    return await analyzeIn(browser, baseUrl, route);
  } finally {
    await browser.close();
  }
}

async function analyzeIn(
  browser: Browser,
  baseUrl: string,
  route: string
): Promise<RouteAnalysis> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await installNameShim(context);
  const page = await context.newPage();
  try {
    const url = new URL(route, baseUrl).href;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });

    // An SPA can report networkidle before it has painted. Waiting for a real
    // element beats a fixed sleep, and a timeout here is not fatal — the page
    // may genuinely be sparse.
    await page
      .waitForSelector('h1, h2, main, [role="main"]', { timeout: 5_000 })
      .catch(() => {});

    return await analyzePageInPlace(page, route);
  } finally {
    await context.close();
  }
}

/** Analyze several routes in one browser. */
export async function analyzeRoutes(
  baseUrl: string,
  routes: readonly string[],
  onRoute?: (route: string, index: number) => void
): Promise<RouteAnalysis[]> {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch();
  const out: RouteAnalysis[] = [];

  try {
    for (const [i, route] of routes.entries()) {
      onRoute?.(route, i);
      try {
        out.push(await analyzeIn(browser, baseUrl, route));
      } catch {
        // One unreachable route should not abandon the analysis — a film can be
        // built from the routes that did load.
      }
    }
  } finally {
    await browser.close();
  }

  return out;
}
