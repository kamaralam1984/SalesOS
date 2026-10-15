'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CalendarPlus, Phone } from 'lucide-react';

export function QuickActions() {
  const t = useTranslations('mobileActions');
  const base = 'inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-xl text-base font-semibold transition active:scale-[0.98]';
  return (
    <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
      <Link href="/m/leads" className={`${base} glow-gold sheen bg-(image:--gold-gradient) text-on-gold border border-gold-600 hover:brightness-105`}>
        <Phone className="size-5" aria-hidden="true" />{t('logCall')}
      </Link>
      <Link href="/m/calls" className={`${base} border border-gold-500 text-gold-500 hover:bg-gold-500/10`}>
        <CalendarPlus className="size-5" aria-hidden="true" />{t('addFollowUp')}
      </Link>
    </div>
  );
}
