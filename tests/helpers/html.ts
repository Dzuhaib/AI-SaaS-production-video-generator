/**
 * Test helpers for asserting on generated markup.
 *
 * The "no motion in the markup" assertions are substring checks against the
 * whole document, which makes them sensitive to prose: the compiler emits a
 * long HTML comment explaining *why* the film grade carries no `@keyframes`,
 * and that sentence matched the very regex asserting keyframes are absent.
 *
 * A comment cannot animate anything, so stripping comments first is what the
 * assertion always meant. Rewording the comment would have fixed the symptom
 * and left the trap armed for the next person who documents a CSS rule by
 * naming it.
 */

/** Drop HTML comments. Inert at render time, so never part of these checks. */
export function stripComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

/** Regexes for CSS that would freeze under frame-by-frame export, since the
 *  browser clock does not advance while the timeline seeks. */
export const MOTION_CSS = [/transition\s*:/, /@keyframes/, /animation\s*:/] as const;
