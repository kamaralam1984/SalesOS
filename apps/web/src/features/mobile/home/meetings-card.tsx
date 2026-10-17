'use client';
import * as React from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarClock, ExternalLink, Video } from 'lucide-react';
import { Badge } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { safeMeetingLink } from '@/features/work/attendance/attendance-logic';
import { useActiveMeetings, useJoinMeeting, type HomeMeeting } from '@/lib/api/hooks/meetings';

/**
 * Zoom meetings the company announced for this person (HR / Founder / Developer). Shown on the home page from the moment they are posted
 * until they end. This is separate from the daily meeting button in the attendance card.
 */
export function MeetingsCard() {
  const { can } = useAuth();
  if (!can('meetings:view')) return null;
  return <Inner />;
}

function Inner() {
  const t = useTranslations('meetings');
  const locale = useLocale();
  const { can } = useAuth();
  const q = useActiveMeetings();
  const join = useJoinMeeting();
  const items = q.data ?? [];
  if (items.length === 0) return null;
  const fmt = new Intl.DateTimeFormat(locale === 'en' ? 'en-IN' : locale, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  return (
    <section aria-label={t('homeTitle')} className="enter-up rounded-2xl border border-gold-300 bg-gold-50 p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink"><CalendarClock aria-hidden="true" className="size-5 text-gold-700" />{t('homeTitle')}</h2>
        {can('meetings:manage') && <Link href="/work/hr/meetings" className="text-sm font-medium text-blue-700 underline">{t('manage')}</Link>}
      </div>
      <ul className="space-y-3">
        {items.map((m: HomeMeeting) => {
          const link = safeMeetingLink(m.url);
          return (
            <li key={m.id} className="rounded-xl border border-line bg-surface p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 font-medium text-ink">{m.title}</p>
                <Badge tone={m.status === 'LIVE' ? 'green' : 'blue'}>{m.status === 'LIVE' ? t('live') : t('upcoming')}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted">{fmt.format(new Date(m.startsAt))} · {t('by', { name: m.createdByName })}</p>
              {m.note && <p className="mt-1 text-sm text-ink-700">{m.note}</p>}
              {link && (
                <a
                  href={link.href} target="_blank" rel="noopener noreferrer"
                  onClick={() => join.mutate(m.id)}
                  className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-blue-700 bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  <Video aria-hidden="true" className="size-4" />{t('join')}<ExternalLink aria-hidden="true" className="size-3.5 opacity-80" />
                </a>
              )}
              {m.joinedAt && <p className="mt-1 text-xs text-muted">{t('joinedAt', { time: new Intl.DateTimeFormat(locale === 'en' ? 'en-IN' : locale, { timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(m.joinedAt)) })}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
