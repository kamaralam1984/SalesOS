import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { headers } from 'next/headers';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import { QueryProvider } from '@/lib/query-client';
import { Providers } from '@/components/providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'CoachEasily SalesOS', template: '%s · CoachEasily SalesOS' },
  description: 'Lead ownership, follow-up discipline and sales accountability for CoachEasily.',
  applicationName: 'SalesOS',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' }, { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: { capable: true, title: 'SalesOS', statusBarStyle: 'default' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#fbf8f2',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    // data-theme / data-theme-pref / style are set by the pre-paint script, so React must not flag the difference.
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* Sets the theme before first paint (no flash). Static string, CSP nonce from src/proxy.ts. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <QueryProvider>
            <Providers>{children}</Providers>
          </QueryProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
