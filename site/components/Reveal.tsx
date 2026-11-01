'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

type Phase = 'idle' | 'armed' | 'in';

/**
 * Scroll-reveal wrapper.
 *
 * It stays visible by default, only arming an entrance when the element is
 * genuinely below the fold — so a no-JS read, a prerender, or a snapshot never
 * ships a page of invisible sections. Reduced motion goes straight to `in`.
 */
export function Reveal({
  children,
  className = '',
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (
      typeof IntersectionObserver === 'undefined' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setPhase('in');
      return;
    }

    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) {
      setPhase('in');
      return;
    }

    setPhase('armed');
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setPhase('in');
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.12 }
    );
    io.observe(el);

    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${phase === 'armed' ? 'is-armed' : ''} ${
        phase === 'in' ? 'is-in' : ''
      } ${className}`.trim()}
      style={{ '--reveal-delay': `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}
