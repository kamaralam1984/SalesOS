'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert, Button, DataTable, Dialog, DialogContent, FormField, Input, Pagination, Select, Sheet, SheetContent, Textarea, Timeline, type Column } from '@salesos/ui';
import { PageHeader } from '@/features/crm/motion';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useRefund, useRefundAction, useRefunds, type PaymentMethod, type Refund, type RefundAction } from '@/lib/api/hooks/revenue';
import { DataState, Money, RefundBadge, usePagerLabels, useRevFormat } from './common';
import { MoneyInput, useSubmit } from './forms';
import { REFUND_NEXT, isMoneyInput, normalizeMoney } from './lib';
import { Hint } from '@/features/hints/hint-views';

const FILTERS = ['', 'REQUESTED', 'REVIEWED', 'APPROVED', 'PROCESSED', 'RECONCILED', 'REJECTED,WITHDRAWN,CANCELLED'] as const;

export function RefundsPage() {
  return (
    <React.Suspense fallback={null}>
      <RefundsInner />
    </React.Suspense>
  );
}

function RefundsInner() {
  const t = useTranslations('revenue.refunds');
  const tr = useTranslations('revenue.refundReason');
  const tc = useTranslations('common');
  const f = useRevFormat();
  const pager = usePagerLabels();
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get('open');
  const apiErr = useApiErrorMessage();
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]>('');
  const [page, setPage] = React.useState(1);
  const q = useRefunds({ page, limit: 20, ...(filter ? { status: filter } : {}) });
  const columns: Column<Refund>[] = [
    { id: 'learner', header: t('colLearner'), primary: true, cell: (r) => r.leadName ?? t('learner') },
    { id: 'status', header: t('colStatus'), cell: (r) => <RefundBadge status={r.status} /> },
    { id: 'amount', header: t('colAmount'), align: 'right', cell: (r) => <Money value={r.amount} /> },
    { id: 'reason', header: t('colReason'), hideOnMobile: true, cell: (r) => tr(r.reasonCategory as 'OTHER') },
    { id: 'requested', header: t('colRequested'), hideOnMobile: true, cell: (r) => f.dateTime(r.requestedAt) },
  ];
  return (
    <RequirePermission permission="refunds:view">
      <PageHeader eyebrow={useTranslations('nav')('revenue')} title={t('title')} description={t('description')} />
      <Alert tone="info" className="mb-4"><span className="inline-flex items-center gap-1">{t('flow')} <Hint id="refundSteps" /></span></Alert>
      <div role="group" aria-label={t('filter')} className="enter-fade mb-4 flex flex-wrap gap-2">
        {FILTERS.map((s) => (
          <Button key={s || 'all'} size="sm" variant={filter === s ? 'primary' : 'secondary'} aria-pressed={filter === s} onClick={() => { setFilter(s); setPage(1); }}>
            {s === '' ? t('filterAll') : s.includes(',') ? t('filterClosed') : t(`filter${s}` as 'filterREQUESTED')}
          </Button>
        ))}
      </div>
      <DataTable
        caption={t('tableCaption')}
        loadingLabel={tc('loading')}
        columns={columns}
        rows={q.data?.items}
        getRowId={(r) => r.id}
        loading={q.isPending}
        error={q.isError ? { message: apiErr(q.error).message, onRetry: () => void q.refetch() } : null}
        emptyTitle={t('emptyTitle')}
        emptyDescription={t('emptyDescription')}
        onRowClick={(r) => router.push(`/revenue/refunds?open=${r.id}`)}
      />
      <Pagination page={page} hasNext={Boolean(q.data?.pagination?.hasMore)} onPageChange={setPage} labels={pager} className="mt-4" />
      <Sheet open={Boolean(openId)} onOpenChange={(o) => !o && router.push('/revenue/refunds')}>
        {openId && <RefundSheet id={openId} />}
      </Sheet>
    </RequirePermission>
  );
}

function RefundSheet({ id }: { id: string }) {
  const t = useTranslations('revenue.refunds');
  const tc = useTranslations('common');
  const q = useRefund(id);
  return (
    <SheetContent title={t('detailTitle')} description={t('detailDescription')} closeLabel={tc('close')} side="right">
      <DataState q={q} empty={{ title: t('missing') }}>
        {(r) => <RefundDetail refund={r} />}
      </DataState>
    </SheetContent>
  );
}

function RefundDetail({ refund }: { refund: Refund }) {
  const t = useTranslations('revenue.refunds');
  const ts = useTranslations('revenue.refundStatus');
  const f = useRevFormat();
  const { can } = useAuth();
  const [action, setAction] = React.useState<RefundAction | null>(null);
  const next = REFUND_NEXT[refund.status].filter((n) => can(n.permission));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <RefundBadge status={refund.status} />
        <Link className="text-sm text-blue-700 hover:underline" href={`/revenue/deals/${refund.dealId}`}>{t('openDeal')}</Link>
      </div>
      <dl className="grid grid-cols-2 gap-y-2 text-sm">
        <dt className="text-muted">{t('requestedAmount')}</dt><dd><Money value={refund.amount} strong /></dd>
        <dt className="text-muted">{t('approvedAmount')}</dt><dd><Money value={refund.approvedAmount} /></dd>
        <dt className="text-muted">{t('processedAmount')}</dt><dd><Money value={refund.processedAmount} /></dd>
        <dt className="text-muted">{t('reason')}</dt><dd className="col-span-1">{refund.reason}</dd>
        {refund.recommendation && (<><dt className="text-muted">{t('recommendation')}</dt><dd>{t(`rec${refund.recommendation}` as 'recAPPROVE')}</dd></>)}
        {refund.externalRef && (<><dt className="text-muted">{t('externalRef')}</dt><dd className="break-all">{refund.externalRef}</dd></>)}
      </dl>
      {next.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('actions')}>
          {next.map((n) => (
            <Button key={n.action} variant={n.action === 'reject' || n.action === 'cancel' || n.action === 'withdraw' ? 'secondary' : 'primary'} onClick={() => setAction(n.action)}>
              {t(`action${n.action}` as 'actionreview')}
            </Button>
          ))}
        </div>
      )}
      <section aria-label={t('timeline')}>
        <h3 className="mb-3 font-display text-lg font-semibold text-ink">{t('timeline')}</h3>
        <Timeline
          label={t('timeline')}
          items={(refund.events ?? []).map((e) => ({
            id: e.id,
            title: ts(e.toStatus),
            time: f.dateTime(e.at),
            description: [e.actorName, e.actorRole ? t('asRole', { role: e.actorRole.replace(/_/g, ' ').toLowerCase() }) : null, e.reason].filter(Boolean).join(' · '),
          }))}
        />
      </section>
      <ActionDialog refund={refund} action={action} onClose={() => setAction(null)} />
    </div>
  );
}

function ActionDialog({ refund, action, onClose }: { refund: Refund; action: RefundAction | null; onClose: () => void }) {
  return (
    <Dialog open={action !== null} onOpenChange={(o) => !o && onClose()}>
      {action && <ActionBody refund={refund} action={action} onClose={onClose} />}
    </Dialog>
  );
}

const METHODS: PaymentMethod[] = ['BANK_TRANSFER', 'UPI', 'CARD', 'CASH', 'CHEQUE', 'GATEWAY', 'OTHER'];

function ActionBody({ refund, action, onClose }: { refund: Refund; action: RefundAction; onClose: () => void }) {
  const t = useTranslations('revenue.refunds');
  const tm = useTranslations('revenue.method');
  const tc = useTranslations('common');
  const mutate = useRefundAction();
  const { run, error, pending } = useSubmit(onClose, t(`done${action}` as 'donereview'));
  const [text, setText] = React.useState('');
  const [recommendation, setRecommendation] = React.useState('APPROVE');
  const [amount, setAmount] = React.useState('');
  const [method, setMethod] = React.useState<PaymentMethod>('BANK_TRANSFER');
  const [touched, setTouched] = React.useState(false);
  const needsAmountCheck = action === 'approve' && amount !== '';
  const amountOk = !needsAmountCheck || isMoneyInput(amount);
  const textMin = action === 'process' ? 3 : action === 'reconcile' ? 2 : 3;
  const textOk = text.trim().length >= textMin;
  const textLabel = action === 'process' ? t('externalRefLabel') : action === 'reconcile' ? t('statementRef') : action === 'review' ? t('reviewNote') : t('reasonLabel');
  function body(): Record<string, unknown> {
    switch (action) {
      case 'review': return { note: text.trim(), recommendation };
      case 'approve': return { reason: text.trim(), ...(amount ? { approvedAmount: normalizeMoney(amount) } : {}) };
      case 'process': return { externalRef: text.trim(), method };
      case 'reconcile': return { statementRef: text.trim() };
      default: return { reason: text.trim() };
    }
  }
  return (
    <DialogContent
      size="md"
      title={t(`title${action}` as 'titlereview')}
      description={t(`help${action}` as 'helpreview')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{tc('cancel')}</Button>
          <Button type="submit" form="refund-action" variant={action === 'reject' || action === 'cancel' ? 'danger' : 'primary'} loading={pending} loadingLabel={tc('saving')}>{t(`action${action}` as 'actionreview')}</Button>
        </>
      }
    >
      <form
        id="refund-action"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!textOk || !amountOk) return;
          void run(() => mutate.mutateAsync({ id: refund.id, action, body: body() }));
        }}
      >
        {error && <Alert tone="danger">{error}</Alert>}
        {action === 'process' && <Alert tone="warning">{t('processNote')}</Alert>}
        {action === 'review' && (
          <FormField label={t('recommendation')} required>
            <Select value={recommendation} onChange={(e) => setRecommendation(e.target.value)}>
              <option value="APPROVE">{t('recAPPROVE')}</option>
              <option value="PARTIAL">{t('recPARTIAL')}</option>
              <option value="REJECT">{t('recREJECT')}</option>
            </Select>
          </FormField>
        )}
        {action === 'approve' && (
          <FormField label={t('approvedAmount')} hint={t('approvedHint', { amount: refund.amount ?? '' })} error={!amountOk ? t('amountInvalid') : undefined}>
            <MoneyInput value={amount} onChange={setAmount} invalid={!amountOk} placeholder={refund.amount ?? ''} />
          </FormField>
        )}
        {action === 'process' && (
          <FormField label={t('method')} required>
            <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {METHODS.map((m) => (<option key={m} value={m}>{tm(m)}</option>))}
            </Select>
          </FormField>
        )}
        <FormField label={textLabel} required error={touched && !textOk ? t('textMin', { count: textMin }) : undefined}>
          {action === 'process' || action === 'reconcile' ? <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={120} autoComplete="off" /> : <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} />}
        </FormField>
      </form>
    </DialogContent>
  );
}
