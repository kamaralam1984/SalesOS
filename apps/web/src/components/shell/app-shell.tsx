'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Sidebar } from './sidebar';
import { BottomNav } from './bottom-nav';
import { TopBar } from './top-bar';
import { Reveal } from './motion';
import { OfflineBanner } from './offline-banner';

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('shell');
  return (
    <div className="min-h-dvh md:pl-[var(--sidebar-w)]">
      <a
        href="#main"
        className="sr-only z-[70] rounded-md bg-inverse px-4 py-2 text-sm font-medium text-on-inverse focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {t('skipToContent')}
      </a>
      <Sidebar />
      <div className="flex min-h-dvh flex-col">
        <OfflineBanner />
        <TopBar />
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1320px] flex-1 px-4 pt-6 pb-[calc(var(--bottomnav-h)+2.5rem)] outline-none md:px-8 md:pt-9 md:pb-14"
        >
          <Reveal y={8}>{children}</Reveal>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
