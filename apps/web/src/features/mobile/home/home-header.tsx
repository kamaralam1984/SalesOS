'use client';
import * as React from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Bell } from 'lucide-react';
import { BrandMark } from '@/components/brand';
import { useAuth } from '@/features/auth/auth-provider';
import { useUnreadCount } from '@/lib/api/hooks/platform';
import { PRIMARY_ROLE_KEYS } from '@/lib/api/types';

const BUSINESS_TZ = 'Asia/Kolkata';

type Part = 'morning' | 'afternoon' | 'evening';

/** Hour of day (0-23) in the business timezone, independent of the device timezone. */
function istHour(now: Date): number {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TZ, hour: 'numeric', hourCycle: 'h23' }).format(now);
  return Number(h) % 24;
}

function partOfDay(hour: number): Part {
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

/** Brand, role chip, notification bell and a time-of-day greeting for the mobile home. */
export function HomeHeader() {
  const t = useTranslations('mobileHead');
  const tr = useTranslations('roles');
  const lc = useLocale();
  const { user, can } = useAuth();
  const allowed = can('notifications:view');
  const unread = useUnreadCount(allowed);
  // Computed after mount so server and client markup agree.
  const [part, setPart] = React.useState<Part | null>(null);
  React.useEffect(() => {
    setPart(partOfDay(istHour(new Date())));
  }, []);

  const firstName = user?.name.trim().split(/\s+/)[0] ?? '';
  const primaryRole = PRIMARY_ROLE_KEYS.find((r) => user?.roles.includes(r)) ?? user?.roles[0];
  const count = unread.data ?? 0;
  const badge = count > 99 ? '99+' : new Intl.NumberFormat(lc).format(count);
  const name = <span className="text-gold-400">{firstName}</span>;
  const chunks = { name: () => name };

  return (
    <header className="enter-fade">
      <div className="flex items-center gap-3">
        <BrandMark className="size-10" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-display text-lg font-semibold text-ink">{t('brand')}</p>
          <p className="truncate text-xs text-muted">{t('product')}</p>
        </div>
        {primaryRole && (
          <span className="inline-flex max-w-32 items-center truncate rounded-full border border-gold-300 bg-gold-50 px-2.5 py-1 text-[0.6875rem] font-semibold tracking-wide text-gold-700 uppercase">
            {tr(primaryRole)}
          </span>
        )}
        {allowed && (
          <Link
            href="/notifications"
            data-testid="mobile-bell"
            aria-label={count > 0 ? t('bellWithCount', { count }) : t('bell')}
            className="glow-hover relative inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-700 focus-visible:outline-2 focus-visible:outline-focus"
          >
            <Bell aria-hidden="true" className="size-5" />
            {count > 0 && (
              <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[0.625rem] leading-5 font-semibold text-white">
                {badge}
              </span>
            )}
          </Link>
        )}
      </div>
      <div className="enter-up mt-6">
        <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-tight text-ink">
          {part === null ? t.rich('greetingDefault', { name: chunks.name, who: firstName }) : t.rich(`greeting.${part}`, { name: chunks.name, who: firstName })}
        </h1>
        <p className="mt-1 text-sm text-muted">{t('subline')}</p>
      </div>
    </header>
  );
}
