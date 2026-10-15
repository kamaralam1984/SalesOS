'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ToastProvider, TooltipProvider } from '@salesos/ui';
import { ServiceWorkerRegister } from './sw-register';
import { ThemeProvider } from './theme/theme-provider';

export function Providers({ children }: { children: React.ReactNode }) {
  const t = useTranslations('common');
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={250}>
        <ToastProvider dismissLabel={t('dismiss')}>
          {children}
          <ServiceWorkerRegister />
        </ToastProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
