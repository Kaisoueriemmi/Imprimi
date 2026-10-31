import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import { Noto_Sans_Arabic } from 'next/font/google';
import type { ReactNode } from 'react';
import { isRtl, type Locale } from '@/i18n/locales';
import './globals.css';

/** Self-hosted at build time by next/font: no request to Google from the customer's phone. */
const notoArabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '600', '700'],
  variable: '--font-noto-arabic',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'PrintBox',
  description: 'Impression en libre-service',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f172a',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = (await getLocale()) as Locale;
  return (
    <html lang={locale} dir={isRtl(locale) ? 'rtl' : 'ltr'} className={notoArabic.variable}>
      <body
        className={`min-h-dvh bg-slate-50 text-slate-900 antialiased ${isRtl(locale) ? 'font-arabic' : ''}`}
      >
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
