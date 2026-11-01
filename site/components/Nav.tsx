'use client';

import { useEffect, useState } from 'react';

const LINKS = [
  { href: '#pipeline', label: 'Pipeline' },
  { href: '#craft', label: 'Craft' },
  { href: '#delivery', label: 'Delivery' },
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
          <span className="nav-version">v0.1.0</span>
          <a className="nav-install" href="#install">
            Install the CLI
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
          <span className="mono">v0.1.0 · MIT</span>
        </div>
      </div>
    </header>
  );
}
