/**
 * The CLI surface, as data.
 *
 * Kept here rather than inline in the components so the page and the tool can
 * be reconciled by reading two lists side by side. Every entry below is a real
 * flag from `videoai --help`.
 */

export interface Row {
  readonly name: string;
  readonly detail: string;
}

export const SUBCOMMANDS: readonly Row[] = [
  {
    name: 'videoai create <url>',
    detail: 'The whole pipeline: analyse → storyboard → compile → MP4.',
  },
  {
    name: 'videoai storyboard <url>',
    detail:
      'Generate and validate a storyboard, then stop — review before spending render time.',
  },
  { name: 'videoai check <file>', detail: 'Run the craft rules against a saved storyboard.' },
  { name: 'videoai render <film>', detail: 'Render an already-compiled film to MP4.' },
  {
    name: 'videoai providers',
    detail: 'Show configured providers and where each key came from.',
  },
  { name: 'videoai models', detail: 'List every model reachable with the configured keys.' },
  { name: 'videoai config', detail: 'Store a provider key, model, base URL or header.' },
  {
    name: 'videoai skills [name] [section]',
    detail: 'List the craft library, or read one section of one skill.',
  },
  { name: 'videoai doctor', detail: 'Check Chromium, ffmpeg and API keys.' },
];

export interface Flag {
  readonly flag: string;
  readonly values: string;
  readonly note: string;
}

export const CREATE_FLAGS: readonly Flag[] = [
  { flag: '--prompt', values: 'text', note: 'What you want, in your own words.' },
  {
    flag: '--duration',
    values: 'seconds',
    note: 'Target length. Scene count and pacing follow from it.',
  },
  {
    flag: '--aspect',
    values: '16:9 · 9:16 · 1:1 · 4:5',
    note: 'Re-composition, not a crop of the 16:9 cut.',
  },
  {
    flag: '--preset',
    values: 'apple · light · midnight · warm · mono',
    note: "Overrides the preset derived from the site's own scheme and accent hue.",
  },
  {
    flag: '--quality',
    values: 'draft · high · master',
    note: 'Encoder effort. Use draft while iterating.',
  },
  { flag: '--draft', values: '—', note: 'Shorthand for --quality draft.' },
  { flag: '--out', values: 'file', note: 'MP4 output path.' },
  {
    flag: '--no-audio',
    values: '—',
    note: 'Silent MP4. Broadcast delivery still requires a track, even a silent one.',
  },
  {
    flag: '--provider',
    values: 'anthropic · openai · gemini · mistral · custom',
    note: 'Overrides the configured default.',
  },
  { flag: '--model', values: 'model id', note: 'Defaults per provider.' },
  { flag: '--route', values: 'path...', note: 'Analyse these routes instead of crawling.' },
  {
    flag: '--no-cache',
    values: '—',
    note: 'Re-analyse rather than reusing the cached capture.',
  },
];

export const SLASH: readonly Row[] = [
  { name: '<url> [prompt]', detail: 'Make a film.' },
  { name: '/key <key>', detail: 'Store an API key.' },
  { name: '/provider <id>', detail: 'anthropic, openai, gemini, mistral, custom.' },
  { name: '/model <id> · /models', detail: 'Choose a model, or list reachable ones.' },
  { name: '/seconds <n> · /aspect <r>', detail: 'Length, and 16:9 / 9:16 / 1:1 / 4:5.' },
  { name: '/quality <q> · /draft', detail: 'draft, high, master.' },
  { name: '/save [path] · /open', detail: 'Keep the render, or watch it.' },
  { name: '/doctor · /status · /help', detail: 'Environment, current settings, command list.' },
];

export const PROVIDER_KEYS: readonly Row[] = [
  { name: 'anthropic', detail: 'ANTHROPIC_API_KEY' },
  { name: 'openai', detail: 'OPENAI_API_KEY' },
  { name: 'gemini', detail: 'GEMINI_API_KEY' },
  { name: 'mistral', detail: 'MISTRAL_API_KEY' },
];
