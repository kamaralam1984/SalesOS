'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Button, Combobox, DataTable, ErrorState, FormField, Input, PageHeader, Pagination, Panel, Select, Skeleton, Textarea, type Column } from '@salesos/ui';
import { Can } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useTeamMemberOptions } from '../common/api';
import { useDone, useFmt } from '../hrkit/kit';
import { useEmployee, useEmployees, useSaveEmployee, type EmployeeRecord } from './api';

export function RestrictedBanner() {
  const t = useTranslations('employees');
  return <Alert tone="warning" className="mb-5" title={t('restrictedTitle')} live={false}>{t('restrictedBody')}</Alert>;
}

export function EmployeesPage() {
  return (
    <RequirePermission permission="hr:records:view">
      <ListInner />
    </RequirePermission>
  );
}

function ListInner() {
  const t = useTranslations('employees');
  const fmt = useFmt();
  const router = useRouter();
  const apiErr = useApiErrorMessage();
  const [page, setPage] = React.useState(1);
  const q = useEmployees(page);
  const people = useTeamMemberOptions();
  const cols: Column<EmployeeRecord>[] = [
    { id: 'name', header: t('col.name'), primary: true, cell: (r) => <span className="font-medium text-ink">{r.name ?? '—'}</span> },
    { id: 'pos', header: t('col.position'), cell: (r) => r.positionTitle ?? '—' },
    { id: 'join', header: t('col.joined'), hideOnMobile: true, cell: (r) => fmt.date(r.joinDate) },
    { id: 'state', header: t('col.state'), cell: (r) => (r.exitDate ? <Badge tone="neutral">{t('exited')}</Badge> : <Badge tone="green">{t('active')}</Badge>) },
  ];
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <RestrictedBanner />
      <Panel accent="gold" title={t('openRecord')} className="enter-up mb-5">
        <FormField label={t('pickPerson')}>
          <Combobox options={(people.data ?? []).map((p) => ({ value: p.id, label: p.name }))} value={null} onValueChange={(v) => v && router.push(`/people/employees/${v}`)} loading={people.isPending} placeholder={t('pickPerson')} />
        </FormField>
      </Panel>
      <Panel accent="blue" title={t('listTitle')} className="enter-up [--enter-delay:80ms]">
        <DataTable
          caption={t('listTitle')}
          columns={cols}
          rows={q.data?.items}
          getRowId={(r) => r.userId}
          loading={q.isPending}
          error={q.isError ? { message: apiErr(q.error).message, onRetry: () => void q.refetch() } : null}
          emptyTitle={t('emptyTitle')}
          emptyDescription={t('emptyBody')}
          onRowClick={(r) => router.push(`/people/employees/${r.userId}`)}
          rowActions={(r) => <Link className="link-underline text-sm font-medium text-blue-700" href={`/people/employees/${r.userId}`}>{t('open')}</Link>}
          actionsHeader={t('actions')}
        />
        <Pagination page={page} hasPrev={page > 1} hasNext={Boolean(q.data?.pagination?.hasMore)} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} />
      </Panel>
    </>
  );
}

export function EmployeeDetailPage({ id }: { id: string }) {
  return (
    <RequirePermission permission="hr:records:view">
      <DetailInner id={id} />
    </RequirePermission>
  );
}

function DetailInner({ id }: { id: string }) {
  const t = useTranslations('employees');
  const apiErr = useApiErrorMessage();
  const q = useEmployee(id);
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={q.data?.name ?? t('detailTitle')} breadcrumbs={[{ label: t('title'), href: '/people/employees' }, { label: q.data?.name ?? '…' }]} breadcrumbLabel={t('breadcrumb')} />
      <RestrictedBanner />
      {q.isPending ? <Skeleton className="shimmer h-48 w-full" /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} description={apiErr(q.error).message} /> : <RecordForm key={q.data.updatedAt ?? 'new'} id={id} rec={q.data} />}
    </>
  );
}

function RecordForm({ id, rec }: { id: string; rec: EmployeeRecord }) {
  const t = useTranslations('employees');
  const apiErr = useApiErrorMessage();
  const done = useDone();
  const save = useSaveEmployee(id);
  const [v, setV] = React.useState({
    employmentType: rec.employmentType ?? 'FULL_TIME', positionTitle: rec.positionTitle ?? '', joinDate: rec.joinDate ?? '', probationEndDate: rec.probationEndDate ?? '',
    exitDate: rec.exitDate ?? '', exitType: rec.exitType ?? '', exitReason: rec.exitReason ?? '',
  });
  const exitIncomplete = (v.exitDate !== '') !== (v.exitType !== '');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate({
      employmentType: v.employmentType, positionTitle: v.positionTitle || undefined, joinDate: v.joinDate || undefined,
      probationEndDate: v.probationEndDate || null, exitDate: v.exitDate || null, exitType: v.exitType || null, exitReason: v.exitReason || null,
    }, { onSuccess: () => done(t('saved')) });
  };
  return (
    <Can permission="hr:records:manage" fallback={<ReadOnly rec={rec} />}>
      <Panel accent="green" title={t('recordTitle')} description={t('notHrms')}>
        {save.isError && <Alert tone="danger" className="mb-3">{apiErr(save.error).message}</Alert>}
        <form onSubmit={submit} className="grid gap-4 md:grid-cols-2" aria-label={t('recordTitle')}>
          <FormField label={t('f.employmentType')}><Select value={v.employmentType} onChange={(e) => setV({ ...v, employmentType: e.target.value })}>{['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'].map((x) => <option key={x} value={x}>{t(`employmentType.${x}` as never)}</option>)}</Select></FormField>
          <FormField label={t('f.position')}><Input value={v.positionTitle} onChange={(e) => setV({ ...v, positionTitle: e.target.value })} /></FormField>
          <FormField label={t('f.joinDate')}><Input type="date" value={v.joinDate} onChange={(e) => setV({ ...v, joinDate: e.target.value })} /></FormField>
          <FormField label={t('f.probationEnd')}><Input type="date" value={v.probationEndDate} onChange={(e) => setV({ ...v, probationEndDate: e.target.value })} /></FormField>
          <FormField label={t('f.exitDate')}><Input type="date" value={v.exitDate} onChange={(e) => setV({ ...v, exitDate: e.target.value })} /></FormField>
          <FormField label={t('f.exitType')} error={exitIncomplete ? t('exitBoth') : undefined}>
            <Select value={v.exitType} onChange={(e) => setV({ ...v, exitType: e.target.value as typeof v.exitType })}><option value="">—</option>{['VOLUNTARY', 'INVOLUNTARY', 'PROBATION_FAILURE', 'TRANSFER'].map((x) => <option key={x} value={x}>{t(`exitType.${x}` as never)}</option>)}</Select>
          </FormField>
          <FormField label={t('f.exitReason')} className="md:col-span-2"><Textarea rows={2} value={v.exitReason} onChange={(e) => setV({ ...v, exitReason: e.target.value })} /></FormField>
          <div className="md:col-span-2"><Button type="submit" className="glow-gold" disabled={exitIncomplete} loading={save.isPending}>{t('save')}</Button></div>
        </form>
      </Panel>
    </Can>
  );
}

function ReadOnly({ rec }: { rec: EmployeeRecord }) {
  const t = useTranslations('employees');
  const fmt = useFmt();
  return (
    <Panel accent="gold" title={t('recordTitle')} description={t('notHrms')}>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="inline text-muted">{t('f.position')}: </dt><dd className="inline">{rec.positionTitle ?? '—'}</dd></div>
        <div><dt className="inline text-muted">{t('f.joinDate')}: </dt><dd className="inline">{fmt.date(rec.joinDate)}</dd></div>
        <div><dt className="inline text-muted">{t('f.exitDate')}: </dt><dd className="inline">{fmt.date(rec.exitDate)}</dd></div>
      </dl>
    </Panel>
  );
}
