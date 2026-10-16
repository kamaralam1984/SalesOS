'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CalendarPlus, PhoneCall } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-provider';

export function QuickActions() {
  const t = useTranslations('mobileActions');
  const { can } = useAuth();
  const canLog = can('leads:view');
  const base = 'inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl text-base font-semibold transition active:scale-[0.98]';
  return (
    <div className="flex flex-col gap-3">
      {canLog && (
      <Link href="/m/leads" className={`${base} glow-gold sheen bg-(image:--gold-gradient) text-on-gold border border-gold-600 hover:brightness-105`}>
        <PhoneCall className="size-5" aria-hidden="true" />{t('logCall')}
      </Link>
      )}
      <Link href="/m/calls" className={`${base} border border-gold-600 bg-surface text-gold-700 hover:bg-gold-50`}>
        <CalendarPlus className="size-5" aria-hidden="true" />{t('addFollowUp')}
      </Link>
    </div>
  );
}
