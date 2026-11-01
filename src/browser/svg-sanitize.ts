/**
 * SVG sanitisation for the extracted logo.
 *
 * `brand-extraction` §The logo says to lift `logoEl.outerHTML` verbatim, and that
 * is the right *extraction* rule — a redrawn logo reads as counterfeit, so the
 * real markup or nothing. It is not a safe *emission* rule. An SVG is a document,
 * not an image: it legitimately carries `<script>`, `on*` event handlers,
 * `<foreignObject>` with arbitrary HTML inside, `<use href>` pointing anywhere,
 * and SMIL `<animate>` that can set attributes over time.
 *
 * The film is emitted to disk and loaded over `file://` (renderer/index.ts), which
 * is the most privileged origin a page can have — a `<script>` that arrives from
 * a crawled third-party site would run there, and the same HTML ships inside
 * `.urlume/film/` for users to host. So the logo goes through an allowlist before
 * it reaches `layouts.ts`.
 *
 * Allowlist, not blocklist. A blocklist of dangerous tags is wrong by
 * construction: the set of ways to execute script in SVG is not enumerable ahead
 * of time, and every new SVG feature is a new bypass. Anything not named here is
 * dropped, which at worst loses a visual flourish from a logo.
 *
 * Regex-based because there is no DOM in this process and pulling in a parser for
 * one 24KB string is not worth the dependency. That constrains what this can
 * promise, so it is deliberately aggressive: when the shape of the input is not
 * something it fully understands, it rejects the whole logo rather than passing
 * through a partially-cleaned one.
 */

/** Elements that draw. Anything absent is removed with its subtree. */
const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'defs',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
  'mask',
  'pattern',
  'title',
  'desc',
  'symbol',
]);

/**
 * Elements dropped along with everything inside them.
 *
 * `<use>` is here rather than in a "strip the href" branch because a `<use>`
 * whose target is removed renders nothing anyway, and `xlink:href` on it is a
 * documented external-reference vector.
 */
const DROP_WITH_CONTENT = new Set([
  'script',
  'foreignobject',
  'use',
  'image',
  'iframe',
  'object',
  'embed',
  'video',
  'audio',
  'animate',
  'animatetransform',
  'animatemotion',
  'set',
  'handler',
  'style',
  'filter',
  'feimage',
]);

/**
 * Attributes that may survive.
 *
 * Presentation and geometry only. No `href`/`xlink:href` in any casing, no
 * `on*`, no `xlink:*`, no `id`-based scripting hooks beyond plain `id`, which is
 * needed for `clip-path="url(#...)"` to resolve within the same fragment.
 */
const ALLOWED_ATTRS = new Set([
  'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'width', 'height', 'points', 'transform', 'viewbox', 'preserveaspectratio',
  'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity',
  'stroke-miterlimit', 'opacity', 'color', 'offset', 'stop-color', 'stop-opacity',
  'gradientunits', 'gradienttransform', 'spreadmethod', 'clip-path', 'clip-rule',
  'mask', 'patternunits', 'id', 'class', 'font-family', 'font-size', 'font-weight',
  'text-anchor', 'dominant-baseline', 'letter-spacing', 'xmlns', 'fr',
  'maskunits', 'maskcontentunits', 'patterncontentunits', 'patterntransform',
]);

/**
 * An attribute value that may reference a URL only ever legitimately points at a
 * fragment in the same document — `url(#gradient-3)`. Anything else (`http:`,
 * `data:`, `javascript:`, a protocol-relative `//host`) is a fetch or an
 * execution and the attribute is dropped.
 */
const URL_ATTRS = new Set(['clip-path', 'mask', 'fill', 'stroke']);

function urlValueIsSafe(value: string): boolean {
  const url = /url\(\s*['"]?([^'")]*)['"]?\s*\)/i.exec(value);
  if (!url) return true; // not a URL reference at all
  return (url[1] ?? '').trimStart().startsWith('#');
}

/**
 * Reject rather than clean when the input contains something that cannot be
 * cleaned reliably with a regex pass.
 *
 * A CDATA section or a processing instruction can hide markup from the tag
 * scanner below; an entity declaration is the XXE/billion-laughs shape. None of
 * these appear in a real inline logo, so their presence means either a hostile
 * SVG or one this module should not claim to have understood.
 */
function hasUnparseableConstruct(svg: string): boolean {
  return (
    svg.includes('<![CDATA[') ||
    svg.includes('<!ENTITY') ||
    svg.includes('<!DOCTYPE') ||
    svg.includes('<?')
  );
}

/**
 * Strip attributes from one tag's attribute text.
 *
 * Attribute names are matched case-insensitively because `oNlOaD` is a valid HTML
 * attribute name and `ONLOAD` is how it usually arrives in an evasion attempt.
 */
function cleanAttributes(attrText: string): string {
  const kept: string[] = [];
  // name="value" | name='value' | name=value | name
  const attr = /([:A-Za-z_][-.:\w]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>=`]+)))?/g;

  let m: RegExpExecArray | null;
  while ((m = attr.exec(attrText)) !== null) {
    const rawName = m[1] ?? '';
    const name = rawName.toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? '';

    if (name.startsWith('on')) continue; // every event handler
    if (name.startsWith('xlink:')) continue; // xlink:href and friends
    if (name.includes(':') && !name.startsWith('xmlns')) continue; // any other namespace
    if (!ALLOWED_ATTRS.has(name)) continue;
    if (URL_ATTRS.has(name) && !urlValueIsSafe(value)) continue;
    // A style attribute is not in the allowlist, but belt and braces: any value
    // carrying a url() to somewhere other than a fragment goes.
    if (/javascript:|data:|vbscript:/i.test(value)) continue;

    kept.push(value ? `${rawName}="${value.replace(/"/g, '&quot;')}"` : rawName);
  }

  return kept.length ? ` ${kept.join(' ')}` : '';
}

/**
 * Sanitise an extracted logo, or return null if it cannot be made safe.
 *
 * Returning null is a normal outcome, not an error: `layouts.ts` already falls
 * back to a wordmark in the brand's display face, which the skill names as the
 * correct answer when no usable SVG exists.
 */
export function sanitizeLogoSvg(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const input = raw.trim();
  if (!input || input.length > 24_000) return null;
  if (!/^<svg[\s>]/i.test(input)) return null;
  if (hasUnparseableConstruct(input)) return null;

  let out = '';
  let cursor = 0;
  /** Depth of dropped subtrees currently open; while > 0 nothing is emitted. */
  let dropping = 0;

  const tag = /<\/?([A-Za-z][-\w:]*)((?:[^>"']|"[^"]*"|'[^']*')*)(\/?)>/g;
  let m: RegExpExecArray | null;

  while ((m = tag.exec(input)) !== null) {
    const [whole, rawName = '', attrText = '', selfClose = ''] = m;
    const name = rawName.toLowerCase();
    const closing = whole.startsWith('</');

    // Text between the previous tag and this one. Escaped so a stray `<` inside
    // a <title> cannot re-open a tag downstream.
    if (dropping === 0) {
      const text = input.slice(cursor, m.index);
      out += text.replace(/&(?![a-zA-Z#][a-zA-Z0-9]{0,30};)/g, '&amp;').replace(/</g, '&lt;');
    }
    cursor = m.index + whole.length;

    if (DROP_WITH_CONTENT.has(name)) {
      // A self-closing dropped element opens no subtree.
      if (closing) dropping = Math.max(0, dropping - 1);
      else if (!selfClose) dropping += 1;
      continue;
    }
    if (dropping > 0) continue;
    if (!ALLOWED_ELEMENTS.has(name)) continue; // dropped, but its children are kept

    out += closing ? `</${name}>` : `<${name}${cleanAttributes(attrText)}${selfClose ? '/' : ''}>`;
  }

  if (dropping === 0) {
    const tail = input.slice(cursor);
    out += tail.replace(/&(?![a-zA-Z#][a-zA-Z0-9]{0,30};)/g, '&amp;').replace(/</g, '&lt;');
  }

  // A logo that survived as a bare <svg></svg> is not worth emitting; the wordmark
  // is the better fallback.
  if (!/<(path|circle|ellipse|rect|line|polyline|polygon|text|g)\b/i.test(out)) return null;
  if (!/^<svg[\s>]/i.test(out.trim())) return null;

  return out.trim();
}
