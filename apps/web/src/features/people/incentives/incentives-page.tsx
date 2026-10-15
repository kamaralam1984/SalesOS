'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus } from 'lucide-react';
import {
  Alert, Button, Combobox, DataTable, Dialog, DialogContent, ErrorState, FormField, Input, PageHeader, Panel, Pagination, Select,
  StatusBadge, Tabs, TabsContent, TabsList, TabsTrigger, type Column, type Status,
} from '@salesos/ui';
import { Can, useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useTeamMemberOptions } from '../common/api';
import { monthRange, numStr, useFmt } from '../hrkit/kit';
import { useAdjustments, useCreateRecommendation, useIncentives, type Incentive, type IncentiveStatus, type Adjustment } from './api';
import { PolicyTab } from './policy-tab';

export const STATUS_TONE: Record<IncentiveStatus, Status> = {
  CALCULATED: 'pending', SUBMITTED: 'info', APPROVED: 'success', REJECTED: 'danger', ON_HOLD: 'warning', PAID: 'success', CLAWBACK_PROPOSED: 'warning', ADJUSTED: 'neutral', WAIVED: 'neutral',
};
const STATUSES = Object.keys(STATUS_TONE) as IncentiveStatus[];

export function IncentiveStatusBadge({ status }: { status: IncentiveStatus }) {
  const t = useTranslations('incentives');
  return <StatusBadge status={STATUS_TONE[status]}>{t(`status.${status}` as never)}</StatusBadge>;
}

export function IncentivesPage() {
  return (
    <RequirePermission permission={['incentives:recommendation:view', 'incentives:policy:view']}>
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('incentives');
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <Alert tone="info" className="enter-fade mb-5" live={false}>{t('recommendationOnly')}</Alert>
      <Tabs defaultValue="recommendations">
        <TabsList aria-label={t('title')}>
          <TabsTrigger value="recommendations">{t('tabs.recommendations')}</TabsTrigger>
          <Can permission="incentives:policy:view"><TabsTrigger value="policy">{t('tabs.policy')}</TabsTrigger></Can>
          <Can permission="incentives:recommendation:view" minScope="team"><TabsTrigger value="clawbacks">{t('tabs.clawbacks')}</TabsTrigger></Can>
        </TabsList>
        <TabsContent value="recommendations"><RecommendationsTab /></TabsContent>
        <TabsContent value="policy"><PolicyTab /></TabsContent>
        <TabsContent value="clawbacks"><ClawbacksTab /></TabsContent>
      </Tabs>
    </>
  );
}

function RecommendationsTab() {
  const t = useTranslations('incentives');
  const tc = useTranslations('common');
  const fmt = useFmt();
  const router = useRouter();
  const apiErr = useApiErrorMessage();
  const [status, setStatus] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [open, setOpen] = React.useState(false);
  const q = useIncentives({ status: status || undefined, page });

  const columns: Column<Incentive>[] = [
    { id: 'employee', header: t('col.employee'), primary: true, cell: (r) => <span className="font-medium text-ink">{r.employeeName ?? '—'}</span> },
    { id: 'period', header: t('col.period'), cell: (r) => `${fmt.date(r.periodStart)} – ${fmt.date(r.periodEnd)}` },
    { id: 'status', header: t('col.status'), cell: (r) => <IncentiveStatusBadge status={r.status} /> },
    { id: 'computed', header: t('col.computed'), align: 'right', hideOnMobile: true, cell: (r) => (r.statusOnly ? <span className="text-muted">{t('statusOnlyShort')}</span> : fmt.money(r.computedAmount, r.currency)) },
    { id: 'approved', header: t('col.approved'), align: 'right', hideOnMobile: true, cell: (r) => (r.statusOnly ? '—' : fmt.money(r.approvedAmount, r.currency)) },
  ];

  return (
    <Panel accent="gold"
      title={t('tabs.recommendations')}
      actions={
        <>
          <Select aria-label={t('filterStatus')} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">{t('allStatuses')}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}` as never)}</option>)}
          </Select>
          <Can permission="incentives:recommendation:create">
            <Button onClick={() => setOpen(true)} leadingIcon={<Plus />}>{t('new')}</Button>
          </Can>
        </>
      }
    >
      <DataTable
        caption={t('tabs.recommendations')}
        columns={columns}
        rows={q.data?.items}
        getRowId={(r) => r.id}
        loading={q.isPending}
        error={q.isError ? { message: apiErr(q.error).message, onRetry: () => void q.refetch() } : null}
        emptyTitle={t('emptyTitle')}
        emptyDescription={t('emptyDescription')}
        onRowClick={(r) => router.push(`/people/incentives/${r.id}`)}
        rowActions={(r) => <Link className="link-underline text-sm font-medium text-blue-700" href={`/people/incentives/${r.id}`}>{t('open')}</Link>}
        actionsHeader={tc('actions')}
      />
      <Pagination page={page} hasPrev={page > 1} hasNext={Boolean(q.data?.pagination?.hasMore)} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} />
      <Dialog open={open} onOpenChange={setOpen}>{open && <CreateBody onClose={() => setOpen(false)} />}</Dialog>
    </Panel>
  );
}

const createSchema = z.object({
  employeeId: z.string().min(1, 'required'),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'required'),
  target: z.string().refine((v) => numStr(v) !== undefined && Number(v) >= 0, 'invalidNumber'),
  revenue: z.string().refine((v) => v === '' || numStr(v) !== undefined, 'invalidNumber'),
  collections: z.string().refine((v) => v === '' || numStr(v) !== undefined, 'invalidNumber'),
  refunds: z.string().refine((v) => v === '' || numStr(v) !== undefined, 'invalidNumber'),
  metrics: z.array(z.object({ key: z.string().trim().min(1, 'required'), value: z.string().refine((v) => numStr(v) !== undefined, 'invalidNumber') })),
});
type CreateValues = z.infer<typeof createSchema>;

function CreateBody({ onClose }: { onClose: () => void }) {
  const t = useTranslations('incentives');
  const apiErr = useApiErrorMessage();
  const router = useRouter();
  const people = useTeamMemberOptions();
  const { user } = useAuth();
  const create = useCreateRecommendation();
  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { employeeId: '', month: new Date().toISOString().slice(0, 7), target: '', revenue: '', collections: '', refunds: '', metrics: [] },
  });
  const metrics = useFieldArray({ control: form.control, name: 'metrics' });
  const fe = (e?: { message?: unknown }) => (typeof e?.message === 'string' ? t(`errors.${e.message}` as never) : undefined);
  const employeeId = useWatch({ control: form.control, name: 'employeeId' });
  const e = form.formState.errors;
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const inputs = {
        target: Number(v.target), revenue: Number(v.revenue || 0), collections: Number(v.collections || 0), refunds: Number(v.refunds || 0),
        metrics: Object.fromEntries(v.metrics.map((m) => [m.key, Number(m.value)])),
      };
      const r = await create.mutateAsync({ employeeId: v.employeeId, ...monthRange(v.month), inputs });
      onClose();
      router.push(`/people/incentives/${r.id}`);
    } catch (err) {
      form.setError('root', { message: apiErr(err).message });
    }
  });
  const options = (people.data ?? []).filter((p) => p.id !== user?.id).map((p) => ({ value: p.id, label: p.name }));
  return (
    <DialogContent
      size="lg"
      title={t('create.title')}
      description={t('create.description')}
      footer={<><Button variant="secondary" onClick={onClose}>{t('cancel')}</Button><Button type="submit" form="inc-create" loading={create.isPending}>{t('create.submit')}</Button></>}
    >
      <Alert tone="warning" className="mb-4" live={false}>{t('create.noProvider')}</Alert>
      {form.formState.errors.root && <Alert tone="danger" className="mb-3">{form.formState.errors.root.message}</Alert>}
      <form id="inc-create" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('create.employee')} required error={fe(e.employeeId)} className="sm:col-span-2">
          <Combobox options={options} value={employeeId || null} onValueChange={(v) => form.setValue('employeeId', v ?? '', { shouldValidate: true })} loading={people.isPending} placeholder={t('create.pickEmployee')} />
        </FormField>
        <FormField label={t('create.month')} required error={fe(e.month)}><Input type="month" {...form.register('month')} /></FormField>
        <FormField label={t('create.target')} required error={fe(e.target)}><Input inputMode="decimal" {...form.register('target')} /></FormField>
        <FormField label={t('create.revenue')} error={fe(e.revenue)}><Input inputMode="decimal" {...form.register('revenue')} /></FormField>
        <FormField label={t('create.collections')} error={fe(e.collections)}><Input inputMode="decimal" {...form.register('collections')} /></FormField>
        <FormField label={t('create.refunds')} error={fe(e.refunds)}><Input inputMode="decimal" {...form.register('refunds')} /></FormField>
        <div className="sm:col-span-2">
          <p className="mb-2 text-sm font-medium text-ink">{t('create.metrics')}</p>
          <p className="mb-2 text-xs text-muted">{t('create.metricsHint')}</p>
          {metrics.fields.map((f, i) => (
            <div key={f.id} className="mb-2 flex gap-2">
              <Input aria-label={t('create.metricKey')} placeholder={t('create.metricKey')} {...form.register(`metrics.${i}.key`)} />
              <Input aria-label={t('create.metricValue')} placeholder={t('create.metricValue')} inputMode="decimal" {...form.register(`metrics.${i}.value`)} />
              <Button type="button" variant="ghost" onClick={() => metrics.remove(i)}>{t('remove')}</Button>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={() => metrics.append({ key: '', value: '' })}>{t('create.addMetric')}</Button>
        </div>
      </form>
    </DialogContent>
  );
}

function ClawbacksTab() {
  const t = useTranslations('incentives');
  const fmt = useFmt();
  const apiErr = useApiErrorMessage();
  const q = useAdjustments();
  const cols: Column<Adjustment>[] = [
    { id: 'emp', header: t('col.employee'), primary: true, cell: (a) => a.employeeName ?? '—' },
    { id: 'proposed', header: t('clawbacks.proposed'), align: 'right', cell: (a) => fmt.money(a.proposedAmount, a.currency) },
    { id: 'decided', header: t('clawbacks.decided'), align: 'right', cell: (a) => fmt.money(a.decidedAmount, a.currency) },
    { id: 'status', header: t('col.status'), cell: (a) => <StatusBadge status={a.status === 'PROPOSED' ? 'warning' : 'neutral'}>{t(`adjustment.${a.status}` as never)}</StatusBadge> },
    { id: 'open', header: '', cell: (a) => a.recommendationId ? <Link className="link-underline text-blue-700" href={`/people/incentives/${a.recommendationId}`}>{t('open')}</Link> : null },
  ];
  return (
    <Panel accent="blue" title={t('tabs.clawbacks')} description={t('clawbacks.description')}>
      {q.isError ? <ErrorState onRetry={() => void q.refetch()} description={apiErr(q.error).message} /> : (
        <DataTable caption={t('tabs.clawbacks')} columns={cols} rows={q.data} getRowId={(a) => a.id} loading={q.isPending} emptyTitle={t('clawbacks.emptyTitle')} emptyDescription={t('clawbacks.emptyDescription')} />
      )}
    </Panel>
  );
}
