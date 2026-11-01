'use client';

import { useEffect, useState } from 'react';

const LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '#install', label: 'Install' },
];

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 14);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <header className={`sitehead ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="nav-wrap">
        <a className="brand" href="#top" onClick={() => setOpen(false)}>
          <BrandMark />
          <span>urlume</span>
        </a>

        <nav className="nav-links" aria-label="Primary">
          {LINKS.map((link) => (
            <a key={link.href} href={link.href}>
              <span>{link.label}</span>
            </a>
          ))}
        </nav>

        <div className="nav-actions">
          <a
            className="nav-github"
            href="https://github.com/Dzuhaib/AI-SaaS-production-video-generator"
            target="_blank"
            rel="noreferrer"
            aria-label="Urlume on GitHub"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 .5C5.73.5.9 5.33.9 11.6c0 4.9 3.17 9.06 7.57 10.53.55.1.75-.24.75-.53 0-.26-.01-1.13-.02-2.05-3.08.67-3.73-1.31-3.73-1.31-.5-1.28-1.23-1.62-1.23-1.62-1-.69.08-.67.08-.67 1.11.08 1.69 1.14 1.69 1.14.99 1.69 2.59 1.2 3.22.92.1-.72.39-1.2.7-1.48-2.46-.28-5.05-1.23-5.05-5.48 0-1.21.43-2.2 1.14-2.98-.11-.28-.49-1.41.11-2.94 0 0 .93-.3 3.05 1.14a10.6 10.6 0 0 1 2.78-.37c.94 0 1.89.13 2.78.37 2.12-1.44 3.05-1.14 3.05-1.14.6 1.53.22 2.66.11 2.94.71.78 1.14 1.77 1.14 2.98 0 4.26-2.6 5.19-5.07 5.47.4.34.75 1.02.75 2.06 0 1.49-.01 2.69-.01 3.06 0 .29.2.64.76.53a11.1 11.1 0 0 0 7.56-10.53C23.1 5.33 18.27.5 12 .5Z" />
            </svg>
          </a>
          <span className="nav-version">v0.1.0</span>
          <a className="nav-install" href="#install">
            Install Urlume
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 8h9M8.5 3.5 13 8l-4.5 4.5" />
            </svg>
          </a>
          <button
            className={`nav-burger ${open ? 'is-open' : ''}`}
            type="button"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((value) => !value)}
          >
            <span />
            <span />
          </button>
        </div>
      </div>

      <div id="mobile-menu" className={`mobile-menu ${open ? 'is-open' : ''}`}>
        <nav aria-label="Mobile">
          {LINKS.map((link, index) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              style={{ ['--i' as string]: index }}
            >
              <span className="m-index">{String(index + 1).padStart(2, '0')}</span>
              {link.label}
            </a>
          ))}
        </nav>
        <div className="mobile-foot">
          <span>AI product films, from a URL</span>
          <a
            href="https://github.com/Dzuhaib/AI-SaaS-production-video-generator"
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
          <span className="mono">v0.1.0 · MIT</span>
        </div>
      </div>
    </header>
  );
}
