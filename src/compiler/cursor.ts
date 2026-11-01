/**
 * The in-film cursor.
 *
 * This is a prop drawn into the film, like the browser chrome or the fake
 * sidebar. It is not the viewer's pointer — that one is hidden over the stage so
 * there is never a second arrow in frame — and it is therefore not styled with
 * the CSS `cursor` property. It is an element the timeline positions, tweens and
 * exports.
 *
 * ## The hotspot contract
 *
 * The engine writes the *same* x/y to both the cursor and the click ring, so each
 * element is responsible for landing its own hotspot on that one coordinate.
 *
 * The arrow does it with geometry: **its path is authored so the tip sits at
 * (0,0)** — the element's own top-left corner — so `left`/`top` alone put the tip
 * exactly on the coordinate, and `.cursor` needs no margin correction at all.
 * `transform-origin: 0 0` then makes the press-scale happen *about the tip*, so
 * the arrow stays planted rather than sliding off the target as it shrinks.
 *
 * The ring is round, so it centres the only way a circle can: a negative margin
 * of half its own width.
 *
 * Get this wrong and the ring blooms a few pixels beside the tip. It never looks
 * like a bug — it just looks sloppy.
 *
 * ## Why these paths were re-authored
 *
 * The source skill shipped seven cursor variants of which six had their tip at
 * some inset coordinate (`M6 1`, `M1.5 1.5`, `M3 6`, `M1 2`, `M1 1`) rather than
 * at the origin. Against the contract above, all six would have clicked
 * off-target — producing exactly the "ring blooms beside the cursor" defect the
 * same document warns about. Every path below starts at `M0 0`.
 *
 * They also carried hard-coded hex fills, so they ignored the film's preset. All
 * fills below read from `--cursor-*` tokens.
 *
 * The real rule is **hotspot at the path origin**, not "always an arrow" — an
 * I-beam has a legitimate hotspot too. What must never happen is a silhouette
 * whose hotspot is ambiguous (a dot, a disc, a ring), because then nothing on
 * screen says what is being pointed at.
 */

export type CursorVariant =
  | 'default'
  | 'pointer'
  | 'outline'
  | 'sharp'
  | 'vibrant'
  | 'grab'
  | 'ibeam';

/**
 * Paths for each variant, every one with its hotspot at (0,0).
 *
 * `viewBox` starts at `0 0` and the shape grows down and right from the origin,
 * which is why `.cursor` also sets `overflow: visible` — the stroke on that
 * corner would otherwise be clipped.
 */
export const CURSOR_PATHS: Record<CursorVariant, { viewBox: string; path: string; kind: 'fill' | 'stroke' }> = {
  /** The canonical arrow. Tip at origin, tail down-left, flag to the right. */
  default: {
    viewBox: '0 0 13.4 18.9',
    path: 'M0 0 L0 16.5 L4.2 12.6 L6.9 18.9 L9.7 17.7 L7 11.5 L13.4 11.5 Z',
    kind: 'fill',
  },

  /**
   * Pointing hand. The finger *tip* is the hotspot, so the whole hand hangs
   * below and right of the origin — which is what the original got wrong by
   * starting at `M6 1` and putting the hotspot in the middle of the knuckles.
   */
  pointer: {
    viewBox: '0 0 15.5 19.5',
    path:
      'M0 0 C0.9 0 1.6 0.7 1.6 1.6 V9.8 C2.1 9.4 2.7 9.2 3.3 9.3 ' +
      'C4.3 9.5 5 10.4 4.9 11.4 V12.8 H10.5 C12.2 12.8 13.6 14.2 13.6 15.9 ' +
      'V16.4 C13.6 18.1 12.2 19.5 10.5 19.5 H5.6 C3.1 19.5 1 17.6 0.7 15.2 ' +
      'L0 9.6 Z',
    kind: 'fill',
  },

  /** Hollow arrow for dense overlays where text beneath must stay readable. */
  outline: {
    viewBox: '0 0 13.4 18.9',
    path: 'M0 0 L0 16.5 L4.2 12.6 L6.9 18.9 L9.7 17.7 L7 11.5 L13.4 11.5 Z',
    kind: 'stroke',
  },

  /** Geometric 45-degree tip. Developer tools, terminals. */
  sharp: {
    viewBox: '0 0 16 21',
    path: 'M0 0 L14.5 14.5 L8 14.5 L11 21 L8.4 21 L5.4 15 L0 18.5 Z',
    kind: 'fill',
  },

  /** Same silhouette as `default`, accent-filled with a drop shadow. */
  vibrant: {
    viewBox: '0 0 13.4 18.9',
    path: 'M0 0 L0 16.5 L4.2 12.6 L6.9 18.9 L9.7 17.7 L7 11.5 L13.4 11.5 Z',
    kind: 'fill',
  },

  /** Closed fist for dragging. Hotspot at the top-left knuckle. */
  grab: {
    viewBox: '0 0 16 17',
    path:
      'M0 0 C0.9 0 1.7 0.7 1.7 1.6 V5.2 C2.1 4.6 2.8 4.2 3.6 4.2 ' +
      'C4.4 4.2 5.1 4.6 5.5 5.2 C5.9 4.6 6.5 4.2 7.3 4.2 ' +
      'C8.4 4.2 9.3 4.9 9.6 5.9 C10 5.5 10.5 5.3 11.1 5.3 ' +
      'C12.4 5.3 13.5 6.4 13.5 7.7 V11 C13.5 14.3 10.8 17 7.5 17 H6.3 ' +
      'C3 17 0.3 14.3 0.3 11 Z',
    kind: 'fill',
  },

  /**
   * I-beam for text entry. Its hotspot is the *centre* of the beam, so the
   * shape is drawn to the right of the origin with the vertical stroke on x=0.
   */
  ibeam: {
    viewBox: '0 0 9 18',
    path: 'M0 0 M-4 0.8 H4 M0 0.8 V17.2 M-4 17.2 H4',
    kind: 'stroke',
  },
};

/** Markup for one variant. `data-el="cursor"` is the engine's default target. */
export function cursorSvg(variant: CursorVariant = 'default'): string {
  const spec = CURSOR_PATHS[variant];
  const paint =
    spec.kind === 'fill'
      ? `fill="var(--cursor-fill)" stroke="var(--cursor-edge)" stroke-width="1.2"`
      : `fill="none" stroke="var(--cursor-core)" stroke-width="2" ` +
        `stroke-linejoin="round" stroke-linecap="round"`;

  return `    <svg class="cursor cursor--${variant}" data-el="cursor" data-cursor-variant="${variant}"
         viewBox="${spec.viewBox}" style="left:0; top:0; opacity:0;" aria-hidden="true">
      <path d="${spec.path}" ${paint}/>
    </svg>`;
}

/** The default arrow, for a film that never switches variant. */
export const CURSOR_SVG = cursorSvg('default');

/** Ring centres itself with a negative margin of half its own width; see the
 *  hotspot contract above. The engine writes the same coordinate to both. */
export const CLICK_RING = `    <div class="click-ring" data-el="ring" style="left:0; top:0;"></div>`;

/**
 * Which variant suits an interaction.
 *
 * Match the cursor to the action: a hand on a button, an I-beam on a field, a
 * fist when dragging. Switching mid-film is legitimate — what is not legitimate
 * is a silhouette whose hotspot the viewer cannot locate.
 */
export function variantFor(elementType: string): CursorVariant {
  switch (elementType) {
    case 'button':
    case 'badge':
      return 'pointer';
    case 'form':
      return 'ibeam';
    case 'card':
    case 'row':
      return 'default';
    default:
      return 'default';
  }
}
