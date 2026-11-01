import type { Metadata, Viewport } from 'next';
import { Instrument_Sans, Instrument_Serif, JetBrains_Mono } from 'next/font/google';
import './globals.css';

/**
 * Three roles, three faces, chosen as an editorial set rather than a stack.
 *
 * Instrument Serif carries the display voice — a high-contrast, narrow-waisted
 * serif that reads like a title card, with the italic reserved for the one word
 * in a headline that deserves it. Instrument Sans is its matching grotesque for
 * running text, and JetBrains Mono carries every command, timecode and spec,
 * because on this page those are evidence rather than decoration.
 *
 * `next/font` self-hosts and preloads all three: no third-party request, no
 * flash of fallback.
 */
const display = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});

const text = Instrument_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-text',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Urlume — your website, rendered as a film',
  description:
    'Point Urlume at a URL. It reads the live site, writes a storyboard and renders a broadcast-legal product film — captions, measured loudness and a photosensitivity report included.',
  applicationName: 'Urlume',
  keywords: ['AI video', 'product film', 'SaaS', 'explainer', 'CLI', 'H.264'],
  openGraph: {
    title: 'Urlume — your website, rendered as a film',
    description:
      'An AI video agent for SaaS. A URL goes in; a broadcast-legal film comes out. No timeline, no footage, no editor.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#0b0a09',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${text.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <div className="ambient" aria-hidden="true" />
        {children}
        <div className="grain" aria-hidden="true" />
      </body>
    </html>
  );
}
