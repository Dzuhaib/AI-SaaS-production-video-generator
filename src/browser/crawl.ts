/**
 * Route discovery for remote mode (§43).
 *
 * In local mode routes come from a filesystem walk, which finds `/dashboard`
 * whether or not anything links to it. A crawl only finds what is reachable from
 * the homepage — for most SaaS sites that means the marketing pages and not the
 * product (§43.2). So this returns *candidates* for the user or the model to choose
 * from, and never pretends it found the app.
 *
 * §43.3 is enforced here rather than trusted: same origin only, no off-host
 * redirects followed, and a hard cap on pages fetched. The user is pointing a
 * camera at something and it should be the thing they meant.
 */

import type { Browser } from 'playwright-core';

import { installNameShim } from './shim.js';

export interface CrawlOptions {
  /** Origin to stay within. Anything else is discarded, not followed. */
  url: string;
  /** Links to collect before stopping. */
  maxRoutes?: number;
  /** How deep to follow. 1 is the homepage's own links, which is usually enough. */
  depth?: number;
  signal?: AbortSignal;
}

export interface CrawlResult {
  origin: string;
  /** Root-relative paths, deduplicated, homepage first. */
  routes: string[];
  /** Reachable but deliberately not offered, with the reason. */
  skipped: { route: string; reason: string }[];
}

/**
 * Paths that are reachable, plausible, and worthless in a product film.
 *
 * Legal and auth pages are the two big ones: they rank highly on link count
 * because they are in every footer and header, which is exactly why a naive
 * importance heuristic would surface them.
 */
const UNINTERESTING =
  /^\/(privacy|terms|legal|cookies?|imprint|dpa|gdpr|security\.txt|robots\.txt|sitemap|login|signin|sign-in|signup|sign-up|register|logout|reset-password|forgot|404|500)\b/i;

/** Extensions that are not pages. */
const NOT_A_PAGE = /\.(png|jpe?g|gif|svg|webp|avif|ico|pdf|zip|tar|gz|mp4|webm|mp3|wav|css|js|json|xml|txt|woff2?|ttf|eot)$/i;

/** Normalise to a comparable root-relative path. */
function normalise(href: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }

  // §43.3: same origin only. A link to a docs subdomain is a different site as far
  // as brand extraction is concerned, and following it would film the wrong thing.
  if (url.origin !== new URL(origin).origin) return null;
  if (!/^https?:$/.test(url.protocol)) return null;
  if (NOT_A_PAGE.test(url.pathname)) return null;

  // Fragments are the same page; query strings usually are too (filters, utm), and
  // treating them as distinct routes fills the list with duplicates of one page.
  let path = url.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/' && path.endsWith('/index')) path = path.slice(0, -6) || '/';
  return path;
}

export async function crawlRoutes(opts: CrawlOptions): Promise<CrawlResult> {
  const maxRoutes = opts.maxRoutes ?? 12;
  const maxDepth = opts.depth ?? 1;
  const origin = new URL(opts.url).origin;

  const { chromium } = await import('playwright-core');
  const browser: Browser = await chromium.launch();

  const found = new Map<string, number>([['/', 0]]);
  const skipped: { route: string; reason: string }[] = [];
  const visited = new Set<string>();

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    await installNameShim(context);
    const page = await context.newPage();

    for (let depth = 0; depth <= maxDepth; depth++) {
      const queue = [...found.entries()]
        .filter(([path, d]) => d === depth && !visited.has(path))
        .map(([path]) => path);

      for (const path of queue) {
        if (opts.signal?.aborted) break;
        if (found.size >= maxRoutes * 3) break; // enough candidates to rank
        visited.add(path);

        try {
          // `commit` rather than `domcontentloaded`: a heavy marketing site
          // (stripe.com, for one) can keep firing requests past a 20s
          // domcontentloaded budget and time out, which loses the *whole crawl*
          // over a page that had already delivered its HTML. We only want the
          // anchors, so resolving on the navigation commit and then waiting for
          // the DOM separately means a slow page degrades to "no links found"
          // instead of "crawl failed".
          const response = await page.goto(new URL(path, origin).href, {
            waitUntil: 'commit',
            timeout: 20_000,
          });
          await page
            .waitForLoadState('domcontentloaded', { timeout: 10_000 })
            .catch(() => {});

          // A redirect that leaves the origin means the link was effectively
          // external; record it rather than silently dropping it.
          const landed = new URL(page.url());
          if (landed.origin !== origin) {
            skipped.push({ route: path, reason: `redirected off-origin to ${landed.origin}` });
            continue;
          }
          if (response && response.status() >= 400) {
            skipped.push({ route: path, reason: `HTTP ${response.status()}` });
            continue;
          }

          if (depth === maxDepth) continue;

          const hrefs = await page.evaluate(() =>
            Array.from(document.querySelectorAll('a[href]')).map((a) =>
              a.getAttribute('href') ?? ''
            )
          );

          for (const href of hrefs) {
            const route = normalise(href, origin);
            if (!route || found.has(route)) continue;
            found.set(route, depth + 1);
          }
        } catch (err) {
          skipped.push({
            route: path,
            reason: err instanceof Error ? err.message.split('\n')[0]! : 'failed to load',
          });
        }
      }
    }
  } finally {
    await browser.close();
  }

  const candidates = [...found.keys()].filter((route) => {
    if (route === '/') return true;
    if (UNINTERESTING.test(route)) {
      skipped.push({ route, reason: 'legal/auth page — never useful in a film' });
      return false;
    }
    return true;
  });

  // Shallower paths first: `/pricing` is more likely to be a real marketing page
  // than `/blog/2024/03/some-post`, and the homepage always leads.
  const routes = candidates
    .sort((a, b) => {
      if (a === '/') return -1;
      if (b === '/') return 1;
      const depthDiff = a.split('/').length - b.split('/').length;
      return depthDiff !== 0 ? depthDiff : a.localeCompare(b);
    })
    .slice(0, maxRoutes);

  return { origin, routes, skipped };
}
