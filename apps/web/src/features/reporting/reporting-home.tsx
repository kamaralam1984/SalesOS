'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { BarChart3, BookOpen, Download, FileBarChart, Filter, Scale, Users } from 'lucide-react';
import { PageHeader } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { HubTile, accentAt } from './hub-tile';

const LINKS = [
  { href: '/reporting/follow-ups', key: 'follow-ups', perm: ['reports:view'], Icon: FileBarChart },
  { href: '/reporting/conversions', key: 'conversions', perm: ['reports:view'], Icon: Filter },
  { href: '/reporting/funnel', key: 'funnel', perm: ['reports:view'], Icon: Filter },
  { href: '/reporting/revenue', key: 'revenue', perm: ['kpi:view'], Icon: BarChart3 },
  { href: '/reporting/team-performance', key: 'team-performance', perm: ['reports:view'], Icon: Users },
  { href: '/reporting/weekly-founder', key: 'weekly-founder', perm: ['reports:view'], Icon: FileBarChart },
  { href: '/reporting/monthly-founder', key: 'monthly-founder', perm: ['reports:view'], Icon: FileBarChart },
  { href: '/reporting/reconciliation', key: 'reconciliation', perm: ['reports:view'], Icon: Scale },
  { href: '/reporting/kpis', key: 'kpis', perm: ['kpi:definitions:view'], Icon: BookOpen },
  { href: '/reporting/exports', key: 'exports', perm: ['reports:export'], Icon: Download },
] as const;

export function ReportingHome() {
  const t = useTranslations('analytics.home');
  const tn = useTranslations('analytics.reportNames');
  const { can } = useAuth();
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <ul className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {LINKS.filter((l) => can([...l.perm])).map(({ href, key, Icon }, i) => (
          <li key={key}>
            <HubTile href={href} accent={accentAt(i)} icon={<Icon />} title={tn(key as 'funnel')} body={tn(`${key}Hint` as 'funnelHint')} />
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-muted">{t('principle')}</p>
    </>
  );
}
