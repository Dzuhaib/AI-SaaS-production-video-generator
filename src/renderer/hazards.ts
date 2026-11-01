/**
 * Determinism guards.
 *
 * The engine guarantees that its own output is a pure function of `t`. It
 * cannot guarantee that about the page around it: a `<video>`, an animated GIF,
 * a lazily-loaded image and a CSS keyframe animation all run on the wall clock,
 * so two renders of the same film disagree wherever one of them appears.
 *
 * Each guard here neutralises one such source. They run after the film is ready
 * and before the first screenshot.
 */

import type { Page } from 'playwright-core';

/**
 * `document.fonts.ready` resolves when loading *finishes* — including when it
 * finishes by failing. So the engine's ready gate proves timing, not
 * correctness: if the export machine has no network, a Google Fonts link
 * silently falls back and every glyph metric shifts, which changes line breaks
 * and therefore the composition.
 *
 * `document.fonts.check()` asks the different question — is this face actually
 * usable right now — which is the one that matters here.
 */
export async function verifyFonts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const warnings: string[] = [];
    const seen = new Set<string>();

    const probe = (el: Element) => {
      const style = getComputedStyle(el);
      const stack = style.fontFamily;
      const first = stack.split(',')[0]?.trim().replace(/^["']|["']$/g, '');
      if (!first || seen.has(first)) return;
      seen.add(first);

      // Generic families are always "available" and never the point.
      if (/^(system-ui|sans-serif|serif|monospace|cursive|fantasy|-apple-system)$/.test(first)) {
        return;
      }
      if (!document.fonts.check(`${style.fontWeight} 16px "${first}"`)) {
        warnings.push(
          `Font "${first}" is declared but not loaded — the export will use a ` +
            `fallback with different metrics. Self-host a woff2 next to the film.`
        );
      }
    };

    document.querySelectorAll('.t-hero, .t-display, .t-title, .t-headline, .t-body')
      .forEach(probe);
    if (document.body) probe(document.body);
    return warnings;
  });
}

/**
 * Freeze everything that advances on its own.
 *
 * `.render-mode *` in the engine's stylesheet already sets
 * `animation-play-state: paused`, but that freezes an animation at whatever time
 * it had reached — which depends on how long the page took to load, and so
 * differs between runs. Setting a negative delay pins every animation to its
 * first frame deterministically instead.
 */
export async function applyHazardGuards(page: Page): Promise<void> {
  // Images: a lazy image that decodes mid-render appears in some frames only.
  await page.evaluate(async () => {
    const images = Array.from(document.images);
    for (const img of images) {
      img.loading = 'eager';
      if (img.decoding !== 'sync') img.decoding = 'sync';
    }
    await Promise.all(
      images
        .filter((img) => !img.complete)
        .map(
          (img) =>
            new Promise<void>((done) => {
              img.addEventListener('load', () => done(), { once: true });
              img.addEventListener('error', () => done(), { once: true });
            })
        )
    );
    // An animated GIF/WebP keeps advancing even when everything else is pinned.
    // There is no API to seek one, so a decoded still is the only fix; document
    // rather than pretend otherwise.
    await Promise.all(
      images.map((img) => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()))
    );
  });

  // Media elements run on their own clock.
  await page.evaluate(() => {
    document.querySelectorAll('video, audio').forEach((el) => {
      const media = el as HTMLMediaElement;
      media.pause();
      media.autoplay = false;
      media.currentTime = 0;
    });
  });

  // Pin every CSS animation to its first frame. A film should have none on
  // timeline-driven properties, but ambient decoration often does.
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-delay: -0.0001s !important;
      animation-play-state: paused !important;
      transition: none !important;
    }`,
  });

  // Caret blink and text selection both differ frame to frame.
  await page.addStyleTag({
    content: `* { caret-color: transparent !important; }
      ::selection { background: transparent !important; }`,
  });
}

/**
 * Sources of non-determinism this module knowingly does NOT solve, so nobody
 * assumes coverage that is not there:
 *
 * - **Animated GIF/WebP.** No API exists to seek one. Replace with a still, or
 *   with an element the timeline drives.
 * - **`Math.random()` inside film code.** The engine seeds its own randomness;
 *   a film that calls `Math.random()` directly is non-reproducible and only its
 *   author can fix it.
 * - **Network content.** Anything fetched at runtime can differ between runs.
 * - **GPU vs SwiftShader.** Rasterisation of `backdrop-filter`, and especially
 *   `backdrop-filter: url(#lens)`, may differ between headed and headless
 *   Chromium. Unverified in this environment. If exported frames show flat
 *   glass, try `--swiftshader`; failing that, drop `.glass-lens` and keep
 *   `.glass`, which still reads as glass.
 */
export const UNGUARDED = [
  'animated GIF/WebP frames',
  'Math.random() in film code',
  'runtime network fetches',
  'GPU vs software rasterisation of backdrop-filter',
] as const;
