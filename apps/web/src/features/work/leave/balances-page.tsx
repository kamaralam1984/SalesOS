'use client';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { Play, SlidersHorizontal } from 'lucide-react';
import { Button, Dialog, DialogContent, FormField, Input, PageHeader, Pagination, Select, Textarea, useToast } from '@salesos/ui';
import { RequirePermission } from '@/features/auth/require-permission';
import { MutationAlert, QueryState, useFormErrors } from '@/features/people/hub/shared';
import { useTeamMemberOptions } from '@/features/people/common/api';
import { useAdjustBalance, useLeaveBalances, useLeaveLedger, useLeaveTypes, useRunEarnedLeave } from '@/lib/api/hooks/work-leave';
import { useWhen } from '../attendance/format';
import { EarnedLeaveCard, EarnedLeaveHistory } from './earned-leave-card';
import { BalanceCards } from './leave-page';
import { trimDays } from './leave-logic';

export function BalancesPage() {
  return (
    <RequirePermission permission="leave:balance:adjust">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('workBalances');
  const { toast } = useToast();
  const people = useTeamMemberOptions(true);
  const [userId, setUserId] = React.useState('');
  const [adjust, setAdjust] = React.useState(false);
  const run = useRunEarnedLeave();
  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={
          userId ? (
            <>
              <Button variant="secondary" leadingIcon={<Play aria-hidden="true" />} loading={run.isPending} onClick={() => run.mutate(userId, { onSuccess: (r) => toast({ tone: 'success', title: t('runDone', { n: r.credits }) }) })}>{t('run')}</Button>
              <Button className="glow-gold glow-hover" leadingIcon={<SlidersHorizontal aria-hidden="true" />} onClick={() => setAdjust(true)}>{t('adjust')}</Button>
            </>
          ) : undefined
        }
      />
      <FormField label={t('employee')} className="mb-5 max-w-sm">
        <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">{t('pick')}</option>
          {(people.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </FormField>
      <MutationAlert error={run.error} />
      {userId ? (
        <Employee key={userId} userId={userId} />
      ) : (
        <p className="text-sm text-muted">{t('pickHint')}</p>
      )}
      {adjust && userId && <AdjustDialog userId={userId} onOpenChange={setAdjust} />}
    </>
  );
}

function Employee({ userId }: { userId: string }) {
  const t = useTranslations('workBalances');
  const tc = useTranslations('common');
  const tl = useTranslations('workLeave');
  const w = useWhen();
  const [page, setPage] = React.useState(1);
  const balances = useLeaveBalances(userId);
  const ledger = useLeaveLedger({ userId, page, limit: 10 });
  return (
    <div className="enter-up min-w-0 max-w-full space-y-6">
      <QueryState query={balances} isEmpty={(balances.data?.length ?? 0) === 0} emptyTitle={tl('balances.empty')}>
        <BalanceCards balances={balances.data ?? []} />
      </QueryState>
      <EarnedLeaveCard userId={userId} />
      <section aria-labelledby="bal-ledger">
        <h2 id="bal-ledger" className="mb-2 font-display text-lg font-semibold text-ink">{t('ledger')}</h2>
        <QueryState query={ledger} isEmpty={(ledger.data?.items.length ?? 0) === 0} emptyTitle={tl('ledger.empty')} emptyDescription={tl('ledger.emptyBody')}>
          <ul className="stagger-fast divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface" aria-label={t('ledger')}>
            {(ledger.data?.items ?? []).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 transition-colors hover:bg-ivory-100">
                <span className="min-w-0 break-words">
                  <span className="block text-sm font-medium text-ink">{tl(`ledger.kind.${r.kind}` as never)} · {r.typeKey}</span>
                  <span className="text-xs text-muted">{w.dateTime(r.createdAt)} · {r.createdByName ?? tl('ledger.system')}{r.note ? ` · ${r.note}` : ''}</span>
                </span>
                <span className="text-right text-sm tabular-nums">
                  <span className={Number(r.amount) < 0 ? 'text-red-700' : 'text-green-700'}>{Number(r.amount) > 0 ? '+' : ''}{trimDays(r.amount)}</span>
                  <span className="block text-xs text-muted">{tl('ledger.balance', { n: trimDays(r.balanceAfter) })}</span>
                </span>
              </li>
            ))}
          </ul>
          {(ledger.data?.hasMore || page > 1) && (
            <Pagination className="mt-4" page={page} hasNext={Boolean(ledger.data?.hasMore)} onPageChange={setPage} labels={{ nav: tc('pagination'), previous: tc('previous'), next: tc('next'), summary: () => '', page: () => '', pageOnly: (p) => tc('paginationPageOnly', { page: p }) }} />
          )}
        </QueryState>
      </section>
      <section aria-labelledby="bal-el">
        <h2 id="bal-el" className="mb-2 font-display text-lg font-semibold text-ink">{t('elHistory')}</h2>
        <EarnedLeaveHistory userId={userId} />
      </section>
    </div>
  );
}

const schema = z.object({
  typeKey: z.string().min(1, 'required'),
  kind: z.enum(['ADJUSTMENT', 'OPENING']),
  amount: z.string().trim().regex(/^-?\d{1,4}(\.\d{1,2})?$/, 'badAmount').refine((s) => Number(s) !== 0, 'badAmount'),
  reason: z.string().trim().min(5, 'reasonShort').max(500, 'tooLong'),
});
type Values = z.infer<typeof schema>;

function AdjustDialog({ userId, onOpenChange }: { userId: string; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('workBalances');
  const tc = useTranslations('common');
  const fe = useFormErrors('workBalances');
  const { toast } = useToast();
  const types = useLeaveTypes();
  const adjust = useAdjustBalance();
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { typeKey: '', kind: 'ADJUSTMENT', amount: '', reason: '' } });
  const formId = React.useId();
  const submit = handleSubmit(async (v) => {
    try {
      await adjust.mutateAsync({ userId, typeKey: v.typeKey, kind: v.kind, amount: v.amount.trim(), reason: v.reason.trim() });
      toast({ tone: 'success', title: t('done') });
      onOpenChange(false);
    } catch {
      /* shown in the dialog */
    }
  });
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        title={t('adjustTitle')}
        description={t('adjustBody')}
        closeLabel={tc('close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button>
            <Button type="submit" form={formId} loading={adjust.isPending}>{t('submit')}</Button>
          </>
        }
      >
        <form id={formId} onSubmit={submit} noValidate className="space-y-4" aria-label={t('adjustTitle')}>
          <FormField label={t('type')} error={fe(formState.errors.typeKey)} required>
            <Select {...register('typeKey')}>
              <option value="">{t('typePrompt')}</option>
              {(types.data ?? []).filter((x) => x.needsBalance).map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
            </Select>
          </FormField>
          <FormField label={t('kind')}>
            <Select {...register('kind')}>{(['ADJUSTMENT', 'OPENING'] as const).map((k) => <option key={k} value={k}>{t(`kindOption.${k}` as never)}</option>)}</Select>
          </FormField>
          <FormField label={t('amount')} hint={t('amountHint')} error={fe(formState.errors.amount)} required><Input inputMode="decimal" {...register('amount')} /></FormField>
          <FormField label={t('reason')} error={fe(formState.errors.reason)} required><Textarea rows={3} {...register('reason')} /></FormField>
          <MutationAlert error={adjust.error} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
