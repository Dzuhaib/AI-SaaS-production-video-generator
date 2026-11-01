/**
 * Text escaping for generated markup.
 *
 * Its own module because both `index.ts` and `scenes.ts` need it, and importing
 * it from `index.ts` would make the two circular.
 */

/** Escape for text nodes and quoted attribute values. */
export function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Escape model-supplied copy, allowing an explicit line break.
 *
 * `{br}` is the only markup that survives, and it becomes `<br>`. Line breaks
 * must be explicit because `splitText('lines')` splits on literal breaks and
 * deliberately does not measure rendered line boxes — font metrics differ
 * between the authoring browser and the headless renderer, so measuring would
 * make the export non-deterministic.
 *
 * Everything else is escaped, so a model cannot inject markup or script into a
 * film through a copy field.
 */
export function copyText(text: string): string {
  return esc(text).replace(/\{br\}/g, '<br>');
}

/**
 * Escape a string for emission as a JavaScript literal in `timeline.js`.
 *
 * `copyText` covers model-supplied strings on their way into *markup*, which is
 * the boundary §53.1a describes. It is not the only boundary: selectors and scene
 * ids are model-supplied too, and they land in generated **code** —
 * `tl.cursorTo('...')`, `tl.point('...')`. Interpolated raw, a single apostrophe
 * ends the literal and whatever follows it is executed, so the claim that a model
 * cannot inject script into a film would hold for copy and fail for a selector.
 *
 * `JSON.stringify` emits the surrounding quotes as well as the escapes, so call
 * sites read `tl.point(${jsString(t)})` with no quotes of their own. It is
 * sufficient on its own: U+2028/U+2029 were the one case JSON escaped and a JS
 * literal did not, and ES2019 made them legal in a literal too. The only
 * consumer of this output is Chromium.
 */
export function jsString(value: string): string {
  return JSON.stringify(value);
}
