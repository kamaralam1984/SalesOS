'use client';
import * as React from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus } from 'lucide-react';
import { Button, Dialog, DialogContent, FormField, Input, PageHeader, Pagination, Select, useToast } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { QueryState, useFormErrors } from '@/features/people/hub/shared';
import { useCreateRun, usePayrollRuns, type PayrollRun } from '@/lib/api/hooks/work-payroll';
import { formatMoney, formatMonth } from './money';
import { PayrollError, RUN_STATUSES, RunStatusBadge, StatutoryNotice } from './shared';

export function PayrollRunsPage() {
  return (
    <RequirePermission permission="payroll:run:view">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('workPayroll');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { can } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const [page, setPage] = React.useState(1);
  const q = usePayrollRuns({ page, limit: 12, status: status || undefined });
  const items = q.data?.items ?? [];
  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('runs.title')}
        description={t('runs.description')}
        actions={can('payroll:run:manage') ? <Button leadingIcon={<Plus aria-hidden="true" />} onClick={() => setOpen(true)}>{t('runs.newRun')}</Button> : undefined}
      />
      <StatutoryNotice className="mb-4" />
      <FormField label={t('runs.filterStatus')} className="mb-4 w-full sm:w-60">
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">{t('runs.anyStatus')}</option>
          {RUN_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
        </Select>
      </FormField>
      <QueryState query={q} isEmpty={items.length === 0} emptyTitle={status ? t('runs.emptyFiltered') : t('runs.empty')} emptyDescription={status ? undefined : t('runs.emptyBody')}>
        <ul className="stagger-fast space-y-2" aria-label={t('runs.listLabel')}>
          {items.map((r: PayrollRun) => (
            <li key={r.id}>
              <Link href={`/work/payroll/${r.month}`} aria-label={t('runs.open', { month: formatMonth(r.month, locale) })} className="flex flex-wrap items-center justify-between gap-3 hover-lift rounded-lg border border-line bg-surface p-3.5 hover:border-gold-300 focus-visible:outline-2 focus-visible:outline-focus">
                <span>
                  <span className="block font-medium text-ink">{formatMonth(r.month, locale)}</span>
                  <span className="text-sm text-muted">{t('runs.payslips', { n: r.payslipCount ?? 0 })}</span>
                </span>
                <span className="flex items-center gap-3">
                  {r.totals.map((tot) => (
                    <span key={tot.currency} className="text-right text-sm">
                      <span className="block text-xs text-muted">{t('money.net')}</span>
                      <span className="font-medium tabular-nums text-ink">{formatMoney(tot.net, tot.currency)}</span>
                    </span>
                  ))}
                  <RunStatusBadge status={r.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {(q.data?.pagination?.hasMore || page > 1) && (
          <Pagination className="mt-4" page={page} hasPrev={page > 1} hasNext={Boolean(q.data?.pagination?.hasMore)} onPrev={() => setPage((p) => Math.max(1, p - 1))} onNext={() => setPage((p) => p + 1)} labels={{ nav: tc('pagination'), previous: tc('previous'), next: tc('next'), summary: () => '', page: () => '', pageOnly: (p) => tc('paginationPageOnly', { page: p }) }} />
        )}
      </QueryState>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t('runs.createTitle')} description={t('runs.createDescription')} closeLabel={tc('close')}>
          {open && <CreateRunForm onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

const schema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'required'), note: z.string().max(500, 'tooLong').optional() });
type Values = z.infer<typeof schema>;

function CreateRunForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('workPayroll.runs');
  const fe = useFormErrors('workPayroll');
  const { toast } = useToast();
  const create = useCreateRun();
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { month: '', note: '' } });
  const submit = handleSubmit(async (v) => {
    try {
      await create.mutateAsync({ month: v.month, ...(v.note?.trim() ? { note: v.note.trim() } : {}) });
      toast({ tone: 'success', title: t('created') });
      onDone();
    } catch {
      /* shown below, nothing is claimed as created */
    }
  });
  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label={t('createTitle')}>
      <FormField label={t('month')} error={fe(formState.errors.month)} required>
        <Input type="month" {...register('month')} />
      </FormField>
      <FormField label={t('note')} error={fe(formState.errors.note)}>
        <Input {...register('note')} />
      </FormField>
      <PayrollError error={create.error} />
      <Button type="submit" loading={create.isPending}>{t('create')}</Button>
    </form>
  );
}
