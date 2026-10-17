'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Cake, CalendarClock, FileBarChart, Hourglass, Megaphone, Scale, SlidersHorizontal, UserPlus, Users } from 'lucide-react';
import { PageHeader, Stat } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useWorkDashboard } from '@/lib/api/hooks/work-people';

export function HrHubPage() {
  return (
    <RequirePermission permission={['workforce:settings:view', 'birthdays:view', 'announcements:manage', 'meetings:manage']}>
      <Inner />
    </RequirePermission>
  );
}

const TILES = [
  { key: 'policy', href: '/work/hr/policy', perm: 'workforce:settings:view', icon: SlidersHorizontal },
  { key: 'meetings', href: '/work/hr/meetings', perm: 'meetings:manage', icon: CalendarClock },
  { key: 'balances', href: '/work/hr/balances', perm: 'leave:balance:adjust', icon: Scale },
  { key: 'joiners', href: '/work/hr/joiners', perm: 'joiners:manage', icon: UserPlus },
  { key: 'probation', href: '/work/hr/probation', perm: 'workforce:reports:view', icon: Hourglass },
  { key: 'birthdays', href: '/work/hr/birthdays', perm: 'birthdays:view', icon: Cake },
  { key: 'announcements', href: '/work/hr/announcements', perm: 'announcements:manage', icon: Megaphone },
  { key: 'reports', href: '/work/reports', perm: 'workforce:reports:view', icon: FileBarChart },
  { key: 'directory', href: '/work/directory', perm: 'directory:view', icon: Users },
] as const;

function Inner() {
  const t = useTranslations('workHr');
  const { can } = useAuth();
  const dash = useWorkDashboard();
  const org = dash.data?.organisation ?? null;
  return (
    <>
      <PageHeader eyebrow={t('hub.eyebrow')} title={t('hub.title')} description={t('hub.description')} />
      {org && (
        <div className="stagger mb-6 grid grid-cols-2 gap-3 md:grid-cols-4" aria-label={t('hub.snapshot')} role="group">
          <Stat label={t('hub.headcount')} value={org.headcount} accent="gold" />
          <Stat label={t('hub.onProbation')} value={org.onProbation} accent="blue" />
          <Stat label={t('hub.endingSoon', { days: org.probationEndingSoon.windowDays })} value={org.probationEndingSoon.items.length} accent={org.probationEndingSoon.items.length > 0 ? 'red' : 'none'} />
          {org.birthdays.available && <Stat label={t('hub.birthdaysSoon', { days: org.birthdays.windowDays })} value={org.birthdays.items.length} accent="green" />}
        </div>
      )}
      <ul className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={t('hub.tools')}>
        {TILES.filter((x) => can(x.perm)).map((x) => (
          <li key={x.key}>
            <Link href={x.href} className="flex h-full items-start gap-3 rounded-lg border border-line bg-surface p-4 hover-lift glow-hover accent-top focus-visible:outline-2 focus-visible:outline-focus">
              <x.icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-gold-700" />
              <span>
                <span className="block font-medium text-ink">{t(`hub.tiles.${x.key}.title` as never)}</span>
                <span className="block text-sm text-muted">{t(`hub.tiles.${x.key}.body` as never)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Short list of the HR tools the person may open (Policy with the Zoom link, joiners, balances, announcements...).
 * Shown at the top of My Work so phones, which have no sidebar, can reach them. Renders nothing without any HR permission.
 */
export function HrToolLinks() {
  const t = useTranslations('workHr');
  const { can } = useAuth();
  const tiles = TILES.filter((x) => can(x.perm) && x.key !== 'directory' && x.key !== 'reports');
  if (tiles.length === 0) return null;
  return (
    <nav aria-label={t('hub.tools')} className="mb-6">
      <h2 className="mb-2 font-display text-xl font-semibold text-ink">{t('hub.title')}</h2>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((x) => (
          <li key={x.key}>
            <Link href={x.href} className="flex min-h-14 items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover-lift focus-visible:outline-2 focus-visible:outline-focus">
              <x.icon aria-hidden="true" className="size-5 shrink-0 text-gold-700" />
              {t(`hub.tiles.${x.key}.title` as never)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
