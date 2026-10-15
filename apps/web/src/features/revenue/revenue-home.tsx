'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Banknote, BarChart3, Briefcase, Lightbulb, Scale, Tag, Target, Undo2 } from 'lucide-react';
import { Card } from '@salesos/ui';
import { PageHeader, StaggerList } from '@/features/crm/motion';
import { Can, useAuth } from '@/features/auth/auth-provider';
import { PipelineStrip } from './deals-page';

const SECTIONS = [
  { href: '/revenue/targets', key: 'targets', perm: 'targets:view', Icon: Target },
  { href: '/revenue/deals', key: 'deals', perm: 'deals:view', Icon: Briefcase },
  { href: '/revenue/collections', key: 'collections', perm: 'collections:view', Icon: Banknote },
  { href: '/revenue/refunds', key: 'refunds', perm: 'refunds:view', Icon: Undo2 },
  { href: '/revenue/forecasts', key: 'forecasts', perm: 'forecasts:view', Icon: BarChart3 },
  { href: '/revenue/pricing', key: 'pricing', perm: 'proposals:view', Icon: Tag },
  { href: '/revenue/intel', key: 'intel', perm: 'market-intel:view', Icon: Lightbulb },
] as const;

export function RevenueHome() {
  const t = useTranslations('revenue.home');
  const tn = useTranslations('nav');
  const { can } = useAuth();
  return (
    <>
      <PageHeader eyebrow={tn('revenue')} title={t('title')} description={t('description')} />
      <Can permission="deals:view">
        <h2 className="mb-3 font-display text-lg font-semibold text-ink">{t('pipeline')}</h2>
        <PipelineStrip />
      </Can>
      <h2 className="mt-8 mb-3 font-display text-lg font-semibold text-ink">{t('sections')}</h2>
      <StaggerList className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.filter((s) => can(s.perm)).map(({ href, key, Icon }) => (
          <div key={key} className="h-full">
            <Link href={href} className="block h-full rounded-xl focus-visible:outline-2 focus-visible:outline-focus">
              <Card accent="gold" interactive className="glow-hover hover-lift h-full">
                <div className="flex items-start gap-3">
                  <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-gold-50 text-gold-700"><Icon className="size-5" /></span>
                  <div>
                    <p className="font-display text-lg font-semibold text-ink">{t(`${key}Title` as 'targetsTitle')}</p>
                    <p className="mt-0.5 text-sm text-muted">{t(`${key}Hint` as 'targetsHint')}</p>
                  </div>
                </div>
              </Card>
            </Link>
          </div>
        ))}
      </StaggerList>
      <p className="enter-fade mt-6 flex items-start gap-2 text-sm text-muted"><Scale className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{t('principle')}</p>
    </>
  );
}
