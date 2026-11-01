/**
 * The icon set.
 *
 * Inlined SVG paths, not a CDN link and not an icon font. Films load over
 * `file://` and §19.5 lists runtime network fetches as knowingly unguarded: an
 * icon fetched at render time is a race the export loses silently, producing a
 * frame with a missing glyph and no error anywhere. So the geometry lives here and
 * is emitted into the document.
 *
 * These are drawn on a 24x24 grid with a 2px stroke and no fill, so every icon
 * inherits `currentColor` and the brand accent applies to all of them at once.
 * Nothing here is specific to any industry — `resolveIcon` maps whatever words a
 * model or a website supplies onto the closest shape, and the vocabulary is
 * deliberately generic enough to cover a channel, a metric, a state or an action.
 */

export type IconName =
  // channels and comms
  | 'message'
  | 'chat'
  | 'mail'
  | 'phone'
  | 'video'
  | 'send'
  | 'bell'
  | 'inbox'
  // people
  | 'user'
  | 'users'
  | 'user-check'
  // time
  | 'clock'
  | 'calendar'
  | 'zap'
  // state
  | 'check'
  | 'check-circle'
  | 'x-circle'
  | 'alert'
  | 'star'
  | 'heart'
  // data
  | 'chart'
  | 'trending-up'
  | 'trending-down'
  | 'target'
  | 'activity'
  // commerce
  | 'cart'
  | 'card'
  | 'tag'
  | 'gift'
  | 'dollar'
  // objects
  | 'file'
  | 'folder'
  | 'database'
  | 'server'
  | 'cloud'
  | 'box'
  | 'truck'
  // tools
  | 'search'
  | 'filter'
  | 'settings'
  | 'sliders'
  | 'code'
  | 'terminal'
  | 'link'
  | 'lock'
  | 'shield'
  | 'key'
  // motion
  | 'refresh'
  | 'arrow-right'
  | 'arrow-up-right'
  | 'play'
  | 'plus'
  // domain-flavoured but generic
  | 'bot'
  | 'sparkles'
  | 'globe'
  | 'map-pin'
  | 'building'
  | 'briefcase'
  | 'graduation'
  | 'stethoscope'
  | 'pill'
  | 'dumbbell'
  | 'scissors'
  | 'camera'
  | 'music'
  | 'book'
  | 'wrench'
  | 'leaf';

/** Path data only — the wrapper adds sizing, stroke and colour. */
const PATHS: Record<IconName, string> = {
  message: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z',
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M22 6l-10 7L2 6',
  phone: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z',
  video: 'M23 7l-7 5 7 5V7z M14 5H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z',
  send: 'M22 2L11 13 M22 2l-7 20-4-9-9-4 20-7z',
  bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2 M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  'user-check': 'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M17 11l2 2 4-4',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2',
  calendar: 'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z M16 2v4 M8 2v4 M3 10h18',
  zap: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  check: 'M20 6L9 17l-5-5',
  'check-circle': 'M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4L12 14.01l-3-3',
  'x-circle': 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M15 9l-6 6 M9 9l6 6',
  alert: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01',
  star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  heart: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l8.84 8.84 8.84-8.84a5.5 5.5 0 0 0 0-7.78z',
  chart: 'M18 20V10 M12 20V4 M6 20v-6',
  'trending-up': 'M23 6l-9.5 9.5-5-5L1 18 M17 6h6v6',
  'trending-down': 'M23 18l-9.5-9.5-5 5L1 6 M17 18h6v-6',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  cart: 'M9 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M20 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6',
  card: 'M21 4H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z M1 10h22',
  tag: 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z M7 7h.01',
  gift: 'M20 12v10H4V12 M2 7h20v5H2z M12 22V7 M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z',
  dollar: 'M12 1v22 M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  file: 'M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M13 2v7h7',
  folder: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  database: 'M12 8c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3z M21 12c0 1.66-4 3-9 3s-9-1.34-9-3 M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5',
  server: 'M20 2H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z M20 14H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2z M6 6h.01 M6 18h.01',
  cloud: 'M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z',
  box: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.27 6.96L12 12.01l8.73-5.05 M12 22.08V12',
  truck: 'M1 3h15v13H1z M16 8h4l3 3v5h-7V8z M5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.35-4.35',
  filter: 'M22 3H2l8 9.46V19l4 2v-8.54L22 3z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  sliders: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
  code: 'M16 18l6-6-6-6 M8 6l-6 6 6 6',
  terminal: 'M4 17l6-6-6-6 M12 19h8',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  lock: 'M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z M7 11V7a5 5 0 0 1 10 0v4',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  key: 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3',
  refresh: 'M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0 1 14.85-3.36L23 10 M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
  'arrow-right': 'M5 12h14 M12 5l7 7-7 7',
  'arrow-up-right': 'M7 17L17 7 M7 7h10v10',
  play: 'M5 3l14 9-14 9V3z',
  plus: 'M12 5v14 M5 12h14',
  bot: 'M12 8V4H8 M16 8H8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2z M2 14h2 M20 14h2 M15 13v2 M9 13v2',
  sparkles: 'M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2L12 3z M19 3v4 M17 5h4',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M2 12h20 M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  'map-pin': 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  building: 'M3 21h18 M5 21V7l8-4v18 M19 21V11l-6-4 M9 9h.01 M9 13h.01 M9 17h.01',
  briefcase: 'M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16',
  graduation: 'M22 10L12 5 2 10l10 5 10-5z M6 12v5c0 1.66 2.69 3 6 3s6-1.34 6-3v-5',
  stethoscope: 'M4 2v6a4 4 0 0 0 8 0V2 M8 12v3a5 5 0 0 0 10 0v-2 M18 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  pill: 'M10.5 20.5a5 5 0 0 1-7-7l7-7a5 5 0 0 1 7 7l-7 7z M8.5 8.5l7 7',
  dumbbell: 'M6.5 6.5l11 11 M21 21l-1-1 M3 3l1 1 M18 22l4-4 M2 6l4-4 M3 10l7-7 M14 21l7-7',
  scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M20 4L8.12 15.88 M14.47 14.48L20 20 M8.12 8.12L12 12',
  camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  music: 'M9 18V5l12-2v13 M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
  wrench: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
  leaf: 'M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z M2 21c0-3 1.85-5.36 2.99-6',
};

export const ICON_NAMES = Object.keys(PATHS) as IconName[];

/**
 * Synonyms, so a model or a website's own wording lands on a real shape.
 *
 * Deliberately not industry-specific: the map is about *meaning*, and covers
 * whatever vocabulary a brand happens to use for a channel, a metric, or a state.
 * A miss falls back to a neutral shape rather than emitting nothing.
 */
const SYNONYMS: Record<string, IconName> = {
  whatsapp: 'message', messenger: 'chat', instagram: 'camera', facebook: 'chat',
  telegram: 'send', sms: 'message', text: 'message', dm: 'message',
  email: 'mail', call: 'phone', voice: 'phone', mobile: 'phone',
  notification: 'bell', alert: 'alert', reminder: 'bell',
  customer: 'user', client: 'user', patient: 'user', lead: 'user-check',
  team: 'users', staff: 'users', agent: 'bot', ai: 'sparkles', assistant: 'bot',
  automation: 'zap', instant: 'zap', fast: 'zap', speed: 'zap', realtime: 'activity',
  booking: 'calendar', appointment: 'calendar', schedule: 'calendar', slot: 'clock',
  time: 'clock', hours: 'clock', '24/7': 'clock', availability: 'calendar',
  done: 'check-circle', success: 'check-circle', resolved: 'check-circle',
  complete: 'check', failed: 'x-circle', missed: 'x-circle', lost: 'trending-down',
  growth: 'trending-up', increase: 'trending-up', revenue: 'dollar',
  sales: 'trending-up', conversion: 'target', roi: 'chart', metrics: 'chart',
  analytics: 'chart', report: 'chart', dashboard: 'activity', kpi: 'target',
  payment: 'card', billing: 'card', pricing: 'tag', checkout: 'cart',
  order: 'cart', product: 'box', inventory: 'box', shipping: 'truck',
  delivery: 'truck', document: 'file', invoice: 'file', contract: 'file',
  storage: 'database', data: 'database', api: 'code', integration: 'link',
  developer: 'terminal', deploy: 'server', infrastructure: 'server',
  security: 'shield', privacy: 'lock', compliance: 'shield', auth: 'key',
  encryption: 'lock', sync: 'refresh', workflow: 'refresh', pipeline: 'activity',
  location: 'map-pin', clinic: 'stethoscope', hospital: 'stethoscope',
  medical: 'stethoscope', health: 'heart', pharmacy: 'pill', fitness: 'dumbbell',
  gym: 'dumbbell', salon: 'scissors', beauty: 'sparkles', restaurant: 'gift',
  school: 'graduation', education: 'graduation', course: 'book',
  legal: 'briefcase', finance: 'dollar', realestate: 'building',
  property: 'building', agency: 'briefcase', service: 'wrench',
  maintenance: 'wrench', sustainability: 'leaf', review: 'star',
  rating: 'star', favourite: 'heart', favorite: 'heart', search: 'search',
  filter: 'filter', settings: 'settings', config: 'sliders', web: 'globe',
  website: 'globe', online: 'globe', chat: 'chat', message: 'message',
};

/**
 * Best icon for an arbitrary label.
 *
 * Exact name, then synonym, then a substring scan so "WhatsApp · 11:48 PM" still
 * finds `message`. Longest synonym first, so `realestate` is not shadowed by a
 * shorter partial match.
 */
export function resolveIcon(label: string | undefined, fallback: IconName = 'box'): IconName {
  if (!label) return fallback;
  const key = label.toLowerCase().trim();

  if (key in PATHS) return key as IconName;
  if (key in SYNONYMS) return SYNONYMS[key]!;

  const compact = key.replace(/[^a-z0-9/]+/g, '');
  if (compact in SYNONYMS) return SYNONYMS[compact]!;

  const words = Object.keys(SYNONYMS).sort((a, b) => b.length - a.length);
  for (const word of words) {
    if (key.includes(word)) return SYNONYMS[word]!;
  }
  for (const name of ICON_NAMES.sort((a, b) => b.length - a.length)) {
    if (key.includes(name)) return name;
  }
  return fallback;
}

/** One icon as inline SVG. `currentColor` so the accent reaches it via CSS. */
export function iconSvg(name: IconName, size = 24, extraClass = ''): string {
  const path = PATHS[name] ?? PATHS.box;
  const cls = `icon icon-${name}${extraClass ? ` ${extraClass}` : ''}`;
  const segments = path
    .split(' M')
    .map((d, i) => (i === 0 ? d : `M${d}`))
    .map((d) => `<path d="${d}"/>`)
    .join('');

  return `<svg class="${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${segments}</svg>`;
}
