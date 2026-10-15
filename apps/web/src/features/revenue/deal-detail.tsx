'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Banknote, Flag, Pencil, RotateCcw, Undo2 } from 'lucide-react';
import { Alert, Badge, Button, DataTable, Panel, Timeline, useToast, type Column } from '@salesos/ui';
import { PageHeader } from '@/features/crm/motion';
import { Can, useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useDeal, useDecideAdjustment, useReopenDeal, useResolveBlocker, useUpdateDeal, type DealDetail, type DealPayment } from '@/lib/api/hooks/revenue';
import { DataState, HighValueBadge, Money, MoneyFacts, PaymentBadge, RefundBadge, StageBadge, useRevFormat } from './common';
import { AdjustSaleDialog, CloseDealDialog, EscalateDialog, RecordPaymentDialog, RequestRefundDialog } from './deal-dialogs';
import { ReasonDialog } from './forms';
import { cmpMoney } from './lib';

export function DealDetailPage({ id }: { id: string }) {
  const q = useDeal(id);
  const t = useTranslations('revenue.deal');
  return (
    <RequirePermission permission="deals:view">
      <DataState q={q} empty={{ title: t('missing') }} skeleton={<div className="h-64" />}>
        {(deal) => <DealBody deal={deal} />}
      </DataState>
    </RequirePermission>
  );
}

function DealBody({ deal }: { deal: DealDetail }) {
  const t = useTranslations('revenue.deal');
  const tm = useTranslations('revenue.money');
  const ts = useTranslations('revenue.stage');
  const tn = useTranslations('nav');
  const f = useRevFormat();
  const { can, hasRole } = useAuth();
  const [dlg, setDlg] = React.useState<null | 'close' | 'escalate' | 'record' | 'refund' | 'adjust' | 'reopen'>(null);
  const open = deal.stage === 'OPEN' || deal.stage === 'NEGOTIATION' || deal.stage === 'PAYMENT_PENDING';
  const won = deal.stage === 'WON';
  const m = deal.money;
  const unpaid = won && m && cmpMoney(m.collected, m.saleValue) < 0;
  const reopen = useReopenDeal();
  const summaryOnly = deal.amount === null;
  const canReopen = deal.stage === 'LOST' && can('deals:update') && (hasRole('SALES_MANAGER') || hasRole('SALES_TEAM_LEAD') || hasRole('FOUNDER_CEO'));

  return (
    <>
      <PageHeader
        eyebrow={tn('revenue')}
        breadcrumbs={[{ label: tn('revenue'), href: '/revenue' }, { label: t('crumbDeals'), href: '/revenue/deals' }, { label: deal.leadName ?? t('learner') }]}
        breadcrumbLabel={t('breadcrumb')}
        title={deal.leadName ?? t('learner')}
        description={`${deal.programName ?? ''}${deal.dealType !== 'NEW' ? ` · ${t(`type${deal.dealType}` as 'typeUPSELL')}` : ''}`}
        actions={
          <>
            <StageBadge stage={deal.stage} />
            {deal.isHighValue && <HighValueBadge level={deal.escalationLevel} />}
            {open && <Can permission="deals:close"><Button variant="gold" onClick={() => setDlg('close')}>{t('close')}</Button></Can>}
            {open && <Can permission="deals:escalate"><Button variant="secondary" onClick={() => setDlg('escalate')}><Flag className="size-4" aria-hidden="true" />{t('escalate')}</Button></Can>}
            {won && <Can permission="collections:create"><Button variant="secondary" onClick={() => setDlg('record')}><Banknote className="size-4" aria-hidden="true" />{t('recordPayment')}</Button></Can>}
            {won && <Can permission="refunds:request"><Button variant="secondary" onClick={() => setDlg('refund')}><Undo2 className="size-4" aria-hidden="true" />{t('requestRefund')}</Button></Can>}
            {won && <Can permission="sales-adjustments:create"><Button variant="secondary" onClick={() => setDlg('adjust')}><Pencil className="size-4" aria-hidden="true" />{t('adjust')}</Button></Can>}
            {canReopen && <Button variant="secondary" onClick={() => setDlg('reopen')}><RotateCcw className="size-4" aria-hidden="true" />{t('reopen')}</Button>}
          </>
        }
      />

      {summaryOnly ? (
        <Alert tone="info">{t('summaryOnly')}</Alert>
      ) : (
        <>
          {(won || deal.stage === 'CANCELLED') && m ? (
            <section aria-label={tm('title')} className="space-y-3">
              {unpaid && <Alert tone="warning">{tm('notPaid', { due: f.money(m.amountDue) })}</Alert>}
              {cmpMoney(m.overCollected, '0.00') > 0 && <Alert tone="danger">{tm('over', { amount: f.money(m.overCollected) })}</Alert>}
              <MoneyFacts
                items={[
                  { label: tm('sale'), value: m.saleValue, hint: cmpMoney(m.adjustmentsTotal, '0.00') !== 0 ? tm('saleAdjusted', { original: f.money(m.originalSaleValue) }) : tm('saleHint') },
                  { label: tm('due'), value: m.amountDue, hint: tm('dueHint'), tone: unpaid ? 'warn' : 'default' },
                  { label: tm('collected'), value: m.collected, hint: m.collectionPct ? tm('collectedHint', { pct: m.collectionPct }) : undefined },
                  { label: tm('refunded'), value: m.refunded, hint: tm('refundedHint') },
                  { label: tm('net'), value: m.netCollections, hint: tm('netHint') },
                ]}
              />
              <p className="text-sm text-muted">
                {tm('pending', { pending: f.money(m.pendingVerification) })} {cmpMoney(m.refundApprovedNotProcessed, '0.00') > 0 && tm('approvedNotPaid', { amount: f.money(m.refundApprovedNotProcessed) })}
              </p>
            </section>
          ) : (
            <section aria-label={tm('openTitle')}>
              <MoneyFacts
                columns={3}
                items={[
                  { label: tm('expectedValue'), value: deal.amount, hint: tm('expectedHint') },
                  { label: tm('threshold'), value: deal.highValueThreshold, hint: deal.isHighValue ? tm('thresholdHit') : tm('thresholdNone') },
                  { label: tm('closeBy'), value: null, hint: f.date(deal.expectedCloseOn) },
                ]}
              />
            </section>
          )}
        </>
      )}

      <div className="enter-up mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Blockers deal={deal} />
          {deal.payments && <Payments payments={deal.payments} />}
          {deal.refunds && deal.refunds.length > 0 && (
            <Panel title={t('refunds')}>
              <ul className="divide-y divide-line">
                {deal.refunds.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <span className="flex items-center gap-2"><RefundBadge status={r.status} /><span className="text-muted">{f.dateTime(r.requestedAt)}</span></span>
                    <span className="flex items-center gap-3"><Money value={r.amount} /><Link className="text-blue-700 hover:underline" href={`/revenue/refunds?open=${r.id}`}>{t('open')}</Link></span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {deal.salesRecord && <Adjustments deal={deal} />}
        </div>
        <div className="space-y-6">
          {deal.salesRecord && (
            <Panel title={t('credits')} description={t('creditsHint')}>
              <ul className="divide-y divide-line text-sm">
                {deal.salesRecord.credits.map((c) => (
                  <li key={c.userId} className="flex items-center justify-between gap-3 py-2">
                    <span>{c.userName}</span>
                    <span className="tabular text-muted">{c.sharePct}% · <Money value={c.amount} /></span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel accent="gold" title={t('details')}>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted">{t('owner')}</dt><dd>{deal.ownerName}</dd>
              <dt className="text-muted">{t('enrolments')}</dt><dd className="tabular">{deal.enrolments}</dd>
              <dt className="text-muted">{t('closedAt')}</dt><dd>{f.dateTime(deal.closedAt)}</dd>
              {deal.lostReason && (<><dt className="text-muted">{t('lostReason')}</dt><dd>{deal.lostReason}</dd></>)}
              {deal.note && (<><dt className="text-muted">{t('note')}</dt><dd className="col-span-1">{deal.note}</dd></>)}
            </dl>
            {!summaryOnly && (
              <Link className="link-underline mt-3 inline-block text-sm text-blue-700" href={`/crm/leads/${deal.leadId}`}>{t('openLead')}</Link>
            )}
          </Panel>
          {!summaryOnly && open && <StageMover deal={deal} />}
          <Panel title={t('history')}>
            <Timeline
              label={t('history')}
              items={deal.history.map((h) => ({
                id: h.id,
                title: h.oldStage ? t('moved', { from: ts(h.oldStage), to: ts(h.newStage) }) : t('createdAs', { stage: ts(h.newStage) }),
                time: f.dateTime(h.at),
                description: [h.changedByName, h.reason].filter(Boolean).join(' · ') || undefined,
              }))}
            />
          </Panel>
        </div>
      </div>

      <CloseDealDialog open={dlg === 'close'} onOpenChange={(o) => setDlg(o ? 'close' : null)} deal={deal} />
      <EscalateDialog open={dlg === 'escalate'} onOpenChange={(o) => setDlg(o ? 'escalate' : null)} dealId={deal.id} />
      <RecordPaymentDialog open={dlg === 'record'} onOpenChange={(o) => setDlg(o ? 'record' : null)} deal={deal} />
      <RequestRefundDialog open={dlg === 'refund'} onOpenChange={(o) => setDlg(o ? 'refund' : null)} deal={deal} />
      <AdjustSaleDialog open={dlg === 'adjust'} onOpenChange={(o) => setDlg(o ? 'adjust' : null)} deal={deal} />
      <ReasonDialog
        open={dlg === 'reopen'}
        onOpenChange={(o) => setDlg(o ? 'reopen' : null)}
        title={t('reopenTitle')}
        description={t('reopenDescription')}
        label={t('reopenReason')}
        submitLabel={t('reopen')}
        successTitle={t('reopened')}
        onSubmit={(reason) => reopen.mutateAsync({ id: deal.id, reason })}
      />
    </>
  );
}

function StageMover({ deal }: { deal: DealDetail }) {
  const t = useTranslations('revenue.deal');
  const ts = useTranslations('revenue.stage');
  const update = useUpdateDeal();
  const { toast } = useToast();
  const apiErr = useApiErrorMessage();
  const next = deal.stage === 'OPEN' ? ['NEGOTIATION', 'PAYMENT_PENDING'] : deal.stage === 'NEGOTIATION' ? ['PAYMENT_PENDING'] : [];
  if (!next.length) return null;
  return (
    <Can permission="deals:update">
      <Panel accent="blue" title={t('moveStage')} description={t('moveStageHint')}>
        <div className="flex flex-wrap gap-2">
          {next.map((s) => (
            <Button
              key={s}
              size="sm"
              variant="secondary"
              loading={update.isPending && update.variables?.stage === s}
              onClick={() =>
                update.mutate(
                  { id: deal.id, stage: s, version: deal.version },
                  { onSuccess: () => toast({ tone: 'success', title: t('stageMoved', { stage: ts(s as 'OPEN') }) }), onError: (e) => toast({ tone: 'danger', title: apiErr(e).message }) },
                )
              }
            >
              {t('moveTo', { stage: ts(s as 'OPEN') })}
            </Button>
          ))}
        </div>
      </Panel>
    </Can>
  );
}

function Blockers({ deal }: { deal: DealDetail }) {
  const t = useTranslations('revenue.deal');
  const f = useRevFormat();
  const resolve = useResolveBlocker();
  const [target, setTarget] = React.useState<string | null>(null);
  if (deal.blockers.length === 0) return null;
  return (
    <Panel title={t('blockers')} description={t('blockersHint')}>
      <ul className="space-y-3">
        {deal.blockers.map((b) => (
          <li key={b.id} className="rounded-lg border border-line p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Badge tone={b.kind === 'HIGH_VALUE' ? 'gold' : 'red'}>{t(`kind${b.kind}` as 'kindBLOCKER')}</Badge>
                <span className="text-muted">{f.dateTime(b.createdAt)} · {b.raisedByName}</span>
              </span>
              {b.resolvedAt ? <Badge tone="green">{t('resolved')}</Badge> : <Can permission="deals:escalate"><Button size="sm" variant="secondary" onClick={() => setTarget(b.id)}>{t('resolve')}</Button></Can>}
            </div>
            <p className="mt-2 text-ink">{b.note}</p>
            {b.requestedHelp && <p className="mt-1 text-muted">{t('help', { text: b.requestedHelp })}</p>}
            {b.resolvedAt && <p className="mt-2 rounded-md bg-ivory-100 p-2 text-muted">{t('resolution', { who: b.resolvedByName ?? '', text: b.resolution ?? '' })}</p>}
          </li>
        ))}
      </ul>
      <ReasonDialog
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        title={t('resolveTitle')}
        label={t('resolution2')}
        submitLabel={t('resolve')}
        successTitle={t('resolvedToast')}
        onSubmit={(resolution) => resolve.mutateAsync({ id: deal.id, blockerId: target!, resolution })}
      />
    </Panel>
  );
}

function Payments({ payments }: { payments: DealPayment[] }) {
  const t = useTranslations('revenue.deal');
  const tc = useTranslations('common');
  const f = useRevFormat();
  const columns: Column<DealPayment>[] = [
    { id: 'status', header: t('colStatus'), primary: true, cell: (p) => <PaymentBadge status={p.status} /> },
    { id: 'amount', header: t('colAmount'), align: 'right', cell: (p) => <Money value={p.status === 'EXPECTED' ? (p.expectedAmount ?? p.amount) : p.amount} /> },
    { id: 'ref', header: t('colRef'), cell: (p) => p.externalTransactionRef ?? (p.dueDate ? t('dueOn', { date: f.date(p.dueDate) }) : '—') },
    { id: 'verified', header: t('colVerified'), hideOnMobile: true, cell: (p) => f.dateTime(p.verifiedAt) },
  ];
  return (
    <Panel accent="green" title={t('payments')} description={t('paymentsHint')}>
      <DataTable caption={t('payments')} loadingLabel={tc('loading')} columns={columns} rows={payments} getRowId={(p) => p.id} emptyTitle={t('noPayments')} />
    </Panel>
  );
}

function Adjustments({ deal }: { deal: DealDetail }) {
  const t = useTranslations('revenue.deal');
  const f = useRevFormat();
  const decide = useDecideAdjustment();
  const { hasRole } = useAuth();
  const { toast } = useToast();
  const apiErr = useApiErrorMessage();
  const adj = deal.salesRecord!.adjustments;
  if (adj.length === 0) return null;
  const canDecide = hasRole('FOUNDER_CEO') || hasRole('FINANCE');
  return (
    <Panel title={t('adjustments')} description={t('adjustmentsHint', { original: f.money(deal.salesRecord!.saleValue) })}>
      <ul className="divide-y divide-line text-sm">
        {adj.map((a) => (
          <li key={a.id} className="space-y-1 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2"><Badge tone={a.status === 'APPROVED' ? 'green' : a.status === 'PENDING' ? 'gold' : 'red'}>{t(`adj${a.status}` as 'adjPENDING')}</Badge><span className="text-muted">{t(`adjKind${a.kind}` as 'adjKindCORRECTION')}</span></span>
              <Money value={a.delta} strong />
            </div>
            <p>{a.reason}</p>
            <p className="text-muted">{[a.createdByName, f.dateTime(a.createdAt), a.approvedByName ? t('approvedBy', { name: a.approvedByName }) : null].filter(Boolean).join(' · ')}</p>
            {a.status === 'PENDING' && canDecide && (
              <div className="flex gap-2 pt-1">
                {(['approve', 'reject'] as const).map((d) => (
                  <Button key={d} size="sm" variant={d === 'approve' ? 'primary' : 'secondary'} onClick={() => decide.mutate({ id: deal.id, adjustmentId: a.id, decision: d }, { onSuccess: () => toast({ tone: 'success', title: t('decided') }), onError: (e) => toast({ tone: 'danger', title: apiErr(e).message }) })}>
                    {t(d)}
                  </Button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
