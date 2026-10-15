'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ErrorState, Skeleton } from '@salesos/ui';
import { AuthProvider, useAuth } from '@/features/auth/auth-provider';
import { IdleGuard } from '@/features/auth/idle-guard';
import { BrandMark } from '@/components/brand';
import { HintsProvider } from '@/features/hints/hints-provider';
import { RouteHintProvider } from '@/features/hints/hint-views';
import { MobileBottomNav } from './mobile-bottom-nav';

/**
 * Forces the dark tokens while the mobile preview is mounted. The ThemeProvider (a parent) re-applies the user's theme in
 * an effect that runs after this child effect on mount, so a one-off setAttribute is overwritten; an observer puts dark
 * back for as long as the frame is mounted. Nothing is written to storage/cookies; the previous theme is restored on exit.
 */
function useForcedDarkTheme() {
  React.useEffect(() => {
    const root = document.documentElement;
    const prevTheme = root.getAttribute('data-theme');
    const prevScheme = root.style.colorScheme;
    const force = () => {
      if (root.getAttribute('data-theme') !== 'dark') root.setAttribute('data-theme', 'dark');
      if (root.style.colorScheme !== 'dark') root.style.colorScheme = 'dark';
    };
    force();
    const observer = new MutationObserver(force);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    return () => {
      observer.disconnect();
      if (prevTheme === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', prevTheme);
      root.style.colorScheme = prevScheme;
    };
  }, []);
}

function FullScreenLoading() {
  const t = useTranslations('common');
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-canvas"
    >
      <BrandMark className="size-12" />
      <div className="w-56 space-y-2" aria-hidden="true">
        <Skeleton className="h-2.5 w-full" />
        <Skeleton className="h-2.5 w-2/3" />
      </div>
      <span className="sr-only">{t('loading')}</span>
    </div>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  const { status, refresh, error, user } = useAuth();
  const t = useTranslations('errors');
  const ts = useTranslations('mobileShell');
  if (status === 'loading' || status === 'unauthenticated') return <FullScreenLoading />;
  if (status === 'error') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas p-4">
        <ErrorState
          title={t('sessionLoadTitle')}
          description={t('sessionLoadDescription')}
          retryLabel={t('retry')}
          onRetry={() => void refresh()}
          requestId={
            error && 'requestId' in error ? (error.requestId as string | undefined) : undefined
          }
        />
      </div>
    );
  }
  return (
    <HintsProvider userId={user?.id}>
      <RouteHintProvider>
        <div className="min-h-dvh bg-canvas text-ink">
          <div className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col bg-canvas md:border-x md:border-line">
            <main
              id="main"
              aria-label={ts('appName')}
              className="flex-1 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[calc(6rem+env(safe-area-inset-bottom))]"
            >
              {children}
            </main>
            <MobileBottomNav />
          </div>
        </div>
        <IdleGuard />
      </RouteHintProvider>
    </HintsProvider>
  );
}

export function MobileFrame({ children }: { children: React.ReactNode }) {
  useForcedDarkTheme();
  return (
    <AuthProvider>
      <Gate>{children}</Gate>
    </AuthProvider>
  );
}
