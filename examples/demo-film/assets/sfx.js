/* sfx.js — procedural sound design. Every sound is synthesized from
   oscillators and noise; there are no sample files, so nothing to license,
   download, or ship.

   Same cue list drives two paths:
     live     — AudioContext, for preview in the browser
     offline  — OfflineAudioContext -> WAV bytes, for muxing into the MP4

   Because both paths run identical graph-building code, what you hear while
   scrubbing is what lands in the exported file.

   Design notes that matter for it not sounding cheap:
   - Decay uses exponentialRampToValueAtTime. Linear fades on amplitude sound
     synthetic; exponential matches how physical resonances actually die out.
   - Every envelope gets a 1.5-4ms attack. Starting a gain at full value
     produces a discontinuity that clicks audibly.
   - exponentialRampToValueAtTime can never reach or pass through 0, so targets
     land on 0.0001 and then hard-stop.
   - Randomness is seeded from the cue index, never Math.random(), so an
     exported soundtrack is reproducible. */
(function (global) {
  'use strict';

  var EPS = 0.0001;

  function seededRand(i, salt) {
    var x = Math.sin((i + 1) * 12.9898 + (salt || 0) * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  /* Noise buffer, generated once per context. Pink-ish: white noise run
     through a simple one-pole lowpass, which is cheaper than a proper
     Voss-McCartney generator and sits better under UI sounds than raw white. */
  function noiseBuffer(ctx, seed) {
    var len = Math.floor(ctx.sampleRate * 2);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var last = 0;
    for (var i = 0; i < len; i++) {
      var w = seededRand(i, seed || 1) * 2 - 1;
      last = 0.72 * last + 0.28 * w;
      d[i] = last * 1.4;
    }
    return buf;
  }

  /* ADSR-ish envelope. attack -> optional hold -> exponential decay. */
  function env(g, t0, peak, attack, decay, hold) {
    hold = hold || 0;
    g.gain.cancelScheduledValues(t0);
    g.gain.setValueAtTime(EPS, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, EPS), t0 + attack);
    if (hold > 0) g.gain.setValueAtTime(Math.max(peak, EPS), t0 + attack + hold);
    g.gain.exponentialRampToValueAtTime(EPS, t0 + attack + hold + decay);
    return t0 + attack + hold + decay;
  }

  /* VOICES
     Each takes (ctx, dest, t0, o) and returns the time it finishes.
     o.gain scales level, o.pitch multiplies frequency — so one recipe can be
     reused at several pitches for variation. */
  var Voices = {};

  /* Soft UI click. Short filtered noise transient with a tiny tonal body so
     it reads as a physical tap rather than a static pop. */
  Voices.click = function (ctx, dest, t0, o) {
    var lvl = (o.gain || 1) * 0.30;
    var src = ctx.createBufferSource();
    src.buffer = ctx._noise;
    src.playbackRate.value = 1 + (o.pitch ? (o.pitch - 1) * 0.5 : 0);
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1100 * (o.pitch || 1);
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600 * (o.pitch || 1);
    bp.Q.value = 0.9;
    var g = ctx.createGain();
    src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(dest);
    var end = env(g, t0, lvl, 0.0015, 0.030);
    src.start(t0); src.stop(end + 0.01);

    var body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(1750 * (o.pitch || 1), t0);
    body.frequency.exponentialRampToValueAtTime(880 * (o.pitch || 1), t0 + 0.035);
    var bg = ctx.createGain();
    body.connect(bg); bg.connect(dest);
    env(bg, t0, lvl * 0.5, 0.001, 0.032);
    body.start(t0); body.stop(t0 + 0.08);
    return end;
  };

  /* Tick — drier and higher than click. For counters, ticks, small state. */
  Voices.tick = function (ctx, dest, t0, o) {
    var lvl = (o.gain || 1) * 0.18;
    var src = ctx.createBufferSource();
    src.buffer = ctx._noise;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 4200 * (o.pitch || 1);
    bp.Q.value = 2.2;
    var g = ctx.createGain();
    src.connect(bp); bp.connect(g); g.connect(dest);
    var end = env(g, t0, lvl, 0.001, 0.018);
    src.start(t0); src.stop(end + 0.01);
    return end;
  };

  /* Keyboard tap, for typewriter scenes. Pitch and level jitter per index or
     the run turns into a machine-gun rattle. */
  Voices.key = function (ctx, dest, t0, o) {
    var i = o.i || 0;
    var jitter = 0.86 + seededRand(i, 3) * 0.30;
    return Voices.click(ctx, dest, t0, {
      gain: (o.gain || 1) * (0.42 + seededRand(i, 5) * 0.16),
      pitch: jitter * 1.25
    });
  };

  /* Pop / bubble. Fast upward pitch bend on a sine — the classic "appear". */
  Voices.pop = function (ctx, dest, t0, o) {
    var lvl = (o.gain || 1) * 0.26;
    var f = 420 * (o.pitch || 1);
    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f, t0);
    osc.frequency.exponentialRampToValueAtTime(f * 2.3, t0 + 0.075);
    var g = ctx.createGain();
    osc.connect(g); g.connect(dest);
    var end = env(g, t0, lvl, 0.004, 0.085);
    osc.start(t0); osc.stop(end + 0.02);
    return end;
  };

  /* Whoosh. Bandpass sweep across noise — the workhorse transition sound.
     The sweep goes up then back down, which reads as movement past the
     listener rather than a simple filter open. */
  Voices.whoosh = function (ctx, dest, t0, o) {
    var dur = (o.dur || 620) / 1000;
    var lvl = (o.gain || 1) * 0.17;
    var src = ctx.createBufferSource();
    src.buffer = ctx._noise;
    src.playbackRate.value = 0.85;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.15;
    bp.frequency.setValueAtTime(260, t0);
    bp.frequency.exponentialRampToValueAtTime(2900 * (o.pitch || 1), t0 + dur * 0.52);
    bp.frequency.exponentialRampToValueAtTime(420, t0 + dur);
    var g = ctx.createGain();
    src.connect(bp); bp.connect(g); g.connect(dest);
    g.gain.setValueAtTime(EPS, t0);
    g.gain.exponentialRampToValueAtTime(lvl, t0 + dur * 0.42);
    g.gain.exponentialRampToValueAtTime(EPS, t0 + dur);
    src.start(t0); src.stop(t0 + dur + 0.05);
    return t0 + dur;
  };

  /* Sub thump. Scene hits and logo stings. Sine dropping into the sub range,
     plus a click transient so it still reads on laptop speakers that cannot
     reproduce 45 Hz at all. */
  Voices.thump = function (ctx, dest, t0, o) {
    var lvl = (o.gain || 1) * 0.62;
    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110 * (o.pitch || 1), t0);
    osc.frequency.exponentialRampToValueAtTime(42 * (o.pitch || 1), t0 + 0.16);
    var g = ctx.createGain();
    osc.connect(g); g.connect(dest);
    var end = env(g, t0, lvl, 0.005, 0.30);
    osc.start(t0); osc.stop(end + 0.05);
    Voices.click(ctx, dest, t0, { gain: (o.gain || 1) * 0.30, pitch: 0.55 });
    return end;
  };

  /* Chime. Two partials a perfect fifth apart (3:2), slightly detuned, with
     the upper partial decaying faster — that ratio is why it reads "Apple"
     rather than "video game". */
  Voices.chime = function (ctx, dest, t0, o) {
    var base = (o.freq || 880) * (o.pitch || 1);
    var lvl = (o.gain || 1) * 0.20;
    var end = t0;
    [[1, 1, 0.62], [1.5, 0.55, 0.44], [2.005, 0.16, 0.30]].forEach(function (p) {
      var osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = base * p[0];
      var g = ctx.createGain();
      osc.connect(g); g.connect(dest);
      var e = env(g, t0, lvl * p[1], 0.006, p[2]);
      osc.start(t0); osc.stop(e + 0.05);
      if (e > end) end = e;
    });
    return end;
  };

  /* Success. Ascending major triad, 70ms apart. Short enough to feel like one
     gesture rather than a melody. */
  Voices.success = function (ctx, dest, t0, o) {
    var notes = [523.25, 659.25, 783.99];   /* C5 E5 G5 */
    var end = t0;
    notes.forEach(function (f, i) {
      var e = Voices.chime(ctx, dest, t0 + i * 0.070, {
        freq: f, gain: (o.gain || 1) * 0.82
      });
      if (e > end) end = e;
    });
    return end;
  };

  /* Error. Descending minor second, detuned — dissonant without being harsh. */
  Voices.error = function (ctx, dest, t0, o) {
    var lvl = (o.gain || 1) * 0.16;
    var end = t0;
    [[233.08, 0], [220.00, 0.055]].forEach(function (p) {
      var osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = p[0];
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      var g = ctx.createGain();
      osc.connect(lp); lp.connect(g); g.connect(dest);
      var e = env(g, t0 + p[1], lvl, 0.006, 0.26);
      osc.start(t0 + p[1]); osc.stop(e + 0.05);
      if (e > end) end = e;
    });
    return end;
  };

  /* Riser. Tension build into a reveal. Noise sweeping up plus a rising sine;
     end it exactly on the beat it resolves to. */
  Voices.riser = function (ctx, dest, t0, o) {
    var dur = (o.dur || 1200) / 1000;
    var lvl = (o.gain || 1) * 0.13;
    var src = ctx.createBufferSource();
    src.buffer = ctx._noise;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(300, t0);
    bp.frequency.exponentialRampToValueAtTime(5200, t0 + dur);
    var g = ctx.createGain();
    src.connect(bp); bp.connect(g); g.connect(dest);
    g.gain.setValueAtTime(EPS, t0);
    g.gain.exponentialRampToValueAtTime(lvl, t0 + dur * 0.88);
    g.gain.exponentialRampToValueAtTime(EPS, t0 + dur);
    src.start(t0); src.stop(t0 + dur + 0.05);

    var osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t0);
    osc.frequency.exponentialRampToValueAtTime(720, t0 + dur);
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    var og = ctx.createGain();
    osc.connect(lp); lp.connect(og); og.connect(dest);
    og.gain.setValueAtTime(EPS, t0);
    og.gain.exponentialRampToValueAtTime(lvl * 0.5, t0 + dur * 0.9);
    og.gain.exponentialRampToValueAtTime(EPS, t0 + dur);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
    return t0 + dur;
  };

  /* Toggle. Two-state, pitch direction encodes on vs off. */
  Voices.toggle = function (ctx, dest, t0, o) {
    return Voices.pop(ctx, dest, t0, {
      gain: (o.gain || 1) * 0.7,
      pitch: o.on === false ? 0.62 : 1.18
    });
  };

  /* Ambient pad. Detuned sine stack, very slow attack, sits at the bottom of
     the mix. This is the bed that makes silence feel intentional. */
  Voices.pad = function (ctx, dest, t0, o) {
    var dur = (o.dur || 6000) / 1000;
    var root = o.freq || 110;
    var lvl = (o.gain || 1) * 0.055;
    var end = t0 + dur;
    /* Root, fifth, octave, plus gentle detunes for movement. */
    [[1, 0], [1.5, 4], [2, -5], [3, 3]].forEach(function (p, i) {
      var osc = ctx.createOscillator();
      osc.type = i === 3 ? 'sine' : 'triangle';
      osc.frequency.value = root * p[0];
      osc.detune.value = p[1];
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      var g = ctx.createGain();
      osc.connect(lp); lp.connect(g); g.connect(dest);
      var amp = lvl * (i === 3 ? 0.25 : 1);
      g.gain.setValueAtTime(EPS, t0);
      g.gain.exponentialRampToValueAtTime(amp, t0 + Math.min(1.6, dur * 0.3));
      g.gain.setValueAtTime(amp, t0 + dur - 1.4);
      g.gain.exponentialRampToValueAtTime(EPS, t0 + dur);
      osc.start(t0); osc.stop(end + 0.1);
    });
    return end;
  };

  /* Aliases so cue names can read naturally in a beat sheet. */
  Voices.transition = Voices.whoosh;
  Voices.impact = Voices.thump;
  Voices.notify = Voices.chime;
  Voices.appear = Voices.pop;

  /* MASTER CHAIN
     Compressor for glue, then a soft-clip waveshaper acting as a limiter, then
     master gain. Without the limiter, a thump landing on the same frame as a
     whoosh and a chime will clip and crackle. */
  function softClipCurve() {
    var n = 2048, c = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(x * 1.35) * 0.92;
    }
    return c;
  }

  function makeMaster(ctx, level) {
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 24;
    comp.ratio.value = 3.2;
    comp.attack.value = 0.004;
    comp.release.value = 0.16;

    var shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve();
    shaper.oversample = '4x';

    var out = ctx.createGain();
    out.gain.value = level === undefined ? 0.85 : level;

    comp.connect(shaper);
    shaper.connect(out);
    out.connect(ctx.destination);
    ctx._noise = noiseBuffer(ctx, 1);
    return comp;
  }

  /* MUSIC BED
     Slow suspended-chord pad progression. Deliberately static and low — a bed
     exists to remove the feeling of dead air, not to be listened to. Four
     chords over the whole piece, root movement only. */
  var BED_ROOTS = [110.00, 123.47, 98.00, 130.81];   /* A2 B2 G2 C3 */

  function scheduleBed(ctx, dest, durationMs, gain) {
    var chordMs = 7000;
    var n = Math.max(1, Math.ceil(durationMs / chordMs));
    for (var i = 0; i < n; i++) {
      var at = i * chordMs / 1000;
      var len = Math.min(chordMs + 1800, durationMs - i * chordMs + 1800);
      Voices.pad(ctx, dest, at, {
        freq: BED_ROOTS[i % BED_ROOTS.length],
        dur: len,
        gain: gain === undefined ? 1 : gain
      });
    }
  }

  /* WAV ENCODING
     AudioBuffer -> 16-bit PCM WAV bytes. ffmpeg reads this directly, so the
     export path is: render offline -> WAV -> mux. No encoder dependency. */
  function audioBufferToWav(buf) {
    var numCh = buf.numberOfChannels;
    var len = buf.length;
    var sr = buf.sampleRate;
    var bytes = 44 + len * numCh * 2;
    var ab = new ArrayBuffer(bytes);
    var view = new DataView(ab);

    function str(off, s) {
      for (var i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
    }

    str(0, 'RIFF');
    view.setUint32(4, bytes - 8, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    view.setUint32(16, 16, true);        /* PCM chunk size   */
    view.setUint16(20, 1, true);         /* format = PCM     */
    view.setUint16(22, numCh, true);
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * numCh * 2, true);
    view.setUint16(32, numCh * 2, true);
    view.setUint16(34, 16, true);
    str(36, 'data');
    view.setUint32(40, len * numCh * 2, true);

    var chans = [];
    for (var c = 0; c < numCh; c++) chans.push(buf.getChannelData(c));

    var off = 44;
    for (var i = 0; i < len; i++) {
      for (var ch = 0; ch < numCh; ch++) {
        var s = Math.max(-1, Math.min(1, chans[ch][i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        off += 2;
      }
    }
    return new Uint8Array(ab);
  }

  function bytesToBase64(u8) {
    var s = '', chunk = 0x8000;
    for (var i = 0; i < u8.length; i += chunk) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    }
    return btoa(s);
  }

  /* PUBLIC API */
  var liveCtx = null, liveBus = null;

  var SFX = {
    enabled: false,
    masterGain: 0.85,
    bedGain: 1,

    voices: Voices,

    /* Browsers block audio until a user gesture, so the context is created
       lazily on first toggle rather than at load. */
    init: function () {
      if (liveCtx) return liveCtx;
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      liveCtx = new AC();
      liveBus = makeMaster(liveCtx, this.masterGain);
      return liveCtx;
    },

    toggle: function () {
      this.enabled = !this.enabled;
      if (this.enabled) {
        var c = this.init();
        if (c && c.state === 'suspended') c.resume();
      }
      return this.enabled;
    },

    /* Fire a cue live. Called by Timeline._fireCues during preview. */
    play: function (name, opts) {
      if (!this.enabled) return;
      var ctx = this.init();
      if (!ctx) return;
      var v = Voices[name];
      if (!v) return;
      v(ctx, liveBus, ctx.currentTime + 0.005, opts || {});
    },

    /* Render the entire soundtrack offline and return WAV bytes.
       Deterministic: same cue list in, byte-identical WAV out. */
    renderWav: function (cues, durationMs, sampleRate) {
      var OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext;
      if (!OAC) return Promise.resolve(null);
      sampleRate = sampleRate || 48000;
      var tail = 1.2;   /* let final reverb/decay finish */
      var frames = Math.ceil((durationMs / 1000 + tail) * sampleRate);
      var ctx = new OAC(2, frames, sampleRate);
      var bus = makeMaster(ctx, this.masterGain);

      if (this.bedGain > 0) scheduleBed(ctx, bus, durationMs, this.bedGain);

      (cues || []).forEach(function (c, i) {
        var v = Voices[c.name];
        if (!v) return;
        var o = Object.assign({ i: i }, c);
        v(ctx, bus, c.at / 1000, o);
      });

      return ctx.startRendering().then(function (buf) {
        return audioBufferToWav(buf);
      });
    },

    /* Convenience for the render harness: returns base64 so the WAV can cross
       the CDP boundary as a JSON string. */
    renderWavBase64: function (cues, durationMs, sampleRate) {
      return SFX.renderWav(cues, durationMs, sampleRate).then(function (u8) {
        return u8 ? bytesToBase64(u8) : null;
      });
    },

    /* Preview the soundtrack as a downloadable file. */
    downloadWav: function (cues, durationMs) {
      SFX.renderWav(cues, durationMs).then(function (u8) {
        if (!u8) return;
        var blob = new Blob([u8], { type: 'audio/wav' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'explainer-audio.wav';
        a.click();
      });
    },

    audioBufferToWav: audioBufferToWav
  };

  global.SFX = SFX;

}(window));
