'use client';
import * as React from 'react';
import { WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useOnline } from './use-online';

export function OfflineBanner() {
  const online = useOnline();
  const t = useTranslations('shell');
  return (
    <div role="status" aria-live="polite">
      {!online && (
        <div className="flex items-center justify-center gap-2 border-b border-gold-300 bg-gold-50 px-4 py-2 text-center text-[0.8125rem] font-medium text-gold-700">
          <WifiOff aria-hidden="true" className="size-4 shrink-0" />
          <span>{t('offline')}</span>
        </div>
      )}
    </div>
  );
}
