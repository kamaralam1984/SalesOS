'use client';
import { useTranslations } from 'next-intl';
import { Lock } from 'lucide-react';
import { Badge } from '@salesos/ui';
import { toneFor, useFormatDate } from '../hub/shared';
import type { OneOnOne } from './api';

/** A 1:1 record. Manager-private notes render ONLY for the manager who wrote them (the API also withholds them). */
export function OneOnOneCard({ item, meId }: { item: OneOnOne; meId: string | undefined }) {
  const t = useTranslations('coaching');
  const fmt = useFormatDate();
  const isManager = item.managerId === meId;
  return (
    <article className="hover-lift rounded-lg border border-line bg-surface p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-semibold text-ink">
            {isManager ? t('oneOnOnes.withEmployee', { name: item.employeeName ?? '—' }) : t('oneOnOnes.withManager', { name: item.managerName ?? '—' })}
          </h2>
          <p className="text-sm text-muted">
            {fmt.dateTime(item.scheduledFor)} · {t('minutes', { n: item.durationMin })}
          </p>
        </div>
        <Badge tone={toneFor(item.status)}>{t(`oneStatus.${item.status}` as never)}</Badge>
      </header>
      {item.agenda && (
        <p className="mt-3 text-sm">
          <span className="font-medium text-ink">{t('oneOnOnes.agenda')}: </span>
          {item.agenda}
        </p>
      )}
      {item.sharedNotes && (
        <div className="mt-3">
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{t('oneOnOnes.sharedNotes')}</h3>
          <p className="text-sm whitespace-pre-wrap text-ink">{item.sharedNotes}</p>
        </div>
      )}
      {isManager && item.privateNotes && (
        <div className="mt-3 rounded-md border border-gold-300 bg-gold-50 p-3" data-testid="private-notes">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-gold-700 uppercase">
            <Lock aria-hidden="true" className="size-3.5" />
            {t('oneOnOnes.privateNotes')}
          </h3>
          <p className="text-sm whitespace-pre-wrap text-ink">{item.privateNotes}</p>
        </div>
      )}
      {item.actions.length > 0 && (
        <ul className="mt-3 divide-y divide-line text-sm" aria-label={t('tabs.actions')}>
          {item.actions.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span>
                {a.title} <span className="text-muted">· {a.ownerName ?? '—'} · {fmt.date(a.dueDate)}</span>
              </span>
              <Badge tone={toneFor(a.status)}>{t(`status.${a.status}` as never)}</Badge>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
