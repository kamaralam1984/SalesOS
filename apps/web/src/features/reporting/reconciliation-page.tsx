'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CheckCircle2, CircleDashed, XCircle } from 'lucide-react';
import { Alert, Button, type Column, DataTable, PageHeader, Stat, useToast } from '@salesos/ui';
import { Can } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { AnalyticsFilterBar, useAnalyticsFilters } from '@/features/dashboard/filters';
import { formatDay, formatTime } from '@/features/dashboard/format';
import { QueryBoundary } from '@/features/dashboard/query-boundary';
import { type ReconCheck, useReconciliation, useRunReconciliation } from '@/lib/api/hooks/analytics';

/** Dashboard accuracy evidence (KPI-PRO-002): every dashboard total recomputed from the raw tables, side by side. */
export function ReconciliationPage() {
  const t = useTranslations('analytics.recon');
  const lc = useLocale();
  const { toast } = useToast();
  const filters = useAnalyticsFilters({ period: 'MONTH' });
  const q = useReconciliation(filters.query);
  const run = useRunReconciliation();
  const statusIcon = (s: ReconCheck['status']) => (s === 'PASS' ? <CheckCircle2 aria-hidden="true" className="size-4 text-green-700" /> : s === 'FAIL' ? <XCircle aria-hidden="true" className="size-4 text-red-700" /> : <CircleDashed aria-hidden="true" className="size-4 text-ink-500" />);
  const columns: Column<ReconCheck>[] = [
    { id: 'name', header: t('check'), primary: true, cell: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { id: 'kpi', header: t('kpi'), hideOnMobile: true, cell: (r) => r.kpiId ?? '—' },
    { id: 'expected', header: t('raw'), align: 'right', cell: (r) => <span className="tabular">{r.expected ?? '—'}</span> },
    { id: 'actual', header: t('dashboard'), align: 'right', cell: (r) => <span className="tabular">{r.actual ?? '—'}</span> },
    { id: 'diff', header: t('difference'), align: 'right', cell: (r) => <span className="tabular">{r.difference ?? '—'}</span> },
    { id: 'status', header: t('result'), cell: (r) => <span className="inline-flex items-center gap-1.5">{statusIcon(r.status)}{t(`status.${r.status}`)}</span> },
    { id: 'note', header: t('note'), hideOnMobile: true, cell: (r) => <span className="text-muted">{r.note ?? ''}</span> },
  ];
  return (
    <RequirePermission permission={['reports:view', 'kpi:view']}>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={
          <Can permission="reports:view">
            <Button
              variant="secondary"
              loading={run.isPending}
              disabled={!q.data?.scope.orgWide}
              title={t('recordHint')}
              onClick={() => {
                // only the window is sent: a recorded run is organisation-wide evidence, never a filtered view
                const { from, to, period } = filters.query;
                run.mutate({ from, to, period }, { onSuccess: () => toast({ title: t('recorded'), tone: 'success' }), onError: () => toast({ title: t('recordFailed'), tone: 'danger' }) });
              }}
            >
              {t('record')}
            </Button>
          </Can>
        }
      />
      <AnalyticsFilterBar filters={filters} target="reconciliation" />
      <QueryBoundary q={q}>
        {(r) => (
          <div className="space-y-5">
            <Alert tone={r.summary.failed > 0 ? 'danger' : r.summary.allPassed ? 'success' : 'info'} live>
              {r.summary.failed > 0 ? t('someFailed', { failed: r.summary.failed }) : r.summary.allPassed ? t('allPassed', { passed: r.summary.passed }) : t('nothingChecked')}
            </Alert>
            <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={t('passed')} value={r.summary.passed} />
              <Stat label={t('failed')} value={r.summary.failed} accent={r.summary.failed > 0 ? 'red' : 'none'} />
              <Stat label={t('skipped')} value={r.summary.skipped} />
              <Stat label={t('accuracy')} value={r.summary.accuracyPct === null ? '—' : `${r.summary.accuracyPct}%`} />
            </div>
            <p className="text-xs text-muted">{t('meta', { from: formatDay(r.dateRange.from, lc), to: formatDay(r.dateRange.to, lc), time: formatTime(r.ranAt, lc), scope: r.scope.level, ms: r.durationMs })}</p>
            <DataTable columns={columns} rows={r.checks} getRowId={(c) => c.id} caption={t('title')} />
            <p className="text-sm text-muted">{r.method}</p>
          </div>
        )}
      </QueryBoundary>
    </RequirePermission>
  );
}
