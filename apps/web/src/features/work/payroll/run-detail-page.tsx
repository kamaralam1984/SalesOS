'use client';
import * as React from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Download, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, Dialog, DialogContent, EmptyState, FormField, Input, PageHeader, Select, Stat, useToast } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { ConfirmDialog, QueryState, useFormErrors } from '@/features/people/hub/shared';
import {
  payrollExportUrl,
  useAddAdjustment,
  useApproveRun,
  useCalculateRun,
  useCancelRun,
  useMarkPaidRun,
  usePayrollRun,
  usePayrollRuns,
  useRemoveAdjustment,
  useSendBackRun,
  type Payslip,
  type PayrollRunDetail,
} from '@/lib/api/hooks/work-payroll';
import { formatMoney, formatMonth, isPositiveMoney } from './money';
import { PayrollError, RunStatusBadge, StatutoryNotice } from './shared';

/** The route is /work/payroll/[month]; the API addresses runs by id, so the month is resolved through the (bounded) run list. */
export function PayrollRunPage({ month }: { month: string }) {
  return (
    <RequirePermission permission="payroll:run:view">
      <Inner month={month} />
    </RequirePermission>
  );
}

function Inner({ month }: { month: string }) {
  const t = useTranslations('workPayroll');
  const list = usePayrollRuns({ limit: 100 });
  const runId = list.data?.items.find((r) => r.month === month)?.id;
  const run = usePayrollRun(runId);
  const loading = list.isLoading || (!!runId && run.isLoading);
  const failed = list.isError ? list : run.isError ? run : null;
  const query = { isLoading: loading, isError: !!failed, error: failed?.error, refetch: () => (list.isError ? list.refetch() : Promise.all([list.refetch(), run.refetch()])) };
  return (
    <QueryState query={query} isEmpty={!runId || !run.data} emptyTitle={t('run.notFound')} emptyDescription={t('run.notFoundBody')} emptyAction={<Link className="text-sm font-medium text-blue-700 underline" href="/work/payroll">{t('run.back')}</Link>}>
      {run.data && <RunView run={run.data} />}
    </QueryState>
  );
}

type Dlg = null | 'approve' | 'sendBack' | 'cancel' | 'paid';

function RunView({ run }: { run: PayrollRunDetail }) {
  const t = useTranslations('workPayroll');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { can } = useAuth();
  const { toast } = useToast();
  const [dlg, setDlg] = React.useState<Dlg>(null);
  const [adjust, setAdjust] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState('');
  const [reference, setReference] = React.useState('');
  const calc = useCalculateRun();
  const approve = useApproveRun();
  const sendBack = useSendBackRun();
  const cancel = useCancelRun();
  const paid = useMarkPaidRun();
  const label = formatMonth(run.month, locale);
  const manage = can('payroll:run:manage');
  const canCalc = manage && (run.status === 'DRAFT' || run.status === 'CALCULATED');
  const canApprove = can('payroll:run:approve') && run.status === 'CALCULATED';
  const canSendBack = can('payroll:run:approve') && (run.status === 'CALCULATED' || run.status === 'APPROVED');
  const canPay = can('payroll:run:mark-paid') && run.status === 'APPROVED';
  const canCancel = manage && run.status !== 'PAID' && run.status !== 'CANCELLED';
  const canExport = run.status !== 'DRAFT' && run.status !== 'CANCELLED';
  const close = () => { setDlg(null); setReason(''); setReference(''); };
  const reasonOk = reason.trim().length >= 3;

  const doCalc = async () => {
    try { await calc.mutateAsync(run.id); toast({ tone: 'success', title: t('run.calculated') }); } catch { /* shown below */ }
  };
  const slip = run.payslips.find((s) => s.id === adjust) ?? null;

  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('run.title', { month: label })}
        description={t('run.workingDays', { n: run.monthWorkingDays })}
        breadcrumbs={[{ label: t('run.back'), href: '/work/payroll' }, { label }]}
        breadcrumbLabel={tc('breadcrumb')}
        actions={
          <>
            <RunStatusBadge status={run.status} />
            {canExport && (
              <Button asChild variant="secondary" leadingIcon={<Download aria-hidden="true" />}>
                <a href={payrollExportUrl(run.id)} download>{t('run.export')}</a>
              </Button>
            )}
          </>
        }
      />
      <StatutoryNotice className="mb-4" />
      <div className="mb-4 space-y-1 text-sm text-muted">
        {run.createdBy && <p>{t('run.preparedBy', { name: run.createdBy.name ?? '—' })}</p>}
        {run.approved && <p>{t('run.approvedBy', { name: run.approved.name ?? '—' })}</p>}
        {run.paid && <p>{t('run.paidBy', { name: run.paid.name ?? '—' })}{run.paymentReference ? ` · ${t('run.reference', { ref: run.paymentReference })}` : ''}</p>}
        {canExport && <p>{t('run.exportNote')}</p>}
      </div>

      {run.totals.length > 0 && (
        <div className="stagger mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {run.totals.flatMap((tot) => [
            <Stat key={`${tot.currency}-g`} label={t('money.gross')} value={formatMoney(tot.gross, tot.currency)} />,
            <Stat key={`${tot.currency}-d`} label={t('money.deductions')} value={formatMoney(tot.deductions, tot.currency)} />,
            <Stat key={`${tot.currency}-a`} label={t('money.adjustments')} value={formatMoney(tot.adjustments, tot.currency)} />,
            <Stat key={`${tot.currency}-n`} label={t('money.net')} value={formatMoney(tot.net, tot.currency)} accent="gold" />,
          ])}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {canCalc && <Button variant="blue" loading={calc.isPending} onClick={doCalc}>{run.status === 'DRAFT' ? t('run.calculate') : t('run.recalculate')}</Button>}
        {canApprove && <Button variant="green" onClick={() => setDlg('approve')}>{t('run.approve')}</Button>}
        {canSendBack && <Button variant="secondary" onClick={() => setDlg('sendBack')}>{t('run.sendBack')}</Button>}
        {canPay && <Button onClick={() => setDlg('paid')}>{t('run.markPaid')}</Button>}
        {canCancel && <Button variant="danger" onClick={() => setDlg('cancel')}>{t('run.cancel')}</Button>}
      </div>
      {canCalc && <p className="mb-4 text-sm text-muted">{t('run.calcHint')}</p>}
      {run.status === 'CALCULATED' && can('payroll:run:manage') && !can('payroll:run:approve') && <p className="mb-4 text-sm text-muted">{t('run.separation')}</p>}
      <div className="mb-4"><PayrollError error={calc.error} /></div>

      <h2 className="mb-3 font-display text-xl font-semibold text-ink">{t('run.payslipsTitle')}</h2>
      {run.payslips.length === 0 ? (
        <EmptyState title={t('run.noPayslips')} description={t('run.noPayslipsBody')} />
      ) : (
        <ul className="stagger-fast space-y-2" aria-label={t('run.payslipsTitle')}>
          {run.payslips.map((s) => (
            <li key={s.id} className="hover-lift rounded-lg border border-line bg-surface p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{s.userName ?? '—'}</p>
                  <p className="text-sm text-muted">
                    {t('run.daysOf', { paid: s.paidDays, total: s.monthWorkingDays })} · {t('run.lossOfPay')}: {s.lossOfPayDays}
                    {s.basis.warnings.length > 0 && <> · <Badge tone="gold">{t('run.warnings', { n: s.basis.warnings.length })}</Badge></>}
                  </p>
                </div>
                <dl className="grid grid-cols-3 gap-x-4 text-right text-sm">
                  <div><dt className="text-xs text-muted">{t('money.gross')}</dt><dd className="tabular-nums">{formatMoney(s.gross, s.currency)}</dd></div>
                  <div><dt className="text-xs text-muted">{t('money.deductions')}</dt><dd className="tabular-nums">{formatMoney(s.totalDeductions, s.currency)}</dd></div>
                  <div><dt className="text-xs text-muted">{t('money.net')}</dt><dd className="font-semibold tabular-nums text-ink">{formatMoney(s.net, s.currency)}</dd></div>
                </dl>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button asChild size="sm" variant="ghost"><Link href={`/work/payslips?slip=${s.id}`}>{t('run.viewPayslip')}<span className="sr-only"> {s.userName}</span></Link></Button>
                <Button size="sm" variant="ghost" onClick={() => setAdjust(s.id)}>{t('run.adjust')} ({s.adjustments.length})<span className="sr-only"> {s.userName}</span></Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog open={dlg === 'approve'} onOpenChange={(o) => !o && close()} title={t('run.approveTitle')} description={t('run.approveBody')} confirmLabel={t('run.approve')} pending={approve.isPending} error={approve.error}
        onConfirm={async () => { try { await approve.mutateAsync(run.id); toast({ tone: 'success', title: t('run.approved') }); close(); } catch { /* shown in dialog */ } }} />
      <ConfirmDialog open={dlg === 'sendBack'} onOpenChange={(o) => !o && close()} title={t('run.sendBackTitle')} description={t('run.sendBackBody')} confirmLabel={t('run.sendBack')} pending={sendBack.isPending} error={sendBack.error} disabled={!reasonOk}
        onConfirm={async () => { try { await sendBack.mutateAsync({ id: run.id, reason: reason.trim() }); toast({ tone: 'success', title: t('run.sentBack') }); close(); } catch { /* shown in dialog */ } }}>
        <FormField label={t('run.reason')} hint={t('run.reasonHint')} required><Input value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
      </ConfirmDialog>
      <ConfirmDialog open={dlg === 'cancel'} onOpenChange={(o) => !o && close()} danger title={t('run.cancelTitle')} description={t('run.cancelBody')} confirmLabel={t('run.cancel')} pending={cancel.isPending} error={cancel.error} disabled={!reasonOk}
        onConfirm={async () => { try { await cancel.mutateAsync({ id: run.id, reason: reason.trim() }); toast({ tone: 'success', title: t('run.cancelled') }); close(); } catch { /* shown in dialog */ } }}>
        <FormField label={t('run.reason')} hint={t('run.reasonHint')} required><Input value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
      </ConfirmDialog>
      <ConfirmDialog open={dlg === 'paid'} onOpenChange={(o) => !o && close()} title={t('run.paidTitle')} description={t('run.paidBody')} confirmLabel={t('run.markPaid')} pending={paid.isPending} error={paid.error} disabled={reference.trim().length < 3}
        onConfirm={async () => { try { await paid.mutateAsync({ id: run.id, reference: reference.trim() }); toast({ tone: 'success', title: t('run.paid') }); close(); } catch { /* shown in dialog */ } }}>
        <FormField label={t('run.referenceLabel')} hint={t('run.referenceHint')} required><Input value={reference} onChange={(e) => setReference(e.target.value)} /></FormField>
      </ConfirmDialog>

      <Dialog open={!!slip} onOpenChange={(o) => !o && setAdjust(null)}>
        <DialogContent title={t('adjust.title', { name: slip?.userName ?? '' })} description={t('adjust.description')} size="lg" closeLabel={tc('close')}>
          {slip && <AdjustmentPanel runId={run.id} slip={slip} locked={!(run.status === 'DRAFT' || run.status === 'CALCULATED') || !manage} status={t(`status.${run.status}`)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

const adjSchema = z.object({
  label: z.string().trim().min(1, 'required').max(80, 'tooLong'),
  kind: z.enum(['EARNING', 'DEDUCTION']),
  amount: z.string().refine(isPositiveMoney, 'amountFormat'),
  reason: z.string().trim().min(3, 'required').max(500, 'tooLong'),
});
type AdjValues = z.infer<typeof adjSchema>;

function AdjustmentPanel({ runId, slip, locked, status }: { runId: string; slip: Payslip; locked: boolean; status: string }) {
  const t = useTranslations('workPayroll.adjust');
  const tp = useTranslations('workPayroll');
  const fe = useFormErrors('workPayroll.structures');
  const { toast } = useToast();
  const add = useAddAdjustment();
  const remove = useRemoveAdjustment();
  const { register, handleSubmit, reset, formState } = useForm<AdjValues>({ resolver: zodResolver(adjSchema), defaultValues: { label: '', kind: 'EARNING', amount: '', reason: '' } });
  const submit = handleSubmit(async (v) => {
    try {
      await add.mutateAsync({ runId, slipId: slip.id, body: { ...v, amount: v.amount.trim() } });
      toast({ tone: 'success', title: t('added') });
      reset();
    } catch { /* shown below */ }
  });
  return (
    <div className="space-y-4">
      <section aria-labelledby="adj-existing">
        <h3 id="adj-existing" className="mb-2 text-sm font-semibold text-ink">{t('existing')}</h3>
        {slip.adjustments.length === 0 ? (
          <p className="text-sm text-muted">{t('none')}</p>
        ) : (
          <ul className="space-y-1.5">
            {slip.adjustments.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-sm">
                <span><span className="font-medium">{a.label}</span> <Badge tone={a.kind === 'EARNING' ? 'green' : 'red'}>{tp(`kind.${a.kind}`)}</Badge>{a.reason && <span className="block text-muted">{a.reason}</span>}</span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{a.kind === 'DEDUCTION' ? '-' : '+'}{formatMoney(a.amount, slip.currency)}</span>
                  {!locked && <Button size="icon" variant="ghost" aria-label={t('remove', { label: a.label })} loading={remove.isPending} onClick={async () => { try { await remove.mutateAsync({ runId, slipId: slip.id, adjustmentId: a.id }); toast({ tone: 'success', title: t('removed') }); } catch { /* shown below */ } }}><Trash2 aria-hidden="true" className="size-4" /></Button>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-sm text-muted">{tp('money.net')}: <span className="font-semibold tabular-nums text-ink">{formatMoney(slip.net, slip.currency)}</span></p>
      </section>
      <PayrollError error={remove.error} />
      {locked ? (
        <Alert tone="info">{t('locked', { status })}</Alert>
      ) : (
        <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2" aria-label={t('add')}>
          <FormField label={t('label')} error={fe(formState.errors.label)} required><Input {...register('label')} /></FormField>
          <FormField label={t('kind')} required>
            <Select {...register('kind')}><option value="EARNING">{tp('kind.EARNING')}</option><option value="DEDUCTION">{tp('kind.DEDUCTION')}</option></Select>
          </FormField>
          <FormField label={t('amount')} hint={t('amountHint')} error={fe(formState.errors.amount)} required><Input inputMode="decimal" {...register('amount')} /></FormField>
          <FormField label={t('reason')} error={fe(formState.errors.reason)} required><Input {...register('reason')} /></FormField>
          <div className="sm:col-span-2 space-y-3">
            <PayrollError error={add.error} />
            <Button type="submit" loading={add.isPending}>{t('add')}</Button>
          </div>
        </form>
      )}
    </div>
  );
}
