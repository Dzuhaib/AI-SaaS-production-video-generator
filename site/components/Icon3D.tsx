import type { ReactNode } from 'react';

/**
 * Three-dimensional icon tiles, drawn rather than imported.
 *
 * Each tile is a bevelled slab sitting at a slight isometric angle, with the
 * glyph on its top face. Depth comes from layered shadows and a specular edge,
 * not from a drop shadow alone; on hover the slab settles upright and lifts.
 * No icon font, no sprite, no external request.
 */
const GLYPHS = {
  crawl: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M10.5 7.5v6M7.5 10.5h6" />
      <path d="m15.5 15.5 4 4" />
    </>
  ),
  analyse: (
    <>
      <path d="M12 3.5 4.5 19.5h15L12 3.5Z" />
      <path d="M8.5 14h7" />
      <path d="M2.5 9h3M18.5 9h3" />
    </>
  ),
  clapper: (
    <>
      <rect x="3" y="8.5" width="18" height="11.5" rx="2" />
      <path d="M3 8.5 5 4h14l2 4.5" />
      <path d="m6.5 8.5 2-4.5M11.5 8.5l2-4.5M16.5 8.5l2-4.5" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 16.5 9 5 9-5" />
    </>
  ),
  film: (
    <>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
      <path d="M7 4.5v15M17 4.5v15M2.5 9h4.5M2.5 15h4.5M17 9h4.5M17 15h4.5" />
      <path d="m10.5 9.5 4 2.5-4 2.5v-5Z" />
    </>
  ),
  terminal: (
    <>
      <rect x="2.5" y="4" width="19" height="16" rx="2.5" />
      <path d="m6.5 9 3.5 3-3.5 3M12.5 15.5h5" />
    </>
  ),
  spark: (
    <>
      <path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5" />
      <path d="m5.2 5.2 3.5 3.5M15.3 15.3l3.5 3.5M18.8 5.2l-3.5 3.5M8.7 15.3l-3.5 3.5" />
    </>
  ),
  check: <path d="m4.5 12 5 5 10-11" />,
  play: <path d="M8 5v14l11-7-11-7Z" />,
  shield: (
    <>
      <path d="M12 3 4.5 6v5.5c0 4.6 3.1 7.9 7.5 9.5 4.4-1.6 7.5-4.9 7.5-9.5V6L12 3Z" />
      <path d="m8.8 12 2.2 2.2 4.4-4.7" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-1 1.4-2.1-.5-1 .1-2 1.2-2h1.2a4.7 4.7 0 0 0 4.7-4.7C20.5 7 16.7 3.5 12 3.5Z" />
      <circle cx="8" cy="10" r="1" />
      <circle cx="12" cy="7.5" r="1" />
      <circle cx="15.8" cy="10" r="1" />
    </>
  ),
} as const;

export type IconName = keyof typeof GLYPHS;

const TONES = ['accent', 'gold', 'sage', 'clay', 'paper'] as const;
export type IconTone = (typeof TONES)[number];

export function Icon3D({
  name,
  tone = 'accent',
  size = 64,
  className = '',
}: {
  name: IconName;
  tone?: IconTone;
  size?: number;
  className?: string;
}): ReactNode {
  return (
    <span
      className={`i3d tone-${tone} ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span className="i3d-shadow" />
      <span className="i3d-plate">
        <span className="i3d-glint" />
        <svg
          className="i3d-glyph"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {GLYPHS[name]}
        </svg>
      </span>
    </span>
  );
}
