'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Card, PageHeader } from '@salesos/ui';
import { RequirePermission } from '@/features/auth/require-permission';
import { QueryBoundary } from '@/features/dashboard/query-boundary';
import { type KpiMeta, useKpiDefinitions } from '@/lib/api/hooks/analytics';

const GROUPS = ['REV', 'SAL', 'PRD', 'TEA', 'PRO', 'CX', 'FND', 'EXC'] as const;

/** The KPI dictionary, served from the same registry that computes the numbers. */
export function KpiDictionaryPage() {
  const t = useTranslations('analytics.dictionary');
  const q = useKpiDefinitions();
  const [filter, setFilter] = React.useState('');
  return (
    <RequirePermission permission="kpi:definitions:view">
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <label className="mb-5 block max-w-md text-[0.8125rem] font-medium text-ink-700">
        {t('search')}
        <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} className="mt-1 h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-base glow-focus md:h-10" placeholder={t('searchPlaceholder')} />
      </label>
      <QueryBoundary q={q}>
        {(defs) => {
          const f = filter.trim().toLowerCase();
          const shown = defs.filter((d) => !f || `${d.id} ${d.name} ${d.definition}`.toLowerCase().includes(f));
          return (
            <div className="space-y-8">
              <p className="text-sm text-muted">{t('count', { n: shown.length })}</p>
              {GROUPS.map((g) => {
                const list = shown.filter((d) => d.group === g);
                if (list.length === 0) return null;
                return (
                  <section key={g} aria-labelledby={`g-${g}`}>
                    <h2 id={`g-${g}`} className="mb-3 font-display text-xl font-semibold text-ink">{t(`groups.${g}` as 'groups.REV')}</h2>
                    <div className="stagger space-y-3">{list.map((d) => <Definition key={d.id} d={d} />)}</div>
                  </section>
                );
              })}
            </div>
          );
        }}
      </QueryBoundary>
    </RequirePermission>
  );
}

function Definition({ d }: { d: KpiMeta }) {
  const t = useTranslations('analytics.dictionary');
  return (
    <Card as="article" id={d.id} className="scroll-mt-24 hover-lift">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-display text-lg font-semibold text-ink">{d.name}</h3>
        <Badge tone="gold">{t('proposed')}</Badge>
      </div>
      <p className="mt-0.5 text-xs text-muted">{d.id} · {d.source}</p>
      <p className="mt-2 text-sm text-ink-700">{d.definition}</p>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-[0.8125rem] sm:grid-cols-2">
        {([['numerator', d.numerator], ['denominator', d.denominator], ['window', d.window], ['exclusions', d.exclusions], ['formula', d.formula], ['zeroDenominator', d.zeroDenominator], ['rounding', d.rounding], ['refresh', d.refresh], ['owner', d.owner], ['sources', d.tables.join(', ')]] as const).map(([k, v]) => (
          <div key={k}><dt className="font-medium text-ink-700">{t(k)}</dt><dd className="text-muted">{v}</dd></div>
        ))}
      </dl>
    </Card>
  );
}
