'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Check, Scale, X } from 'lucide-react';
import { Alert, Badge, Button, DataTable, Dialog, DialogContent, FormField, Input, Pagination, Panel, Select, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, useToast, type Column } from '@salesos/ui';
import { PageHeader } from '@/features/crm/motion';
import { Can, usePermission } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { usePayments, useReconciliation, useRejectPayment, useReversePayment, useRunReconciliation, useVerifyPayment, type Payment, type ReconcileResult, type ReconciliationView } from '@/lib/api/hooks/revenue';
import { DataState, Money, MoneyFacts, PaymentBadge, usePagerLabels, useRevFormat } from './common';
import { ReasonDialog, useSubmit } from './forms';
import { isMoneyInput, normalizeMoney, todayIst } from './lib';
import { Hint } from '@/features/hints/hint-views';

export function CollectionsPage() {
  const t = useTranslations('revenue.collections');
  const canReconcile = usePermission('collections:reconcile');
  return (
    <RequirePermission permission="collections:view">
      <PageHeader eyebrow={useTranslations('nav')('revenue')} title={t('title')} description={t('description')} actions={<Hint id="paymentVerified" />} />
      <Tabs defaultValue="ledger">
        <TabsList aria-label={t('sections')}>
          <TabsTrigger value="ledger">{t('ledger')}</TabsTrigger>
          {canReconcile && <TabsTrigger value="reconciliation">{t('reconciliation')}</TabsTrigger>}
        </TabsList>
        <TabsContent value="ledger" className="pt-5">
          <Ledger />
        </TabsContent>
        {canReconcile && (
          <TabsContent value="reconciliation" className="pt-5">
            <Reconciliation />
          </TabsContent>
        )}
      </Tabs>
    </RequirePermission>
  );
}

const FILTERS = ['', 'RECORDED', 'VERIFIED', 'RECONCILED', 'EXPECTED', 'REJECTED,REVERSED'] as const;

function Ledger() {
  const t = useTranslations('revenue.collections');
  const tc = useTranslations('common');
  const f = useRevFormat();
  const pager = usePagerLabels();
  const { toast } = useToast();
  const apiErr = useApiErrorMessage();
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]>('RECORDED');
  const [page, setPage] = React.useState(1);
  const q = usePayments({ page, limit: 20, ...(filter ? { status: filter } : {}) });
  const verify = useVerifyPayment();
  const reject = useRejectPayment();
  const reverse = useReversePayment();
  const canVerify = usePermission('collections:verify');
  const canReverse = usePermission('collections:reconcile');
  const [rejectId, setRejectId] = React.useState<string | null>(null);
  const [reverseId, setReverseId] = React.useState<string | null>(null);
  const columns: Column<Payment>[] = [
    { id: 'learner', header: t('colLearner'), primary: true, cell: (p) => <Link className="font-medium text-blue-700 hover:underline" href={`/revenue/deals/${p.dealId}`}>{p.leadName ?? t('learner')}</Link> },
    { id: 'status', header: t('colStatus'), cell: (p) => <PaymentBadge status={p.status} /> },
    { id: 'amount', header: t('colAmount'), align: 'right', cell: (p) => <Money value={p.status === 'EXPECTED' ? (p.expectedAmount ?? p.amount) : p.amount} /> },
    { id: 'ref', header: t('colRef'), hideOnMobile: true, cell: (p) => (p.externalTransactionRef ? `${p.provider} · ${p.externalTransactionRef}` : p.dueDate ? t('dueOn', { date: f.date(p.dueDate) }) : '—') },
    { id: 'program', header: t('colProgram'), hideOnMobile: true, cell: (p) => p.programName },
    { id: 'recorded', header: t('colRecorded'), hideOnMobile: true, cell: (p) => (p.recordedAt ? `${p.recordedByName ?? ''} · ${f.dateTime(p.recordedAt)}` : '—') },
    { id: 'verified', header: t('colVerified'), hideOnMobile: true, cell: (p) => (p.verifiedAt ? `${p.verifiedByName ?? ''} · ${f.dateTime(p.verifiedAt)}` : '—') },
  ];
  return (
    <div className="space-y-4">
      <Alert tone="info">{t('distinction')}</Alert>
      <div role="group" aria-label={t('filter')} className="enter-fade flex flex-wrap gap-2">
        {FILTERS.map((s) => (
          <Button key={s || 'all'} size="sm" variant={filter === s ? 'primary' : 'secondary'} aria-pressed={filter === s} onClick={() => { setFilter(s); setPage(1); }}>
            {s === '' ? t('filterAll') : s === 'REJECTED,REVERSED' ? t('filterClosed') : t(`filter${s}` as 'filterRECORDED')}
          </Button>
        ))}
      </div>
      <DataTable
        caption={t('tableCaption')}
        loadingLabel={tc('loading')}
        columns={columns}
        rows={q.data?.items}
        getRowId={(p) => p.id}
        loading={q.isPending}
        error={q.isError ? { message: apiErr(q.error).message, onRetry: () => void q.refetch() } : null}
        emptyTitle={t('emptyTitle')}
        emptyDescription={t('emptyDescription')}
        actionsHeader={tc('actions')}
        rowActions={(p) => (
          <div className="flex flex-wrap justify-end gap-1.5">
            {canVerify && p.status === 'RECORDED' && (
              <>
                <Button size="sm" variant="primary" loading={verify.isPending && verify.variables?.id === p.id} onClick={() => verify.mutate({ id: p.id }, { onSuccess: () => toast({ tone: 'success', title: t('verified') }), onError: (e) => toast({ tone: 'danger', title: apiErr(e).message }) })}>
                  <Check className="size-4" aria-hidden="true" />
                  {t('verify')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setRejectId(p.id)}><X className="size-4" aria-hidden="true" />{t('reject')}</Button>
              </>
            )}
            {canReverse && p.status === 'VERIFIED' && <Button size="sm" variant="secondary" onClick={() => setReverseId(p.id)}>{t('reverse')}</Button>}
          </div>
        )}
      />
      <Pagination page={page} hasNext={Boolean(q.data?.pagination?.hasMore)} onPageChange={setPage} labels={pager} />
      <ReasonDialog open={rejectId !== null} onOpenChange={(o) => !o && setRejectId(null)} title={t('rejectTitle')} description={t('rejectDescription')} label={t('reason')} submitLabel={t('reject')} successTitle={t('rejected')} onSubmit={(reason) => reject.mutateAsync({ id: rejectId!, reason })} />
      <ReasonDialog open={reverseId !== null} onOpenChange={(o) => !o && setReverseId(null)} title={t('reverseTitle')} description={t('reverseDescription')} label={t('reason')} minLength={5} danger submitLabel={t('reverse')} successTitle={t('reversed')} onSubmit={(reason) => reverse.mutateAsync({ id: reverseId!, reason })} />
    </div>
  );
}

function Reconciliation() {
  const t = useTranslations('revenue.collections');
  const tr = useTranslations('revenue.reconcile');
  const f = useRevFormat();
  const [view, setView] = React.useState<ReconciliationView>('unreconciled');
  const q = useReconciliation(view);
  const [open, setOpen] = React.useState(false);
  const [result, setResult] = React.useState<ReconcileResult | null>(null);
  const tot = q.data?.totals;
  return (
    <div className="space-y-5">
      <DataState q={q} empty={{ title: tr('empty') }} skeleton={<div className="h-24" />}>
        {(data) => (
          <>
            <Alert tone="info">{tr('explain')}</Alert>
            <MoneyFacts
              items={[
                { label: tr('booked'), value: data.totals.bookedSales, hint: tr('sales', { count: data.totals.saleCount }) },
                { label: tr('verified'), value: data.totals.collectedVerified, hint: data.totals.collectionPct ? tr('pct', { pct: data.totals.collectionPct }) : undefined },
                { label: tr('awaiting'), value: data.totals.verifiedAwaitingReconciliation, hint: tr('reconciledOf', { amount: f.money(data.totals.reconciled) }) },
                { label: tr('refunds'), value: data.totals.refundedProcessed },
                { label: tr('net'), value: data.totals.netCollections, hint: tr('outstanding', { amount: f.money(data.totals.outstandingDue) }), tone: 'default' },
              ]}
            />
            <p className="text-sm text-muted">{tr('pendingLine', { pending: f.money(data.totals.pendingVerification), expected: f.money(data.totals.expected) })}</p>
          </>
        )}
      </DataState>
      <Panel
        accent="green"
        title={tr('worklist')}
        actions={
          <Can permission="collections:reconcile">
            <Button variant="gold" onClick={() => setOpen(true)}><Scale className="size-4" aria-hidden="true" />{tr('run')}</Button>
          </Can>
        }
      >
        <div className="mb-4 max-w-xs">
          <FormField label={tr('view')}>
            <Select value={view} onChange={(e) => setView(e.target.value as ReconciliationView)}>
              <option value="unreconciled">{tr('viewUnreconciled')}</option>
              <option value="deal-mismatch">{tr('viewMismatch')}</option>
              <option value="duplicates">{tr('viewDuplicates')}</option>
            </Select>
          </FormField>
        </div>
        {tot && <WorkList view={view} items={q.data?.items ?? []} />}
        {result && <ReconcileOutcome result={result} />}
      </Panel>
      <RunDialog open={open} onOpenChange={setOpen} onResult={setResult} />
      <span className="sr-only">{t('reconciliation')}</span>
    </div>
  );
}

function WorkList({ view, items }: { view: ReconciliationView; items: Array<Record<string, unknown>> }) {
  const tr = useTranslations('revenue.reconcile');
  const tc = useTranslations('common');
  const f = useRevFormat();
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  const cols: Column<Record<string, unknown>>[] =
    view === 'unreconciled'
      ? [
          { id: 'ref', header: tr('colRef'), primary: true, cell: (r) => `${s(r.provider)} · ${s(r.externalTransactionRef)}` },
          { id: 'amount', header: tr('colAmount'), align: 'right', cell: (r) => <Money value={s(r.amount)} /> },
          { id: 'verified', header: tr('colVerifiedAt'), cell: (r) => f.dateTime(s(r.verifiedAt)) },
          { id: 'deal', header: tr('colDeal'), cell: (r) => <Link className="text-blue-700 hover:underline" href={`/revenue/deals/${s(r.dealId)}`}>{tr('open')}</Link> },
        ]
      : view === 'deal-mismatch'
        ? [
            { id: 'learner', header: tr('colLearner'), primary: true, cell: (r) => <Link className="text-blue-700 hover:underline" href={`/revenue/deals/${s(r.dealId)}`}>{s(r.leadName)}</Link> },
            { id: 'sale', header: tr('colSale'), align: 'right', cell: (r) => <Money value={s(r.saleValue)} /> },
            { id: 'collected', header: tr('colCollected'), align: 'right', cell: (r) => <Money value={s(r.collected)} /> },
            { id: 'due', header: tr('colDue'), align: 'right', cell: (r) => <Money value={s(r.amountDue)} /> },
            { id: 'flag', header: tr('colFlag'), cell: (r) => <Badge tone={s(r.flag) === 'OVER_COLLECTED' ? 'red' : 'gold'}>{tr(`flag${s(r.flag)}` as 'flagDUE')}</Badge> },
          ]
        : [
            { id: 'deal', header: tr('colDeal'), primary: true, cell: (r) => <Link className="text-blue-700 hover:underline" href={`/revenue/deals/${s(r.dealId)}`}>{tr('open')}</Link> },
            { id: 'amount', header: tr('colAmount'), align: 'right', cell: (r) => <Money value={s(r.amount)} /> },
            { id: 'day', header: tr('colDay'), cell: (r) => s(r.day) },
            { id: 'refs', header: tr('colRefs'), cell: (r) => (Array.isArray(r.references) ? (r.references as string[]).join(', ') : '') },
          ];
  return <DataTable caption={tr('worklist')} loadingLabel={tc('loading')} columns={cols} rows={items} getRowId={(r) => s(r.id) || s(r.dealId) + s(r.day) + s(r.amount)} emptyTitle={tr('emptyList')} />;
}

function ReconcileOutcome({ result }: { result: ReconcileResult }) {
  const tr = useTranslations('revenue.reconcile');
  return (
    <div className="mt-5 space-y-2" role="status">
      <Alert tone={result.unmatchedCount ? 'warning' : 'success'}>{tr('outcome', { matched: result.matchedCount, unmatched: result.unmatchedCount, ref: result.statementRef })}</Alert>
      {result.unmatched.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {result.unmatched.map((u, i) => (
            <li key={i}>{`${u.externalTransactionRef ?? u.paymentId ?? ''}: ${tr(`reason${u.reason.startsWith('NOT_VERIFIED') ? 'NOT_VERIFIED' : u.reason}` as 'reasonNOT_FOUND')}`}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RunDialog({ open, onOpenChange, onResult }: { open: boolean; onOpenChange: (o: boolean) => void; onResult: (r: ReconcileResult) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <RunBody onOpenChange={onOpenChange} onResult={onResult} />}
    </Dialog>
  );
}

function RunBody({ onOpenChange, onResult }: { onOpenChange: (o: boolean) => void; onResult: (r: ReconcileResult) => void }) {
  const tr = useTranslations('revenue.reconcile');
  const tc = useTranslations('common');
  const run = useRunReconciliation();
  const [ref, setRef] = React.useState('');
  const [lines, setLines] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const done = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  const { run: submit, error, pending } = useSubmit(done);
  const parsed = lines
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [r, a] = l.split(/[,\t]/).map((x) => x.trim());
      return { externalTransactionRef: r ?? '', amount: a ?? '' };
    });
  const badLine = parsed.findIndex((p) => !p.externalTransactionRef || !isMoneyInput(p.amount));
  const problems = { ref: ref.trim().length < 2, lines: parsed.length === 0 || badLine >= 0 };
  return (
    <DialogContent
      size="lg"
      title={tr('runTitle')}
      description={tr('runDescription')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={done}>{tc('cancel')}</Button>
          <Button type="submit" form="reconcile-form" loading={pending} loadingLabel={tc('saving')}>{tr('runSubmit')}</Button>
        </>
      }
    >
      <form
        id="reconcile-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (problems.ref || problems.lines) return;
          void submit(async () => onResult(await run.mutateAsync({ statementRef: ref.trim(), lines: parsed.map((p) => ({ externalTransactionRef: p.externalTransactionRef, amount: normalizeMoney(p.amount) })) })));
        }}
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <Alert tone="info">{tr('runNote')}</Alert>
        <FormField label={tr('statementRef')} required error={touched && problems.ref ? tr('statementRefInvalid') : undefined}>
          <Input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={120} placeholder={`BANK-${todayIst()}`} />
        </FormField>
        <FormField label={tr('lines')} required hint={tr('linesHint')} error={touched && problems.lines ? (badLine >= 0 ? tr('lineInvalid', { n: badLine + 1 }) : tr('linesRequired')) : undefined}>
          <Textarea rows={8} className="font-mono text-sm" value={lines} onChange={(e) => setLines(e.target.value)} placeholder={'UTR123456789, 50000.00\nUTR987654321, 25000.50'} />
        </FormField>
      </form>
    </DialogContent>
  );
}
