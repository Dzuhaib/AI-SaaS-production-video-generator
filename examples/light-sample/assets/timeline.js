/* timeline.js — deterministic, seekable animation engine (classic script, no
   modules, so it works over file:// with no server and no CORS problems).

   THE CONTRACT THAT MAKES VIDEO EXPORT WORK
   Animation state is a PURE FUNCTION of time t. Nothing depends on the
   browser's animation clock, on transition events, or on how many frames have
   elapsed. seek(1234) always produces byte-identical pixels.

   That means: do NOT put CSS `transition` on anything this engine animates.
   The engine writes inline styles directly; a transition would fight it and
   introduce time-dependence you cannot seek.

   Preview mode advances t with requestAnimationFrame. Render mode lets an
   external harness call seek(t) once per frame and screenshot. Same code path.

   Exposes: window.Timeline, window.Ease, window.splitText,
            window.__EXPLAINER__ (the render harness hook) */
(function (global) {
  'use strict';

  /* EASING
     Cubic-bezier solved with Newton-Raphson, falling back to bisection. Same
     algorithm class browsers use, so previews match CSS-eased elements. */
  function cubicBezier(x1, y1, x2, y2) {
    if (x1 === y1 && x2 === y2) return function (t) { return t; };
    var A = function (a1, a2) { return 1 - 3 * a2 + 3 * a1; };
    var B = function (a1, a2) { return 3 * a2 - 6 * a1; };
    var C = function (a1) { return 3 * a1; };
    var calc = function (t, a1, a2) { return ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t; };
    var slope = function (t, a1, a2) { return 3 * A(a1, a2) * t * t + 2 * B(a1, a2) * t + C(a1); };

    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var t = x;
      for (var i = 0; i < 8; i++) {
        var xEst = calc(t, x1, x2) - x;
        if (Math.abs(xEst) < 1e-6) return calc(t, y1, y2);
        var d = slope(t, x1, x2);
        if (Math.abs(d) < 1e-6) break;
        t -= xEst / d;
      }
      var lo = 0, hi = 1;
      t = x;
      for (var j = 0; j < 24; j++) {
        var v = calc(t, x1, x2);
        if (Math.abs(v - x) < 1e-6) break;
        if (v > x) hi = t; else lo = t;
        t = (lo + hi) / 2;
      }
      return calc(t, y1, y2);
    };
  }

  /* Closed-form damped spring. Deterministic and seekable — no per-frame
     integration, so seek(t) is exact at any t and never drifts. */
  function spring(opts) {
    opts = opts || {};
    var stiffness = opts.stiffness || 180;
    var damping = opts.damping || 22;
    var mass = opts.mass || 1;
    var w0 = Math.sqrt(stiffness / mass);
    var zeta = damping / (2 * Math.sqrt(stiffness * mass));
    /* Normalize the sim window so the spring has essentially settled at t=1,
       whatever the stiffness. 4.6 time-constants ~= 99% settled. */
    var settle = zeta < 1 ? 4.6 / (zeta * w0) : 6.0 / w0;
    return function (t) {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      var T = t * settle;
      if (zeta < 1) {
        var wd = w0 * Math.sqrt(1 - zeta * zeta);
        return 1 - Math.exp(-zeta * w0 * T) *
          (Math.cos(wd * T) + (zeta * w0 / wd) * Math.sin(wd * T));
      }
      return 1 - Math.exp(-w0 * T) * (1 + w0 * T);
    };
  }

  var Ease = {
    linear:       function (t) { return t; },
    /* Film-clock set. These are the curves that carry the piece. */
    outExpo:      cubicBezier(0.16, 1, 0.30, 1),
    outQuint:     cubicBezier(0.22, 1, 0.36, 1),
    outQuart:     cubicBezier(0.25, 1, 0.50, 1),
    outCubic:     cubicBezier(0.33, 1, 0.68, 1),
    outCirc:      cubicBezier(0.00, 0.55, 0.45, 1),
    outBack:      cubicBezier(0.34, 1.56, 0.64, 1),
    inExpo:       cubicBezier(0.70, 0, 0.84, 0),
    inCubic:      cubicBezier(0.32, 0, 0.67, 0),
    inQuart:      cubicBezier(0.50, 0, 0.75, 0),
    inOutCubic:   cubicBezier(0.65, 0, 0.35, 1),
    inOutQuart:   cubicBezier(0.76, 0, 0.24, 1),
    inOutQuint:   cubicBezier(0.83, 0, 0.17, 1),
    inOutCirc:    cubicBezier(0.85, 0, 0.15, 1),
    softLand:     cubicBezier(0.05, 0.70, 0.10, 1),
    standard:     cubicBezier(0.20, 0, 0, 1),
    /* Interactive-UI clock. */
    uiOut:        cubicBezier(0.00, 0, 0.58, 1),
    uiInOut:      cubicBezier(0.42, 0, 0.58, 1),
    spring:       spring(),
    springSoft:   spring({ stiffness: 120, damping: 20 }),
    springSnappy: spring({ stiffness: 320, damping: 26 }),
    bezier:       cubicBezier,
    makeSpring:   spring,
    /* Step function for hard cuts and typewriters. */
    steps: function (n) {
      return function (t) { return Math.floor(t * n) / n; };
    }
  };

  function resolveEase(e) {
    if (typeof e === 'function') return e;
    if (typeof e === 'string') {
      if (Ease[e]) return Ease[e];
      var m = e.match(/cubic-bezier\(([^)]+)\)/);
      if (m) {
        var p = m[1].split(',').map(Number);
        return cubicBezier(p[0], p[1], p[2], p[3]);
      }
    }
    return Ease.outQuint;
  }

  /* HELPERS */
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function lerp(a, b, p) { return a + (b - a) * p; }

  function toArray(target) {
    if (!target) return [];
    if (typeof target === 'string') {
      return Array.prototype.slice.call(document.querySelectorAll(target));
    }
    if (target.nodeType === 1) return [target];
    if (typeof target.length === 'number') {
      var out = [];
      for (var i = 0; i < target.length; i++) {
        var t = target[i];
        if (typeof t === 'string') out = out.concat(toArray(t));
        else if (t && t.nodeType === 1) out.push(t);
      }
      return out;
    }
    return [];
  }

  /* Deterministic pseudo-random from an integer seed. Used for "random"
     stagger and jitter so that the same frame always looks the same. A real
     Math.random() here would make video export non-reproducible. */
  function hashRand(i, salt) {
    var x = Math.sin((i + 1) * 12.9898 + (salt || 0) * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  function hyphen(k) {
    return k.charAt(0) === '-' ? k : k.replace(/[A-Z]/g, function (m) {
      return '-' + m.toLowerCase();
    });
  }

  /* VALUE INTERPOLATION
     Handles plain numbers, numbers with units ("24px", "-1.5em", "40%"),
     and colors (#rgb, #rrggbb, rgb(), rgba()). */
  var NUM_UNIT = /^(-?[\d.]+)([a-z%]*)$/i;

  function parseColor(v) {
    if (typeof v !== 'string') return null;
    v = v.trim();
    var m;
    if (v.charAt(0) === '#') {
      var h = v.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      if (h.length !== 6) return null;
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16),
              parseInt(h.slice(4, 6), 16), 1];
    }
    m = v.match(/^rgba?\(([^)]+)\)$/i);
    if (m) {
      var p = m[1].split(',').map(function (s) { return parseFloat(s); });
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    }
    return null;
  }

  function interpolate(from, to, p) {
    if (typeof from === 'number' && typeof to === 'number') {
      return lerp(from, to, p);
    }
    var cf = parseColor(from), ct = parseColor(to);
    if (cf && ct) {
      return 'rgba(' + Math.round(lerp(cf[0], ct[0], p)) + ',' +
                       Math.round(lerp(cf[1], ct[1], p)) + ',' +
                       Math.round(lerp(cf[2], ct[2], p)) + ',' +
                       (Math.round(lerp(cf[3], ct[3], p) * 1000) / 1000) + ')';
    }
    var mf = String(from).match(NUM_UNIT), mt = String(to).match(NUM_UNIT);
    if (mf && mt) {
      var unit = mt[2] || mf[2] || '';
      return (lerp(parseFloat(mf[1]), parseFloat(mt[1]), p)) + unit;
    }
    /* Structural: same skeleton, different numbers. This is what makes shape
       morphing work at all — see the block below. */
    var st = interpolateStructural(from, to, p);
    if (st !== null) return st;
    /* Genuinely non-interpolable: switch at the midpoint. */
    return p < 0.5 ? from : to;
  }

  /* STRUCTURAL INTERPOLATION — the whole basis of shape morphing here.

     An enormous number of CSS and SVG values are "a fixed skeleton with numbers
     poured into it":
       polygon(50% 0%, 100% 50%, 0% 100%)
       M0 0 C4 2 8 6 12 12 Z
       0 8px 24px rgba(0,0,0,0.28)
     If two values share the SAME skeleton — identical non-numeric text, in the
     same order, holding the same COUNT of numbers — then interpolating them is
     just lerping the numbers pairwise and pouring them back in. One rule buys
     clip-path polygons, SVG path data, `points` lists, gradient stops and
     shadows with no per-property special case.

     If the skeletons differ there is no honest pairwise answer: a 4-point
     polygon against a 6-point one has no correspondence, and an `L` command
     against a `C` does not even have matching arity. We return null and the
     caller falls back to a midpoint switch. That is the normalization problem,
     and it is the AUTHOR's job to fix by matching the two shapes — which is
     exactly what "Shape morphing" in the prose is about. */
  var NUM_G = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;

  /* Split a value into its literal parts and its numbers.

     `split` on a global regex keeps the text BETWEEN the matches, so there is
     no placeholder character to collide with real content — a sentinel would
     have to be a character that can never appear in a CSS value, and there is
     no such character worth betting on.

     Whitespace runs are then collapsed, because once the numbers are out,
     `polygon(0% 0%, 1px 2px)` and `polygon(0% 0%,1px 2px)` describe the same
     shape and must be allowed to morph into each other. */
  function numSkeleton(v) {
    var str = String(v);
    var parts = str.split(NUM_G);
    var nums = str.match(NUM_G);
    var skel = [];
    for (var i = 0; i < parts.length; i++) {
      /* Separator normalization. Between two numbers, whitespace and commas
         both mean only "next number" — `polygon(0% 0%,1px 2px)` and
         `polygon(0% 0%, 1px 2px)` are the same shape, and `M0 0` and `M0,0`
         are the same path. Collapsing them means an author's formatting can
         never be the reason a morph silently degrades to a midpoint snap.
         Everything that carries MEANING — the function name, the parens, the
         units, the path command letters — survives untouched, so two genuinely
         different values still fail to match. */
      skel.push(parts[i].replace(/[\s,]+/g, ' ').trim());
    }
    return {
      skel: skel.join('\u0000'),
      parts: parts,
      nums: nums ? nums.map(parseFloat) : []
    };
  }

  function interpolateStructural(from, to, p) {
    var a = numSkeleton(from), b = numSkeleton(to);
    /* Same literal skeleton AND the same count of numbers, or there is no
       honest pairwise correspondence to interpolate. */
    if (!a.nums.length || a.nums.length !== b.nums.length) return null;
    if (a.skel !== b.skel) return null;
    var out = b.parts[0];
    for (var i = 0; i < b.nums.length; i++) {
      var v = lerp(a.nums[i], b.nums[i], p);
      /* 3dp is below the visible threshold at any sane stage size, and keeps a
         200-point path from becoming a kilobyte of attribute churn per frame. */
      out += String(Math.round(v * 1000) / 1000) + b.parts[i + 1];
    }
    return out;
  }

  /* PROPERTY MODEL
     Transforms must be composed into ONE transform string per element per
     frame, otherwise the last tween to write wins and everything else is
     silently dropped. Same for filters. This is the single most common bug in
     hand-rolled animation code, so the engine owns it. */
  var TRANSFORM_ORDER = ['perspective', 'translate3d', 'rotate', 'rotateX',
    'rotateY', 'skewX', 'skewY', 'scaleXY'];

  var TRANSFORM_PROPS = {
    x: 1, y: 1, z: 1, scale: 1, scaleX: 1, scaleY: 1, rotate: 1,
    rotateX: 1, rotateY: 1, skewX: 1, skewY: 1, perspective: 1
  };
  var FILTER_PROPS = { blur: 'px', saturate: '', brightness: '', contrast: '', grayscale: '' };

  var TRANSFORM_DEFAULTS = {
    x: 0, y: 0, z: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0,
    rotateX: 0, rotateY: 0, skewX: 0, skewY: 0, perspective: 0
  };

  function unitFor(prop, v) {
    if (typeof v !== 'number') return String(v);
    if (prop === 'x' || prop === 'y' || prop === 'z' || prop === 'perspective') return v + 'px';
    if (prop === 'rotate' || prop === 'rotateX' || prop === 'rotateY' ||
        prop === 'skewX' || prop === 'skewY') return v + 'deg';
    return String(v);
  }

  function buildTransform(t) {
    var out = [];
    if (t.perspective) out.push('perspective(' + unitFor('perspective', t.perspective) + ')');
    if (t.x !== undefined || t.y !== undefined || t.z !== undefined) {
      var x = t.x === undefined ? 0 : t.x;
      var y = t.y === undefined ? 0 : t.y;
      var z = t.z === undefined ? 0 : t.z;
      if (x || y || z) {
        out.push('translate3d(' + unitFor('x', x) + ',' + unitFor('y', y) + ',' + unitFor('z', z) + ')');
      }
    }
    ['rotate', 'rotateX', 'rotateY', 'skewX', 'skewY'].forEach(function (k) {
      if (t[k] !== undefined && parseFloat(t[k]) !== 0) {
        out.push(k + '(' + unitFor(k, t[k]) + ')');
      }
    });
    var sx = t.scaleX !== undefined ? t.scaleX : t.scale;
    var sy = t.scaleY !== undefined ? t.scaleY : t.scale;
    if (sx !== undefined || sy !== undefined) {
      sx = sx === undefined ? 1 : sx;
      sy = sy === undefined ? 1 : sy;
      if (sx !== 1 || sy !== 1) out.push('scale(' + sx + ',' + sy + ')');
    }
    return out.length ? out.join(' ') : '';
  }

  function buildFilter(f) {
    var out = [];
    for (var k in f) {
      if (!Object.prototype.hasOwnProperty.call(f, k)) continue;
      var v = f[k];
      out.push(k + '(' + (typeof v === 'number' ? v + FILTER_PROPS[k] : v) + ')');
    }
    return out.length ? out.join(' ') : '';
  }

  /* TIMELINE */
  function Timeline(opts) {
    opts = opts || {};
    this.fps = opts.fps || 60;
    this.duration = opts.duration || 30000;
    this.width = opts.width || 1920;
    this.height = opts.height || 1080;
    this.records = [];
    this.scenes = [];
    this.cues = [];
    this.loops = [];
    this.t = -1;
    this._acc = new Map();
    this._touched = new Map();
  }

  /* Normalize a property spec.
       { opacity: [0, 1] }        explicit from -> to
       { opacity: 0 }             from the channel default -> 0
       { scale: [0.9, 1.06, 1] }  N keyframes, evenly spaced
     The single-value form is what makes exits read naturally: `{opacity: 0}`
     means "fade out from wherever the neutral state is", i.e. from 1.

     Three or more values become a keyframe track. `from`/`to` are still set to
     the first and last values so any code reading them keeps working; `ks` is
     what the sampler uses when present. */
  function normProp(key, spec) {
    if (Array.isArray(spec)) {
      if (spec.length > 2) return { from: spec[0], to: spec[spec.length - 1], ks: spec };
      return { from: spec[0], to: spec[1] };
    }
    /* An attribute channel has no meaningful neutral value — there is no
       "default d" to fade a path in from — so a single value HOLDS. Without
       this, `{ '@d': 'M0 0...' }` would try to interpolate from the numeric
       default 0 and snap at the midpoint instead. */
    if (String(key).charAt(0) === '@') return { from: spec, to: spec };
    var def;
    if (TRANSFORM_PROPS[key]) def = TRANSFORM_DEFAULTS[key];
    else if (key === 'opacity') def = 1;
    else if (key === 'blur') def = 0;
    else if (key in FILTER_PROPS) def = 1;
    else def = 0;
    return { from: def, to: spec };
  }

  /* Sample a keyframe track at eased progress e.

     Keyframes are positioned by `times` (normalized 0..1, defaults to even
     spacing) and each segment is interpolated independently. `easeEach` applies
     a curve within every segment, on top of the record's overall ease — the
     outer ease distributes time across the whole move, the inner one shapes each
     leg. Without an inner ease, segment joins are linear and a bounce reads
     mechanical at the turn.

     Still a pure function of e, so seeking anywhere stays exact. */
  function sampleKeys(ks, times, easeEach, e) {
    var n = ks.length, last = n - 1;
    if (e <= 0) return ks[0];
    if (e >= 1) return ks[last];

    /* Find the segment containing e. Linear scan: tracks are 3-6 keys in
       practice, so an index cache would cost more than it saves — and it would
       make sampling stateful, which breaks arbitrary seeking. */
    var i = 0;
    if (times) {
      while (i < last - 1 && e >= times[i + 1]) i++;
    } else {
      i = Math.min(last - 1, Math.floor(e * last));
    }

    var t0 = times ? times[i] : i / last;
    var t1 = times ? times[i + 1] : (i + 1) / last;
    var span = t1 - t0;
    /* Defensive only — span is not reachable at 0 today. A hard cut (two keys
       sharing an offset) is handled by the scan above, whose `>=` steps past
       the zero-width segment, and the validator guarantees times[0] === 0 and
       times[last] === 1 while e <= 0 / e >= 1 already returned. Kept because
       the alternative is a NaN written straight into a transform, which paints
       nothing and gives no clue why. */
    var local = span > 0 ? (e - t0) / span : 1;
    if (easeEach) local = easeEach(clamp01(local));
    return interpolate(ks[i], ks[i + 1], local);
  }

  /* Stagger ordering. 'random' is seeded, never Math.random(), because video
     export must be reproducible frame for frame. */
  function staggerIndex(mode, i, n) {
    switch (mode) {
      case 'end':    return n - 1 - i;
      case 'center': return Math.abs(i - (n - 1) / 2);
      case 'edges':  return (n - 1) / 2 - Math.abs(i - (n - 1) / 2);
      case 'random': return hashRand(i, 7) * n;
      default:       return i;
    }
  }

  /* tl.add(target, { at, dur, ease, stagger, staggerFrom, origin, ...props }) */
  Timeline.prototype.add = function (target, cfg) {
    cfg = cfg || {};
    var els = toArray(target);
    if (!els.length) {
      if (typeof target === 'string' && !this._warned) {
        console.warn('[timeline] no elements matched:', target);
      }
      return this;
    }
    var at = cfg.at || 0;
    var dur = cfg.dur === undefined ? 480 : cfg.dur;
    var ease = resolveEase(cfg.ease);
    var stagger = cfg.stagger || 0;
    var mode = cfg.staggerFrom || 'start';

    /* Keyframe timing, shared by every property in this record. */
    var easeEach = cfg.easeEach ? resolveEase(cfg.easeEach) : null;
    var times = null;
    if (cfg.times) {
      times = cfg.times.slice();
      /* Malformed times would produce a silently wrong curve, so validate loudly
         and fall back to even spacing rather than animating something subtly
         incorrect for the rest of the film. */
      var monotonic = times[0] === 0;
      for (var ti = 1; ti < times.length; ti++) {
        if (times[ti] < times[ti - 1]) { monotonic = false; break; }
      }
      if (!monotonic || times[times.length - 1] !== 1) {
        console.warn('[timeline] times must start at 0, end at 1, and never ' +
          'decrease — got [' + times.join(', ') + ']. Falling back to even spacing.');
        times = null;
      }
    }

    var props = {};
    for (var k in cfg) {
      if (!Object.prototype.hasOwnProperty.call(cfg, k)) continue;
      if (k === 'at' || k === 'dur' || k === 'ease' || k === 'stagger' ||
          k === 'staggerFrom' || k === 'origin' || k === 'label' ||
          k === 'times' || k === 'easeEach') continue;
      props[k] = normProp(k, cfg[k]);

      /* times must describe the track it is applied to. A mismatch means the
         author changed one and not the other. */
      if (times && props[k].ks && times.length !== props[k].ks.length) {
        console.warn('[timeline] ' + k + ' has ' + props[k].ks.length +
          ' keyframes but times has ' + times.length +
          ' entries. Using even spacing for ' + k + '.');
      }
    }

    for (var i = 0; i < els.length; i++) {
      if (cfg.origin) els[i].style.transformOrigin = cfg.origin;
      this.records.push({
        el: els[i],
        start: at + staggerIndex(mode, i, els.length) * stagger,
        dur: dur,
        ease: ease,
        props: props,
        times: times,
        easeEach: easeEach
      });
    }
    return this;
  };

  /* Instant set — a zero-duration record, so it still participates in the
     compose step and cannot be clobbered by transform writes elsewhere. */
  Timeline.prototype.set = function (target, props) {
    var cfg = { at: 0, dur: 0 };
    for (var k in props) {
      if (Object.prototype.hasOwnProperty.call(props, k)) {
        cfg[k] = [props[k], props[k]];
      }
    }
    return this.add(target, cfg);
  };

  /* Scene = a time range plus auto fade in/out. Returns a scoped helper so
     scene code can use times relative to the scene start, which keeps beat
     sheets readable and lets you move a whole scene by editing one number. */
  Timeline.prototype.scene = function (name, start, dur, opts) {
    opts = opts || {};
    var root = typeof opts.root === 'string'
      ? document.querySelector(opts.root)
      : (opts.root || document.querySelector('[data-scene="' + name + '"]'));
    var self = this;
    /* Default is a HARD CUT. A fade on every scene dissolves every cut, and a
       dissolve between two scenes that share no element just reads as mush.
       Pass `fade` only where you want a real dissolve (or an opening fade up
       from black); pass `overlay: true` for a layer that outlives the cuts,
       like a persistent HUD. */
    var fade = opts.fade === undefined ? 0 : opts.fade;

    this.scenes.push({ name: name, start: start, dur: dur, el: root, fade: fade,
                       overlay: !!opts.overlay });
    /* Scenes may be declared in any order and a scene's paint window depends on
       its neighbours, so the windows are resolved lazily and cached. */
    this._cuts = null;

    return {
      root: root,
      /* q = query within the scene, so selectors can't leak across scenes. */
      q: function (sel) {
        return root ? Array.prototype.slice.call(root.querySelectorAll(sel)) : [];
      },
      add: function (target, cfg) {
        cfg = Object.assign({}, cfg);
        cfg.at = start + (cfg.at || 0);
        if (typeof target === 'string' && root) target = root.querySelectorAll(target);
        self.add(target, cfg);
        return this;
      },
      set: function (target, props) {
        if (typeof target === 'string' && root) target = root.querySelectorAll(target);
        self.set(target, props);
        return this;
      },
      cue: function (name, at, opts2) {
        self.cue(name, start + at, opts2);
        return this;
      },
      start: start,
      dur: dur,
      end: start + dur
    };
  };

  /* Audio cue. Fired on playback; collected by the offline renderer to build
     the soundtrack. Cues are data, not side effects, so the same list drives
     both live preview and offline WAV rendering. */
  /* CURSOR + POINTING

     Hand-derived cursor coordinates are the single biggest source of "the
     cursor clicks next to the button" bugs. A comment like
     `frame (160,88) + browser bar 46 + sidebar 232 + topbar 62 + pad 22` is
     correct exactly once; the next layout tweak silently invalidates it and
     nothing errors, because a wrong number is still a number.

     So derive the point from the DOM instead. */

  /* The stage element an animated node belongs to. */
  function stageOf(el) {
    for (var n = el; n; n = n.parentNode) {
      if (n.classList && n.classList.contains('stage')) return n;
    }
    return document.querySelector('.stage');
  }

  /* An element's box in STAGE coordinates — the same 1920x1080 space every
     hand-written `left`/`top` in the markup uses.

     Deliberately walks offsetParent instead of using getBoundingClientRect:
     offsets are LAYOUT positions, so they ignore the stage's fit scale and any
     camera transform in between. getBoundingClientRect would fold both in and
     the result would change with the window size, which is exactly the class of
     bug this helper exists to remove.

     Caveat worth knowing: layout position is the element's UNANIMATED position.
     Point at something the timeline moves and you get where it started, not
     where it currently is. Point at stable geometry — a button, a row, a card. */
  function boxInStage(el) {
    var stage = stageOf(el);
    /* offsetParent is null for a display:none subtree, so un-hide ancestors for
       the measurement and put them back. Synchronous, so nothing is painted. */
    var undo = [], n;
    for (n = el; n && n !== stage; n = n.parentNode) {
      if (n.style && n.style.display === 'none') {
        undo.push(n); n.style.display = '';
      }
    }
    var x = 0, y = 0;
    for (n = el; n && n !== stage; n = n.offsetParent) {
      x += n.offsetLeft || 0;
      y += n.offsetTop || 0;
      /* A positioned ancestor's border sits outside its padding box, which is
         what offsetLeft is measured from. */
      var op = n.offsetParent;
      if (op && op !== stage) { x += op.clientLeft || 0; y += op.clientTop || 0; }
    }
    for (var i = 0; i < undo.length; i++) undo[i].style.display = 'none';
    var w = el.offsetWidth || 0, h = el.offsetHeight || 0;
    return { x: x, y: y, w: w, h: h, cx: x + w / 2, cy: y + h / 2 };
  }

  function firstOf(target) { var a = toArray(target); return a.length ? a[0] : null; }

  /* Stage-space point for a target. `align` picks the spot: 'center' (default),
     'left', 'right', 'top', 'bottom'. `dx`/`dy` nudge it.

     Use this for camera moves too — camTo(tl.point('[data-el="x"]')) beats
     re-deriving the same arithmetic by hand. */
  Timeline.prototype.point = function (target, opts) {
    opts = opts || {};
    var el = firstOf(target);
    if (!el) {
      if (!this._warnedPoint) {
        this._warnedPoint = true;
        console.warn('[timeline] point(): no element matched:', target);
      }
      return { x: 0, y: 0, w: 0, h: 0 };
    }
    var b = boxInStage(el);
    var x = b.cx, y = b.cy, a = opts.align || 'center';
    if (a === 'left')   x = b.x;
    if (a === 'right')  x = b.x + b.w;
    if (a === 'top')    y = b.y;
    if (a === 'bottom') y = b.y + b.h;
    if (!b.w && !b.h && !this._warnedZero) {
      this._warnedZero = true;
      console.warn('[timeline] point(): target measured 0x0 — is it in the ' +
                   'stage, and does it have layout? ', target);
    }
    return { x: x + (opts.dx || 0), y: y + (opts.dy || 0), w: b.w, h: b.h };
  };

  /* The whole travel -> settle -> press -> release -> ring chain in one call,
     aimed at an ELEMENT rather than at coordinates.

     Returns the timing the caller needs, notably `respondAt` — the moment the
     UI should react. Deliberately not chainable: the numbers are the point.

       var c = tl.cursorTo('[data-el="save"]', { at: 2000 });
       tl.add('[data-el="toast"]', { at: c.respondAt, ... });   // 80-140ms later
  */
  Timeline.prototype.cursorTo = function (target, cfg) {
    cfg = cfg || {};
    var at = cfg.at || 0;
    var travel = cfg.travel === undefined ? 620 : cfg.travel;
    var settle = cfg.settle === undefined ? 120 : cfg.settle;
    var press = cfg.press === undefined ? 90 : cfg.press;
    var release = cfg.release === undefined ? 220 : cfg.release;
    var click = cfg.click !== false;
    var cur = firstOf(cfg.cursor || '[data-el="cursor"]');
    var ring = firstOf(cfg.ring || '[data-el="ring"]');
    var p = target && target.x !== undefined ? target : this.point(target, cfg);

    if (!cur) {
      if (!this._warnedCursor) {
        this._warnedCursor = true;
        console.warn('[timeline] cursorTo(): no [data-el="cursor"] element. Add ' +
                     'the cursor + ring markup as the last children of .camera.');
      }
      return { arriveAt: at + travel, pressAt: at + travel + settle,
               respondAt: at + travel + settle + press + 110, point: p };
    }

    /* Where this move starts. Precedence, and the order matters:
         1. an explicit cfg.from — art direction wins;
         2. wherever the last cursorTo() left it, so calls chain into a path;
         3. off to one side of the target. Never 0,0: a cursor that starts in the
            top-left corner announces that it is a div. */
    var from = cfg.from || this._cursorAt || {
      x: Math.max(60, p.x - 300),
      y: Math.min((this.height || 1080) - 60, p.y + 260)
    };

    if (!this._cursorShown) {
      this._cursorShown = true;
      this.set(cur, { opacity: 0 });
      this.set(cur, { x: from.x, y: from.y });
      this.add(cur, { at: at, dur: 260, ease: 'outCubic', opacity: [0, 1] });
      if (ring) this.set(ring, { opacity: 0, scale: 0.4 });
    }

    /* Bow the path. A straight line between two points is the tell that a
       machine moved the cursor; sampling a quadratic Bezier whose control point
       is pushed perpendicular to the path gives a hand-like arc, and sampling
       (rather than a 3-key polyline) keeps it smooth through the middle. */
    var dx = p.x - from.x, dy = p.y - from.y;
    var dist = Math.sqrt(dx * dx + dy * dy) || 1;
    var bow = cfg.bow === undefined ? Math.min(90, dist * 0.16) : cfg.bow;
    var nx = -dy / dist, ny = dx / dist;
    var ctl = { x: (from.x + p.x) / 2 + nx * bow, y: (from.y + p.y) / 2 + ny * bow };
    var xs = [], ys = [], k, u, iu;
    for (k = 0; k <= 4; k++) {
      u = k / 4; iu = 1 - u;
      xs.push(iu * iu * from.x + 2 * iu * u * ctl.x + u * u * p.x);
      ys.push(iu * iu * from.y + 2 * iu * u * ctl.y + u * u * p.y);
    }
    this.add(cur, { at: at, dur: travel, ease: 'inOutCubic', x: xs, y: ys });

    var arriveAt = at + travel;
    var pressAt = arriveAt + settle;
    if (click) {
      /* Press then release on one element is exactly the chain the precedence
         rule exists for: the release record is inserted later, so once it
         starts it displaces the press. */
      this.add(cur, { at: pressAt, dur: press, ease: 'outCubic', scale: [1, 0.88] });
      this.add(cur, { at: pressAt + press, dur: release, ease: 'outBack', scale: [0.88, 1] });
      if (ring) {
        /* Park the ring on this click's point AT the press, not at t=0 — a
           zero-duration record at 0 for every click would leave every ring at
           the last click's coordinates. */
        this.add(ring, { at: pressAt, dur: 0, x: [p.x, p.x], y: [p.y, p.y] });
        this.add(ring, { at: pressAt, dur: 460, ease: 'outQuint',
                         scale: [0.4, 1.9], opacity: [0.55, 0] });
      }
    }
    this._cursorAt = { x: p.x, y: p.y };
    return {
      arriveAt: arriveAt,
      pressAt: pressAt,
      releaseAt: pressAt + press,
      /* Real software has latency. Instant response reads as fake. */
      respondAt: pressAt + press + (cfg.latency === undefined ? 110 : cfg.latency),
      endAt: pressAt + press + release,
      point: p
    };
  };

  Timeline.prototype.cue = function (name, at, opts) {
    this.cues.push(Object.assign({ name: name, at: at }, opts || {}));
    return this;
  };

  /* Continuous/looping motion (drifting gradients, spinners, shimmer).
     Expressed as a function of t so it stays seekable. Never use a CSS
     @keyframes animation for this — CSS animations run on the browser clock
     and would desync from the render harness. */
  Timeline.prototype.loop = function (fn) {
    this.loops.push(fn);
    return this;
  };

  /* SEEK — the whole contract in one function.

     Evaluates EVERY record at time t, in insertion order, accumulating into a
     per-element bucket, then flushes once.

     PRECEDENCE. Records use fill-both semantics: before a record starts it
     holds its `from`, after it ends it holds its `to`. That is what makes
     scrubbing backwards work and why you can seek to any t cold. But naive
     fill-both plus "last write wins" silently breaks every chained tween —
     given a press (scale 1 -> .88 at 2500) followed by a release
     (.88 -> 1 at 2590), the release's `from` would fill backwards and pin the
     element at .88 for the entire timeline before 2590.

     So the rule is three-tiered, per property:
       1. A record that has STARTED (t >= start) beats one that has not.
       2. Among started records, the LAST inserted wins  — so you can layer.
       3. Among not-yet-started records, the FIRST wins — so the earliest
          record supplies the initial pose and later ones stay out of the way.

     This is what makes `set()` then `add()` behave the way you'd expect, and
     what lets you chain any number of tweens on one property. */
  Timeline.prototype.seek = function (t) {
    t = Math.max(0, Math.min(this.duration, t));
    this.t = t;
    var acc = this._acc;
    acc.clear();

    var i, n, s;

    /* Scene visibility, from the derived paint window rather than the declared
       range — see _resolveScenes for why those differ. display:none outside the
       window also keeps offscreen glass from costing a backdrop-filter pass on
       every frame, which is often the difference between 4 fps and 30 fps in
       preview.

       Opacity is computed here instead of being written as records at declare
       time, because a scene's fade window is only knowable once its neighbours
       are known. Author records on the scene root still win: they are applied
       in the flush pass below, which runs after this one. */
    var cuts = this._resolveScenes();
    for (i = 0, n = cuts.length; i < n; i++) {
      s = cuts[i];
      if (!s.el) continue;
      var atEnd = t >= this.duration && s.visEnd >= this.duration;
      var live = t >= s.start && (t < s.visEnd || atEnd);
      s.el.style.display = live ? '' : 'none';
      s.el.style.setProperty('z-index', s.z);
      var op = 0;
      if (live) {
        op = 1;
        if (s.fade > 0 && t < s.start + s.fade) {
          op = Ease.outCubic(clamp01((t - s.start) / s.fade));
        } else if (s.outDur > 0 && t > s.visEnd - s.outDur) {
          op = 1 - Ease.inCubic(clamp01((t - (s.visEnd - s.outDur)) / s.outDur));
        }
      }
      s.el.style.setProperty('opacity', op);
    }

    for (i = 0, n = this.records.length; i < n; i++) {
      var r = this.records[i];
      var p;
      if (r.dur <= 0) p = t >= r.start ? 1 : 0;
      else p = clamp01((t - r.start) / r.dur);
      var e = r.ease(p);

      var bucket = acc.get(r.el);
      if (!bucket) {
        bucket = { tf: null, ft: null, st: null, vr: null, at: null, rank: {} };
        acc.set(r.el, bucket);
      }

      /* Rank encodes tier 1 of the precedence rule; ties are then broken by
         insertion order in the comparison below. */
      var started = t >= r.start;

      for (var k in r.props) {
        if (!Object.prototype.hasOwnProperty.call(r.props, k)) continue;

        /* Tier 2/3: a started record always displaces a pending one; between
           two started records the later wins; between two pending ones the
           earlier is kept. */
        var prev = bucket.rank[k];
        if (prev !== undefined) {
          if (prev === 1 && !started) continue;      /* pending never beats started */
          if (prev === 0 && !started) continue;      /* keep the FIRST pending      */
        }
        bucket.rank[k] = started ? 1 : 0;

        var spec = r.props[k];
        /* Multi-keyframe tracks sample per segment; the 2-value case stays on
           the single-interpolate fast path so existing films pay nothing. */
        var v;
        if (spec.ks) {
          var kt = (r.times && r.times.length === spec.ks.length) ? r.times : null;
          v = sampleKeys(spec.ks, kt, r.easeEach, e);
        } else {
          v = interpolate(spec.from, spec.to, e);
        }

        if (TRANSFORM_PROPS[k]) {
          (bucket.tf || (bucket.tf = {}))[k] = v;
        } else if (k in FILTER_PROPS) {
          (bucket.ft || (bucket.ft = {}))[k] = v;
        } else if (k.charAt(0) === '-' && k.charAt(1) === '-') {
          (bucket.vr || (bucket.vr = {}))[k] = v;
        } else if (k.charAt(0) === '@') {
          /* ATTRIBUTE channel. `@d`, `@points`, `@r`, `@stdDeviation`... Some
             SVG geometry is an ATTRIBUTE, not a style: `d` is only a CSS
             property in newer engines and not everywhere, while the attribute
             has worked since SVG 1.1. The `@` prefix says "write this with
             setAttribute", the same way `--` says "write it with
             setProperty". */
          (bucket.at || (bucket.at = {}))[k.slice(1)] = v;
        } else {
          (bucket.st || (bucket.st = {}))[k] = v;
        }
      }
    }

    /* Flush. One write pass per element per frame. */
    acc.forEach(function (b, el) {
      if (b.tf) {
        var base = el.getAttribute('data-base-transform');
        var tf = buildTransform(b.tf);
        el.style.transform = base ? (base + ' ' + tf) : (tf || 'none');
      }
      if (b.ft) el.style.filter = buildFilter(b.ft) || 'none';
      if (b.st) {
        for (var k in b.st) {
          if (Object.prototype.hasOwnProperty.call(b.st, k)) {
            el.style.setProperty(hyphen(k), b.st[k]);
          }
        }
      }
      if (b.vr) {
        for (var v in b.vr) {
          if (Object.prototype.hasOwnProperty.call(b.vr, v)) {
            el.style.setProperty(v, b.vr[v]);
          }
        }
      }
      if (b.at) {
        for (var a in b.at) {
          if (Object.prototype.hasOwnProperty.call(b.at, a)) {
            el.setAttribute(a, b.at[a]);
          }
        }
      }
    });

    for (i = 0; i < this.loops.length; i++) this.loops[i](t);
    return this;
  };

  /* Derive each scene's PAINT window from its neighbours.

     A scene's time range and its visible window are two different things. The
     range is allowed to overlap the next scene's — that is how a tween can
     still be resolving across a cut, which is what keeps a film from coming to
     a dead stop seven times. But only ONE scene may be painted at a time.
     Painting both is what leaves the outgoing scene's elements sitting on top
     of the incoming one for the length of the overlap: scenes are absolutely
     positioned siblings and a scene has no opaque background of its own, so the
     old content simply shows through the new one.

     So: a scene paints from its own start until the next non-overlay scene
     starts, NOT until its own range ends. */
  Timeline.prototype._resolveScenes = function () {
    if (this._cuts) return this._cuts;
    var list = this.scenes.slice().sort(function (a, b) { return a.start - b.start; });
    var flow = [], i;
    for (i = 0; i < list.length; i++) if (!list[i].overlay) flow.push(list[i]);

    for (i = 0; i < list.length; i++) {
      var s = list[i];
      /* Later scenes paint above earlier ones regardless of DOM order, so a
         dissolve layers correctly. Overlays sit above the whole stack. */
      s.z = (s.overlay ? 100 : 1) + i;
      s.outDur = 0;
      if (s.overlay) { s.visEnd = s.start + s.dur; continue; }

      var idx = flow.indexOf(s);
      var nxt = idx === -1 ? null : flow[idx + 1] || null;
      if (!nxt) {
        /* Last scene: its own fade is the film's fade out. */
        s.visEnd = s.start + s.dur;
        s.outDur = Math.min(s.fade, s.visEnd - s.start);
      } else if (nxt.fade > 0) {
        /* The incoming scene dissolves in, so this one has to stay painted
           underneath it and fade out across exactly the same window. */
        s.visEnd = Math.min(s.start + s.dur, nxt.start + nxt.fade);
        s.outDur = Math.min(nxt.fade, s.visEnd - s.start);
      } else {
        /* Hard cut: gone on the exact frame the next scene appears. */
        s.visEnd = Math.min(s.start + s.dur, nxt.start);
      }
    }
    this._cuts = list;
    return list;
  };

  Timeline.prototype.sceneAt = function (t) {
    var cuts = this._resolveScenes();
    for (var i = cuts.length - 1; i >= 0; i--) {
      var s = cuts[i];
      if (!s.overlay && t >= s.start && t < s.visEnd) return s.name;
    }
    return '';
  };

  /* TEXT + PATH HELPERS
     Implemented as loops (evaluated every seek) rather than as style records,
     because they write textContent / attributes rather than CSS. Still pure
     functions of t, so still frame-accurate. */

  /* Typewriter. Monospace or a fixed-width container is strongly advised —
     otherwise the line reflows every frame and the text visibly jitters. */
  Timeline.prototype.type = function (target, cfg) {
    var els = toArray(target);
    if (!els.length) return this;
    var at = cfg.at || 0;
    var dur = cfg.dur === undefined ? 1200 : cfg.dur;
    var ease = resolveEase(cfg.ease || 'linear');
    var caret = cfg.caret !== false;

    els.forEach(function (el) {
      var full = cfg.text !== undefined ? cfg.text : el.textContent;
      el.textContent = '';
      var span = document.createElement('span');
      var cur = document.createElement('span');
      cur.className = 'caret';
      cur.textContent = '▏';
      el.appendChild(span);
      if (caret) el.appendChild(cur);

      this.loop(function (t) {
        var p = dur <= 0 ? 1 : clamp01((t - at) / dur);
        var n = Math.round(ease(p) * full.length);
        span.textContent = full.slice(0, n);
        if (caret) {
          /* Blink at 1.06 Hz, derived from t so it never desyncs on export. */
          var active = t >= at - 200 && t <= at + dur + 900;
          cur.style.opacity = active ? (Math.floor(t / 530) % 2 ? 0.15 : 1) : 0;
        }
      });
    }, this);
    return this;
  };

  /* Number counter. Use .tnum (tabular-nums) on the element or the digits
     will shift width as they change and the whole line will wobble. */
  Timeline.prototype.count = function (target, cfg) {
    var els = toArray(target);
    if (!els.length) return this;
    var at = cfg.at || 0;
    var dur = cfg.dur === undefined ? 1200 : cfg.dur;
    var ease = resolveEase(cfg.ease || 'outExpo');
    var from = cfg.from === undefined ? 0 : cfg.from;
    var to = cfg.to === undefined ? 100 : cfg.to;
    var dec = cfg.decimals || 0;
    var prefix = cfg.prefix || '';
    var suffix = cfg.suffix || '';
    var sep = cfg.separator;

    els.forEach(function (el) {
      this.loop(function (t) {
        var p = dur <= 0 ? 1 : clamp01((t - at) / dur);
        var v = lerp(from, to, ease(p));
        var s = v.toFixed(dec);
        if (sep) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
        el.textContent = prefix + s + suffix;
      });
    }, this);
    return this;
  };

  /* SHAPE MORPH.

       tl.morph('[data-el="icon"] path', {
         at: 1200, dur: 520, ease: 'inOutCubic',
         d: ['M0 0 L24 0 L24 24 Z', 'M0 0 L24 12 L12 24 Z']
       })

     Morphs SVG path `d` (or `points`, or a CSS `clipPath`) by structural
     interpolation. There is no path-normalization library in here on purpose —
     see "Shape morphing" in the prose. The two shapes must already correspond:
     same command letters in the same order, same number of coordinates.

     THIS THROWS on a mismatch rather than degrading quietly. A morph that
     silently becomes a midpoint snap is the kind of defect you do not notice
     until you are watching the export frame by frame, and by then it is in
     seven other scenes too. Loud, at build time, is better. */
  Timeline.prototype.morph = function (target, cfg) {
    var els = toArray(target);
    var self = this;
    var prop = cfg.points ? 'points' : (cfg.clipPath ? 'clipPath' : 'd');
    var pair = cfg[prop];
    if (!pair || pair.length < 2) {
      throw new Error('tl.morph: needs at least two shapes in `' + prop + '`');
    }

    /* Validate every consecutive pair, so a 3-key morph is checked end to end
       and the error names the leg that is wrong. */
    for (var i = 0; i < pair.length - 1; i++) {
      var why = morphMismatch(pair[i], pair[i + 1]);
      if (why) {
        throw new Error('tl.morph: shapes ' + i + ' and ' + (i + 1) +
          ' do not correspond — ' + why +
          '. Both shapes need the same commands in the same order and the ' +
          'same number of coordinates. Redraw the simpler one with matching ' +
          'points (see "Shape morphing").');
      }
    }

    var key = prop === 'clipPath' ? 'clipPath' : '@' + prop;
    els.forEach(function (el, n) {
      var spec = {
        at: (cfg.at || 0) + n * (cfg.stagger || 0),
        dur: cfg.dur === undefined ? 520 : cfg.dur,
        ease: cfg.ease || 'inOutCubic'
      };
      if (cfg.times) spec.times = cfg.times;
      if (cfg.easeEach) spec.easeEach = cfg.easeEach;
      spec[key] = pair;
      self.add(el, spec);
    });
    return this;
  };

  /* Why two shapes cannot morph, as a human sentence — or null if they can. */
  function morphMismatch(a, b) {
    var sa = numSkeleton(a), sb = numSkeleton(b);
    if (!sa.nums.length) return 'the first shape contains no numbers';
    if (sa.nums.length !== sb.nums.length) {
      return 'they hold ' + sa.nums.length + ' and ' + sb.nums.length +
             ' coordinates';
    }
    if (sa.skel !== sb.skel) {
      var ca = String(a).replace(/[^a-zA-Z]/g, '');
      var cb = String(b).replace(/[^a-zA-Z]/g, '');
      if (ca !== cb) return 'their commands differ (' + ca + ' vs ' + cb + ')';
      return 'their non-numeric structure differs';
    }
    return null;
  }

  /* SVG stroke draw-on. Measures each path and animates dashoffset. */
  Timeline.prototype.draw = function (target, cfg) {
    var els = toArray(target);
    var self = this;
    els.forEach(function (el, i) {
      var len = 0;
      try { len = el.getTotalLength(); } catch (e) { len = 0; }
      if (!len) return;
      el.style.strokeDasharray = len + ' ' + len;
      self.add(el, {
        at: (cfg.at || 0) + i * (cfg.stagger || 0),
        dur: cfg.dur === undefined ? 900 : cfg.dur,
        ease: cfg.ease || 'outQuart',
        strokeDashoffset: [len, 0]
      });
    });
    return this;
  };

  /* PLAYBACK (preview only — the render harness never calls this) */
  Timeline.prototype.play = function () {
    if (this._raf) return this;
    var self = this;
    var last = performance.now();
    if (this.t >= this.duration) this.t = 0;
    var step = function (now) {
      var dt = now - last;
      last = now;
      var next = self.t + dt * (self.rate || 1);
      if (next >= self.duration) {
        next = self.duration;
        self.seek(next);
        self.pause();
        if (self.onUpdate) self.onUpdate(next);
        return;
      }
      self._fireCues(self.t, next);
      self.seek(next);
      if (self.onUpdate) self.onUpdate(next);
      self._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
    this.playing = true;
    return this;
  };

  Timeline.prototype.pause = function () {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this.playing = false;
    return this;
  };

  Timeline.prototype.toggle = function () {
    return this.playing ? this.pause() : this.play();
  };

  Timeline.prototype._fireCues = function (from, to) {
    if (!global.SFX || !global.SFX.enabled) return;
    for (var i = 0; i < this.cues.length; i++) {
      var c = this.cues[i];
      if (c.at > from && c.at <= to) global.SFX.play(c.name, c);
    }
  };

  /* splitText — wrap chars / words / lines in spans so they can be staggered.

     'lines' splits on explicit <br> or on \n in the source text. It does NOT
     measure rendered line boxes: that would depend on font metrics, which
     differ between your browser and the headless renderer, which would make
     the export non-deterministic. Author your line breaks explicitly. */
  function splitText(target, mode) {
    mode = mode || 'chars';
    var els = toArray(target);
    var out = [];

    els.forEach(function (el) {
      if (mode === 'lines') {
        var html = el.innerHTML.replace(/<br\s*\/?>/gi, '\n');
        var lines = html.split('\n').map(function (s) { return s.trim(); })
                        .filter(function (s) { return s.length; });
        el.innerHTML = '';
        lines.forEach(function (line) {
          var mask = document.createElement('span');
          mask.className = 'line-mask';
          var inner = document.createElement('span');
          inner.innerHTML = line;
          mask.appendChild(inner);
          el.appendChild(mask);
          out.push(inner);
        });
        return;
      }

      var text = el.textContent;
      el.textContent = '';
      var parts = mode === 'words' ? text.split(/(\s+)/) : text.split('');
      parts.forEach(function (part) {
        if (/^\s+$/.test(part)) { el.appendChild(document.createTextNode(part)); return; }
        var s = document.createElement('span');
        s.textContent = part;
        s.style.display = 'inline-block';
        s.style.willChange = 'transform, opacity';
        el.appendChild(s);
        out.push(s);
      });
    });
    return out;
  }

  /* MOUNT — stage scaling, preview chrome, and the render harness hook. */
  function mount(tl, opts) {
    opts = opts || {};
    var params = new URLSearchParams(location.search);
    var isRender = params.has('render');

    /* The Timeline dimensions are the single source of truth for canvas size.
       CSS carries defaults (and data-aspect presets) so the stage is centred on
       first paint, but these writes win. */
    document.documentElement.style.setProperty('--stage-w', tl.width + 'px');
    document.documentElement.style.setProperty('--stage-h', tl.height + 'px');

    /* If someone set data-aspect but passed different dimensions to Timeline,
       the preview and the export disagree about the frame. Warn rather than
       silently pick one — a mismatch here produces a correctly-centred preview
       and a wrongly-cropped video, which is a confusing thing to debug later. */
    /* Compare derived pixels, not the ratio. A ratio comparison with a small
       absolute tolerance is weak on tall canvases — 1080x1900 lands 0.0059 from
       9:16, so a 0.01 tolerance would call a 20px error a match. */
    var aspectAttr = document.documentElement.getAttribute('data-aspect');
    if (aspectAttr && /^\d+:\d+$/.test(aspectAttr)) {
      var parts = aspectAttr.split(':');
      var expectH = tl.width * parseFloat(parts[1]) / parseFloat(parts[0]);
      if (Math.abs(tl.height - expectH) > 1) {
        console.warn('[timeline] data-aspect="' + aspectAttr + '" implies ' +
          tl.width + 'x' + Math.round(expectH) + ', but Timeline is ' +
          tl.width + 'x' + tl.height + '. The preview will letterbox ' +
          'differently from the export, which follows the Timeline dimensions.');
      }
    }

    /* Scale the stage down to fit the window. CSS does the centring with a
       transform; this only decides how much to shrink.

       Two things matter here:
       - Never scale ABOVE 1. Upscaling a 1920px canvas on a 4K monitor blurs
         text and glass edges; letterboxing looks deliberate, soft type does not.
       - The bar's height has to reach CSS as `--chrome-h`, because the centring
         offset in `.stage` and the shrink factor computed here must agree on one
         number. If this subtracted the bar height locally while CSS still
         centred on the full window height, the bar would cover the bottom of
         the frame by half its own height.

       The height is measured rather than hardcoded: it follows button padding,
       font-size and line-height, so it moves with the preset and with whatever
       font stack the machine actually resolves. */
    function chromeH() {
      if (isRender) return 0;
      var bar = document.querySelector('.scrub-bar');
      /* offsetHeight is correct even though the bar sits at opacity:0 — it is
         still in flow. Before buildControls() runs there is nothing to measure,
         so use a close estimate and re-fit once the bar exists. */
      return bar ? bar.offsetHeight : 54;
    }

    function fit() {
      var chrome = chromeH();
      document.documentElement.style.setProperty('--chrome-h', chrome + 'px');
      var availH = Math.max(120, innerHeight - chrome);
      var s = Math.min(innerWidth / tl.width, availH / tl.height, 1);
      document.documentElement.style.setProperty('--stage-scale', s);
    }
    fit();

    /* Registered in render mode too. The renderer resizes the viewport to the film's
       own dimensions once the page has loaded — so it can rasterise at a higher device
       pixel ratio rather than upscale a smaller frame — and the stage has to re-fit
       against the new window or it keeps the scale it computed for the old one. In
       render mode chromeH() is 0, so this lands on scale 1 and a perfectly centred
       stage whenever the viewport matches the film. */
    addEventListener('resize', fit);

    if (!isRender) {
      /* orientationchange fires before the new innerHeight is readable on
         mobile Safari, so re-fit on the next frame too. */
      addEventListener('orientationchange', function () {
        requestAnimationFrame(fit);
      });
      /* Browser zoom and OS display-scaling changes alter the CSS pixel ratio
         without firing resize in every browser. */
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', fit);
      }
      /* Late-loading webfonts can change scrollbar/metrics state; cheap insurance. */
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(fit);
      }

      /* THE VIEWER'S POINTER — hidden, but not unconditionally.
         `.stage` hides the OS cursor so the film's own drawn arrow is the only pointer
         on screen. Hiding it whenever the mouse is over the stage means it vanishes the
         instant the viewer crosses the preview and they cannot find their way back to
         the scrub bar — a preview you cannot point at is worse than a second arrow.
         So it is hidden only when it is both unnecessary and unmissed: the film is
         playing and the mouse has been still for a beat. Any movement, click or
         keypress brings it straight back, and a paused film always shows it. */
      var idleTimer = null;
      var wake = function () {
        document.body.classList.remove('cursor-idle');
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(function () {
          if (tl.playing) document.body.classList.add('cursor-idle');
        }, 1400);
      };
      addEventListener('pointermove', wake, { passive: true });
      addEventListener('pointerdown', wake, { passive: true });
      addEventListener('keydown', wake);
      wake();
    }

    if (isRender) {
      document.body.classList.add('render-mode');
      /* Note what is NOT done here: the stage's transform is left alone. `.stage` is
         positioned with top/left 50% and pulled back by translate(-50%, -50%), so
         clearing the transform would put its top-left corner at the window centre and
         push three quarters of the film off-frame. Render mode changes the scale (via
         chromeH() returning 0 and fit() running against the full window), never the
         centring. */
    }

    tl.seek(0);

    /* The render harness contract. Puppeteer waits for ready, then calls
       seek(ms) once per frame and screenshots. Keep this shape stable. */
    global.__EXPLAINER__ = {
      version: 1,
      ready: false,
      duration: tl.duration,
      fps: tl.fps,
      width: tl.width,
      height: tl.height,
      frames: Math.round(tl.duration / 1000 * tl.fps),
      seek: function (ms) { tl.seek(ms); return ms; },
      seekFrame: function (f) { tl.seek(f * 1000 / tl.fps); return f; },
      cues: tl.cues,
      timeline: tl,
      /* Returns a Promise<base64 WAV> so the render harness can pull the
         soundtrack across the CDP boundary as a plain JSON string. */
      renderAudio: function (sampleRate) {
        if (!global.SFX || !global.SFX.renderWavBase64) return Promise.resolve(null);
        return global.SFX.renderWavBase64(tl.cues, tl.duration, sampleRate || 48000);
      }
    };

    /* Fonts must be settled before the first screenshot or frame 1 renders in
       a fallback face and every later frame is a different width. */
    var markReady = function () { global.__EXPLAINER__.ready = true; };
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { requestAnimationFrame(markReady); });
    } else {
      requestAnimationFrame(markReady);
    }

    if (!isRender && opts.controls !== false) {
      buildControls(tl);
      /* Now the bar exists, so chromeH() can measure it instead of guessing.
         Without this re-fit the film is centred against the 54px estimate and
         sits a few px off whenever the real bar is a different height. */
      fit();
    }
    return tl;
  }

  function fmtTime(ms) {
    var s = ms / 1000;
    var m = Math.floor(s / 60);
    var r = s - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(2);
  }

  function buildControls(tl) {
    var bar = document.createElement('div');
    bar.className = 'preview-ui scrub-bar';
    bar.innerHTML =
      '<button data-act="play">Play</button>' +
      '<span class="tc"></span>' +
      '<input type="range" min="0" max="' + tl.duration + '" value="0" step="1">' +
      '<span class="scene-name"></span>' +
      '<button data-act="sound">Sound: off</button>';
    document.body.appendChild(bar);

    var range = bar.querySelector('input');
    var tc = bar.querySelector('.tc');
    var sn = bar.querySelector('.scene-name');
    var playBtn = bar.querySelector('[data-act="play"]');
    var soundBtn = bar.querySelector('[data-act="sound"]');
    var frameMs = 1000 / tl.fps;

    function sync(t) {
      range.value = t;
      tc.textContent = fmtTime(t) + ' / ' + fmtTime(tl.duration) +
                       '  f' + Math.round(t / frameMs);
      sn.textContent = tl.sceneAt(t);
      playBtn.textContent = tl.playing ? 'Pause' : 'Play';
    }
    tl.onUpdate = sync;

    range.addEventListener('input', function () {
      tl.pause();
      tl.seek(+range.value);
      sync(+range.value);
    });
    playBtn.addEventListener('click', function () { tl.toggle(); sync(tl.t); });
    soundBtn.addEventListener('click', function () {
      if (!global.SFX) return;
      var on = global.SFX.toggle();
      soundBtn.textContent = 'Sound: ' + (on ? 'on' : 'off');
    });

    addEventListener('keydown', function (e) {
      if (e.target && e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); tl.toggle(); sync(tl.t); }
      else if (e.key === 'ArrowRight') {
        tl.pause();
        tl.seek(tl.t + (e.shiftKey ? frameMs * 10 : frameMs));
        sync(tl.t);
      } else if (e.key === 'ArrowLeft') {
        tl.pause();
        tl.seek(tl.t - (e.shiftKey ? frameMs * 10 : frameMs));
        sync(tl.t);
      } else if (e.key === 'Home') { tl.pause(); tl.seek(0); sync(0); }
      else if (e.key === 'End') { tl.pause(); tl.seek(tl.duration); sync(tl.duration); }
      else if (e.key === 'g') {
        var g = document.querySelector('.safe-guide');
        if (g) g.style.display = g.style.display === 'none' ? '' : 'none';
      }
    });

    sync(0);
  }

  Timeline.prototype.mount = function (opts) { return mount(this, opts); };

  global.Ease = Ease;
  global.Timeline = Timeline;
  global.splitText = splitText;

}(window));
