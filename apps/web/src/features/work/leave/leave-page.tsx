'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { CalendarPlus } from 'lucide-react';
import { Badge, Button, FormField, PageHeader, Pagination, Panel, Select, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, useToast } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { ConfirmDialog, QueryState } from '@/features/people/hub/shared';
import { useCancelLeave, useLeaveBalances, useLeaveCalendar, useLeaveLedger, useLeaveRequests, type LeaveBalance, type LeaveRequest } from '@/lib/api/hooks/work-leave';
import { addDays, today } from '../attendance/attendance-logic';
import { useWhen } from '../attendance/format';
import { ApplyLeaveDialog } from './apply-dialog';
import { EarnedLeaveCard, EarnedLeaveHistory } from './earned-leave-card';
import { leaveTone, stepTone, trimDays, waitingFor } from './leave-logic';

export function LeavePage() {
  return (
    <RequirePermission permission="leave:apply">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('workLeave');
  const { can } = useAuth();
  const [apply, setApply] = React.useState(false);
  const team = can('leave:view', 'team');
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} actions={<Button leadingIcon={<CalendarPlus aria-hidden="true" />} onClick={() => setApply(true)}>{t('apply.open')}</Button>} />
      <Balances />
      <div className="mt-5"><EarnedLeaveCard /></div>
      <Tabs defaultValue="requests" className="mt-6">
        <TabsList aria-label={t('tabs.label')}>
          <TabsTrigger value="requests">{t('tabs.requests')}</TabsTrigger>
          <TabsTrigger value="ledger">{t('tabs.ledger')}</TabsTrigger>
          <TabsTrigger value="earned">{t('tabs.earned')}</TabsTrigger>
          <TabsTrigger value="calendar">{team ? t('tabs.calendarTeam') : t('tabs.calendar')}</TabsTrigger>
        </TabsList>
        <TabsContent value="requests"><MyRequests /></TabsContent>
        <TabsContent value="ledger"><Ledger /></TabsContent>
        <TabsContent value="earned"><div className="mt-4"><EarnedLeaveHistory /></div></TabsContent>
        <TabsContent value="calendar"><LeaveCalendar /></TabsContent>
      </Tabs>
      {apply && <ApplyLeaveDialog open onOpenChange={setApply} />}
    </>
  );
}

/* ------------------------------------------------------------------ balances */
export function BalanceCards({ balances }: { balances: LeaveBalance[] }) {
  const t = useTranslations('workLeave');
  return (
    <ul className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={t('balances.title')}>
      {balances.filter((b) => b.active || b.balance !== 0).map((b) => (
        <li key={b.typeKey} className="accent-top hover-lift glow-hover rounded-lg border border-line bg-surface p-4">
          <p className="text-sm font-medium text-muted">{b.name}</p>
          {b.needsBalance ? (
            <>
              <p className="kpi-number mt-1 text-3xl text-ink">{trimDays(b.available)}</p>
              <p className="text-sm text-muted">{t('balances.available')}</p>
              <p className="mt-2 text-xs text-muted">{t('balances.detail', { balance: trimDays(b.balance), pending: trimDays(b.pending) })}</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">{b.isPaid ? t('balances.noBalance') : t('balances.unpaidType')}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function Balances() {
  const t = useTranslations('workLeave');
  const q = useLeaveBalances();
  return (
    <QueryState query={q} isEmpty={(q.data?.length ?? 0) === 0} emptyTitle={t('balances.empty')}>
      <BalanceCards balances={q.data ?? []} />
    </QueryState>
  );
}

/* ------------------------------------------------------------------ requests */
export function RequestCard({ r, showPerson, actions }: { r: LeaveRequest; showPerson?: boolean; actions?: React.ReactNode }) {
  const t = useTranslations('workLeave');
  const w = useWhen();
  const waiting = waitingFor(r);
  return (
    <li className="hover-lift rounded-lg border border-line bg-surface p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-ink">
            {showPerson && r.userName ? `${r.userName} · ` : ''}
            {t('requests.range', { type: r.typeKey, from: w.day(r.startDate), to: w.day(r.endDate) })}
          </p>
          <p className="text-sm text-muted">
            {t('requests.days', { n: trimDays(r.days) })}
            {r.halfDay !== 'NONE' ? ` · ${t(`halfDay.${r.halfDay}` as never)}` : ''}
            {Number(r.unpaidDays) > 0 ? ` · ${t('requests.unpaid', { n: trimDays(r.unpaidDays) })}` : ''}
          </p>
        </div>
        <Badge tone={leaveTone(r.status)}>{t(`status.${r.status}` as never)}</Badge>
      </div>
      <p className="mt-2 text-sm text-ink">{r.reason}</p>
      <ol className="mt-2 flex flex-wrap gap-2 text-xs" aria-label={t('requests.steps')}>
        {r.steps.map((s) => (
          <li key={s.step}>
            <Badge tone={stepTone(s.status)}>{t(`step.${s.step}` as never)}: {t(`stepStatus.${s.status}` as never)}{s.actorName ? ` (${s.actorName})` : ''}</Badge>
          </li>
        ))}
      </ol>
      {waiting && <p className="mt-1 text-xs text-muted">{t('requests.waiting', { step: t(`step.${waiting}` as never) })}</p>}
      {r.cancelReason && <p className="mt-1 text-sm text-muted">{t('requests.cancelReason', { reason: r.cancelReason })}</p>}
      {r.steps.some((s) => s.comment && s.status !== 'SKIPPED') && (
        <ul className="mt-1 text-sm text-muted">{r.steps.filter((s) => s.comment && s.status !== 'SKIPPED').map((s) => <li key={s.step}>{t(`step.${s.step}` as never)}: {s.comment}</li>)}</ul>
      )}
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </li>
  );
}

function MyRequests() {
  const t = useTranslations('workLeave');
  const tc = useTranslations('common');
  const { toast } = useToast();
  const [page, setPage] = React.useState(1);
  const [cancel, setCancel] = React.useState<LeaveRequest | null>(null);
  const [reason, setReason] = React.useState('');
  const q = useLeaveRequests({ view: 'mine', page, limit: 10 });
  const cancelM = useCancelLeave();
  return (
    <div className="mt-4">
      <QueryState query={q} isEmpty={(q.data?.items.length ?? 0) === 0} emptyTitle={t('requests.empty')} emptyDescription={t('requests.emptyBody')}>
        <ul className="stagger space-y-2" aria-label={t('tabs.requests')}>
          {(q.data?.items ?? []).map((r) => (
            <RequestCard key={r.id} r={r} actions={r.can.cancel ? <Button size="sm" variant="ghost" onClick={() => { setReason(''); setCancel(r); }}>{t('requests.cancel')}</Button> : undefined} />
          ))}
        </ul>
        {(q.data?.hasMore || page > 1) && (
          <Pagination className="mt-4" page={page} hasNext={Boolean(q.data?.hasMore)} onPageChange={setPage} labels={{ nav: tc('pagination'), previous: tc('previous'), next: tc('next'), summary: () => '', page: () => '', pageOnly: (p) => tc('paginationPageOnly', { page: p }) }} />
        )}
      </QueryState>
      {cancel && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setCancel(null)}
          title={t('requests.cancelTitle')}
          description={t('requests.cancelBody')}
          confirmLabel={t('requests.cancel')}
          danger
          pending={cancelM.isPending}
          error={cancelM.error}
          disabled={reason.trim().length < 3}
          onConfirm={() => cancelM.mutate({ id: cancel.id, reason: reason.trim() }, { onSuccess: () => { toast({ tone: 'success', title: t('requests.cancelled') }); setCancel(null); } })}
        >
          <FormField label={t('requests.cancelReasonLabel')} required><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
        </ConfirmDialog>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ ledger */
function Ledger() {
  const t = useTranslations('workLeave');
  const tc = useTranslations('common');
  const w = useWhen();
  const types = useLeaveBalances();
  const [typeKey, setTypeKey] = React.useState('');
  const [page, setPage] = React.useState(1);
  const q = useLeaveLedger({ typeKey, page, limit: 10 });
  return (
    <div className="mt-4 space-y-4">
      <FormField label={t('ledger.type')} className="max-w-xs">
        <Select value={typeKey} onChange={(e) => { setTypeKey(e.target.value); setPage(1); }}>
          <option value="">{t('ledger.allTypes')}</option>
          {(types.data ?? []).filter((b) => b.needsBalance).map((b) => <option key={b.typeKey} value={b.typeKey}>{b.name}</option>)}
        </Select>
      </FormField>
      <QueryState query={q} isEmpty={(q.data?.items.length ?? 0) === 0} emptyTitle={t('ledger.empty')} emptyDescription={t('ledger.emptyBody')}>
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface" aria-label={t('tabs.ledger')}>
          {(q.data?.items ?? []).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{t(`ledger.kind.${r.kind}` as never)} · {r.typeKey}</span>
                <span className="text-xs text-muted">{w.dateTime(r.createdAt)} · {r.createdByName ?? t('ledger.system')}{r.note ? ` · ${r.note}` : ''}</span>
              </span>
              <span className="text-right text-sm tabular-nums">
                <span className={Number(r.amount) < 0 ? 'text-red-700' : 'text-green-700'}>{Number(r.amount) > 0 ? '+' : ''}{trimDays(r.amount)}</span>
                <span className="block text-xs text-muted">{t('ledger.balance', { n: trimDays(r.balanceAfter) })}</span>
              </span>
            </li>
          ))}
        </ul>
        {(q.data?.hasMore || page > 1) && (
          <Pagination className="mt-4" page={page} hasNext={Boolean(q.data?.hasMore)} onPageChange={setPage} labels={{ nav: tc('pagination'), previous: tc('previous'), next: tc('next'), summary: () => '', page: () => '', pageOnly: (p) => tc('paginationPageOnly', { page: p }) }} />
        )}
      </QueryState>
    </div>
  );
}

/* ------------------------------------------------------------------ calendar */
function LeaveCalendar() {
  const t = useTranslations('workLeave');
  const w = useWhen();
  const from = today();
  const q = useLeaveCalendar(from, addDays(from, 60));
  return (
    <div className="mt-4">
      <Panel title={t('calendar.title')} description={t('calendar.description')}>
        <QueryState query={q} isEmpty={(q.data?.length ?? 0) === 0} emptyTitle={t('calendar.empty')}>
          <ul className="space-y-2">
            {(q.data ?? []).map((e) => (
              <li key={e.requestId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-ink">{e.userName ?? '—'} · {e.typeKey}</span>
                <span className="text-muted">{w.day(e.startDate)}{e.endDate !== e.startDate ? ` – ${w.day(e.endDate)}` : ''}</span>
                <Badge tone={e.status === 'APPROVED' ? 'green' : 'gold'}>{e.status === 'APPROVED' ? t('status.APPROVED') : t('calendar.pending')}</Badge>
              </li>
            ))}
          </ul>
        </QueryState>
      </Panel>
    </div>
  );
}
