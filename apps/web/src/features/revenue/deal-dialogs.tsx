'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Combobox, Dialog, DialogContent, FormField, Input, Select, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from '@salesos/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-provider';
import { useAssignableUsers, useLeadMeta } from '@/lib/api/hooks/crm';
import {
  useAdjustSale,
  useCloseDeal,
  useCreateDeal,
  useEscalateDeal,
  useLeadSearch,
  usePrograms,
  useRecordPayment,
  useRequestRefund,
  type DealDetail,
  type PaymentMethod,
} from '@/lib/api/hooks/revenue';
import { Money, useRevFormat } from './common';
import { MoneyInput, ReasonDialog, useSubmit } from './forms';
import { addMoney, cmpMoney, equalShares, isMoneyInput, normalizeMoney, splitState, subMoney, todayIst, type CreditRow } from './lib';
import { Hint } from '@/features/hints/hint-views';

/* ------------------------------------------------------------------ new deal */
export function NewDealDialog({ open, onOpenChange, leadId, leadName }: { open: boolean; onOpenChange: (o: boolean) => void; leadId?: string; leadName?: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <NewDealBody onOpenChange={onOpenChange} leadId={leadId} leadName={leadName} />}
    </Dialog>
  );
}

function NewDealBody({ onOpenChange, leadId, leadName }: { onOpenChange: (o: boolean) => void; leadId?: string; leadName?: string }) {
  const t = useTranslations('revenue.newDeal');
  const tc = useTranslations('common');
  const programs = usePrograms();
  const create = useCreateDeal();
  const [lead, setLead] = React.useState<string | null>(leadId ?? null);
  const [q, setQ] = React.useState('');
  const search = useLeadSearch(q);
  const [programId, setProgramId] = React.useState('');
  const [dealType, setDealType] = React.useState('NEW');
  const [fromProgramId, setFromProgramId] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [expected, setExpected] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  const { run, error, pending } = useSubmit(close, t('created'));
  const options = (search.data ?? []).map((l) => ({ value: l.id, label: l.fullName, description: l.status }));
  if (leadId && leadName && !options.some((o) => o.value === leadId)) options.unshift({ value: leadId, label: leadName, description: '' });
  const problems = {
    lead: !lead,
    program: !programId,
    amount: !isMoneyInput(amount),
    from: dealType === 'UPSELL' && !fromProgramId,
  };
  return (
    <DialogContent
      size="md"
      title={t('title')}
      description={t('description')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={close}>{tc('cancel')}</Button>
          <Button type="submit" form="new-deal-form" loading={pending} loadingLabel={tc('saving')}>{t('submit')}</Button>
        </>
      }
    >
      <form
        id="new-deal-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (Object.values(problems).some(Boolean)) return;
          void run(() => create.mutateAsync({ leadId: lead!, programId, amount: normalizeMoney(amount), dealType, ...(dealType === 'UPSELL' ? { fromProgramId } : {}), ...(expected ? { expectedCloseOn: expected } : {}) }));
        }}
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <FormField label={t('lead')} required error={touched && problems.lead ? t('leadRequired') : undefined} hint={t('leadHint')}>
          <Combobox options={options} value={lead} onValueChange={setLead} onQueryChange={setQ} loading={search.isFetching} placeholder={t('leadPlaceholder')} emptyText={t('leadEmpty')} disabled={Boolean(leadId)} />
        </FormField>
        <FormField label={t('program')} required error={touched && problems.program ? t('programRequired') : undefined}>
          <Select value={programId} onChange={(e) => setProgramId(e.target.value)}>
            <option value="">{t('choose')}</option>
            {(programs.data ?? []).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </Select>
        </FormField>
        <FormField label={t('type')}>
          <Select value={dealType} onChange={(e) => setDealType(e.target.value)}>
            <option value="NEW">{t('typeNEW')}</option>
            <option value="UPSELL">{t('typeUPSELL')}</option>
            <option value="CROSS_SELL">{t('typeCROSS_SELL')}</option>
          </Select>
        </FormField>
        {dealType === 'UPSELL' && (
          <FormField label={t('fromProgram')} required error={touched && problems.from ? t('fromRequired') : undefined}>
            <Select value={fromProgramId} onChange={(e) => setFromProgramId(e.target.value)}>
              <option value="">{t('choose')}</option>
              {(programs.data ?? []).filter((p) => p.id !== programId).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </Select>
          </FormField>
        )}
        <FormField label={t('amount')} required hint={t('amountHint')} error={touched && problems.amount ? t('amountInvalid') : undefined}>
          <MoneyInput value={amount} onChange={setAmount} invalid={touched && problems.amount} />
        </FormField>
        <FormField label={t('expected')} hint={t('expectedHint')}>
          <Input type="date" value={expected} min={todayIst()} onChange={(e) => setExpected(e.target.value)} />
        </FormField>
      </form>
    </DialogContent>
  );
}

/* ------------------------------------------------------------------ close won / lost (ONE transaction on the server) */
export function CloseDealDialog({ open, onOpenChange, deal }: { open: boolean; onOpenChange: (o: boolean) => void; deal: Pick<DealDetail, 'id' | 'amount' | 'ownerId' | 'ownerName' | 'leadName'> }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <CloseBody onOpenChange={onOpenChange} deal={deal} />}
    </Dialog>
  );
}

interface Installment {
  amount: string;
  dueDate: string;
}

function CloseBody({ onOpenChange, deal }: { onOpenChange: (o: boolean) => void; deal: Pick<DealDetail, 'id' | 'amount' | 'ownerId' | 'ownerName' | 'leadName'> }) {
  const t = useTranslations('revenue.close');
  const tc = useTranslations('common');
  const { can } = useAuth();
  const meta = useLeadMeta();
  const close = useCloseDeal();
  const f = useRevFormat();
  const [tab, setTab] = React.useState<'WON' | 'LOST'>('WON');
  const [final, setFinal] = React.useState(deal.amount ?? '');
  const [plan, setPlan] = React.useState<Installment[]>([]);
  const [useSplit, setUseSplit] = React.useState(false);
  const [credits, setCredits] = React.useState<CreditRow[]>([{ userId: deal.ownerId, sharePct: '100' }]);
  const users = useAssignableUsers();
  const [lostReason, setLostReason] = React.useState('');
  const [lostNote, setLostNote] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const done = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  const { run, error, pending } = useSubmit(done);
  const planTotal = plan.reduce((a, p) => (isMoneyInput(p.amount) ? addMoney(a, normalizeMoney(p.amount)) : a), '0.00');
  const finalOk = isMoneyInput(final);
  const planDiff = finalOk && plan.length > 0 ? subMoney(normalizeMoney(final), planTotal) : '0.00';
  const planOk = plan.length === 0 || (cmpMoney(planDiff, '0.00') === 0 && plan.every((p) => isMoneyInput(p.amount) && p.dueDate));
  const lostCfg = meta.data?.lostReasons.find((r) => r.key === lostReason);
  const canSplit = can('targets:approve');
  const split = splitState(credits);
  const wonProblems = !finalOk || !planOk || (useSplit && canSplit && !split.ok);
  const lostProblems = !lostReason || (lostCfg?.requiresNote && !lostNote.trim());

  return (
    <DialogContent
      size="lg"
      title={t('title')}
      description={t('description', { name: deal.leadName ?? '' })}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={done}>{tc('cancel')}</Button>
          <Button type="submit" form="close-form" variant={tab === 'LOST' ? 'danger' : 'gold'} loading={pending} loadingLabel={tc('saving')}>{tab === 'WON' ? t('submitWon') : t('submitLost')}</Button>
        </>
      }
    >
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'WON' | 'LOST')}>
        <TabsList aria-label={t('outcome')}>
          <TabsTrigger value="WON">{t('won')}</TabsTrigger>
          <TabsTrigger value="LOST">{t('lost')}</TabsTrigger>
        </TabsList>
        <form
          id="close-form"
          noValidate
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (tab === 'WON') {
              if (wonProblems) return;
              void run(() =>
                close.mutateAsync({
                  id: deal.id,
                  body: {
                    outcome: 'WON',
                    finalAmount: normalizeMoney(final),
                    ...(plan.length ? { paymentPlan: plan.map((p) => ({ amount: normalizeMoney(p.amount), dueDate: p.dueDate })) } : {}),
                    ...(useSplit && canSplit ? { credits: credits.map((c) => ({ userId: c.userId, sharePct: c.sharePct.trim() })) } : {}),
                  },
                }),
              );
            } else {
              if (lostProblems) return;
              void run(() => close.mutateAsync({ id: deal.id, body: { outcome: 'LOST', lostReason, ...(lostNote.trim() ? { lostNote: lostNote.trim() } : {}) } }));
            }
          }}
        >
          {error && <Alert tone="danger">{error}</Alert>}
          <TabsContent value="WON" className="space-y-4">
            <Alert tone="info"><span className="inline-flex items-center gap-1">{t('notPaid')} <Hint id="dealClosedWon" /></span></Alert>
            <FormField label={t('finalAmount')} required hint={t('finalHint')} info={<Hint id="dealFinalValue" />} error={touched && !finalOk ? t('amountInvalid') : undefined}>
              <MoneyInput value={final} onChange={setFinal} invalid={touched && !finalOk} />
            </FormField>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-ink">{t('planTitle')}</legend>
              <p className="text-[0.8125rem] text-muted">{t('planHint')}</p>
              {plan.map((p, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
                  <FormField label={t('installmentAmount', { n: i + 1 })} hideLabel={false}>
                    <MoneyInput value={p.amount} onChange={(v) => setPlan(plan.map((x, j) => (j === i ? { ...x, amount: v } : x)))} />
                  </FormField>
                  <FormField label={t('dueDate')}>
                    <Input type="date" value={p.dueDate} min={todayIst()} onChange={(e) => setPlan(plan.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} />
                  </FormField>
                  <Button type="button" variant="ghost" size="icon" aria-label={t('removeInstallment', { n: i + 1 })} onClick={() => setPlan(plan.filter((_, j) => j !== i))}>
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="secondary" size="sm" onClick={() => setPlan([...plan, { amount: '', dueDate: '' }])}>
                <Plus className="size-4" aria-hidden="true" />
                {t('addInstallment')}
              </Button>
              {plan.length > 0 && (
                <p role="status" className={cmpMoney(planDiff, '0.00') === 0 ? 'text-sm text-green-700' : 'text-sm font-medium text-red-700'}>
                  {cmpMoney(planDiff, '0.00') === 0 ? t('planBalanced', { total: f.money(planTotal) }) : t('planDiff', { total: f.money(planTotal), diff: f.money(planDiff) })}
                </p>
              )}
            </fieldset>
            {canSplit && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 size-4" checked={useSplit} onChange={(e) => setUseSplit(e.target.checked)} />
                <span>
                  <span className="font-medium text-ink">{t('credit')}</span>
                  <span className="block text-muted">{t('creditHint', { owner: deal.ownerName ?? '' })}</span>
                </span>
              </label>
            )}
            {canSplit && useSplit && (
              <fieldset className="space-y-2 rounded-lg border border-line p-3" data-testid="credit-split">
                <legend className="px-1 text-sm font-medium text-ink">{t('splitTitle')}</legend>
                <p className="text-[0.8125rem] text-muted">{t('splitHint')}</p>
                {credits.map((c, i) => (
                  <div key={i} className="grid grid-cols-[1fr_7rem_auto] items-end gap-2">
                    <FormField label={t('splitUser', { n: i + 1 })}>
                      <Select value={c.userId} onChange={(e) => setCredits(credits.map((x, j) => (j === i ? { ...x, userId: e.target.value } : x)))}>
                        <option value="">{t('choose')}</option>
                        {(users.data ?? []).map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}
                        {c.userId && !(users.data ?? []).some((u) => u.id === c.userId) && <option value={c.userId}>{c.userId === deal.ownerId ? (deal.ownerName ?? c.userId) : c.userId}</option>}
                      </Select>
                    </FormField>
                    <FormField label={t('splitShare', { n: i + 1 })}>
                      <Input inputMode="decimal" value={c.sharePct} onChange={(e) => setCredits(credits.map((x, j) => (j === i ? { ...x, sharePct: e.target.value } : x)))} />
                    </FormField>
                    <Button type="button" variant="ghost" size="icon" aria-label={t('splitRemove', { n: i + 1 })} disabled={credits.length === 1} onClick={() => setCredits(credits.filter((_, j) => j !== i))}>
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" size="sm" disabled={credits.length >= 10} onClick={() => setCredits([...credits, { userId: '', sharePct: '' }])}>
                    <Plus className="size-4" aria-hidden="true" />
                    {t('splitAdd')}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => { const eq = equalShares(credits.length); setCredits(credits.map((c, i) => ({ ...c, sharePct: eq[i]! }))); }}>{t('splitEqual')}</Button>
                </div>
                <p role="status" className={split.ok ? 'text-sm text-green-700' : 'text-sm font-medium text-red-700'}>
                  {split.ok ? t('splitBalanced') : split.problems.includes('DUPLICATE_USER') ? t('splitDuplicate') : split.problems.includes('USER_MISSING') ? t('splitUserMissing') : split.problems.includes('SHARE_INVALID') ? t('splitShareInvalid') : t('splitTotal', { total: split.total, remaining: split.remaining })}
                </p>
              </fieldset>
            )}
          </TabsContent>
          <TabsContent value="LOST" className="space-y-4">
            <FormField label={t('lostReason')} required error={touched && !lostReason ? t('lostReasonRequired') : undefined}>
              <Select value={lostReason} onChange={(e) => setLostReason(e.target.value)}>
                <option value="">{t('choose')}</option>
                {(meta.data?.lostReasons ?? []).map((r) => (<option key={r.key} value={r.key}>{r.label}</option>))}
              </Select>
            </FormField>
            <FormField label={t('lostNote')} required={Boolean(lostCfg?.requiresNote)} error={touched && lostCfg?.requiresNote && !lostNote.trim() ? t('lostNoteRequired') : undefined}>
              <Textarea rows={3} value={lostNote} onChange={(e) => setLostNote(e.target.value)} maxLength={1000} />
            </FormField>
          </TabsContent>
        </form>
      </Tabs>
    </DialogContent>
  );
}

/* ------------------------------------------------------------------ escalate */
export function EscalateDialog({ open, onOpenChange, dealId }: { open: boolean; onOpenChange: (o: boolean) => void; dealId: string }) {
  const t = useTranslations('revenue.escalate');
  const esc = useEscalateDeal();
  const [help, setHelp] = React.useState('');
  const [founder, setFounder] = React.useState(false);
  return (
    <ReasonDialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) { setHelp(''); setFounder(false); }
      }}
      title={t('title')}
      description={t('description')}
      label={t('note')}
      submitLabel={t('submit')}
      successTitle={t('done')}
      extra={
        <>
          <FormField label={t('help')}>
            <Input value={help} onChange={(e) => setHelp(e.target.value)} maxLength={500} />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={founder} onChange={(e) => setFounder(e.target.checked)} />
            {t('toFounder')}
          </label>
        </>
      }
      onSubmit={(note) => esc.mutateAsync({ id: dealId, note, ...(help.trim() ? { requestedHelp: help.trim() } : {}), escalateToFounder: founder })}
    />
  );
}

/* ------------------------------------------------------------------ record payment */
const METHODS: PaymentMethod[] = ['UPI', 'BANK_TRANSFER', 'CARD', 'CASH', 'CHEQUE', 'GATEWAY', 'OTHER'];

export function RecordPaymentDialog({ open, onOpenChange, deal }: { open: boolean; onOpenChange: (o: boolean) => void; deal: Pick<DealDetail, 'id' | 'leadName' | 'payments' | 'money'> }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <RecordBody onOpenChange={onOpenChange} deal={deal} />}
    </Dialog>
  );
}

function RecordBody({ onOpenChange, deal }: { onOpenChange: (o: boolean) => void; deal: Pick<DealDetail, 'id' | 'leadName' | 'payments' | 'money'> }) {
  const t = useTranslations('revenue.record');
  const tc = useTranslations('common');
  const tm = useTranslations('revenue.method');
  const f = useRevFormat();
  const record = useRecordPayment();
  const open = (deal.payments ?? []).filter((p) => p.status === 'EXPECTED' || p.status === 'REJECTED');
  const [expectedId, setExpectedId] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [method, setMethod] = React.useState<PaymentMethod>('UPI');
  const [ref, setRef] = React.useState('');
  const [paidAt, setPaidAt] = React.useState(() => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 16));
  const [note, setNote] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const done = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  const { run, error, pending } = useSubmit(done, t('done'));
  const bad = { amount: !isMoneyInput(amount), ref: ref.trim().length < 3, paid: !paidAt };
  return (
    <DialogContent
      size="md"
      title={t('title')}
      description={t('description', { name: deal.leadName ?? '' })}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={done}>{tc('cancel')}</Button>
          <Button type="submit" form="record-form" loading={pending} loadingLabel={tc('saving')}>{t('submit')}</Button>
        </>
      }
    >
      <form
        id="record-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (Object.values(bad).some(Boolean)) return;
          // the form time is IST wall-clock; send an ISO instant
          const iso = new Date(`${paidAt}:00+05:30`).toISOString();
          void run(() => record.mutateAsync({ dealId: deal.id, amount: normalizeMoney(amount), method, externalTransactionRef: ref.trim(), paidAt: iso, ...(expectedId ? { expectedPaymentId: expectedId } : {}), ...(note.trim() ? { note: note.trim() } : {}) }));
        }}
      >
        <Alert tone="info">{t('notCredited')}</Alert>
        {error && <Alert tone="danger">{error}</Alert>}
        {deal.money && <p className="text-sm text-muted">{t('due', { due: f.money(deal.money.amountDue), pending: f.money(deal.money.pendingVerification) })}</p>}
        {open.length > 0 && (
          <FormField label={t('installment')} hint={t('installmentHint')}>
            <Select
              value={expectedId}
              onChange={(e) => {
                setExpectedId(e.target.value);
                const p = open.find((x) => x.id === e.target.value);
                if (p) setAmount(p.expectedAmount ?? p.amount);
              }}
            >
              <option value="">{t('newPayment')}</option>
              {open.map((p) => (<option key={p.id} value={p.id}>{`${f.money(p.expectedAmount ?? p.amount)} · ${p.dueDate ? f.date(p.dueDate) : '-'}`}</option>))}
            </Select>
          </FormField>
        )}
        <FormField label={t('amount')} required error={touched && bad.amount ? t('amountInvalid') : undefined}>
          <MoneyInput value={amount} onChange={setAmount} invalid={touched && bad.amount} />
        </FormField>
        <FormField label={t('method')} required>
          <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {METHODS.map((m) => (<option key={m} value={m}>{tm(m)}</option>))}
          </Select>
        </FormField>
        <FormField label={t('ref')} required hint={t('refHint')} info={<Hint id="paymentReference" />} error={touched && bad.ref ? t('refInvalid') : undefined}>
          <Input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={120} autoComplete="off" />
        </FormField>
        <FormField label={t('paidAt')} required>
          <Input type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </FormField>
        <FormField label={t('note')}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </FormField>
      </form>
    </DialogContent>
  );
}

/* ------------------------------------------------------------------ request refund */
const REASONS = ['LEARNER_REQUEST', 'DUPLICATE_PAYMENT', 'PROGRAM_CANCELLED', 'MISSELLING', 'TECHNICAL', 'OTHER'] as const;

export function RequestRefundDialog({ open, onOpenChange, deal }: { open: boolean; onOpenChange: (o: boolean) => void; deal: Pick<DealDetail, 'id' | 'leadName' | 'money' | 'payments'> }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <RefundBody onOpenChange={onOpenChange} deal={deal} />}
    </Dialog>
  );
}

function RefundBody({ onOpenChange, deal }: { onOpenChange: (o: boolean) => void; deal: Pick<DealDetail, 'id' | 'leadName' | 'money' | 'payments'> }) {
  const t = useTranslations('revenue.refundRequest');
  const tr = useTranslations('revenue.refundReason');
  const tc = useTranslations('common');
  const f = useRevFormat();
  const request = useRequestRefund();
  const refundable = deal.money?.refundable ?? '0.00';
  const [amount, setAmount] = React.useState('');
  const [category, setCategory] = React.useState<(typeof REASONS)[number]>('LEARNER_REQUEST');
  const [reason, setReason] = React.useState('');
  const [paymentId, setPaymentId] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const done = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  const { run, error, pending } = useSubmit(done, t('done'));
  const verified = (deal.payments ?? []).filter((p) => p.status === 'VERIFIED' || p.status === 'RECONCILED');
  const amountOk = isMoneyInput(amount) && cmpMoney(normalizeMoney(amount), refundable) <= 0;
  const reasonOk = reason.trim().length >= 5;
  return (
    <DialogContent
      size="md"
      title={t('title')}
      description={t('description', { name: deal.leadName ?? '' })}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={done}>{tc('cancel')}</Button>
          <Button type="submit" form="refund-form" loading={pending} loadingLabel={tc('saving')}>{t('submit')}</Button>
        </>
      }
    >
      <form
        id="refund-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!amountOk || !reasonOk) return;
          void run(() => request.mutateAsync({ dealId: deal.id, amount: normalizeMoney(amount), reasonCategory: category, reason: reason.trim(), ...(paymentId ? { paymentId } : {}) }));
        }}
      >
        <Alert tone="info">{t('notAuto')}</Alert>
        {error && <Alert tone="danger">{error}</Alert>}
        <p className="text-sm text-muted">{t('refundable', { amount: f.money(refundable) })}</p>
        <FormField label={t('amount')} required error={touched && !amountOk ? t('amountInvalid', { max: f.money(refundable) }) : undefined}>
          <MoneyInput value={amount} onChange={setAmount} invalid={touched && !amountOk} />
        </FormField>
        {verified.length > 0 && (
          <FormField label={t('payment')} hint={t('paymentHint')}>
            <Select value={paymentId} onChange={(e) => setPaymentId(e.target.value)}>
              <option value="">{t('anyPayment')}</option>
              {verified.map((p) => (<option key={p.id} value={p.id}>{`${f.money(p.amount)} · ${p.externalTransactionRef ?? ''}`}</option>))}
            </Select>
          </FormField>
        )}
        <FormField label={t('category')} required>
          <Select value={category} onChange={(e) => setCategory(e.target.value as (typeof REASONS)[number])}>
            {REASONS.map((r) => (<option key={r} value={r}>{tr(r)}</option>))}
          </Select>
        </FormField>
        <FormField label={t('reason')} required error={touched && !reasonOk ? t('reasonMin') : undefined}>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
        </FormField>
      </form>
    </DialogContent>
  );
}

/* ------------------------------------------------------------------ adjust sale */
export function AdjustSaleDialog({ open, onOpenChange, deal }: { open: boolean; onOpenChange: (o: boolean) => void; deal: Pick<DealDetail, 'id' | 'money'> }) {
  const t = useTranslations('revenue.adjust');
  const adjust = useAdjustSale();
  const { hasRole } = useAuth();
  const [kind, setKind] = React.useState<'CORRECTION' | 'DISCOUNT' | 'CANCELLATION'>('CORRECTION');
  const [delta, setDelta] = React.useState('');
  const [sign, setSign] = React.useState<'-' | '+'>('-');
  const selfApprove = hasRole('FOUNDER_CEO') || hasRole('FINANCE');
  const deltaOk = kind === 'CANCELLATION' || isMoneyInput(delta);
  return (
    <ReasonDialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) { setDelta(''); setKind('CORRECTION'); }
      }}
      title={t('title')}
      description={<>{t('description')} <Money value={deal.money?.originalSaleValue} /></>}
      label={t('reason')}
      minLength={5}
      submitLabel={t('submit')}
      successTitle={selfApprove ? t('done') : t('doneProposed')}
      danger={kind === 'CANCELLATION'}
      extra={
        <>
          {!selfApprove && <Alert tone="info">{t('needsApproval')}</Alert>}
          <FormField label={t('kind')}>
            <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="CORRECTION">{t('kindCORRECTION')}</option>
              <option value="DISCOUNT">{t('kindDISCOUNT')}</option>
              {selfApprove && <option value="CANCELLATION">{t('kindCANCELLATION')}</option>}
            </Select>
          </FormField>
          {kind !== 'CANCELLATION' && (
            <FormField label={t('delta')} required hint={t('deltaHint')} error={!deltaOk && delta ? t('deltaInvalid') : undefined}>
              <div className="flex gap-2">
                <Select aria-label={t('sign')} className="w-24" value={kind === 'DISCOUNT' ? '-' : sign} onChange={(e) => setSign(e.target.value as '+' | '-')} disabled={kind === 'DISCOUNT'}>
                  <option value="-">&minus;</option>
                  <option value="+">+</option>
                </Select>
                <MoneyInput value={delta} onChange={setDelta} />
              </div>
            </FormField>
          )}
          {kind === 'CANCELLATION' && <Alert tone="warning">{t('cancelWarning')}</Alert>}
        </>
      }
      onSubmit={(reason) => {
        const signed = kind === 'CANCELLATION' ? undefined : `${kind === 'DISCOUNT' ? '-' : sign}${normalizeMoney(delta)}`;
        return adjust.mutateAsync({ id: deal.id, kind, reason, ...(signed ? { delta: signed } : {}) });
      }}
    />
  );
}
