import { CommandBlock } from '../components/CopyCommand';
import { Faq } from '../components/Faq';
import { Icon3D, type IconName, type IconTone } from '../components/Icon3D';
import { Nav } from '../components/Nav';
import { Reveal } from '../components/Reveal';
import { TiltCard } from '../components/TiltCard';

const STANDARDS = [
  '1920 × 1080',
  'H.264 High',
  'BT.709',
  'EBU R128',
  'ATSC A/85',
  '30000/1001',
  'WebVTT + SRT',
  'WCAG 2.3.1',
] as const;

const STAGES: readonly {
  n: string;
  title: string;
  line: string;
  icon: IconName;
  tone: IconTone;
}[] = [
  {
    n: '01',
    title: 'Crawl',
    line: 'Finds the pages worth filming.',
    icon: 'crawl',
    tone: 'accent',
  },
  {
    n: '02',
    title: 'Analyse',
    line: 'Lifts accent, type and logo from the DOM.',
    icon: 'analyse',
    tone: 'gold',
  },
  {
    n: '03',
    title: 'Storyboard',
    line: 'The model writes JSON, not pixels.',
    icon: 'clapper',
    tone: 'sage',
  },
  {
    n: '04',
    title: 'Compose',
    line: 'Frames, captions and safe areas, measured.',
    icon: 'layers',
    tone: 'clay',
  },
  {
    n: '05',
    title: 'Render',
    line: 'Seeked frame by frame. Same input, same film.',
    icon: 'film',
    tone: 'paper',
  },
];

const RULES = [
  ['cuts-not-crossfades', 'Hard cuts; two dissolves at most.'],
  ['no-linear-on-motion', 'Nothing moving ever eases linearly.'],
  ['stagger-range', '60–120ms between siblings.'],
  ['payoff-hold', '600–900ms of stillness after the payoff.'],
  ['attributed-stats', 'Every number carries its source.'],
  ['readable-type', 'Body copy stays at 24px or larger.'],
] as const;

const SPECS = [
  ['film', 'Resolution', '1920 × 1080', '16:9 master'],
  ['clock', 'Cadence', '30000/1001', 'exact NTSC'],
  ['palette', 'Colour', 'BT.709', 'limited range'],
  ['shield', 'Flash limit', '3 / second', 'WCAG 2.3.1'],
] as const;

function Arrow() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h9M8.5 3.5 13 8l-4.5 4.5" />
    </svg>
  );
}

export default function Page() {
  return (
    <>
      <Nav />

      <main id="top">
        <section className="hero">
          <div className="wrap hero-grid">
            <div className="hero-copy">
              <span className="eyebrow">
                <svg className="eyebrow-spark" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M6 0v12M0 6h12M1.8 1.8l8.4 8.4M10.2 1.8 1.8 10.2" />
                </svg>
                AI product films, from a URL
              </span>

              <h1 className="hero-h1">
                <span className="line">
                  <span>Your website,</span>
                </span>
                <span className="line">
                  <span>
                    <em>rendered</em> as a film.
                  </span>
                </span>
              </h1>

              <p className="hero-lede">
                Point Urlume at a live site. It writes the storyboard and renders a captioned,
                broadcast-legal master.
              </p>

              <div className="hero-actions">
                <a className="btn btn-primary" href="#install">
                  <span>Install the CLI</span>
                  <span className="btn-ico">
                    <Arrow />
                  </span>
                </a>
                <a className="btn btn-ghost" href="#pipeline">
                  <span>See how it works</span>
                  <span className="btn-ico">
                    <Arrow />
                  </span>
                </a>
              </div>

              <ul className="hero-meta">
                <li>
                  <span className="meta-dot" aria-hidden="true" />
                  MIT licensed
                </li>
                <li>Node ≥ 20.11</li>
                <li>One API key</li>
              </ul>
            </div>

            <div className="hero-media">
              <div className="hero-float hero-float-1" aria-hidden="true">
                <Icon3D name="film" tone="gold" size={56} />
              </div>
              <div className="hero-float hero-float-2" aria-hidden="true">
                <Icon3D name="spark" tone="accent" size={42} />
              </div>
              <div className="hero-float hero-float-3" aria-hidden="true">
                <Icon3D name="layers" tone="sage" size={38} />
              </div>

              <figure className="still">
                <div className="still-chrome">
                  <span className="player-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="player-file">clinza · master</span>
                  <span className="player-master">
                    <i aria-hidden="true" />
                    rendered
                  </span>
                </div>

                <div className="still-screen">
                  <span className="still-ambient" aria-hidden="true" />
                  <span className="still-grid" aria-hidden="true" />
                  <span className="still-kicker mono">Clinza · 2026</span>
                  <span className="still-title">The front desk that never sleeps.</span>
                  <span className="still-line">24/7 AI reception for aesthetic clinics.</span>
                  <span className="still-metric">
                    4.2× <i>faster booking</i>
                  </span>
                  <span className="still-source mono">
                    source: internal data · 240 teams · Q2 2025
                  </span>
                </div>

                <div className="still-bar">
                  <span className="mono">00:00</span>
                  <span className="still-track" aria-hidden="true">
                    <i />
                  </span>
                  <span className="mono">00:22</span>
                  <span className="still-spec mono">1920 × 1080 · 30fps</span>
                </div>
              </figure>

              <span className="hero-side-note mono" aria-hidden="true">
                URL → STORYBOARD → MASTER
              </span>
            </div>
          </div>
        </section>

        <div className="marquee" aria-hidden="true">
          <div className="marquee-track">
            {[...STANDARDS, ...STANDARDS].map((item, index) => (
              <span className="marquee-item" key={`${item}-${index}`}>
                <i />
                {item}
              </span>
            ))}
          </div>
        </div>

        <section id="pipeline" className="section pipeline">
          <div className="wrap">
            <Reveal className="section-head split">
              <div>
                <span className="eyebrow">The pipeline</span>
                <h2>
                  URL in. <em>Master</em> out.
                </h2>
              </div>
              <p>
                Five deterministic stages. The model makes the creative decisions; the renderer
                makes every frame.
              </p>
            </Reveal>

            <div className="stage-grid">
              {STAGES.map((stage, index) => (
                <Reveal key={stage.n} delay={index * 70} className="stage-reveal">
                  <TiltCard className="stage-card">
                    <span className="stage-line" aria-hidden="true" />
                    <div className="stage-top">
                      <Icon3D name={stage.icon} tone={stage.tone} size={54} />
                      <span className="stage-num mono">{stage.n}</span>
                    </div>
                    <h3>{stage.title}</h3>
                    <p>{stage.line}</p>
                  </TiltCard>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section id="craft" className="section craft">
          <div className="wrap craft-grid">
            <Reveal className="craft-intro">
              <span className="eyebrow">Craft, enforced</span>
              <h2>
                Thirteen rules.
                <br />
                <em>Not suggestions.</em>
              </h2>
              <p className="lede">
                The rules compile into executable checks. Fixable violations are repaired in
                place; structural ones go back to the model.
              </p>
              <div className="craft-icon" aria-hidden="true">
                <Icon3D name="clapper" tone="clay" size={72} />
              </div>
            </Reveal>

            <Reveal className="ledger" delay={120}>
              <div className="ledger-head mono">
                <span>rule</span>
                <span>what it enforces</span>
              </div>
              {RULES.map(([name, gloss], index) => (
                <div className="rule" key={name} style={{ ['--i' as string]: index }}>
                  <span className="rule-i mono">{String(index + 1).padStart(2, '0')}</span>
                  <span className="rule-name mono">{name}</span>
                  <span className="rule-gloss">{gloss}</span>
                  <span className="rule-check" aria-hidden="true" />
                </div>
              ))}
            </Reveal>
          </div>
        </section>

        <section id="delivery" className="section delivery">
          <div className="wrap">
            <Reveal className="section-head split">
              <div>
                <span className="eyebrow">Delivery</span>
                <h2>
                  Broadcast-legal,
                  <br />
                  <em>by default.</em>
                </h2>
              </div>
              <p>
                The compiler, caption writer and encoder all read the same numbers — before a
                frame is drawn.
              </p>
            </Reveal>

            <Reveal className="spec-ribbon" delay={100}>
              {SPECS.map(([icon, label, value, sub]) => (
                <div className="spec" key={label}>
                  <Icon3D name={icon} tone="paper" size={40} />
                  <div className="spec-copy">
                    <span className="spec-k mono">{label}</span>
                    <strong>{value}</strong>
                    <span className="spec-s mono">{sub}</span>
                  </div>
                </div>
              ))}
            </Reveal>
          </div>
        </section>

        <section id="install" className="section install">
          <div className="wrap">
            <Reveal className="install-card">
              <span className="install-glow" aria-hidden="true" />
              <div className="install-copy">
                <span className="eyebrow">Start</span>
                <h2>
                  Two commands.
                  <br />
                  <em>One key.</em>
                </h2>
                <p className="lede">
                  The site only has to be public. Bring any model provider; ffmpeg ships with
                  the package.
                </p>

                <div className="provider-chips">
                  <span className="chips-label mono">bring your own model</span>
                  <span>Anthropic</span>
                  <span>OpenAI</span>
                  <span>Gemini</span>
                  <span>Custom</span>
                </div>
              </div>

              <div className="install-side">
                <CommandBlock
                  title="terminal"
                  lines={[
                    'npm install -g urlume',
                    'npx playwright-core install chromium',
                    'urlume create https://your-saas.com --prompt "24 second launch film"',
                  ]}
                />
                <div className="install-foot mono">
                  <span>MIT</span>
                  <span>Node ≥ 20.11</span>
                  <span>~2 min per film</span>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section id="faq" className="section faq-section">
          <div className="wrap faq-wrap">
            <Reveal className="faq-head">
              <span className="eyebrow">Questions</span>
              <h2>
                The short <em>answers.</em>
              </h2>
            </Reveal>
            <Faq />
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="filmstrip" aria-hidden="true">
          {Array.from({ length: 30 }, (_, index) => (
            <i key={index} />
          ))}
        </div>

        <div className="wrap footer-main">
          <div className="footer-brand">
            <a className="footer-mark" href="#top">
              urlume
            </a>
            <p>A URL in. A film out. Built for the terminal.</p>
            <span className="footer-spark" aria-hidden="true">
              <Icon3D name="spark" tone="accent" size={38} />
            </span>
          </div>

          <div className="footer-cols">
            <div>
              <h4 className="mono">Product</h4>
              <a href="#pipeline">Pipeline</a>
              <a href="#craft">Craft</a>
              <a href="#delivery">Delivery</a>
              <a href="#install">Install</a>
            </div>
            <div>
              <h4 className="mono">Standards</h4>
              <span>EBU R128</span>
              <span>BT.709</span>
              <span>WCAG 2.3.1</span>
            </div>
            <div>
              <h4 className="mono">Meta</h4>
              <span>MIT License</span>
              <span>v0.1.0</span>
              <span>Node ≥ 20.11</span>
            </div>
          </div>
        </div>

        <div className="wrap footer-base">
          <span>© 2026 Urlume</span>
          <span className="mono">1920 × 1080 · 30fps · H.264 · BT.709</span>
          <a href="#top">
            Back to top
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 13V4M3.5 8.5 8 4l4.5 4.5" />
            </svg>
          </a>
        </div>
      </footer>
    </>
  );
}
