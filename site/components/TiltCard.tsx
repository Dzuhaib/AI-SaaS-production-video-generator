'use client';

import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from 'react';

/**
 * A card that leans toward the pointer and carries a small spotlight with it.
 *
 * The rotation is deliberately shallow — four degrees — because the point is
 * material, not a fairground ride. Touch pointers and reduced-motion users get
 * the card completely still; the CSS spotlight is the only thing left.
 */
export function TiltCard({
  children,
  className = '',
  intensity = 4,
}: {
  children: ReactNode;
  className?: string;
  intensity?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || event.pointerType === 'touch') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const rect = el.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    el.style.setProperty('--mx', `${(x * 100).toFixed(2)}%`);
    el.style.setProperty('--my', `${(y * 100).toFixed(2)}%`);
    el.style.setProperty('--rx', `${((0.5 - y) * intensity).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${((x - 0.5) * intensity).toFixed(2)}deg`);
  };

  const leave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
    el.style.setProperty('--mx', '50%');
    el.style.setProperty('--my', '50%');
  };

  return (
    <div
      ref={ref}
      className={`tilt ${className}`.trim()}
      style={{ '--mx': '50%', '--my': '50%' } as CSSProperties}
      onPointerMove={move}
      onPointerLeave={leave}
    >
      {children}
    </div>
  );
}
