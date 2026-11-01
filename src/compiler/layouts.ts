/**
 * Scene layouts — one per scene type.
 *
 * The compiler used to render every scene the same way: a centred copy block, then
 * absolutely positioned elements. That is why every film looked alike regardless of
 * the business — a dashboard beat, a channel grid and an end card all arrived as
 * "text with things under it".
 *
 * Each layout here composes the engine's own component vocabulary (`.browser`,
 * `.phone`, `.app`, `.chart`, `.bubble`, `.cell`, `.deck`) plus the depth layer, and
 * every surface reads its colour from the brand tokens on `<body>`. Nothing sets a
 * hue, so the same layout looks like whichever site was analysed.
 *
 * A layout returns markup only. Motion stays in the timeline (§18.1), and no layout
 * emits a `transition` or `@keyframes` — under frame-by-frame export those freeze.
 */

import type { Scene, Storyboard, StoryboardElement } from '../storyboard/schema.js';
import { copyText, esc } from './escape.js';
import { iconSvg, resolveIcon } from './icons.js';

export interface LayoutResult {
  /** Inner markup for the scene, already positioned. */
  markup: string;
  /** True when the layout has placed the copy itself, so the generic copy block
   *  must not also be emitted — the cause of text landing twice. */
  ownsCopy: boolean;
  /** Extra classes for the `<section class="scene">` wrapper, e.g. a 3D scope. */
  sceneClass?: string;
}

/** Centre a block of known width on the stage. */
function centred(sb: Storyboard, width: number): number {
  return Math.round((sb.resolution.width - width) / 2);
}

/**
 * Title-safe horizon for a stage.
 *
 * Broadcast delivery reserves ~10% of each edge; a 5% floor keeps a pushed-in
 * or panned copy block from sliding under the frame edge and being read as a
 * rendering fault. Everything the compiler positions for me should respect
 * this, so a model asking for a full-width block still gets one that survives a
 * camera move rather than one that ends up clipped.
 */
function safeInset(sb: Storyboard): number {
  const shorter = Math.min(sb.resolution.width, sb.resolution.height);
  return Math.round(shorter * 0.06);
}

/** A left offset that keeps a block inside the title-safe horizon. */
function safeLeft(sb: Storyboard, width: number): number {
  const margin = safeInset(sb);
  return Math.max(margin, Math.min(centred(sb, width), sb.resolution.width - width - margin));
}

/** The brand's own name, for a lockup. */
function productName(sb: Storyboard): string {
  return sb.brand.productName || sb.product;
}

/**
 * The logo, or a wordmark.
 *
 * The extracted SVG is emitted inline rather than as an `<img>`: a data-URI image
 * cannot inherit `currentColor`, and an external file is a runtime fetch that §19.5
 * lists as unguarded. A site with no extractable mark gets its name set in the
 * brand's own display face, which reads as deliberate rather than as a gap.
 */
function logoMark(sb: Storyboard, size: 'sm' | 'md' | 'lg' = 'md'): string {
  const cls = size === 'lg' ? 'brand-logo brand-logo-lg' : size === 'sm' ? 'brand-logo brand-logo-sm' : 'brand-logo';
  if (sb.brand.logoSvg) {
    return `<div class="${cls}" data-el="logo">${sb.brand.logoSvg}</div>`;
  }
  const fontSize = size === 'lg' ? 96 : size === 'sm' ? 40 : 64;
  return `<div class="brand-word" data-el="logo" style="font-size:${fontSize}px">${copyText(productName(sb))}</div>`;
}

/** Copy lines, for layouts that place their own text. */
function copyLines(scene: Scene, opts: { align?: 'left' | 'center' } = {}): string {
  const c = scene.copy;
  if (!c) return '';
  const align = opts.align === 'center' ? ' style="text-align:center"' : '';
  const lines: string[] = [];

  if (c.eyebrow) lines.push(`<div class="t-eyebrow" data-el="eyebrow">${copyText(c.eyebrow)}</div>`);
  if (c.headline) {
    lines.push(`<div class="reveal-mask" data-el="headline-mask">
  <span class="t-display" data-el="headline">${copyText(c.headline)}</span>
</div>`);
  }
  if (c.body) {
    const size = c.bodySize ? ` style="font-size:${c.bodySize}px"` : '';
    lines.push(`<div class="t-body" data-el="body"${size}>${copyText(c.body)}</div>`);
  }
  if (c.cta) lines.push(`<div class="t-headline" data-el="cta">${copyText(c.cta)}</div>`);

  return lines.length ? `<div class="stack-v"${align}>\n${lines.join('\n')}\n</div>` : '';
}

/* ------------------------------------------------------------------ *
 * hero — the reveal. Logo lockup, name, one line.
 * ------------------------------------------------------------------ */

function heroLayout(scene: Scene, sb: Storyboard): LayoutResult {
  const width = 1100;
  const left = centred(sb, width);
  const top = Math.round(sb.resolution.height * 0.3);

  // When there is no extracted logo SVG, `logoMark` falls back to setting the
  // brand name in its own display face. If the headline then repeats that same
  // name — the common "Relay / Relay" reveal — the frame says the name twice.
  // The headline already carries it, so drop the redundant wordmark.
  const headline = scene.copy?.headline?.trim().toLowerCase();
  const product = productName(sb).trim().toLowerCase();
  const mark =
    sb.brand.logoSvg || !headline || headline !== product ? logoMark(sb, 'lg') : '';

  return {
    ownsCopy: true,
    sceneClass: 'scene-3d',
    markup: `<div class="abs stack-v" data-el="lockup"
     style="left:${left}px; top:${top}px; width:${width}px; align-items:center; text-align:center; gap:30px;">
  ${mark}
${copyLines(scene, { align: 'center' })}
</div>`,
  };
}

/* ------------------------------------------------------------------ *
 * dashboard — the product, in a browser frame, tilted.
 * ------------------------------------------------------------------ */

function dashboardLayout(scene: Scene, sb: Storyboard): LayoutResult {
  const rows = scene.elements.filter((e) => e.type === 'row');
  const metrics = scene.elements.filter((e) => e.type === 'metric');
  const others = scene.elements.filter((e) => !['row', 'metric'].includes(e.type));

  const width = 1500;
  const left = centred(sb, width);
  const top = scene.copy?.headline ? 300 : 170;

  const metricCells = metrics
    .slice(0, 4)
    .map(
      (m) => `      <div class="card glass metric" data-el="${esc(m.id)}">
        ${m.text ? `<div class="k">${copyText(m.text)}</div>` : ''}
        <div class="v tnum" data-el="${esc(m.id)}-value">${copyText(m.value ?? '0')}</div>
        ${m.attribution ? `<div class="t-caption">${copyText(m.attribution)}</div>` : ''}
      </div>`
    )
    .join('\n');

  const rowItems = rows
    .slice(0, 6)
    .map((r) => {
      const icon = iconSvg(resolveIcon(r.secondary ?? r.text, 'message'), 22);
      return `      <div class="row-item" data-el="${esc(r.id)}">
        <span class="stack-h stack-tight" style="color:var(--accent)">${icon}</span>
        <span class="name">${copyText(r.text ?? '')}</span>
        ${r.secondary ? `<span class="badge badge-info">${copyText(r.secondary)}</span>` : ''}
      </div>`;
    })
    .join('\n');

  const extras = others
    .slice(0, 3)
    .map((el) => {
      if (el.type === 'button') {
        return `      <button class="btn btn-primary btn-lg glow-accent" data-el="${esc(el.id)}">${copyText(el.text ?? '')}</button>`;
      }
      return `      <span class="badge badge-ok" data-el="${esc(el.id)}">${copyText(el.text ?? '')}</span>`;
    })
    .join('\n');

  const copy = scene.copy?.headline
    ? `<div class="abs" style="left:${left}px; top:110px; width:${width}px;">
${copyLines(scene)}
</div>`
    : '';

  return {
    ownsCopy: true,
    sceneClass: 'scene-3d',
    // The frame is the subject, so it gets the tilt; the copy stays flat and
    // readable above it.
    markup: `${copy}
<div class="abs d3 tilt-up" data-el="app-frame"
     style="left:${left}px; top:${top}px; width:${width}px;">
  <div class="frame-window">
    <div class="frame-bar" style="color:var(--label-3)">
      <span class="frame-dot"></span><span class="frame-dot"></span><span class="frame-dot"></span>
      <span class="frame-title">${copyText(productName(sb))}</span>
    </div>
    <div class="stack-v" style="padding:34px; gap:24px;">

      <!-- A metric strip spans the full window width; the rows and the action
           column then split the remaining space. Without the split, a wide
           window with four short rows leaves the right half empty and reads as
           a broken screen rather than as the product. -->
${metricCells ? `<div class="grid-${Math.min(4, Math.max(2, metrics.length))}" style="grid-column:1 / -1;">\n${metricCells}\n      </div>` : ''}
${rowItems ? `      <div class="grid-2">
        <div class="rows">\n${rowItems}\n        </div>
${extras ? `        <div class="stack-v">
${extras}
        </div>` : ''}
      </div>` : ''}
${!rowItems && extras ? `      <div class="stack-h">\n${extras}\n      </div>` : ''}
    </div>
  </div>
</div>`,
  };
}

/* ------------------------------------------------------------------ *
 * device — a phone, for anything that happens in a message.
 * ------------------------------------------------------------------ */

function deviceLayout(scene: Scene, sb: Storyboard): LayoutResult {
  const bubbles = scene.elements
    .filter((e) => ['row', 'card', 'toast'].includes(e.type))
    .slice(0, 4);

  // Alternating sides read as a conversation. The product's own turn carries the
  // accent, so which side is which is legible at a glance.
  const thread = bubbles
    .map((b, i) => {
      const us = i % 2 === 1;
      return `      <div class="bubble ${us ? 'bubble-us' : 'bubble-them'}" data-el="${esc(b.id)}"
           style="font-size:22px; max-width:280px;">
        ${copyText(b.text ?? '')}
        ${b.secondary ? `<div class="bubble-meta" style="font-size:14px">${copyText(b.secondary)}</div>` : ''}
      </div>`;
    })
    .join('\n');

  const phoneLeft = Math.round(sb.resolution.width * 0.56);
  const copyWidth = 640;

  return {
    ownsCopy: true,
    sceneClass: 'scene-3d-near',
    markup: `<div class="abs" data-el="copy-col"
     style="left:150px; top:${Math.round(sb.resolution.height * 0.32)}px; width:${copyWidth}px;">
${copyLines(scene)}
</div>

<div class="abs d3 tilt-l" data-el="phone"
     style="left:${phoneLeft}px; top:110px;">
  <div class="frame-phone">
    <div class="frame-notch"></div>
    <div class="frame-phone-screen">
      <div class="stack-v" style="padding:74px 20px 20px; gap:14px;">
${thread}
      </div>
    </div>
  </div>
</div>`,
  };
}

/* ------------------------------------------------------------------ *
 * feature — a grid of icon cells. The channel/capability beat.
 * ------------------------------------------------------------------ */

function featureLayout(scene: Scene, sb: Storyboard): LayoutResult {
  const items = scene.elements
    .filter((e) => ['feature', 'card', 'badge', 'metric'].includes(e.type))
    .slice(0, 6);

  const columns = items.length <= 2 ? 2 : items.length <= 4 ? 2 : 3;
  const width = columns === 2 ? 1080 : 1520;
  const left = safeLeft(sb, width);

  const cells = items
    .map((el) => {
      const icon = iconSvg(resolveIcon(el.text ?? el.id, 'sparkles'), 34);
      return `  <div class="cell" data-el="${esc(el.id)}">
    <span class="icon-tile">${icon}</span>
    <div class="cell-title">${copyText(el.text ?? '')}</div>
    ${el.secondary ? `<div class="cell-body">${copyText(el.secondary)}</div>` : ''}
    ${el.value ? `<div class="v tnum" data-el="${esc(el.id)}-value" style="font-size:34px">${copyText(el.value)}</div>` : ''}
  </div>`;
    })
    .join('\n');

  const copyTop = 150;
  const gridTop = scene.copy?.headline ? 400 : 240;

  return {
    ownsCopy: true,
    sceneClass: 'scene-3d',
    markup: `${
      scene.copy?.headline
        ? `<div class="abs" style="left:${left}px; top:${copyTop}px; width:${width}px; text-align:center;">
${copyLines(scene, { align: 'center' })}
</div>`
        : ''
    }
<div class="abs grid-${columns}" data-el="feature-grid"
     style="left:${left}px; top:${gridTop}px; width:${width}px;">
${cells}
</div>`,
  };
}

/* ------------------------------------------------------------------ *
 * text / zoom — typography, and nothing competing with it.
 * ------------------------------------------------------------------ */

function textLayout(scene: Scene, sb: Storyboard): LayoutResult {
  const rows = scene.elements.filter((e) => e.type === 'row');
  const width = 1240;
  const left = safeLeft(sb, width);

  // Rows under a headline become a stack of accented lines rather than a table:
  // this beat is usually the "here is the pain, repeatedly" moment.
  const list = rows
    .slice(0, 6)
    .map((r) => {
      const icon = iconSvg(resolveIcon(r.secondary ?? r.text, 'message'), 24);
      return `    <div class="row-item" data-el="${esc(r.id)}" style="height:64px">
      <span style="color:var(--accent)">${icon}</span>
      <span class="name" style="font-size:26px">${copyText(r.text ?? '')}</span>
      ${r.secondary ? `<span class="badge" style="background:color-mix(in srgb, var(--accent) 16%, transparent); color:var(--accent)">${copyText(r.secondary)}</span>` : ''}
    </div>`;
    })
    .join('\n');

  // The compose, not the canvas. A copy block pinned to a fixed 30% below the
  // top of a tall list leaves the lower half of the frame empty, and a camera
  // push on a block that sits at the very top clips the headline under the
  // frame edge. Centre the composed block in the safe area: it lands balanced
  // and a push on the copy has an even margin on every side.
  const rowHeight = 64;
  const gap = 44;
  const copyH =
    (scene.copy?.eyebrow ? 24 + gap : 0) +
    (scene.copy?.headline ? 78 + gap : 0) +
    (scene.copy?.body ? 40 + gap : 0);
  const rowsH = list ? rows.length * rowHeight + (rows.length - 1) * 24 + gap : 0;
  const blockH = Math.max(120, copyH + rowsH);
  const margin = safeInset(sb);
  const usable = sb.resolution.height - margin * 2;
  const top = margin + Math.round(Math.max(0, (usable - blockH) / 2) * 0.92);

  return {
    ownsCopy: true,
    markup: `<div class="abs stack-v" data-el="text-block"
     style="left:${left}px; top:${top}px; width:${width}px; gap:${gap}px;">
${copyLines(scene)}
${list ? `  <div class="rows" style="max-width:640px;">\n${list}\n  </div>` : ''}
</div>`,
  };
}

/* ------------------------------------------------------------------ *
 * stat — one number, big. The proof beat.
 * ------------------------------------------------------------------ */

/**
 * The headline number, alone and huge. A single metric with a source line is the
 * shot a buyer actually remembers — the "10,000+ bookings" frame — and it was
 * being buried as a small `.metric` cell inside a browser window, which is the
 * opposite of how product films treat their own proof.
 *
 * Everything sits in the compose: the value is hero-size, the label above it at
 * title-size, the attribution as a caption. The value is `hero` size purely so a
 * camera push reads it as a headline, and it is the one place a large numeral is
 * correct rather than a cheap tell.
 */
function statLayout(scene: Scene, sb: Storyboard): LayoutResult {
  const metric = scene.elements.find((e) => e.type === 'metric') ?? null;
  const label = (metric?.text ?? scene.copy?.eyebrow ?? '') as string;
  const value = (metric?.value ?? scene.copy?.headline ?? '') as string;
  const body = metric?.secondary ?? metric?.attribution ?? scene.copy?.body ?? '';

  const width = 1160;
  const left = safeLeft(sb, width);
  const margin = safeInset(sb);
  const usable = sb.resolution.height - margin * 2;

  const lines: string[] = [];
  if (label) lines.push(`<div class="stat-label" data-el="stat-label">${copyText(label)}</div>`);
  lines.push(
    `<div class="stat-value tnum reveal-mask" data-el="stat-value"><span>${copyText(value)}</span></div>`
  );
  if (body) lines.push(`<div class="stat-body" data-el="stat-body">${copyText(body)}</div>`);

  return {
    ownsCopy: true,
    sceneClass: 'scene-3d',
    markup: `<div class="abs stack-v" data-el="stat-block"
     style="left:${left}px; top:${margin + Math.round((usable - 380) / 2)}px; width:${width}px; align-items:center; text-align:center; gap:26px;">
${lines.join('\n')}
</div>`,
  };
}

/* ------------------------------------------------------------------ *
 * logo — a lockup on its own. Also the fallback for `transition`.
 * ------------------------------------------------------------------ */

function logoLayout(scene: Scene, sb: Storyboard): LayoutResult {
  const width = 900;
  const headline = scene.copy?.headline?.trim().toLowerCase();
  const product = productName(sb).trim().toLowerCase();
  const mark =
    sb.brand.logoSvg || !headline || headline !== product ? logoMark(sb, 'lg') : '';
  return {
    ownsCopy: true,
    sceneClass: 'scene-3d',
    markup: `<div class="abs stack-v" data-el="lockup"
     style="left:${centred(sb, width)}px; top:${Math.round(sb.resolution.height * 0.38)}px; width:${width}px; align-items:center; text-align:center; gap:26px;">
  ${mark}
${copyLines(scene, { align: 'center' })}
</div>`,
  };
}

/* ------------------------------------------------------------------ *
 * cta — the end card. One action, held.
 * ------------------------------------------------------------------ */

function ctaLayout(scene: Scene, sb: Storyboard): LayoutResult {
  const width = 1080;
  const left = centred(sb, width);
  const button = scene.elements.find((e) => e.type === 'button');
  const cta = scene.copy?.cta;

  return {
    ownsCopy: true,
    sceneClass: 'scene-3d',
    markup: `<div class="abs stack-v" data-el="end-card"
     style="left:${left}px; top:${Math.round(sb.resolution.height * 0.3)}px; width:${width}px; align-items:center; text-align:center; gap:34px;">
  ${logoMark(sb, 'md')}
  ${
    scene.copy?.headline
      ? `<div class="reveal-mask" data-el="headline-mask">
    <span class="t-display" data-el="headline">${copyText(scene.copy.headline)}</span>
  </div>`
      : ''
  }
  ${scene.copy?.body ? `<div class="t-body" data-el="body"${scene.copy.bodySize ? ` style="font-size:${scene.copy.bodySize}px"` : ''}>${copyText(scene.copy.body)}</div>` : ''}
  ${
    button || cta
      ? `<div class="stack-v" style="align-items:center; gap:20px;">
    <button class="btn btn-primary btn-lg glow-accent" data-el="${esc(button?.id ?? 'cta-button')}"
            style="font-size:26px; height:68px; padding:0 40px;">${copyText(button?.text ?? cta ?? '')}</button>
    ${button && cta ? `<div class="t-body" data-el="cta" style="font-size:24px">${copyText(cta)}</div>` : ''}
  </div>`
      : ''
  }
</div>`,
  };
}

/* ------------------------------------------------------------------ *
 * scroll — a long page moving behind a frame.
 * ------------------------------------------------------------------ */

function scrollLayout(scene: Scene, sb: Storyboard): LayoutResult {
  const items = scene.elements.slice(0, 8);
  const width = 1180;
  const left = safeLeft(sb, width);

  const blocks = items
    .map((el, i) => {
      const icon = iconSvg(resolveIcon(el.text ?? el.id, 'box'), 28);
      const accent = i % 3 === 0;
      return `    <div class="cell ${accent ? 'surface-accent' : ''}" data-el="${esc(el.id)}" style="padding:22px;">
      <div class="stack-h">
        <span class="icon-tile-sm icon-tile">${icon}</span>
        <div class="stack-v stack-tight">
          <div class="cell-title" style="font-size:26px">${copyText(el.text ?? '')}</div>
          ${el.secondary ? `<div class="cell-body" style="font-size:19px">${copyText(el.secondary)}</div>` : ''}
        </div>
      </div>
    </div>`;
    })
    .join('\n');

  return {
    ownsCopy: true,
    sceneClass: 'scene-3d',
    markup: `${
      scene.copy?.headline
        ? `<div class="abs" style="left:${left}px; top:120px; width:${width}px;">
${copyLines(scene)}
</div>`
        : ''
    }
<div class="abs d3 tilt-r" data-el="scroll-frame"
     style="left:${left}px; top:${scene.copy?.headline ? 340 : 160}px; width:${width}px;">
  <div class="frame-window">
    <div class="stack-v" data-el="scroll-track" style="padding:30px; gap:18px;">
${blocks}
    </div>
  </div>
</div>`,
  };
}

/* ------------------------------------------------------------------ *
 * Dispatch
 * ------------------------------------------------------------------ */

/**
 * Elements that dress a shot without giving it structure. A badge beside a
 * number is garnish; a row, card or button is furniture, and furniture is what
 * a window frame exists to hold.
 */
const DECORATIVE: ReadonlySet<string> = new Set(['badge', 'toast', 'logo']);

/**
 * True when a scene's entire payload is one number.
 *
 * This is tested *before* the declared scene type, because the type is the
 * model's word for what a scene is and the elements are what it actually
 * contains — and when they disagree, the elements are right. A `payoff` beat
 * carrying one metric and a badge was typed `dashboard`, so it got a browser
 * window: a squat, mostly-empty chrome frame floating in the upper third with
 * "+40%" set at body size in its top-left corner. The one number the film
 * exists to land was the smallest text on screen.
 *
 * `statLayout` was written for exactly that shot, but was reachable only from
 * `feature` and `zoom`. Hoisting the test here is what stops the next scene
 * type from having to rediscover it.
 */
function isProofShot(scene: Scene): boolean {
  const metrics = scene.elements.filter((e) => e.type === 'metric');
  if (metrics.length !== 1) return false;
  return scene.elements.every((e) => e.type === 'metric' || DECORATIVE.has(e.type));
}

/**
 * Scene types whose job is not to show content. A title card or an end card
 * with a number on it is still a card — the proof-shot rule must not hijack
 * them — and `capture` composites real frames rather than building any layout.
 */
const NEVER_PROOF: ReadonlySet<string> = new Set(['cta', 'logo', 'transition', 'capture']);

/**
 * The layout for a scene.
 *
 * `capture` returns null so the caller falls back to compositing real frames, and
 * `transition` borrows the logo layout — a transition scene that carries copy is
 * almost always a title card.
 */
export function layoutFor(scene: Scene, sb: Storyboard): LayoutResult | null {
  if (!NEVER_PROOF.has(scene.type) && isProofShot(scene)) return statLayout(scene, sb);

  switch (scene.type) {
    case 'hero':
      return heroLayout(scene, sb);
    case 'dashboard':
      return dashboardLayout(scene, sb);
    case 'device':
      return deviceLayout(scene, sb);
    case 'feature': {
      // The single-metric proof shot is already handled above. What is left is
      // either a real grid or a *row* of numbers, and `featureLayout` renders
      // metrics as cells — so it shows all of them. Routing multi-metric scenes
      // to `statLayout` here used to render the first and silently drop the
      // rest, which is worse than either composition.
      return featureLayout(scene, sb);
    }
    case 'text':
      return textLayout(scene, sb);
    case 'zoom':
      // A zoom beat carrying a metric is the proof shot: one big number. A zoom
      // beat with only copy is a push-in on type, so it takes the text layout.
      return scene.elements.some((e) => e.type === 'metric')
        ? statLayout(scene, sb)
        : textLayout(scene, sb);
    case 'logo':
    case 'transition':
      return logoLayout(scene, sb);
    case 'cta':
      return ctaLayout(scene, sb);
    case 'scroll':
      return scrollLayout(scene, sb);
    case 'capture':
      return null;
    default:
      return null;
  }
}
