'use client';
import * as React from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Bell, Check, OctagonAlert, X } from 'lucide-react';
import { Badge, Button, cn } from '@salesos/ui';
import type { NotificationDto } from '@/lib/api/hooks/platform';
import { useNotificationText } from './type-text';

/** Same-origin paths only: a server-provided link can never navigate off-site. */
export const safeHref = (u: string | null): string | null => (u && u.startsWith('/') && !u.startsWith('//') ? u : null);

export function useRelativeTime() {
  const locale = useLocale();
  return React.useMemo(() => {
    const rtf = new Intl.RelativeTimeFormat(locale === 'en' ? 'en-IN' : locale, { numeric: 'auto' });
    return (iso: string) => {
      const diff = (new Date(iso).getTime() - Date.now()) / 1000;
      const abs = Math.abs(diff);
      if (abs < 60) return rtf.format(Math.round(diff), 'second');
      if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
      if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
      return rtf.format(Math.round(diff / 86400), 'day');
    };
  }, [locale]);
}

const sev = {
  INFO: { Icon: Bell, tone: 'blue' as const },
  WARNING: { Icon: AlertTriangle, tone: 'gold' as const },
  CRITICAL: { Icon: OctagonAlert, tone: 'red' as const },
};

export function NotificationItem({
  n,
  onRead,
  onDismiss,
  compact = false,
}: {
  n: NotificationDto;
  onRead: (id: string) => void;
  onDismiss?: (id: string) => void;
  compact?: boolean;
}) {
  const t = useTranslations('platform.notifications');
  const text = useNotificationText();
  const rel = useRelativeTime();
  const href = safeHref(n.actionUrl);
  const { Icon, tone } = sev[n.severity];
  const unread = n.status === 'UNREAD';
  return (
    <li className={cn(
        'flex gap-3 px-3 py-3 transition-[background-color,box-shadow] duration-300 hover:bg-ivory-100/70 motion-reduce:transition-none',
        unread && 'bg-gold-50/60 [box-shadow:inset_3px_0_0_var(--color-gold-500,#b8892f),inset_14px_0_18px_-14px_var(--tone-glow-gold,transparent)]',
        unread && n.severity === 'CRITICAL' && '[box-shadow:inset_3px_0_0_var(--color-red-600,#b42318)]',
      )} data-testid="notification-item" data-status={n.status}>
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-ink-600">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className={cn('break-words', unread ? 'font-semibold text-ink' : 'text-ink-700')}>{text.title(n)}</span>
          {unread && <Badge tone="gold">{t('new')}</Badge>}
          {n.severity !== 'INFO' && <Badge tone={tone}>{t(`severity.${n.severity}`)}</Badge>}
          {n.occurrences > 1 && <Badge tone="neutral">{t('times', { count: n.occurrences })}</Badge>}
        </p>
        {n.body && !compact && <p className="mt-0.5 text-[0.8125rem] text-muted">{n.body}</p>}
        <p className="mt-1 text-xs text-muted">
          <time dateTime={n.lastRaisedAt}>{rel(n.lastRaisedAt)}</time>
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {href && (
            <Button asChild size="sm" variant="secondary">
              <Link href={href} onClick={() => unread && onRead(n.id)}>
                {t('open')}
              </Link>
            </Button>
          )}
          {unread && (
            <Button size="sm" variant="ghost" onClick={() => onRead(n.id)} leadingIcon={<Check aria-hidden="true" className="size-4" />}>
              {t('markRead')}
            </Button>
          )}
          {onDismiss && !compact && (
            <Button size="sm" variant="ghost" onClick={() => onDismiss(n.id)} leadingIcon={<X aria-hidden="true" className="size-4" />}>
              {t('dismiss')}
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}
