/* ============================================================================
   starter.timeline.js — the timing for templates/starter.html

   Read this top to bottom; it is meant to be edited, not extended. Every
   pattern worth copying appears once: staggered entrance, compound move,
   overlap, hard cut, hold, and the wrapper/glass opacity split.

   The one rule: all timing lives here. Nothing in the HTML animates.
   ============================================================================ */
(function () {
  'use strict';

  /* Single source of truth for scene timing. Moving a scene is one edit here,
     not a hunt through offsets. [start, duration] in ms.

     NOTE THE OVERLAPS: reveal starts 300ms before hook ends, end starts 300ms
     before reveal ends. Scene ranges are allowed to overlap — each scene stays
     alive for its own window and they stack absolutely. The overlap is what
     stops the film dead-halting at every cut: the outgoing scene is still
     resolving while the incoming one has already begun. Hard cut, no dissolve,
     but never a full stop. */
  var SCENES = {
    hook:   [0,     6000],   /* 0     -> 6000  */
    reveal: [5700,  5300],   /* 5700  -> 11000 */
    end:    [10700, 3800]    /* 10700 -> 14500 */
  };
  var TOTAL = 14500;

  /* Hard cuts. A crossfade between scenes reads as slideshow, and a scene-level
     opacity fade would flatten any glass inside it. */
  var CUT = { fade: 0 };

  var tl = new Timeline({
    duration: TOTAL, fps: 60, width: 1920, height: 1080
  });

  /* ==========================================================================
     S1 — HOOK
     ========================================================================== */
  var s1 = tl.scene('hook', SCENES.hook[0], SCENES.hook[1], CUT);

  /* Rest pose first. Without this the rows would inherit their pending value
     from the first record, which happens to be correct here — but relying on
     that is how you get a mystery later. Be explicit. */
  s1.set('[data-el="eyebrow"]', { opacity: 0, y: 12 });
  s1.set('[data-el="q"]',       { opacity: 0, y: 26 });
  s1.set('[data-el="hook-line"]', { opacity: 0, y: 30 });

  s1.add('[data-el="eyebrow"]', {
    at: 200, dur: 520, ease: 'outQuart', opacity: [0, 1], y: [12, 0]
  });

  /* Staggered entrance. 170ms is at the loose end on purpose: each row should
     register as a separate arrival, because the count is the point. */
  s1.add('[data-el="q"]', {
    at: 500, dur: 620, ease: 'outExpo',
    stagger: 170, staggerFrom: 'start',
    opacity: [0, 1], y: [26, 0]
  });
  for (var i = 0; i < 5; i++) {
    s1.cue('pop', 500 + i * 170, { gain: 0.5 + i * 0.06, pitch: 1 + i * 0.04 });
  }

  /* The headline lands after the last row has settled — it names what the
     viewer has already noticed. Compound move: opacity finishes before the
     position does, so it is readable while still arriving. */
  var lastRow = 500 + 4 * 170 + 620;
  s1.add('[data-el="hook-line"]', { at: lastRow + 260, dur: 700,  ease: 'outQuart', opacity: [0, 1] });
  s1.add('[data-el="hook-line"]', { at: lastRow + 260, dur: 1000, ease: 'softLand', y: [30, 0] });
  s1.cue('thump', lastRow + 300, { gain: 0.5 });
  /* Then hold. The remaining ~1.4s of stillness is doing work. */

  /* ==========================================================================
     S2 — REVEAL. Hard cut: the problem stops, something else is here.
     ========================================================================== */
  var s2 = tl.scene('reveal', SCENES.reveal[0], SCENES.reveal[1], CUT);

  s2.set('[data-el="hero-glass"]', { opacity: 0 });
  s2.set('[data-el="lock"]', { opacity: 0, y: 20 });
  s2.set('[data-el="tag"]',  { opacity: 0, y: 16 });
  s2.set('[data-el="sheen"]', { x: -420 });

  /* THE SPLIT — transform on the wrapper, opacity on the glass element.
     Fading the wrapper makes it a backdrop root and the glass silently goes
     flat. This is the single most common way to break Liquid Glass. */
  s2.add('[data-el="hero-wrap"]',  { at: 0, dur: 1100, ease: 'softLand', scale: [0.94, 1], y: [26, 0] });
  s2.add('[data-el="hero-glass"]', { at: 0, dur: 620,  ease: 'outQuart', opacity: [0, 1] });
  s2.cue('whoosh', 0, { gain: 0.55 });
  s2.cue('chime', 240, { gain: 0.5 });

  /* Sheen sweeps ONCE. On a loop it reads as a loading skeleton. */
  s2.add('[data-el="sheen"]', { at: 320, dur: 1150, ease: 'inOutCubic', x: [-420, 1420] });

  /* Contents lag the panel by ~60ms — secondary motion, so the scene has depth
     instead of looking like a flat image being slid around. */
  s2.add('[data-el="lock"]', { at: 380, dur: 760, ease: 'outExpo', opacity: [0, 1], y: [20, 0] });
  s2.add('[data-el="tag"]',  { at: 560, dur: 720, ease: 'outQuart', opacity: [0, 1], y: [16, 0] });

  /* ==========================================================================
     CAMERA — a slow push toward the hero panel, held, then released.

     camTo() brings a stage point to the stage centre. The scale factor is in
     there on purpose: the engine writes `translate3d(...) scale(...)` and CSS
     applies the RIGHTMOST function first, so the point is scaled about the
     centre before it is translated. Without the multiply the target lands
     hundreds of px off at any zoom above ~1.5.

     Animate .camera and nothing else for frame moves. Transform on an ancestor
     is safe for Liquid Glass; opacity/filter/mask are not — so never fade this.

     This push is deliberately gentle (1.12x). Cursor-led zooms in a UI scene go
     harder, 1.6-2.2x. Either way one push per beat. */
  var CX = 960, CY = 540;
  function camTo(px, py, s) {
    return { x: s * (CX - px), y: s * (CY - py), scale: s };
  }
  var push = camTo(960, 470, 1.12);   /* hero panel sits slightly above centre */

  tl.add('[data-el="camera"]', {
    at: SCENES.reveal[0] - 240,       /* LEADS the reveal — anticipation, not lockstep */
    dur: 1500, ease: 'inOutCubic',
    x: [0, push.x], y: [0, push.y], scale: [1, push.scale]
  });
  /* Released so it is still moving through the cut into the end card. A camera
     that finishes its move and sits still for a second is the dead air that
     makes an explainer feel like a slideshow. */
  tl.add('[data-el="camera"]', {
    at: SCENES.end[0] - 700,
    dur: 1400, ease: 'inOutCubic',
    x: [push.x, 0], y: [push.y, 0], scale: [push.scale, 1]
  });

  /* ==========================================================================
     S3 — END CARD. One action, held long enough to act on.
     ========================================================================== */
  var s3 = tl.scene('end', SCENES.end[0], SCENES.end[1], CUT);

  s3.set('[data-el="end-lock"]', { opacity: 0, scale: 0.96 });
  s3.set('[data-el="end-cta"]',  { opacity: 0, y: 18 });

  s3.add('[data-el="end-lock"]', { at: 0, dur: 900, ease: 'outExpo', opacity: [0, 1], scale: [0.96, 1] });
  s3.add('[data-el="end-cta"]',  { at: 420, dur: 700, ease: 'outQuart', opacity: [0, 1], y: [18, 0] });
  s3.cue('success', 60, { gain: 0.6 });
  /* ~2.1s of hold. Long enough to read the URL and decide. */

  /* ==========================================================================
     CURSOR — aim at the ELEMENT, never at hand-computed numbers.

     cursorTo() reads the target's LAYOUT position (an offsetParent walk), so it
     stays correct when the button moves and it is immune to both the stage fit
     scale and the camera transform. Hand-derived coordinates are correct exactly
     once; the next layout nudge silently puts every click a few px off.

     It plays the whole gesture — bowed travel, settle, press, release, ring —
     and returns the timing marks so the UI's reaction hangs off the click
     instead of a guessed number.
     ========================================================================== */
  var cta = tl.cursorTo('[data-el="end-cta"] .btn-primary', {
    at: SCENES.end[0] + 900,      /* after the CTA has finished arriving */
    from: { x: 1180, y: 250 }     /* first move needs a start; later ones chain */
  });

  tl.cue('click', cta.pressAt, { gain: 0.9 });
  /* The button reacts to the press, then recovers. */
  tl.add('[data-el="end-cta"] .btn-primary', {
    at: cta.pressAt, dur: 110, ease: 'outCubic', scale: [1, 0.96]
  });
  tl.add('[data-el="end-cta"] .btn-primary', {
    at: cta.releaseAt, dur: 320, ease: 'outBack', scale: [0.96, 1]
  });

  /* ==========================================================================
     AMBIENT — must be a function of t, never a CSS animation. A CSS keyframe
     animation freezes during frame-by-frame export because the browser clock
     does not advance between seeks.
     ========================================================================== */
  var auroras = document.querySelectorAll('[data-el="aurora"], [data-el="end-aurora"]');
  tl.loop(function (t) {
    for (var j = 0; j < auroras.length; j++) {
      var dx = Math.sin(t / 4200 + j) * 16;
      var dy = Math.cos(t / 5600 + j) * 11;
      auroras[j].style.transform =
        'translate3d(' + dx.toFixed(2) + 'px,' + dy.toFixed(2) + 'px,0) scale(1.06)';
    }
  });

  /* NO explicit pad cue here. SFX schedules an ambient bed automatically
     (SFX.bedGain, default 1) — a slow chord progression across the whole
     duration. Adding your own full-length `pad` on top stacks a second drone in
     the same octave and the low end turns to mud. Adjust the bed instead:
       SFX.bedGain = 0.6;   // quieter
       SFX.bedGain = 0;     // off, then place pads by hand
     Short pads for a single scene are still fine — it is the full-length one
     that collides. */

  tl.mount();
}());
