'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import { Alert, Badge, Button, FormField, Input, PageHeader, Pagination, Select, useToast } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { MutationAlert, QueryState } from '@/features/people/hub/shared';
import { useDirectoryDepartments } from '@/lib/api/hooks/work-people';
import { useExportWorkforceReport, useWorkforceReport, WORKFORCE_REPORT_KEYS, type ReportCell, type ReportColumn, type WorkforceReportKey } from '@/lib/api/hooks/work-reports';
import { useDates } from '../common';

export function ReportsPage() {
  return (
    <RequirePermission permission="workforce:reports:view">
      <Inner />
    </RequirePermission>
  );
}

const PAGE = 25;

function Inner() {
  const t = useTranslations('workReports');
  const tc = useTranslations('common');
  const { can } = useAuth();
  const { toast } = useToast();
  const dates = useDates();
  const reports = WORKFORCE_REPORT_KEYS.filter((k) => k !== 'birthdays' || can('birthdays:view'));
  const [key, setKey] = React.useState<WorkforceReportKey>('attendance');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [department, setDepartment] = React.useState('');
  const [groupBy, setGroupBy] = React.useState<'department' | 'manager'>('department');
  const [page, setPage] = React.useState(1);
  const deps = useDirectoryDepartments();
  const rangeBad = Boolean(from && to && from > to);
  const filters = { from: from || undefined, to: to || undefined, departmentId: department || undefined, groupBy: key === 'department-performance' ? groupBy : undefined };
  const q = useWorkforceReport(key, { ...filters, page, limit: PAGE }, !rangeBad);
  const exp = useExportWorkforceReport(key);
  const r = q.data?.report;
  const doExport = (format: 'csv' | 'xlsx') =>
    exp.mutate({ filters, format }, { onSuccess: (res) => toast({ title: res.truncated ? t('export.doneTruncated', { n: res.rowCount }) : t('export.done', { n: res.rowCount }), tone: res.truncated ? 'warning' : 'success' }) });
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <FormField label={t('filters.report')} className="lg:col-span-2">
          <Select value={key} onChange={(e) => { setKey(e.target.value as WorkforceReportKey); setPage(1); }}>
            {reports.map((k) => <option key={k} value={k}>{t(`names.${k}` as never)}</option>)}
          </Select>
        </FormField>
        <FormField label={t('filters.from')} error={rangeBad ? t('filters.rangeBad') : undefined}><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></FormField>
        <FormField label={t('filters.to')}><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></FormField>
        <FormField label={t('filters.department')}>
          <Select value={department} onChange={(e) => { setDepartment(e.target.value); setPage(1); }}>
            <option value="">{t('filters.allDepartments')}</option>
            {(deps.data ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        </FormField>
        {key === 'department-performance' && (
          <FormField label={t('filters.groupBy')}>
            <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value as 'department' | 'manager')}>
              <option value="department">{t('filters.byDepartment')}</option>
              <option value="manager">{t('filters.byManager')}</option>
            </Select>
          </FormField>
        )}
      </div>
      <p className="mb-3 text-sm text-muted">{t(`help.${key}` as never)}</p>
      {r && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">{t('scope', { from: dates.date(r.range.from), to: dates.date(r.range.to), level: t(`level.${r.scopeLevel}` as never) })}</p>
          {can('workforce:reports:export') && (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" leadingIcon={<Download aria-hidden="true" />} loading={exp.isPending} onClick={() => doExport('csv')}>{t('export.csv')}</Button>
              <Button size="sm" variant="secondary" leadingIcon={<Download aria-hidden="true" />} loading={exp.isPending} onClick={() => doExport('xlsx')}>{t('export.xlsx')}</Button>
            </div>
          )}
        </div>
      )}
      <MutationAlert error={exp.error} />
      {r?.truncated && <Alert tone="warning" className="mb-3">{t('truncated', { n: r.rowCap })}</Alert>}
      <QueryState query={q} isEmpty={!rangeBad && (r?.rows.length ?? 0) === 0} emptyTitle={t('empty')} emptyDescription={t('emptyBody')}>
        {rangeBad ? <Alert tone="danger">{t('filters.rangeBad')}</Alert> : r && (
          <>
            <Summary summary={r.summary} />
            <div className="overflow-x-auto rounded-lg border border-line bg-surface">
              <table className="w-full min-w-[40rem] text-sm">
                <caption className="sr-only">{r.title}</caption>
                <thead className="bg-ivory-100 text-left text-xs text-muted">
                  <tr>{r.columns.map((c) => <th key={c.key} scope="col" className={`px-3 py-2 font-semibold ${isNum(c) ? 'text-right' : ''}`}>{c.label}</th>)}</tr>
                </thead>
                <tbody>
                  {r.rows.map((row, i) => (
                    <tr key={i} className="border-t border-line transition-colors hover:bg-champagne-100/60">
                      {r.columns.map((c) => <td key={c.key} className={`px-3 py-2 ${isNum(c) ? 'text-right tabular-nums' : ''}`}>{cell(c, row[c.key], dates.date)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(q.data?.pagination?.hasMore || page > 1) && (
              <Pagination className="mt-4" page={page} hasPrev={page > 1} hasNext={Boolean(q.data?.pagination?.hasMore)} onPrev={() => setPage((p) => Math.max(1, p - 1))} onNext={() => setPage((p) => p + 1)}
                labels={{ nav: tc('pagination'), previous: tc('previous'), next: tc('next'), summary: () => '', page: () => '', pageOnly: (p) => tc('paginationPageOnly', { page: p }) }} />
            )}
          </>
        )}
      </QueryState>
    </>
  );
}

const isNum = (c: ReportColumn) => c.type === 'int' || c.type === 'number' || c.type === 'pct';
/** Empty cell = not computable / not applicable: shown as a dash, never as 0. */
function cell(c: ReportColumn, v: ReportCell | undefined, date: (v?: string | null) => string): string {
  if (v === null || v === undefined || v === '') return '—';
  if (c.type === 'date') return date(String(v));
  if (c.type === 'pct') return `${v}%`;
  return String(v);
}

function Summary({ summary }: { summary: Record<string, number | string | null | Record<string, number>> }) {
  const t = useTranslations('workReports');
  const entries = Object.entries(summary);
  if (entries.length === 0) return null;
  return (
    <dl className="stagger-fast mb-3 flex flex-wrap gap-2" aria-label={t('summary')}>
      {entries.map(([k, v]) => (
        <div key={k} className="hover-lift accent-top rounded-lg border border-line bg-surface px-3 py-2">
          <dt className="text-xs text-muted">{t.has(`summaryKeys.${k}` as never) ? t(`summaryKeys.${k}` as never) : k}</dt>
          <dd className="text-sm font-semibold text-ink">
            {v !== null && typeof v === 'object' ? (
              <span className="flex flex-wrap gap-1">{Object.entries(v).map(([s, n]) => <Badge key={s} tone="neutral">{s}: {n}</Badge>)}</span>
            ) : v === null ? '—' : k.endsWith('Pct') ? `${v}%` : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
