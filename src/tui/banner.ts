/**
 * The splash banner.
 *
 * Kept as its own module so the art is one thing in one place: it is 54 columns
 * wide, and editing it inside a component is how a character gets lost and the
 * lettering shears.
 */

/**
 * Block-letter wordmark.
 *
 * Rows 3 and 4 are naturally two characters shorter — the `E` of URLUME ends without
 * a trailing box edge on those lines — so they are padded to a true rectangle at
 * load. Centring ragged rows shifts them by half the difference each, which shears
 * the lettering in a way that looks like a broken glyph rather than a design.
 */
const ART_RAW = String.raw`
██╗   ██╗██████╗ ██╗     ██╗   ██╗███╗   ███╗███████╗
██║   ██║██╔══██╗██║     ██║   ██║████╗ ████║██╔════╝
██║   ██║██████╔╝██║     ██║   ██║██╔████╔██║█████╗
██║   ██║██╔══██╗██║     ██║   ██║██║╚██╔╝██║██╔══╝
╚██████╔╝██║  ██║███████╗╚██████╔╝██║ ╚═╝ ██║███████╗
 ╚═════╝ ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝     ╚═╝╚══════╝
`;

const ART_ROWS = ART_RAW.split('\n').filter((row) => row.length > 0);

/**
 * The block, normalised to a rectangle with every row starting at column 0.
 *
 * Two separate raggednesses have to go, and both shear the lettering by a character
 * or two when the block is centred:
 *
 *   - rows 3 and 4 end early (the `E` has no trailing box edge on those lines)
 *   - the last row begins with a space (`╚═════╝` is inset under `╚██████╔╝`)
 *
 * So the common leading indent is removed and every row padded to the widest. The
 * inset on the final row is part of the glyph and is preserved by measuring the
 * *minimum* indent rather than trimming each row independently.
 */
const MIN_INDENT = Math.min(...ART_ROWS.map((row) => row.length - row.trimStart().length));

const ART_TRIMMED = ART_ROWS.map((row) => row.slice(MIN_INDENT));

/** Widest row — every row is padded to this, so the block is a rectangle. */
const ART_COLUMNS = Math.max(...ART_TRIMMED.map((row) => row.length));

const ART = ART_TRIMMED.map((row) => row.padEnd(ART_COLUMNS, ' '));

export const TAGLINE = 'URL → PRODUCT VIDEO';
export const BLURB = 'Turn any website into a beautiful AI-powered explainer video.';

/** Rows in the block art, for callers that need to reason about height. */
export const ART_HEIGHT = ART.length;

export interface BannerLine {
  text: string;
  tone: 'brand' | 'accent' | 'dim';
}

/**
 * The banner, centred for the current terminal.
 *
 * Falls back to plain text below 54 columns rather than printing art that wraps —
 * half a sheared block letter looks like a rendering fault, and a narrow terminal is
 * exactly where a first impression matters.
 */
export function banner(columns = process.stdout.columns ?? 80): BannerLine[] {
  const lines: BannerLine[] = [];

  // `centre` never returns a line wider than the terminal: a wrapped line would push
  // everything below it down by one and break the block just as badly as shearing.
  const centre = (text: string): string => {
    if (text.length >= columns) return text.slice(0, columns);
    return ' '.repeat(Math.floor((columns - text.length) / 2)) + text;
  };

  // The blurb is the longest single line, so it decides the compact threshold along
  // with the art — a terminal wide enough for the letters but not the sentence would
  // otherwise wrap the sentence.
  if (columns < ART_COLUMNS + 2) {
    lines.push({ text: 'URLUME', tone: 'brand' });
    lines.push({ text: TAGLINE, tone: 'accent' });
    lines.push({ text: '', tone: 'dim' });
    // Wrapped by the terminal if it must be, but never padded into wrapping.
    lines.push({ text: BLURB.slice(0, Math.max(0, columns)), tone: 'dim' });
    return lines;
  }

  const pad = ' '.repeat(Math.floor((columns - ART_COLUMNS) / 2));
  for (const row of ART) {
    // Padding is trimmed from the right only. Trimming the left would undo the
    // centring, and the final row's own leading space is part of its glyph.
    lines.push({ text: (pad + row).replace(/ +$/, ''), tone: 'brand' });
  }

  lines.push({ text: '', tone: 'dim' });
  lines.push({ text: centre(TAGLINE), tone: 'accent' });
  lines.push({ text: '', tone: 'dim' });
  lines.push({ text: centre(BLURB), tone: 'dim' });

  return lines;
}
