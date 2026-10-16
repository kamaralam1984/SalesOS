'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ErrorState, Skeleton } from '@salesos/ui';
import { AuthProvider, useAuth } from './auth-provider';
import { IdleGuard } from './idle-guard';
import { AppShell } from '@/components/shell/app-shell';
import { BrandMark } from '@/components/brand';
import { PhoneRedirect } from '@/features/mobile/phone-redirect';
import { HintsProvider } from '@/features/hints/hints-provider';
import { RouteHintProvider } from '@/features/hints/hint-views';
import { MaintenanceGate } from '@/features/maintenance/maintenance-gate';

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
        <AppShell>
          <MaintenanceGate>{children}</MaintenanceGate>
          <PhoneRedirect />
          <IdleGuard />
        </AppShell>
      </RouteHintProvider>
    </HintsProvider>
  );
}

export function AppFrame({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <Gate>{children}</Gate>
    </AuthProvider>
  );
}
