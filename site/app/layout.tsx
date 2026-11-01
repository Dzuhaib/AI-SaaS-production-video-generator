import type { Metadata, Viewport } from 'next';
import { Instrument_Sans, JetBrains_Mono, Sora } from 'next/font/google';
import './globals.css';

const display = Sora({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
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
  title: 'Urlume — your website, turned into a product film',
  description:
    'Paste a URL. Urlume writes the story and renders a captioned, broadcast-ready product film. No editor, no timeline.',
  applicationName: 'Urlume',
  keywords: ['AI video', 'product film', 'SaaS', 'explainer', 'CLI', 'H.264'],
  openGraph: {
    title: 'Urlume — your website, turned into a product film',
    description:
      'A URL goes in; a broadcast-ready film comes out. Open source, model-agnostic, one command.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
  colorScheme: 'light',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${text.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <div className="page-orb" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
