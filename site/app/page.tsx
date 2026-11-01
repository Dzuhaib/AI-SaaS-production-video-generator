import { CommandBlock } from '../components/CopyCommand';
import { Icon3D, type IconName, type IconTone } from '../components/Icon3D';
import { Nav } from '../components/Nav';
import { Reveal } from '../components/Reveal';
import { TiltCard } from '../components/TiltCard';

const STANDARDS = ['H.264', 'BT.709', 'EBU R128', 'WCAG 2.3.1', 'WebVTT'] as const;

const STEPS: readonly {
  n: string;
  title: string;
  line: string;
  icon: IconName;
  tone: IconTone;
}[] = [
  {
    n: '01',
    title: 'Paste a URL',
    line: 'We read the brand, copy and layout.',
    icon: 'crawl',
    tone: 'accent',
  },
  {
    n: '02',
    title: 'Get a storyboard',
    line: 'The model writes the story, scene by scene.',
    icon: 'clapper',
    tone: 'gold',
  },
  {
    n: '03',
    title: 'Publish the film',
    line: 'A captioned, broadcast-ready master.',
    icon: 'film',
    tone: 'sage',
  },
];

const SWATCHES = ['#2563eb', '#38bdf8', '#0f172a', '#f59e0b', '#e2e8f0'] as const;

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
          <div className="wrap hero-copy">
            <span className="eyebrow">
              <i aria-hidden="true" />
              AI product films, from a URL
            </span>

            <h1>
              Turn your website into a <span className="hero-accent">product film.</span>
            </h1>

            <p className="hero-lede">
              Paste a URL. Urlume reads your site, writes the story, and renders a
              ready-to-publish video in minutes.
            </p>

            <div className="hero-actions">
              <a className="btn btn-primary" href="#install">
                Install Urlume
                <span className="btn-ico">
                  <Arrow />
                </span>
              </a>
              <a className="btn btn-ghost" href="#how">
                See how it works
              </a>
            </div>

            <ul className="hero-meta">
              <li>
                <span className="meta-dot" aria-hidden="true" />
                Open source
              </li>
              <li>Any AI model</li>
              <li>No editing</li>
            </ul>
          </div>

          <Reveal className="hero-stage wrap" delay={120}>
            <span className="hero-blob" aria-hidden="true" />

            <div className="hero-float hero-float-1" aria-hidden="true">
              <Icon3D name="spark" tone="accent" size={44} />
            </div>
            <div className="hero-float hero-float-2" aria-hidden="true">
              <Icon3D name="film" tone="gold" size={52} />
            </div>

            <div className="stage-window">
              <div className="window-bar">
                <span className="window-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="window-url mono">https://clinza.com</span>
                <span className="window-state mono">
                  <i aria-hidden="true" />
                  ready
                </span>
              </div>

              <div className="window-body">
                <div className="stage-col">
                  <span className="stage-label mono">01 · source</span>
                  <div className="source-card">
                    <span className="source-brand">
                      <i aria-hidden="true" />
                      Clinza
                    </span>
                    <span className="source-line w-80" aria-hidden="true" />
                    <span className="source-line w-60" aria-hidden="true" />
                    <span className="source-blocks" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="source-chip">Book a demo</span>
                  </div>
                </div>

                <span className="stage-arrow" aria-hidden="true">
                  →
                </span>

                <div className="stage-col">
                  <span className="stage-label mono">02 · storyboard</span>
                  <div className="scenes">
                    <span className="scene scene-1" aria-hidden="true">
                      <i />
                    </span>
                    <span className="scene scene-2" aria-hidden="true">
                      <i />
                    </span>
                    <span className="scene scene-3" aria-hidden="true">
                      <i />
                    </span>
                  </div>
                  <span className="scene-track" aria-hidden="true">
                    <i />
                  </span>
                </div>

                <span className="stage-arrow" aria-hidden="true">
                  →
                </span>

                <div className="stage-col">
                  <span className="stage-label mono">03 · master</span>
                  <div className="master-frame">
                    <span className="master-orb" aria-hidden="true" />
                    <span className="master-brand">Clinza</span>
                    <span className="master-title">The front desk that never sleeps.</span>
                    <span className="master-play" aria-hidden="true">
                      ▶
                    </span>
                    <span className="master-spec mono">22s · 1080p</span>
                  </div>
                </div>
              </div>
            </div>

            <span className="stage-note mono">No editor · No timeline</span>
          </Reveal>
        </section>

        <section className="trust">
          <div className="wrap trust-row">
            <span className="trust-label mono">Built to delivery standards</span>
            <ul>
              {STANDARDS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section id="how" className="section how">
          <div className="wrap">
            <Reveal className="section-head center">
              <span className="eyebrow">How it works</span>
              <h2>From URL to film in three steps.</h2>
              <p>One command. About two minutes.</p>
            </Reveal>

            <div className="step-grid">
              {STEPS.map((step, index) => (
                <Reveal key={step.n} delay={index * 80}>
                  <TiltCard className="step-card">
                    <div className="step-top">
                      <Icon3D name={step.icon} tone={step.tone} size={58} />
                      <span className="step-n mono">{step.n}</span>
                    </div>
                    <h3>{step.title}</h3>
                    <p>{step.line}</p>
                  </TiltCard>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section id="features" className="section features">
          <div className="wrap">
            <Reveal className="section-head center">
              <span className="eyebrow">Why Urlume</span>
              <h2>Everything a launch video needs.</h2>
            </Reveal>

            <div className="bento">
              <Reveal className="bento-card" delay={40}>
                <div className="bento-visual brand-visual" aria-hidden="true">
                  <span className="swatches">
                    {SWATCHES.map((color) => (
                      <i key={color} style={{ background: color }} />
                    ))}
                  </span>
                  <span className="type-spec">Aa</span>
                  <span className="logo-dot" />
                </div>
                <h3>Your brand, built in.</h3>
                <p>Colours, type and logo, read from the live site.</p>
              </Reveal>

              <Reveal className="bento-card" delay={110}>
                <div className="bento-visual frames-visual" aria-hidden="true">
                  {Array.from({ length: 8 }, (_, index) => (
                    <span className={`frame frame-${index + 1}`} key={index}>
                      <i />
                    </span>
                  ))}
                </div>
                <h3>Same input. Same frames.</h3>
                <p>Rendered deterministically — not a screen recording.</p>
              </Reveal>

              <Reveal className="bento-card" delay={180}>
                <div className="bento-visual specs-visual" aria-hidden="true">
                  <span>1080p</span>
                  <span>Captions</span>
                  <span>−23 LUFS</span>
                  <span>Safe areas</span>
                  <span>H.264</span>
                  <span>BT.709</span>
                </div>
                <h3>Ready to publish.</h3>
                <p>Captions, loudness and safe areas, already handled.</p>
              </Reveal>
            </div>
          </div>
        </section>

        <section id="install" className="section install">
          <div className="wrap">
            <Reveal className="cta">
              <span className="cta-orb" aria-hidden="true" />
              <div className="cta-copy">
                <span className="eyebrow">Start in one command</span>
                <h2>Your first film is two minutes away.</h2>
                <p>Bring any model key. ffmpeg ships with the package.</p>
                <div className="providers" aria-label="Supported model providers">
                  <span>Anthropic</span>
                  <span>OpenAI</span>
                  <span>Gemini</span>
                  <span>Local</span>
                </div>
              </div>

              <div className="cta-side">
                <CommandBlock
                  title="terminal"
                  lines={[
                    'npm install -g urlume',
                    'npx playwright-core install chromium',
                    'urlume create https://your-saas.com',
                  ]}
                />
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-main">
          <div className="footer-brand">
            <a className="footer-mark" href="#top">
              urlume
            </a>
            <p>A URL in. A film out.</p>
          </div>

          <nav className="footer-links" aria-label="Footer">
            <a href="#how">How it works</a>
            <a href="#features">Features</a>
            <a href="#install">Install</a>
            <a
              href="https://github.com/Dzuhaib/AI-SaaS-production-video-generator"
              target="_blank"
              rel="noreferrer"
            >
              GitHub ↗
            </a>
          </nav>
        </div>

        <div className="wrap footer-base">
          <span>© 2026 Urlume</span>
          <span className="mono">MIT · v0.1.0</span>
        </div>
      </footer>
    </>
  );
}
