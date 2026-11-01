/**
 * Scene builders: one storyboard scene -> markup + timeline records.
 *
 * Each scene type owns its own layout and its own motion. The storyboard says
 * *what* the scene is and what goes in it; these functions decide the pixels and
 * the curves, using the craft rules as defaults so a sparse storyboard still
 * produces a well-timed scene.
 *
 * Two invariants every builder must respect:
 *
 * 1. **Markup carries no motion.** No inline transform, no transition, no
 *    keyframes. Rest poses are established with `tl.set` so they participate in
 *    composition and cannot be clobbered by a later transform write.
 * 2. **`transform` on the wrapper, `opacity` on the glass.** Any ancestor with
 *    `opacity < 1` becomes a backdrop root and silently flattens the glass
 *    beneath it — so a card's entrance splits across two records.
 */

import type { Scene, Storyboard, StoryboardElement } from '../storyboard/schema.js';
import { copyText, esc, jsString } from './escape.js';
import { layoutFor } from './layouts.js';

export interface BuiltScene {
  markup: string;
  code: string;
}

/**
 * Identifier suffix for a scene's generated variables.
 *
 * Derived from the scene's ordinal, never from its id. A storyboard id is a
 * model-supplied string, so `var s_${scene.id}` is a syntax error the moment a
 * model returns `"scene-1"` — and the failure surfaces as a film that does not
 * animate rather than as a validation error.
 */
function slot(index: number): string {
  return String(index);
}

/** Stage centre, for camera arithmetic. */
function centre(sb: Storyboard): { cx: number; cy: number } {
  return { cx: sb.resolution.width / 2, cy: sb.resolution.height / 2 };
}

/** Indent a block so generated output stays readable. */
function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((l) => (l.trim() ? pad + l : l))
    .join('\n');
}

/* ------------------------------------------------------------------ *
 * Camera
 * ------------------------------------------------------------------ */

/**
 * A camera move, as records on `.camera`.
 *
 * The arithmetic is the part that is easy to get wrong. The engine writes
 * `translate3d(...) scale(...)`, and CSS applies the **rightmost** function
 * first — so the target point is scaled about the stage centre before it is
 * translated. The translation must therefore be multiplied by the scale.
 *
 * Without the multiply, a push to 2.4x leaves the target roughly 950px off centre
 * on a 1920x1080 stage. This is why the film never hand-writes camera numbers.
 */
/**
 * How much zoom this scene's layout can survive.
 *
 * A layout that fills the frame has no room to be pushed into: at 1.5x, a 1500px
 * dashboard panel loses 500px of its own width. The craft rules cap zoom at 2.5x
 * for *rasterisation* reasons, which is a different limit from "the subject still
 * fits", and only the compiler knows how wide the panel it just built is.
 *
 * A `text` beat is the exception — type is meant to be pushed into, and there is no
 * panel edge to reveal.
 */
function maxZoomFor(type: Scene['type']): number {
  switch (type) {
    case 'dashboard':
      // 1500px wide: 1920/1500 leaves almost nothing.
      return 1.2;
    case 'scroll':
      return 1.25;
    case 'feature':
      // Up to 1520px of grid.
      return 1.15;
    case 'device':
      // A 380px phone is a small subject in a wide frame; pushing in is the point.
      return 1.9;
    case 'zoom':
      // A stat is one big number; a bare copy block has no edges to reveal. Either
      // way 1.8 is the safe push.
      return 1.8;
    case 'hero':
    case 'logo':
    case 'cta':
      return 1.4;
    default:
      return 2.5;
  }
}

function cameraCode(scene: Scene, sb: Storyboard, index: number): string {
  const cam = scene.camera;
  if (!cam) return '';

  const { cx, cy } = centre(sb);
  // Capped by what the scene's own layout can afford to lose (see maxZoomFor).
  const s = Math.min(cam.zoom, maxZoomFor(scene.type));
  const n = slot(index);

  /**
   * Where the camera aims.
   *
   * `target` is the good case: the engine resolves the element to a stage
   * coordinate at mount, so the number stays correct when the layout moves.
   *
   * Bare `x`/`y` are the ambiguous case, and the ambiguity is load-bearing. This
   * code read them as an absolute stage *point* to centre on, but a model writes
   * them as a *nudge from centre* — `x: -40, y: 60` meaning "a touch left and
   * down", which is also how every craft rule about keeping a subject off dead
   * centre is phrased. Read as absolute, that -40 becomes
   * `1.18 * (960 - -40) = 1180px` of translation and pushes the whole film off
   * frame, with nothing to indicate it beyond a composition that looks wrong.
   *
   * Small values are therefore treated as offsets and large ones as absolute
   * points. The threshold is a quarter of the stage: a real point of interest on a
   * 1920 frame is essentially never within 480px of the origin, and an offset is
   * essentially never larger than that.
   */
  const offsetLimit = Math.min(sb.resolution.width, sb.resolution.height) / 4;
  const looksLikeOffset =
    cam.target === undefined &&
    Math.abs(cam.x ?? 0) <= offsetLimit &&
    Math.abs(cam.y ?? 0) <= offsetLimit;

  const point =
    cam.target !== undefined
      ? `tl.point(${jsString(cam.target)})`
      : looksLikeOffset
        ? `{ x: ${cx + (cam.x ?? 0)}, y: ${cy + (cam.y ?? 0)} }`
        : `{ x: ${cam.x ?? cx}, y: ${cam.y ?? cy} }`;

  /**
   * A push-in must not crop the thing it is pushing into.
   *
   * At scale `s` the visible window is `width/s` by `height/s`, so the frame can
   * only travel `(width - width/s) / 2` before an edge enters shot. The model
   * chooses a zoom and a target without knowing how large the layout is, and a
   * dashboard frame is 1500px wide — so a 1.5x push aimed at a row inside it slid
   * the panel off all four edges at once. The result reads as a rendering fault
   * rather than as a camera move.
   *
   * Clamped at emit time rather than in a craft rule, because the limit depends on
   * geometry the compiler owns and the storyboard cannot see.
   */
  const maxX = ((sb.resolution.width * (s - 1)) / 2).toFixed(1);
  const maxY = ((sb.resolution.height * (s - 1)) / 2).toFixed(1);

  return `
  /* Camera. Leads the cursor by ~260ms; the scale multiply is load-bearing. */
  var p_${n} = ${point};
  var cam_${n} = { x: ${s} * (${cx} - p_${n}.x),
                          y: ${s} * (${cy} - p_${n}.y),
                          scale: ${s} };
  /* Keep the move inside the frame: past this the stage edge enters shot. */
  cam_${n}.x = Math.max(-${maxX}, Math.min(${maxX}, cam_${n}.x));
  cam_${n}.y = Math.max(-${maxY}, Math.min(${maxY}, cam_${n}.y));
  tl.add('.camera', {
    at: ${scene.start + cam.at}, dur: ${cam.dur}, ease: '${cam.ease}',
    x: [0, cam_${n}.x], y: [0, cam_${n}.y], scale: [1, ${s}]
  });
  tl.add('.camera', {
    at: ${scene.start + cam.at + cam.dur + Math.max(400, scene.duration - cam.at - cam.dur - 900)},
    dur: 1000, ease: 'inOutCubic',
    x: [cam_${n}.x, 0], y: [cam_${n}.y, 0], scale: [${s}, 1]
  });`;
}

/* ------------------------------------------------------------------ *
 * Cursor
 * ------------------------------------------------------------------ */

/**
 * Cursor gestures, plus the UI's reaction.
 *
 * `cursorTo` returns timing marks so the reaction hangs off the click rather
 * than a guessed number. `respondAt` already includes the latency beat — adding
 * another delay on top double-counts it and the UI feels sluggish.
 */
function cursorCode(scene: Scene, index: number, sb: Storyboard): string {
  if (!scene.cursor.length) return '';

  const gestures = scene.cursor
    .map((gesture, i) => {
      const name = `c${i}_${slot(index)}`;
      const target = jsString(gesture.target);
      return `
  /* Cursor: travel, settle, press, release, ring. */
  var ${name} = tl.cursorTo(${target}, {
    at: ${scene.start + gesture.at}, travel: ${gesture.travel},
    latency: ${gesture.latency}, click: ${gesture.click}
  });
  tl.add(${target}, { at: ${name}.pressAt, dur: 110, ease: 'outCubic',
                               scale: [1.04, 0.96] });
  tl.cue('click', ${name}.pressAt, { gain: 1.15 });`;
    })
    .join('\n');

  // One cursor serves the whole film, and `cursorTo` only ever fades it *in* — so
  // without this it stays parked wherever the last gesture left it, sitting on the
  // payoff and the end card. A cursor is what makes a mockup a demonstration; left
  // on a title card it is just litter.
  //
  // Only when the next scene has no gestures of its own: two UI scenes in a row
  // should keep it, or it blinks out and back across the cut.
  const next = sb.scenes[index + 1];
  if (next?.cursor.length) return gestures;

  const last = scene.cursor[scene.cursor.length - 1]!;
  // The engine's gesture ends at press + release; mirror its defaults (§ cursorTo).
  const gestureEnd = scene.start + last.at + last.travel + 120 + 90 + 220;
  const boundary = next ? next.start : scene.start + scene.duration;
  const at = Math.max(gestureEnd + 100, boundary - 350);

  return `${gestures}

  /* Retire the cursor before the cut away from UI. */
  tl.add('[data-el="cursor"]', { at: ${at}, dur: 300, ease: 'outQuart',
                               opacity: [1, 0] });`;
}

function cueCode(scene: Scene): string {
  if (!scene.cues.length) return '';
  return scene.cues
    .map((cue) => {
      const opts = cue.gain !== undefined ? `, { gain: ${cue.gain} }` : '';
      return `  tl.cue('${cue.name}', ${scene.start + cue.at}${opts});`;
    })
    .join('\n');
}

/* ------------------------------------------------------------------ *
 * Animations
 * ------------------------------------------------------------------ */

/** Times passed to the scene helper are scene-relative; the helper adds `start`. */
function animationCode(scene: Scene, index: number): string {
  if (!scene.animations.length) return '';

  return scene.animations
    .map((a) => {
      const props: string[] = [];
      if (a.opacity) props.push(`opacity: [${a.opacity.join(', ')}]`);
      if (a.x) props.push(`x: [${a.x.join(', ')}]`);
      if (a.y) props.push(`y: [${a.y.join(', ')}]`);
      if (a.scale) props.push(`scale: [${a.scale.join(', ')}]`);
      if (a.rotate) props.push(`rotate: [${a.rotate.join(', ')}]`);
      if (a.blur) props.push(`blur: [${a.blur.join(', ')}]`);
      // The engine has always interpolated these; the schema just never exposed
      // them, so no film could tilt a panel into frame.
      if (a.rotateY) props.push(`rotateY: [${a.rotateY.join(', ')}]`);
      if (a.rotateX) props.push(`rotateX: [${a.rotateX.join(', ')}]`);
      if (a.z) props.push(`z: [${a.z.join(', ')}]`);

      const parts = [
        `at: ${a.at}`,
        `dur: ${a.dur}`,
        `ease: '${a.ease}'`,
        ...(a.stagger ? [`stagger: ${a.stagger}`] : []),
        ...(a.staggerFrom ? [`staggerFrom: '${a.staggerFrom}'`] : []),
        ...props,
      ];

      return `  s_${slot(index)}.add(${jsString(a.target)}, { ${parts.join(', ')} });`;
    })
    .join('\n');
}

/* ------------------------------------------------------------------ *
 * Element markup
 * ------------------------------------------------------------------ */

/**
 * Absolute positioning is opt-in.
 *
 * `.scene` is the positioning context (`position:absolute; inset:0`), but the
 * component classes are not positioned — `.card` sets background and padding,
 * `.btn` is an `inline-flex`. So a `left`/`top` written onto a bare `.card` is
 * silently ignored and the element lands wherever normal flow puts it, stacked on
 * top of whatever else the scene contains. `.abs` from explainer.css is what makes
 * the coordinate mean anything, and every element that carries one needs it.
 */
const ABS = 'abs';

function metricMarkup(el: StoryboardElement): string {
  // `.tnum` is required on anything that counts, or digit widths differ and the
  // whole line wobbles as the number runs up.
  return `<div class="${ABS} card glass metric" data-el="${esc(el.id)}"
     style="left:${el.x ?? 0}px; top:${el.y ?? 0}px; width:${el.width ?? 420}px;">
  ${el.text ? `<div class="k">${copyText(el.text)}</div>` : ''}
  <div class="v tnum" data-el="${esc(el.id)}-value">${copyText(el.value ?? '0')}</div>
  ${el.attribution ? `<div class="t-caption">${copyText(el.attribution)}</div>` : ''}
</div>`;
}

function rowsMarkup(elements: StoryboardElement[], sb: Storyboard): string {
  // Four rows, not forty. A real app's density reads as texture at film scale.
  const visible = elements.slice(0, 5);

  const rows = visible
    .map(
      (el) => `  <div class="row-item" data-el="${esc(el.id)}">
    <span class="name">${copyText(el.text ?? '')}</span>
    ${el.secondary ? `<span class="badge badge-warn">${copyText(el.secondary)}</span>` : ''}
  </div>`
    )
    .join('\n');

  // `.rows` is a bare flex column with no position of its own, so without a
  // coordinate it sits at the scene origin — behind the copy block, which starts at
  // 30% of the stage height.
  //
  // The column is positioned ONCE, and the rows inside it stack by flexbox. A model
  // naturally gives every row its own x/y (they are elements like any other), and
  // honouring both would lay the same rows out twice: the container would take row
  // one's offset and flexbox would then stack the rest below it, so a column
  // starting at y=250 with 124px steps ends up running off the bottom of the frame.
  // So the first row's coordinate positions the column and the rest are ignored,
  // which is the reading that matches what the model meant.
  const first = visible[0];
  const vertical = sb.aspect === '9:16' || sb.aspect === '4:5';
  const width = first?.width ?? (vertical ? 880 : 940);

  // Clamped into the frame. A model asking for x=520 w=880 on a 1920 stage means
  // "a wide column, roughly centred", not "40px of it off the right edge".
  const margin = 60;
  const maxWidth = sb.resolution.width - margin * 2;
  const finalWidth = Math.min(width, maxWidth);
  const requestedLeft = first?.x ?? Math.round((sb.resolution.width - finalWidth) / 2);
  const left = Math.max(margin, Math.min(requestedLeft, sb.resolution.width - finalWidth - margin));

  // Height is knowable: `.row-item` is 52px and the gap comes from the stylesheet.
  const rowHeight = 52;
  const estimated = visible.length * rowHeight;
  const requestedTop = first?.y ?? Math.round(sb.resolution.height * 0.46);
  const top = Math.max(
    margin,
    Math.min(requestedTop, sb.resolution.height - estimated - margin)
  );

  return `<div class="${ABS} rows" data-el="rows"
     style="left:${left}px; top:${top}px; width:${finalWidth}px;">\n${rows}\n</div>`;
}

function cardMarkup(el: StoryboardElement): string {
  return `<div class="${ABS} card glass" data-el="${esc(el.id)}"
     style="left:${el.x ?? 0}px; top:${el.y ?? 0}px; width:${el.width ?? 380}px;">
  ${el.text ? `<div class="t-headline">${copyText(el.text)}</div>` : ''}
  ${el.secondary ? `<div class="t-body">${copyText(el.secondary)}</div>` : ''}
</div>`;
}

function elementMarkup(el: StoryboardElement): string {
  switch (el.type) {
    case 'metric':
      return metricMarkup(el);
    case 'card':
    case 'feature':
      return cardMarkup(el);
    case 'button':
      return `<button class="${ABS} btn btn-primary" data-el="${esc(el.id)}"
        style="left:${el.x ?? 0}px; top:${el.y ?? 0}px;">${copyText(el.text ?? '')}</button>`;
    case 'badge':
      return `<span class="${ABS} badge" data-el="${esc(el.id)}"
        style="left:${el.x ?? 0}px; top:${el.y ?? 0}px;">${copyText(el.text ?? '')}</span>`;
    // Text-bearing types get a real type class. Without one they fall through to a
    // bare `<div>` at the browser's 16px default, which on a 1920 stage renders as
    // an almost-invisible smudge — the kind of defect that looks like a rendering
    // fault rather than a missing stylesheet hook.
    case 'hero':
    case 'heading':
      return `<div class="${ABS} t-display" data-el="${esc(el.id)}"
        style="left:${el.x ?? 0}px; top:${el.y ?? 0}px;${el.width ? ` width:${el.width}px;` : ''}">${copyText(el.text ?? '')}</div>`;
    default:
      return `<div class="${ABS} t-body" data-el="${esc(el.id)}"
        style="left:${el.x ?? 0}px; top:${el.y ?? 0}px;${el.width ? ` width:${el.width}px;` : ''}">${copyText(el.text ?? '')}</div>`;
  }
}

/* ------------------------------------------------------------------ *
 * Copy block
 * ------------------------------------------------------------------ */

function copyMarkup(scene: Scene, sb: Storyboard): string {
  const c = scene.copy;
  if (!c) return '';

  // Vertical frames get a narrower text column: 1080 wide minus an 80px safe
  // area each side leaves 920, and 880 keeps a margin off the guides.
  const vertical = sb.aspect === '9:16' || sb.aspect === '4:5';
  const width = vertical ? 880 : 940;
  const left = Math.round((sb.resolution.width - width) / 2);

  // Copy sits at 30% of the frame when it is the only thing on screen. When the
  // scene also carries positioned elements it moves above the topmost of them,
  // because the copy block has no coordinate of its own and a fixed 30% lands on
  // top of anything a model placed in the upper half — a text collision, which is
  // the most legible possible defect.
  const positioned = scene.elements
    .map((el) => el.y)
    .filter((y): y is number => typeof y === 'number');

  const defaultTop = Math.round(sb.resolution.height * (vertical ? 0.22 : 0.3));
  // Room for an eyebrow, a display line and a body line at film scale.
  const copyHeight = 260;
  const highestElement = positioned.length ? Math.min(...positioned) : null;

  const top =
    highestElement !== null && highestElement < defaultTop + copyHeight
      ? Math.max(60, highestElement - copyHeight)
      : defaultTop;

  const lines: string[] = [];
  if (c.eyebrow) {
    lines.push(`  <div class="t-eyebrow" data-el="eyebrow">${copyText(c.eyebrow)}</div>`);
  }
  if (c.headline) {
    // The mask is a clipping parent with the text sliding up inside it. Opacity
    // must never go on the mask — it would become a backdrop root.
    lines.push(`  <div class="line-mask" data-el="headline-mask">
    <span class="t-display" data-el="headline">${copyText(c.headline)}</span>
  </div>`);
  }
  if (c.body) {
    const size = c.bodySize ? ` style="font-size:${c.bodySize}px"` : '';
    lines.push(`  <div class="t-body" data-el="body"${size}>${copyText(c.body)}</div>`);
  }
  if (c.cta) {
    lines.push(`  <div class="t-headline" data-el="cta">${copyText(c.cta)}</div>`);
  }

  return `<div class="abs" style="left:${left}px; top:${top}px; width:${width}px;">
${lines.join('\n')}
</div>`;
}

/* ------------------------------------------------------------------ *
 * Default motion
 * ------------------------------------------------------------------ */

/**
 * Motion for a scene whose storyboard supplied no animations.
 *
 * The defaults encode the craft rules directly: film-clock durations, ease-out
 * entrances, a 60-120ms stagger, and copy landing after the visual it names.
 */
/** Which structural frame a scene type builds, if any. */
function frameTargetFor(type: Scene['type']): string | null {
  switch (type) {
    case 'dashboard':
      return '[data-el="app-frame"]';
    case 'device':
      return '[data-el="phone"]';
    case 'scroll':
      return '[data-el="scroll-frame"]';
    default:
      return null;
  }
}

/**
 * The frame's 3D entrance.
 *
 * A browser or phone frame is the subject of its beat, so it enters as an object
 * with mass — rotating toward the viewer while rising and settling — rather than
 * fading in flat. This is what separates a product film from a slideshow, and it is
 * why `rotateY`/`rotateX` had to be exposed on the timeline at all.
 *
 * The rest pose comes from the `tilt-*` class in CSS; the timeline animates *from* a
 * steeper angle *to* that pose, so the two never fight over the transform.
 */
function frameEntranceCode(scene: Scene, index: number): string {
  const target = frameTargetFor(scene.type);
  if (!target) return '';

  const s = `s_${slot(index)}`;
  const restY = scene.type === 'device' ? 14 : 0;
  const restX = scene.type === 'device' ? 0 : -10;

  return `  /* The frame enters as an object: it rotates toward the viewer as it settles. */
  ${s}.set(${jsString(target)}, { opacity: 0, y: 70, scale: 0.94, rotateY: ${restY + 16}, rotateX: ${restX + 8} });
  ${s}.add(${jsString(target)}, { at: 120, dur: 1200, ease: 'softLand',
                               y: [70, 0], scale: [0.94, 1],
                               rotateY: [${restY + 16}, ${restY}], rotateX: [${restX + 8}, ${restX}] });
  ${s}.add(${jsString(target)}, { at: 120, dur: 700, ease: 'outQuart', opacity: [0, 1] });`;
}

function defaultMotion(scene: Scene, index: number): string {
  const s = `s_${slot(index)}`;
  const lines: string[] = [];
  const hasCopy = Boolean(scene.copy?.headline || scene.copy?.body);
  const hasElements = scene.elements.length > 0;

  const framed = frameTargetFor(scene.type) !== null;
  const entrance = frameEntranceCode(scene, index);
  if (entrance) lines.push(entrance);

  if (scene.elements.some((e) => e.type === 'row')) {
    // Rows land after the frame that holds them, or they appear to arrive through
    // its chrome.
    const at = framed ? 700 : 300;
    lines.push(`  /* Rows arrive first; the copy then names what the viewer has seen. */
  ${s}.set('.row-item', { opacity: 0, y: 26 });
  ${s}.add('.row-item', {
    at: ${at}, dur: 640, ease: 'outExpo', stagger: 90, staggerFrom: 'start',
    opacity: [0, 1], y: [26, 0]
  });`);
  }

  // Message bubbles alternate sides, so they come in from their own side — the
  // conversation reads as a conversation rather than as a list.
  if (scene.type === 'device') {
    lines.push(`  ${s}.set('.bubble', { opacity: 0, y: 22, scale: 0.96 });
  ${s}.add('.bubble', { at: 900, dur: 620, ease: 'outBack', stagger: 110, staggerFrom: 'start',
                      opacity: [0, 1], y: [22, 0], scale: [0.96, 1] });`);
  }

  // Feature cells: a stagger across a grid is what makes it read as a set rather
  // than as one block appearing.
  if (scene.type === 'feature' || scene.type === 'scroll') {
    const at = framed ? 800 : 400;
    lines.push(`  ${s}.set('.cell', { opacity: 0, y: 34, scale: 0.97 });
  ${s}.add('.cell', { at: ${at}, dur: 760, ease: 'softLand', stagger: 95, staggerFrom: 'start',
                    opacity: [0, 1], y: [34, 0], scale: [0.97, 1] });
  ${s}.set('.icon-tile', { scale: 0.7, opacity: 0 });
  ${s}.add('.icon-tile', { at: ${at + 160}, dur: 620, ease: 'outBack', stagger: 95,
                         scale: [0.7, 1], opacity: [0, 1] });`);
  }

  // The logo lockup: a scale-and-settle, which is the one place a slight overshoot
  // is right — it reads as arrival.
  if (['hero', 'logo', 'cta', 'transition'].includes(scene.type)) {
    lines.push(`  ${s}.set('[data-el="logo"]', { opacity: 0, scale: 0.88 });
  ${s}.add('[data-el="logo"]', { at: 150, dur: 900, ease: 'outBack',
                              opacity: [0, 1], scale: [0.88, 1] });`);
  }

  // Cards and metrics: transform on the wrapper, opacity on the glass element,
  // or fading the wrapper turns it into a backdrop root and flattens the glass.
  const glassy = scene.elements.filter(
    (e) => e.type === 'card' || e.type === 'metric'
  );
  if (glassy.length && scene.type !== 'feature') {
    const at = framed ? 600 : 300;
    lines.push(`  ${s}.set('.card', { y: 24 });
  ${s}.add('.card', { at: ${at}, dur: 820, ease: 'softLand', stagger: 85, y: [24, 0], scale: [0.97, 1] });
  ${s}.add('.card', { at: ${at}, dur: 620, ease: 'outQuart', stagger: 85, opacity: [0, 1] });`);
  }

  // The hero stat: the number rises through a mask and scales to rest, then the
  // source line fades in below it. The mask is a clipping parent; opacity never
  // goes on it (it would become a backdrop root and flatten the glass).
  if (scene.type === 'zoom' && scene.elements.some((e) => e.type === 'metric')) {
    lines.push(`  ${s}.set('[data-el="stat-value"] span', { y: 120 });
  ${s}.add('[data-el="stat-value"] span', { at: 160, dur: 1050, ease: 'outExpo', y: [120, 0] });
  ${s}.add('[data-el="stat-value"]', { at: 160, dur: 1250, ease: 'softLand', scale: [0.96, 1] });
  ${s}.set('[data-el="stat-label"]', { opacity: 0, y: 16 });
  ${s}.add('[data-el="stat-label"]', { at: 120, dur: 600, ease: 'outQuart', opacity: [0, 1], y: [16, 0] });
  ${s}.set('[data-el="stat-body"]', { opacity: 0, y: 20 });
  ${s}.add('[data-el="stat-body"]', { at: 1050, dur: 700, ease: 'outQuart', opacity: [0, 1], y: [20, 0] });`);
  }

  if (hasCopy) {
    // ~600ms after the visual, so the copy reads as agreement rather than
    // assertion. Overlap at ~65% rather than queueing.
    const at = hasElements && !framed ? 900 : framed ? 200 : 300;
    lines.push(`  ${s}.set('[data-el="headline"]', { y: 110 });
  ${s}.add('[data-el="headline"]', { at: ${at}, dur: 900, ease: 'outExpo', y: [110, 0] });
  ${s}.add('[data-el="eyebrow"]', { at: ${Math.max(0, at - 150)}, dur: 600, ease: 'outQuart',
                                  opacity: [0, 1], y: [14, 0] });
  ${s}.add('[data-el="body"]', { at: ${at + 585}, dur: 700, ease: 'outQuart',
                              opacity: [0, 1], y: [18, 0] });
  ${s}.add('[data-el="cta"]', { at: ${at + 900}, dur: 640, ease: 'outBack',
                             opacity: [0, 1], y: [20, 0] });`);
  }

  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export function buildScene(scene: Scene, sb: Storyboard, index: number): BuiltScene {
  // A per-type layout composes real components — a browser frame for a dashboard, a
  // phone for a message thread, an icon grid for a feature beat — so scenes stop
  // arriving as "centred text with things under it", which is what made every film
  // look like the last one. `capture` and anything unrecognised fall through to the
  // generic path below.
  const layout = layoutFor(scene, sb);

  const inner = layout
    ? layout.markup
    : [
        copyMarkup(scene, sb),
        scene.elements.filter((e) => e.type === 'row').length
          ? rowsMarkup(
              scene.elements.filter((e) => e.type === 'row'),
              sb
            )
          : '',
        ...scene.elements.filter((e) => e.type !== 'row').map(elementMarkup),
      ]
        .filter(Boolean)
        .join('\n\n');

  const sceneClass = layout?.sceneClass ? ` ${layout.sceneClass}` : '';
  const markup = `    <section class="scene${sceneClass}" data-scene="${esc(scene.id)}">
${indent(inner, 6)}
    </section>`;

  const animations = animationCode(scene, index);

  /**
   * The frame's 3D entrance always runs.
   *
   * It used to live in `defaultMotion`, which only fires when the storyboard supplies
   * no animations of its own — and a model always supplies some. So the depth was
   * present in exactly the films nobody generates. The frame is structural: the
   * compiler put it there, the model does not know its selector, and animating it is
   * the compiler's job either way.
   *
   * It is emitted *before* the model's records so an explicit animation on the same
   * target still wins on the properties it names.
   */
  const frameEntrance = animations ? frameEntranceCode(scene, index) : '';

  const body = [
    frameEntrance,
    animations || defaultMotion(scene, index),
    cursorCode(scene, index, sb),
    cameraCode(scene, sb, index),
    cueCode(scene),
  ]
    .filter(Boolean)
    .join('\n');

  // `fade: 0` is a hard cut and the default. A dissolve is only requested
  // explicitly, because a fading scene flattens its own glass.
  const fade = scene.transition.fade;

  /**
   * Motion out of the scene.
   *
   * Scene ranges overlap so a tween can carry across the cut, but nothing was ever
   * animating during the overlap — every scene eased in, sat still, and was
   * replaced. That reads as a slideshow no matter how good each frame is.
   *
   * So the subject drifts and recedes slightly in the last ~500ms. Because the
   * outgoing scene is still painting while the incoming one starts, the eye
   * follows continuous movement through the cut rather than registering a
   * substitution. `whip` and `match` get a stronger push, since both are supposed
   * to feel like the camera moved rather than the picture changed.
   */
  const exitTargets: Record<string, string> = {
    dashboard: '[data-el="app-frame"]',
    device: '[data-el="phone"]',
    scroll: '[data-el="scroll-frame"]',
    // A feature scene whose only content is metrics renders the stat block, not
    // a grid; a grid-only feature renders the grid.
    feature: scene.elements.some((e) => e.type === 'metric') &&
      !scene.elements.some((e) => e.type !== 'metric')
      ? '[data-el="stat-block"]'
      : '[data-el="feature-grid"]',
    hero: '[data-el="lockup"]',
    logo: '[data-el="lockup"]',
    text: '[data-el="text-block"]',
    // A zoom beat is either a push on a stat or a push on a copy block.
    zoom:
      scene.elements.some((e) => e.type === 'metric')
        ? '[data-el="stat-block"]'
        : '[data-el="text-block"]',
  };
  const exitTarget = exitTargets[scene.type];
  const kind = scene.transition.kind;
  // An end card holds to black; pushing it away undercuts the one thing the film
  // is asking for.
  const wantsExit = exitTarget && scene.beat !== 'end' && kind !== 'dissolve';

  const exitCode = wantsExit
    ? (() => {
        const strong = kind === 'whip' || kind === 'match';
        const dur = strong ? 520 : 620;
        const at = Math.max(0, scene.duration - dur + 120);
        const drift = strong ? -90 : -34;
        const depth = strong ? -220 : -90;
        return `
  /* Carry motion through the cut: the subject recedes as the next scene starts. */
  ${`s_${slot(index)}`}.add(${jsString(exitTarget)}, {
    at: ${at}, dur: ${dur}, ease: 'inOutCubic',
    y: [0, ${drift}], z: [0, ${depth}], scale: [1, ${strong ? 0.9 : 0.97}]
  });`;
      })()
    : '';

  // Each scene gets its own helper variable, named by ordinal rather than by id:
  // a model-supplied id is not guaranteed to be a legal identifier. The SCENES
  // lookup is by key for the same reason.
  const code = `  /* ---- ${scene.id} (${scene.beat}) ---- */
  var s_${slot(index)} = tl.scene(${jsString(scene.id)}, SCENES[${jsString(scene.id)}][0], SCENES[${jsString(scene.id)}][1], { fade: ${fade} });
${body}${exitCode}`;

  return { markup, code };
}
