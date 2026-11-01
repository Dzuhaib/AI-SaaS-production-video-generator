/**
 * Safe-area measurement.
 *
 * `titleSafe()` and `SAFE_AREA.social*` were computed and never enforced: the
 * compiler reported the box in a note, and nothing ever checked whether any
 * text was inside it. That is the same shape as every other defect §60 records
 * — code that is correct, cites its standard, and reaches no one.
 *
 * The check has to *measure* rather than reason about the storyboard, for two
 * reasons. Layout is decided by `compiler/layouts.ts` from scene content, so a
 * storyboard element rarely carries the coordinate it ends up at; and copy is
 * laid out by CSS, which only the browser can resolve. So this runs in the page
 * the renderer already has open, at the film's native size.
 *
 * Why this is a delivery concern rather than a style one:
 *
 *   broadcast  an overscanning display crops the edges. EBU R95 (UK/EU) and
 *              SMPTE RP 218 (US) agree on 5% for text, and a caption or CTA
 *              outside it is cut off on a real television.
 *   social     the platform draws its own UI over roughly the top 12% and
 *              bottom 20% of a vertical video. Text under it is not cropped,
 *              it is covered — which is worse, because it looks fine in the
 *              file and is unreadable in the feed.
 *
 * Deliberately not run for `web`, where nothing crops the frame and a margin
 * rule would be an aesthetic opinion rather than a standard.
 */

import type { Page } from 'playwright-core';
import {
  SAFE_AREA,
  titleSafe,
  type ConformanceNote,
  type DeliveryProfile,
  type SafeBox,
} from '../shared/broadcast.js';

/** A text rectangle measured in the page, in stage pixels. */
export interface TextRect {
  text: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SafeAreaReport {
  /** False when the profile has no cropping authority — `web`. */
  applicable: boolean;
  box: SafeBox | null;
  /** The worst overflow found, per side, in pixels. */
  worst: number;
  violations: { text: string; side: string; overflow: number; atMs: number }[];
  /** How many moments across the film were sampled. */
  samples: number;
}

/**
 * The box text must stay inside, for this profile.
 *
 * Social is not a percentage inset from every edge: the platform's chrome sits
 * at the top and bottom specifically, so the horizontal inset stays at the
 * title-safe 5% while the vertical insets are much deeper and asymmetric.
 */
export function safeBoxFor(
  profile: DeliveryProfile,
  width: number,
  height: number
): SafeBox | null {
  if (profile === 'web') return null;
  if (profile === 'social') {
    const x = Math.round(width * SAFE_AREA.title);
    const top = Math.round(height * SAFE_AREA.socialTop);
    const bottom = Math.round(height * SAFE_AREA.socialBottom);
    return {
      left: x,
      top,
      right: width - x,
      bottom: height - bottom,
      width: width - x * 2,
      height: height - top - bottom,
    };
  }
  return titleSafe(width, height);
}

/**
 * Measure every rendered text box in the page.
 *
 * Leaf elements only — an element with element children is a container, and its
 * rect spans all of them. A full-bleed section wrapping a centred headline
 * would otherwise report as a violation on all four sides while the headline it
 * contains is perfectly placed.
 *
 * Backgrounds, images and decorative surfaces are ignored by construction:
 * they carry no text, and they are *allowed* to bleed to the edge. The rule is
 * about reading, not about ink.
 */
export async function measureText(page: Page): Promise<TextRect[]> {
  return page.evaluate(() => {
    const out: TextRect[] = [];
    const stage = document.querySelector('.stage');
    if (!stage) return out;
    const origin = stage.getBoundingClientRect();

    for (const el of Array.from(stage.querySelectorAll<HTMLElement>('*'))) {
      // Leaf nodes carrying their own text.
      if (el.childElementCount > 0) continue;
      const text = (el.textContent ?? '').trim();
      if (!text) continue;

      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      // Mid-transition elements are legitimately off-box; only what is
      // substantially visible is held to the rule.
      if (Number(style.opacity) < 0.5) continue;

      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;

      out.push({
        text: text.slice(0, 60),
        left: r.left - origin.left,
        top: r.top - origin.top,
        right: r.right - origin.left,
        bottom: r.bottom - origin.top,
      });
    }
    return out;
  });
}

/**
 * Sample the film at intervals and report text that leaves the safe box.
 *
 * Sampled rather than checked per frame: a 588-frame film would mean 588 DOM
 * walks, and text does not move independently of the scene it is in. Sixteen
 * moments across the film catch a headline that is mispositioned for a whole
 * beat, which is the failure that matters — a caption is outside the box for
 * seconds or not at all.
 *
 * `seek` is the engine's own, so this costs sixteen seeks and no screenshots.
 */
export async function checkSafeAreas(opts: {
  page: Page;
  profile: DeliveryProfile;
  width: number;
  height: number;
  durationMs: number;
  samples?: number;
}): Promise<SafeAreaReport> {
  const box = safeBoxFor(opts.profile, opts.width, opts.height);
  if (!box) {
    return { applicable: false, box: null, worst: 0, violations: [], samples: 0 };
  }

  const samples = opts.samples ?? 16;
  const { page } = opts;
  const violations: SafeAreaReport['violations'] = [];
  let worst = 0;

  for (let i = 0; i < samples; i++) {
    // Offset into the sample window rather than starting at 0: the first and
    // last moments of a film are mid-transition by construction.
    const atMs = Math.round(((i + 0.5) / samples) * opts.durationMs);
    await page.evaluate((ms: number) => {
      (window as unknown as { __EXPLAINER__: { seek(ms: number): number } }).__EXPLAINER__.seek(ms);
    }, atMs);

    for (const rect of await measureText(page)) {
      const overflows: [string, number][] = [
        ['left', box.left - rect.left],
        ['top', box.top - rect.top],
        ['right', rect.right - box.right],
        ['bottom', rect.bottom - box.bottom],
      ];
      for (const [side, over] of overflows) {
        // A pixel or two is rounding, not a composition fault.
        if (over <= 2) continue;
        worst = Math.max(worst, over);
        violations.push({ text: rect.text, side, overflow: Math.round(over), atMs });
      }
    }
  }

  return { applicable: true, box, worst, violations, samples };
}

/**
 * Turn the measurement into conformance notes.
 *
 * One note per distinct piece of text rather than one per sample, because a
 * headline outside the box for a whole beat is one defect and would otherwise
 * be reported sixteen times.
 */
export function describeSafeArea(
  report: SafeAreaReport,
  profile: DeliveryProfile
): ConformanceNote[] {
  if (!report.applicable || !report.violations.length) return [];

  const standard =
    profile === 'social'
      ? 'platform feed UI insets (~12% top, ~20% bottom)'
      : 'EBU R95 / SMPTE RP 218 title-safe (5%)';

  // Worst overflow per text, so the report names each defect once.
  const byText = new Map<string, { side: string; overflow: number }>();
  for (const v of report.violations) {
    const prior = byText.get(v.text);
    if (!prior || v.overflow > prior.overflow) {
      byText.set(v.text, { side: v.side, overflow: v.overflow });
    }
  }

  return [...byText.entries()]
    .sort((a, b) => b[1].overflow - a[1].overflow)
    .slice(0, 6)
    .map(([text, { side, overflow }]) => ({
      area: 'safe-area' as const,
      severity: (profile.startsWith('broadcast') ? 'error' : 'warning') as 'error' | 'warning',
      message:
        `"${text}" extends ${overflow}px past the ${side} safe edge. ` +
        (profile === 'social'
          ? "The platform's own UI covers it in the feed."
          : 'An overscanning display crops it.'),
      standard,
    }));
}
