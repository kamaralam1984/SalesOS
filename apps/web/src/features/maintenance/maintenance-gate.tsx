'use client';

import * as React from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import { useFormatter, useTranslations } from 'next-intl';
import { Wrench } from 'lucide-react';
import { Button } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { useMaintenanceStatus } from '@/lib/api/hooks/devpanel-maintenance';

/** Window event fired by the api client when any call answers 503 MAINTENANCE. */
export const MAINTENANCE_EVENT = 'salesos:maintenance';

export function MaintenancePage({ message, eta, onCheck, checking, onSignOut }: { message: string | null; eta: string | null; onCheck: () => void; checking: boolean; onSignOut?: () => void }) {
  const t = useTranslations('developer.maintenance');
  const fmt = useFormatter();
  const reduce = useReducedMotion();
  return (
    <div role="alert" className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-canvas p-6">
      <motion.div
        className="w-full max-w-md text-center"
        initial={reduce ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduce ? 0 : 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.div
          className="mx-auto mb-6 flex size-16 items-center justify-center rounded-full bg-champagne-200/70 text-gold-600"
          animate={reduce ? undefined : { rotate: [0, -8, 8, 0] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
          aria-hidden="true"
        >
          <Wrench className="size-7" />
        </motion.div>
        <h1 className="text-2xl font-semibold text-ink">{t('pageTitle')}</h1>
        <p className="mt-3 text-base text-ink">{message || t('pageDefault')}</p>
        {eta && <p className="mt-2 text-sm text-ink-muted">{t('pageEta', { when: fmt.dateTime(new Date(eta), { dateStyle: 'medium', timeStyle: 'short' }) })}</p>}
        <p className="mt-6 text-xs text-ink-muted">{t('pageRetry')}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="secondary" onClick={onCheck} loading={checking} loadingLabel={t('pageChecking')}>{t('pageCheckNow')}</Button>
          {onSignOut && <Button variant="ghost" onClick={onSignOut}>{t('pageSignOut')}</Button>}
        </div>
      </motion.div>
    </div>
  );
}

/**
 * Wraps the signed-in app. Non-developers see a full-screen maintenance page while maintenance is ON (status poll or a 503 MAINTENANCE from any call);
 * developers see a thin banner instead. Fails open: if the status cannot be read, the app is shown.
 */
export function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const { can, logout } = useAuth();
  const t = useTranslations('developer.maintenance');
  const isDev = can('devpanel:access');
  const q = useMaintenanceStatus();
  const refetch = q.refetch;
  React.useEffect(() => {
    const h = () => void refetch();
    window.addEventListener(MAINTENANCE_EVENT, h);
    return () => window.removeEventListener(MAINTENANCE_EVENT, h);
  }, [refetch]);

  const s = q.data;
  const on = Boolean(s?.enabled);
  if (on && !isDev) {
    return <MaintenancePage message={s?.message ?? null} eta={s?.eta ?? null} onCheck={() => void refetch()} checking={q.isFetching} onSignOut={() => void logout('manual')} />;
  }
  return (
    <>
      {on && isDev && (
        <div role="status" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-red-300 bg-red-50 px-4 py-1.5 text-sm text-red-900">
          <span className="font-medium">{t('bannerText')}</span>
          <Link href="/admin/developer" className="underline underline-offset-2 hover:no-underline">{t('bannerLink')}</Link>
        </div>
      )}
      {children}
    </>
  );
}
