'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The Studio: a miniature of what Urlume actually outputs, generating and
 * playing itself on a loop.
 *
 * Architecture mirrors the product's own: one clock drives everything. A single
 * rAF loop writes `--t` (0..1 across the cycle) onto the root node and pokes
 * text into refs directly, so the playhead, the progress bar, the frame counter
 * and the film stay in lockstep without React re-rendering at 60fps. React
 * state changes six times per cycle — once per scene — which is cheap.
 *
 * Scene compositions are the real ones the compiler emits: a checklist hook, a
 * brand reveal, a phone thread, a dashboard in browser chrome, a single-number
 * proof shot, an end card.
 */

const CYCLE = 18_000;

interface Scene {
  readonly beat: string;
  readonly ms: number;
  readonly label: string;
}

const SCENES: readonly Scene[] = [
  { beat: 'hook', ms: 3400, label: 'You are losing patients every day' },
  { beat: 'reveal', ms: 2600, label: 'Every channel becomes an AI salesperson' },
  { beat: 'how', ms: 3400, label: 'It answers and books the appointment' },
  { beat: 'how', ms: 3200, label: 'You watch from one place' },
  { beat: 'payoff', ms: 3000, label: 'More bookings, same traffic' },
  { beat: 'end', ms: 2400, label: 'Book a demo' },
];

const TOTAL = SCENES.reduce((a, s) => a + s.ms, 0);

/** Cumulative start time of each scene, so a `t` maps to an index. */
const STARTS = SCENES.reduce<number[]>((acc, s, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1]! + SCENES[i - 1]!.ms);
  return acc;
}, []);

function sceneAt(ms: number): number {
  for (let i = SCENES.length - 1; i >= 0; i--) {
    if (ms >= STARTS[i]!) return i;
  }
  return 0;
}

export function Studio() {
  const root = useRef<HTMLDivElement>(null);
  const pct = useRef<HTMLSpanElement>(null);
  const frames = useRef<HTMLSpanElement>(null);
  const tcode = useRef<HTMLSpanElement>(null);
  const [scene, setScene] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (reduced) {
      // Hold on the proof shot: a still frame that shows what the tool makes.
      setScene(4);
      root.current?.style.setProperty('--t', '0.78');
      if (pct.current) pct.current.textContent = '100';
      if (frames.current) frames.current.textContent = '540/540';
      if (tcode.current) tcode.current.textContent = '00:00:15:12';
      return;
    }

    let raf = 0;
    const start = performance.now();
    let last = -1;

    const tick = (now: number) => {
      const elapsed = (now - start) % CYCLE;
      const t = elapsed / CYCLE;
      const filmMs = Math.min(TOTAL, (elapsed / CYCLE) * TOTAL);

      root.current?.style.setProperty('--t', t.toFixed(5));

      const i = sceneAt(filmMs);
      if (i !== last) {
        last = i;
        setScene(i);
      }

      if (pct.current) pct.current.textContent = String(Math.round(t * 100));
      if (frames.current) {
        frames.current.textContent = `${Math.round(t * 540)}/540`;
      }
      if (tcode.current) {
        const total = Math.floor(filmMs / 1000);
        const ss = String(total % 60).padStart(2, '0');
        const ff = String(Math.floor(((filmMs % 1000) / 1000) * 30)).padStart(2, '0');
        tcode.current.textContent = `00:00:${ss}:${ff}`;
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  return (
    <div className="studio" ref={root} data-scene={scene}>
      {/* ---- viewport ------------------------------------------------ */}
      <div className="viewport">
        <div className="vpBar">
          <span className="vpDot" />
          <span className="vpName">clinza.mp4</span>
          <span className="vpSpec">1920×1080 · 30fps · H.264</span>
          <span className="vpTc" ref={tcode}>
            00:00:00:00
          </span>
        </div>

        <div className="stage">
          <div className="aurora" aria-hidden="true" />

          {/* 01 hook — a checklist of missed messages */}
          <div className="sc sc0">
            <p className="kicker">The problem</p>
            <h3 className="scH">You are losing patients every day</h3>
            <ul className="rows">
              {[
                ['WhatsApp', '21:40'],
                ['Instagram DM', '22:15'],
                ['Website chat', '01:18'],
                ['Missed call', '07:55'],
              ].map(([c, t], i) => (
                <li key={c} style={{ ['--i' as string]: i }}>
                  <span className="rowDot" />
                  <span className="rowName">{c}</span>
                  <span className="rowTime">{t}</span>
                  <span className="rowTag">no reply</span>
                </li>
              ))}
            </ul>
          </div>

          {/* 02 reveal — brand lockup */}
          <div className="sc sc1">
            <div className="lock">
              <span className="lockMark" />
              <span className="lockWord">Clinza</span>
            </div>
            <h3 className="scH big">Every channel becomes an AI salesperson</h3>
            <p className="scSub">24/7 receptionist for aesthetic clinics</p>
          </div>

          {/* 03 device — a phone thread */}
          <div className="sc sc2">
            <div className="scCopy">
              <p className="kicker">They message. It sells.</p>
              <h3 className="scH">It answers and books the appointment</h3>
            </div>
            <div className="phone">
              <span className="notch" />
              <div className="thread">
                <span className="bub in" style={{ ['--i' as string]: 0 }}>
                  How much is lip filler?
                </span>
                <span className="bub out" style={{ ['--i' as string]: 1 }}>
                  1ml is 240, free consult included.
                </span>
                <span className="bub in" style={{ ['--i' as string]: 2 }}>
                  Anything Thursday?
                </span>
                <span className="bub out" style={{ ['--i' as string]: 3 }}>
                  Thu 14:30 with Dr Aya. Book it?
                </span>
              </div>
            </div>
          </div>

          {/* 04 dashboard — browser chrome */}
          <div className="sc sc3">
            <p className="kicker">One inbox</p>
            <h3 className="scH">You watch from one place</h3>
            <div className="win">
              <div className="winBar">
                <i /> <i /> <i />
                <span>Clinza</span>
              </div>
              <div className="winBody">
                <div className="stats">
                  <div>
                    <b>10,000+</b>
                    <span>conversations handled</span>
                  </div>
                  <div>
                    <b>98%</b>
                    <span>answered in seconds</span>
                  </div>
                </div>
                <ul className="wrows">
                  {['Sara M. · WhatsApp', 'Nour K. · Instagram', 'Hana T. · Web chat'].map(
                    (r, i) => (
                      <li key={r} style={{ ['--i' as string]: i }}>
                        <span className="rowDot" />
                        {r}
                        <em>booked</em>
                      </li>
                    )
                  )}
                </ul>
              </div>
              <span className="cursor" aria-hidden="true" />
            </div>
          </div>

          {/* 05 payoff — one number, alone and huge */}
          <div className="sc sc4">
            <p className="statLabel">More bookings on average</p>
            <div className="statValue">+40%</div>
            <p className="statBody">Clinza published result</p>
          </div>

          {/* 06 end card */}
          <div className="sc sc5">
            <div className="lock">
              <span className="lockMark" />
              <span className="lockWord">Clinza</span>
            </div>
            <h3 className="scH">Ready to turn every channel into a salesperson?</h3>
            <span className="cta">Book a free demo</span>
          </div>
        </div>

        {/* ---- timeline ---------------------------------------------- */}
        <div className="tl">
          <div className="tlTrack">
            {SCENES.map((s, i) => (
              <div
                key={i}
                className={i === scene ? 'tlBlock on' : 'tlBlock'}
                style={{ flexGrow: s.ms }}
                title={s.label}
              >
                <span>{s.beat}</span>
              </div>
            ))}
            <div className="playhead" />
          </div>
        </div>
      </div>

      {/* ---- console ------------------------------------------------- */}
      <div className="console">
        <div className="conLine">
          <span className="conP">$</span> urlume create{' '}
          <span className="conS">clinza.com</span>{' '}
          <span className="conF">--duration</span> 18
        </div>
        <ol className="conSteps">
          {[
            ['crawl', '8 routes found, 6 skipped'],
            ['analyse', 'accent #1F7A63 · light · radius 8'],
            ['storyboard', '6 scenes, 0 craft errors'],
            ['compile', 'title-safe 1728×972 · captions written'],
            ['render', 'seek, screenshot, encode'],
          ].map(([k, v], i) => (
            <li key={k} className={i <= Math.min(4, scene) ? 'done' : ''}>
              <span className="conKey">{k}</span>
              <span className="conVal">{v}</span>
              <span className="conTick" aria-hidden="true" />
            </li>
          ))}
        </ol>
        <div className="conBar">
          <div className="conFill" />
        </div>
        <div className="conFoot">
          <span>
            <span ref={frames}>0/540</span> frames
          </span>
          <span className="conPass">flash safety: pass</span>
          <span className="conPct">
            <span ref={pct}>0</span>%
          </span>
        </div>
      </div>
    </div>
  );
}
