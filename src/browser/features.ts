/**
 * Feature extraction.
 *
 * The element analyser ranks what is *visually prominent*, which on a marketing
 * page means the nav, the hero and the buttons. It never finds the feature grid —
 * so a film got built from a headline and a CTA while the eight things the product
 * actually does went unmentioned. That is why the output read like a slide deck
 * about a problem rather than a product video.
 *
 * This reads the parts of a page that carry the product's substance: the feature
 * cards, the plan inclusions, the metrics, the integrations. It is DOM-shape based
 * rather than keyword based, so it works on any SaaS marketing page regardless of
 * industry or framework.
 */

import type { Page } from 'playwright-core';

export interface Feature {
  /** The feature's own name, as the site words it. */
  title: string;
  /** One line of supporting copy, where the page has one. */
  detail: string | null;
  /** Where it was found, for ranking: a card grid beats a plan bullet. */
  origin: 'card' | 'heading' | 'list' | 'plan';
}

export interface Metric {
  /** "98%", "10,000+", "+40%" */
  value: string;
  /** What it counts, where the page says. */
  label: string | null;
}

export interface SiteFeatures {
  features: Feature[];
  metrics: Metric[];
  /** Named third-party products the page claims to connect to. */
  integrations: string[];
  /** Section headings in document order — the page's own narrative spine. */
  sections: string[];
  /** Distinct CTA wordings, longest-first (the real one is rarely "Sign In"). */
  ctas: string[];
  /** Anything that reads like a testimonial or a customer quote. */
  quotes: string[];
}

/**
 * Runs as one `page.evaluate`.
 *
 * Every heuristic here is about DOM *shape* — a repeated sibling structure that
 * contains a short heading and a paragraph is a feature card on any site, whatever
 * it is selling. Keyword matching would only work for the verticals we thought of.
 */
export async function extractFeatures(page: Page): Promise<SiteFeatures> {
  return page.evaluate(() => {
    const text = (el: Element | null): string =>
      (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

    const visible = (el: Element): boolean => {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (Number(style.opacity) < 0.05) return false;
      const r = el.getBoundingClientRect();
      return r.width > 20 && r.height > 8;
    };

    /** Chrome that is structurally identical to content and never worth filming. */
    const inJunk = (el: Element): boolean => {
      let node: Element | null = el;
      let depth = 0;
      while (node && depth < 6) {
        const hay = `${node.className} ${node.id}`.toLowerCase();
        if (/cookie|consent|gdpr|newsletter|footer|nav|menu|breadcrumb|modal|popup|banner/.test(hay)) {
          return true;
        }
        if (node.tagName === 'NAV' || node.tagName === 'FOOTER' || node.tagName === 'HEADER') return true;
        node = node.parentElement;
        depth++;
      }
      return false;
    };

    /* ---------------- features from repeated card structures ---------------- */

    const features: Feature[] = [];
    const seenTitles = new Set<string>();

    const push = (title: string, detail: string | null, origin: Feature['origin']): void => {
      const clean = title.replace(/^[•\-–\s]+/, '').trim();
      // A feature name is a phrase, not a sentence or a single letter.
      if (clean.length < 3 || clean.length > 60) return;
      if (/^\d+$/.test(clean)) return;
      const key = clean.toLowerCase();
      if (seenTitles.has(key)) return;
      seenTitles.add(key);
      features.push({
        title: clean,
        detail: detail && detail.length > 8 && detail.length < 220 ? detail : null,
        origin,
      });
    };

    /**
     * A grid of cards is the single most reliable feature signal on a SaaS page:
     * three or more siblings that each contain a short heading. Found by shape, so
     * it does not matter whether the site calls them cards, tiles or blocks.
     */
    const containers = Array.from(document.querySelectorAll('div, ul, section'));
    for (const container of containers) {
      if (inJunk(container)) continue;
      const kids = Array.from(container.children).filter(visible);
      if (kids.length < 3 || kids.length > 12) continue;

      // Siblings must be structurally alike, or this is a page section rather than
      // a card grid.
      const shapes = new Set(kids.map((k) => `${k.tagName}:${k.children.length}`));
      if (shapes.size > 2) continue;

      const candidates: { title: string; detail: string | null }[] = [];
      for (const kid of kids) {
        const heading = kid.querySelector('h2, h3, h4, h5, strong, b, [class*="title"], [class*="head"]');
        const title = text(heading);
        if (!title) continue;
        const para = kid.querySelector('p, [class*="desc"], [class*="body"], [class*="sub"]');
        let detail = text(para);
        if (detail === title) detail = '';
        candidates.push({ title, detail: detail || null });
      }

      if (candidates.length >= 3) {
        for (const c of candidates) push(c.title, c.detail, 'card');
      }
    }

    /* ---------------- features from h3-level headings ---------------- */

    // A page that lists its capabilities as headings rather than cards. Kept after
    // cards so a real grid ranks higher.
    for (const h of Array.from(document.querySelectorAll('h3, h4'))) {
      if (!visible(h) || inJunk(h)) continue;
      const title = text(h);
      if (!title) continue;
      // The paragraph immediately following a heading is its description.
      let sibling = h.nextElementSibling;
      let detail: string | null = null;
      let hops = 0;
      while (sibling && hops < 3) {
        if (sibling.tagName === 'P' || sibling.tagName === 'DIV') {
          const t = text(sibling);
          if (t.length > 12 && t.length < 220) {
            detail = t;
            break;
          }
        }
        if (/^H[1-6]$/.test(sibling.tagName)) break;
        sibling = sibling.nextElementSibling;
        hops++;
      }
      push(title, detail, 'heading');
    }

    /* ---------------- plan inclusions ---------------- */

    // Pricing bullets are a precise, product-owner-written list of what the thing
    // does. They are also repetitive across tiers, hence the dedupe above.
    for (const li of Array.from(document.querySelectorAll('li'))) {
      if (!visible(li) || inJunk(li)) continue;
      if (li.querySelector('a, li')) continue; // a nav item or a nested list
      const t = text(li);
      if (t.length < 8 || t.length > 70) continue;
      push(t, null, 'plan');
    }

    /* ---------------- metrics ---------------- */

    const metrics: { value: string; label: string | null }[] = [];
    const seenMetrics = new Set<string>();
    // A number carrying a unit or a multiplier is a claim worth putting on screen.
    const claim = /^[+\-]?[\d.,]+\s*(%|x|×|\+|k|m|bn|hrs?|hours?|mins?|days?|sec|s)?$/i;

    for (const el of Array.from(document.querySelectorAll('*'))) {
      if (el.children.length !== 0 || !visible(el) || inJunk(el)) continue;
      const t = text(el);
      if (!t || t.length > 18) continue;
      if (!claim.test(t)) continue;
      if (!/\d/.test(t)) continue;
      // A bare small integer is a step number or a row count, not a statistic.
      if (/^\d{1,2}$/.test(t)) continue;
      if (seenMetrics.has(t)) continue;
      seenMetrics.add(t);

      // The label is whatever sits beside or under it in the same block.
      const parent = el.parentElement;
      let label: string | null = null;
      if (parent) {
        const siblingText = Array.from(parent.children)
          .filter((c) => c !== el)
          .map(text)
          .find((s) => s.length > 2 && s.length < 60);
        label = siblingText ?? null;
      }
      metrics.push({ value: t, label });
    }

    /* ---------------- integrations ---------------- */

    // Named products a page claims to connect to. Read from image alt text and
    // icon labels, which is where they live on almost every SaaS page.
    const integrations = new Set<string>();
    for (const el of Array.from(document.querySelectorAll('img[alt], [aria-label], svg title'))) {
      if (inJunk(el)) continue;
      const raw =
        el.getAttribute('alt') ?? el.getAttribute('aria-label') ?? text(el);
      const name = raw?.replace(/\b(logo|icon|image)\b/gi, '').trim();
      if (!name || name.length < 3 || name.length > 24) continue;
      if (/\s{2,}|[.!?]/.test(name)) continue;
      if (name.split(/\s+/).length > 3) continue;
      integrations.add(name);
    }

    /* ---------------- narrative spine and CTAs ---------------- */

    const sections = Array.from(document.querySelectorAll('h1, h2'))
      .filter((h) => visible(h) && !inJunk(h))
      .map(text)
      .filter((t) => t.length > 3 && t.length < 120);

    const ctas = Array.from(
      new Set(
        Array.from(document.querySelectorAll('a, button'))
          .filter((el) => visible(el) && !inJunk(el))
          .map(text)
          .filter((t) => t.length > 4 && t.length < 40)
          // A real CTA is a verb phrase. Nav labels are one word.
          .filter((t) => /\s/.test(t))
      )
    ).sort((a, b) => b.length - a.length);

    const quotes = Array.from(document.querySelectorAll('blockquote, [class*="testimonial"], [class*="quote"]'))
      .filter((el) => visible(el) && !inJunk(el))
      .map(text)
      .filter((t) => t.length > 30 && t.length < 260)
      .slice(0, 4);

    return { features, metrics, integrations: [...integrations], sections, ctas, quotes };
  });
}

/**
 * Rank and trim, so the prompt carries signal rather than a dump.
 *
 * Card-grid features first — they are the page's own deliberate summary of the
 * product — then headings, then plan bullets. A feature that carries its own
 * description outranks a bare title within each group, because a film cell needs
 * two lines.
 */
export function rankFeatures(found: SiteFeatures, limit = 10): Feature[] {
  const weight: Record<Feature['origin'], number> = { card: 0, heading: 1, list: 2, plan: 3 };

  // Plan names are card-shaped and rank highly on structure alone, but "Starter"
  // is not a capability — a film that opens its feature grid with three pricing
  // tiers is showing the price list, not the product.
  const planName = /^(starter|basic|free|pro|plus|premium|growth|scale|business|enterprise|team|standard|advanced|ultimate|lite)$/i;

  // Two cards sharing a detail means one of them borrowed its neighbour's
  // paragraph — a real risk with a grid whose cells are unevenly filled. The first
  // keeps it; later ones lose the detail rather than assert something untrue.
  const seenDetails = new Set<string>();

  return [...found.features]
    .filter((f) => !planName.test(f.title.trim()))
    .sort((a, b) => {
      const byOrigin = weight[a.origin] - weight[b.origin];
      if (byOrigin !== 0) return byOrigin;
      const byDetail = Number(Boolean(b.detail)) - Number(Boolean(a.detail));
      if (byDetail !== 0) return byDetail;
      // A longer description is a more substantive feature, not a longer title.
      return (b.detail?.length ?? 0) - (a.detail?.length ?? 0);
    })
    .map((f) => {
      if (!f.detail) return f;
      const key = f.detail.toLowerCase();
      if (seenDetails.has(key)) return { ...f, detail: null };
      seenDetails.add(key);
      return f;
    })
    .slice(0, limit);
}
