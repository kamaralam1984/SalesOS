'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Bell } from 'lucide-react';
import { Button, Popover, PopoverContent, PopoverTrigger, Skeleton, cn } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { useNotificationActions, useRecentNotifications, useUnreadCount } from '@/lib/api/hooks/platform';
import { NotificationItem } from './notification-item';
import { useNotificationStream } from './use-notification-stream';

/** Top-bar bell: live unread count (SSE with polling fallback) and a dropdown with the latest notifications. */
export function NotificationBell() {
  const t = useTranslations('platform.bell');
  const { can } = useAuth();
  const allowed = can('notifications:view');
  const [open, setOpen] = React.useState(false);
  const mode = useNotificationStream(allowed);
  const unread = useUnreadCount(allowed);
  const recent = useRecentNotifications(open && allowed);
  const { read, readAll } = useNotificationActions();
  const count = unread.data ?? 0;
  if (!allowed) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={count > 0 ? t('openWithCount', { count }) : t('open')}
        data-testid="notification-bell"
        className="relative inline-flex size-10 items-center justify-center rounded-md text-ink-700 hover:bg-ivory-200"
      >
        <Bell aria-hidden="true" className="size-[1.125rem]" />
        {count > 0 && (
          <span
            data-testid="notification-badge"
            aria-hidden="true"
            className="absolute top-1 right-1 inline-flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[0.625rem] leading-4 font-semibold text-white"
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" aria-label={t('title')} className="w-[min(24rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
          <p className="text-sm font-semibold text-ink">{t('title')}</p>
          <Button size="sm" variant="ghost" disabled={count === 0} loading={readAll.isPending} onClick={() => readAll.mutate()}>
            {t('markAll')}
          </Button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto" aria-live="polite">
          {recent.isPending ? (
            <div className="space-y-2 p-3" role="status">
              <span className="sr-only">{t('loading')}</span>
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : recent.isError ? (
            <p className="p-4 text-sm text-red-700" role="alert">
              {t('error')}
            </p>
          ) : recent.data.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted">{t('empty')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {recent.data.map((n) => (
                <NotificationItem key={n.id} n={n} compact onRead={(id) => read.mutate(id)} />
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
          <span className={cn('text-xs', mode === 'live' ? 'text-green-700' : 'text-muted')} data-testid="stream-mode">
            {mode === 'live' ? t('live') : t('polling')}
          </span>
          <Link href="/notifications" onClick={() => setOpen(false)} className="text-sm font-medium text-blue-700 hover:underline">
            {t('viewAll')}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
