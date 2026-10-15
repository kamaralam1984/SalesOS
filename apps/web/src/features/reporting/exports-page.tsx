'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import { Button, type Column, DataTable, PageHeader, StatusBadge, useToast } from '@salesos/ui';
import { RequirePermission } from '@/features/auth/require-permission';
import { formatTime } from '@/features/dashboard/format';
import { QueryBoundary } from '@/features/dashboard/query-boundary';
import { type ExportRecord, downloadExport, useExports } from '@/lib/api/hooks/analytics';

/** My report exports (CSV / XLSX): status, row count, truncation, authorised download. Exports expire; every one is audited. */
export function ExportsPage() {
  const t = useTranslations('analytics.exports');
  const tn = useTranslations('analytics.reportNames');
  const lc = useLocale();
  const { toast } = useToast();
  const q = useExports();
  const columns: Column<ExportRecord>[] = [
    { id: 'report', header: t('report'), primary: true, cell: (r) => <span className="font-medium">{tn(r.report as 'funnel')}</span> },
    { id: 'format', header: t('format'), cell: (r) => r.format },
    { id: 'status', header: t('status'), cell: (r) => <StatusBadge status={r.status === 'READY' ? 'success' : r.status === 'FAILED' ? 'danger' : r.status === 'EXPIRED' ? 'neutral' : 'pending'}>{t(`state.${r.status}`)}</StatusBadge> },
    { id: 'rows', header: t('rows'), align: 'right', cell: (r) => <span className="tabular">{r.rowCount ?? '—'}{r.truncated ? ` (${t('truncated')})` : ''}</span> },
    { id: 'requested', header: t('requested'), cell: (r) => formatTime(r.requestedAt, lc) },
    { id: 'expires', header: t('expires'), hideOnMobile: true, cell: (r) => formatTime(r.expiresAt, lc) },
  ];
  return (
    <RequirePermission permission="reports:export">
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <QueryBoundary q={q}>
        {(rows) => (
          <DataTable
            columns={columns}
            rows={rows}
            getRowId={(r) => r.id}
            caption={t('title')}
            emptyTitle={t('empty')}
            emptyDescription={t('emptyHint')}
            actionsHeader={t('actions')}
            rowActions={(r) => r.downloadable ? <Button size="sm" variant="secondary" leadingIcon={<Download className="size-4" aria-hidden="true" />} onClick={() => void downloadExport(r).catch(() => toast({ title: t('downloadFailed'), tone: 'danger' }))}>{t('download')}</Button> : null}
          />
        )}
      </QueryBoundary>
    </RequirePermission>
  );
}
