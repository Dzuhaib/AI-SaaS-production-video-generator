/**
 * Delivery standards and pipeline stages, as data.
 *
 * These figures are the ones the encoder, the compiler and the caption writer
 * all read. Where the US and UK numbers differ they are both kept rather than
 * averaged — a film delivered at −23 LUFS to a US network is 1 LU hot for
 * ATSC A/85.
 */

export interface Profile {
  readonly id: string;
  readonly cadence: string;
  readonly loudness: string;
  readonly truePeak: string;
  readonly standard: string;
  readonly gloss: string;
}

export const PROFILES: readonly Profile[] = [
  {
    id: 'web',
    cadence: 'any',
    loudness: '−14 LUFS',
    truePeak: '−1 dBTP',
    standard: 'Streaming normalisation',
    gloss: 'YouTube, Meta, Spotify',
  },
  {
    id: 'social',
    cadence: 'any',
    loudness: '−14 LUFS',
    truePeak: '−1 dBTP',
    standard: 'Feed normalisation',
    gloss: 'tighter range for phone speakers',
  },
  {
    id: 'broadcast-uk',
    cadence: '25 fps',
    loudness: '−23 LUFS',
    truePeak: '−1 dBTP',
    standard: 'EBU R128',
    gloss: 'what Ofcom expects of UK broadcasters',
  },
  {
    id: 'broadcast-us',
    cadence: '29.97 fps',
    loudness: '−24 LKFS',
    truePeak: '−2 dBTP',
    standard: 'ATSC A/85',
    gloss: 'mandated by the CALM Act 2010',
  },
];

export const FRAME_RATES = '23.976 · 24 · 25 · 29.97 · 30 · 50 · 59.94 · 60';

export interface Stage {
  readonly n: string;
  readonly title: string;
  /** One line for the landing page, where the full body would be a wall. */
  readonly short: string;
  readonly body: string;
  readonly note: string;
}

export const STAGES: readonly Stage[] = [
  {
    n: '01',
    title: 'Crawl',
    short:
      'Finds the routes worth filming and drops legal pages, anything behind auth, and off-origin links.',
    body: 'Discovers routes from the entry URL and drops the ones no film needs — legal pages, anything behind auth, off-origin links.',
    note: 'Navigation commits rather than waiting for the DOM, because a single slow third-party script used to cost the whole crawl.',
  },
  {
    n: '02',
    title: 'Analyse',
    short:
      'Ranks every element, then lifts accent, type, radius, scheme and the logo straight out of the live DOM.',
    body: 'Ranks every element by prominence, then reads the brand out of the live DOM: accent colour, display and text faces, corner radius, colour scheme, and the logo as inline SVG. A separate pass reads feature cards, plan bullets, metrics with labels, quotes and CTAs by DOM shape.',
    note: 'Ranking alone finds the hero and the nav and never the feature grid — which is how a film ends up describing a problem and never showing the product.',
  },
  {
    n: '03',
    title: 'Storyboard',
    short:
      'The model returns JSON and nothing else — validated against a schema and 13 craft rules, repaired or re-asked.',
    body: 'The model returns JSON and nothing else. It is validated against the schema, then against 13 craft rules. Fixable violations are repaired in place; structural ones are re-asked with the failure attached.',
    note: 'Craft rules run before the compile. A storyboard that fails an error-level rule must never reach the renderer.',
  },
  {
    n: '04',
    title: 'Compile',
    short:
      'JSON becomes a self-contained film: markup, one clock, brand tokens, layouts, inlined icons, caption sidecars.',
    body: 'JSON becomes a self-contained film: markup, a timeline driven from a single clock, the brand as custom properties, per-scene layouts, inlined icons and glass filters. Caption sidecars are written here.',
    note: 'No network fetches at runtime — films load over file://, so every asset is inlined or copied.',
  },
  {
    n: '05',
    title: 'Render',
    short:
      'Chromium is seeked and screenshotted frame by frame, never recorded, then encoded and loudness-normalised.',
    body: 'Chromium is seeked to each frame and screenshotted, never recorded in real time, so a slow machine changes the wall clock and not the result. ffmpeg encodes to H.264, normalises loudness to the delivery target and muxes AAC.',
    note: 'Photosensitivity is measured on the encoded file, so what gets assessed is what actually ships.',
  },
];

export interface Skill {
  readonly name: string;
  readonly gloss: string;
}

export const SKILLS: readonly Skill[] = [
  { name: 'saas-explainer-motion', gloss: 'the engine, the beat sheet, material rules' },
  { name: 'storyboard-schema', gloss: 'JSON as the only output; repair vs re-ask' },
  { name: 'ui-mockup-rebuild', gloss: 'rebuilding UI from glass components' },
  { name: 'brand-extraction', gloss: 'a brand system from a live DOM' },
  { name: 'kinetic-typography', gloss: 'film-scale type, masked reveals' },
  { name: 'data-viz-motion', gloss: 'counters, chart reveals, the one-number rule' },
  { name: 'device-mockups', gloss: 'browser, laptop and phone chrome' },
  { name: 'playwright-deterministic-capture', gloss: 'the seek-and-screenshot loop' },
  { name: 'ffmpeg-video-encoding', gloss: 'flag-by-flag encode reasoning' },
  { name: 'threejs-in-video', gloss: 'real 3D driven from t, and when not to' },
  { name: 'svg-shape-morphing', gloss: 'path morphing and its cheaper alternatives' },
  { name: 'css-animations', gloss: 'technique, and when to reach for JS' },
  { name: 'framer-motion', gloss: 'React animation patterns' },
  { name: 'motion-audio', gloss: 'music selection, licensing, sourcing' },
  { name: 'voiceover-narration', gloss: 'whether to narrate; writing to a beat' },
  { name: 'vertical-social-reformat', gloss: '9:16, 4:5, 1:1 as re-composition' },
];
