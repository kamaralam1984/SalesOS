'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, type Column, DataTable, PageHeader, Select } from '@salesos/ui';
import { RequirePermission } from '@/features/auth/require-permission';
import { AnalyticsFilterBar, useAnalyticsFilters } from '@/features/dashboard/filters';
import { formatDay, formatMoney, formatNumber, formatTime } from '@/features/dashboard/format';
import { KpiTile, TileGrid } from '@/features/dashboard/kpi-tile';
import { QueryBoundary } from '@/features/dashboard/query-boundary';
import { type ReportResult, useReport } from '@/lib/api/hooks/analytics';
import { ExportButtons } from './export-buttons';
import type { ReportKey } from './report-keys';


const PERMISSIONS: Record<ReportKey, string[]> = {
  'follow-ups': ['reports:view'],
  conversions: ['reports:view'],
  funnel: ['reports:view'],
  revenue: ['kpi:view'],
  'team-performance': ['reports:view'],
  'weekly-founder': ['reports:view'],
  'monthly-founder': ['reports:view'],
};

const GROUPABLE: Partial<Record<ReportKey, string[]>> = { conversions: ['source', 'program', 'owner'], revenue: ['program', 'owner'] };

type Row = ReportResult['rows'][number] & { __id?: string };

function cell(col: ReportResult['columns'][number], v: Row[string], lc: string): React.ReactNode {
  if (v === null || v === undefined || v === '') return <span className="text-muted" aria-label="not available">—</span>;
  if (col.type === 'money') return <span className="tabular">{formatMoney(String(v), lc)}</span>;
  if (col.type === 'pct') return <span className="tabular">{formatNumber(String(v), lc)}%</span>;
  if (col.type === 'int' || col.type === 'number') return <span className="tabular">{formatNumber(String(v), lc)}</span>;
  if (col.type === 'date') return formatDay(String(v), lc);
  return String(v);
}

/** Generic report view: KPI strip (definitions + freshness), table, export. Works for every `/reports/*` endpoint. */
export function ReportPage({ reportKey }: { reportKey: ReportKey }) {
  const t = useTranslations('analytics.report');
  const tn = useTranslations('analytics.reportNames');
  const lc = useLocale();
  const filters = useAnalyticsFilters({ period: reportKey === 'weekly-founder' ? 'WEEK' : 'MONTH' });
  const groups = GROUPABLE[reportKey];
  const [by, setBy] = React.useState<string>(groups?.[0] ?? '');
  const params = { ...filters.query, ...(groups ? { by } : {}), ...(reportKey === 'weekly-founder' && !filters.raw.period ? { period: 'WEEK' as const } : {}) };
  const q = useReport(reportKey, { ...params, limit: 500 });
  return (
    <RequirePermission permission={PERMISSIONS[reportKey]}>
      <PageHeader eyebrow={t('eyebrow')} title={tn(reportKey)} description={tn(`${reportKey}Hint` as 'follow-upsHint')} actions={<ExportButtons report={reportKey} params={params} />} />
      <AnalyticsFilterBar filters={filters} target={reportKey} show={{ owner: reportKey !== 'conversions' }} />
      {groups && (
        <label className="mb-4 block max-w-xs text-[0.8125rem] font-medium text-ink-700">
          {t('groupBy')}
          <Select className="mt-1" value={by} onChange={(e) => setBy(e.target.value)} aria-label={t('groupBy')}>
            {groups.map((g) => (
              <option key={g} value={g}>{t(`by.${g}` as 'by.source')}</option>
            ))}
          </Select>
        </label>
      )}
      <QueryBoundary q={q}>
        {(r, fetching) => {
          const columns: Column<Row>[] = r.columns.map((c, i) => ({ id: c.key, header: c.label, primary: i === 0, align: c.type === 'text' ? 'left' : 'right', cell: (row) => cell(c, row[c.key] ?? null, lc) }));
          return (
            <div aria-busy={fetching} className="space-y-5">
              <p className="text-xs text-muted" data-testid="report-meta">
                {t('meta', { from: formatDay(r.meta.dateRange.from, lc), to: formatDay(r.meta.dateRange.to, lc), time: formatTime(r.meta.computedAt, lc), scope: r.meta.filters.scopeLevel, currency: r.meta.currency })}
              </p>
              {r.meta.detailWithheld && <Alert tone="info">{t('detailWithheld')}</Alert>}
              {r.truncated && (
                <Alert tone="warning">{t('truncated', { limit: r.rowLimit })}</Alert>
              )}
              {r.kpis.length > 0 && reportKey !== 'weekly-founder' && reportKey !== 'monthly-founder' && (
                <TileGrid>{r.kpis.slice(0, 8).map((k) => <KpiTile key={k.id} kpi={k} />)}</TileGrid>
              )}
              <DataTable columns={columns} rows={r.rows.map((row, i) => ({ ...row, __id: String(i) }))} getRowId={(row) => row.__id ?? ''} caption={tn(reportKey)} emptyTitle={t('empty')} emptyDescription={t('emptyHint')} />
              <details className="enter-up rounded-lg border border-line bg-surface p-3 text-sm">
                <summary className="cursor-pointer font-medium text-ink">{t('definitions')}</summary>
                <ul className="mt-2 space-y-1 text-muted">
                  {r.meta.definitions.map((d) => (
                    <li key={d.id}>
                      <a className="font-medium text-blue-700 underline-offset-2 hover:underline" href={`/reporting/kpis#${d.id}`}>{d.id}</a> {d.name} · {d.approvalStatus === 'PROPOSED_DEFAULT_AWAITING_OWNER_APPROVAL' ? t('proposed') : d.approvalStatus}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          );
        }}
      </QueryBoundary>
    </RequirePermission>
  );
}
