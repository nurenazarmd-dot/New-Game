import type {Metadata, Viewport} from 'next';
import {Outfit, Plus_Jakarta_Sans, JetBrains_Mono} from 'next/font/google';
import Script from 'next/script';
import './globals.css';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-display',
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['500', '700'],
  variable: '--font-mono',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#030308',
};

export const metadata: Metadata = {
  title: 'Synapse Weaver',
  description:
    'A minimalist one-tap cyberpunk neural orbital rhythm-action game optimized for YouTube Playables.',
  openGraph: {
    title: 'Synapse Weaver',
    description:
      'A minimalist one-tap cyberpunk neural orbital rhythm-action game optimized for YouTube Playables.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Synapse Weaver',
    description:
      'A minimalist one-tap cyberpunk neural orbital rhythm-action game optimized for YouTube Playables.',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${jakarta.variable} ${jetbrainsMono.variable} dark`}
    >
      <head>
        <Script
          src="https://www.youtube.com/game_api/v1"
          strategy="beforeInteractive"
        />
      </head>
      <body
        suppressHydrationWarning
        className="bg-[#030308] text-slate-100 antialiased selection:bg-cyan-500/30 selection:text-cyan-200 overflow-hidden select-none"
      >
        {children}
      </body>
    </html>
  );
}
