'use client';
import * as React from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge, Button, Dialog, DialogContent, FormField, Input, PageHeader, Pagination, Select, Textarea, useToast, type Tone } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { MutationAlert, QueryState, useFormErrors } from '@/features/people/hub/shared';
import { useProbationDecision, useProbationHistory, useProbationList, type ProbationDecision, type ProbationRow, type ProbationState } from '@/lib/api/hooks/work-hr';
import { useDates } from '../common';
import { HrProfileDialog } from './hr-profile-dialog';

export function ProbationPage() {
  return (
    <RequirePermission permission="workforce:reports:view">
      <Inner />
    </RequirePermission>
  );
}

export const stateTone = (s: ProbationState): Tone => (s === 'CONFIRMED' ? 'green' : s === 'DECISION_DUE' ? 'red' : s === 'ENDING_SOON' || s === 'UNDER_REVIEW' ? 'gold' : 'blue');
const STATUSES = ['ACTIVE', 'IN_PROBATION', 'ENDING_SOON', 'DECISION_DUE', 'UNDER_REVIEW', 'CONFIRMED', 'ALL'] as const;

function Inner() {
  const t = useTranslations('workHr');
  const tc = useTranslations('common');
  const { can } = useAuth();
  const dates = useDates();
  const [status, setStatus] = React.useState<(typeof STATUSES)[number]>('ACTIVE');
  const [days, setDays] = React.useState('30');
  const [page, setPage] = React.useState(1);
  const q = useProbationList({ status, days: Number(days), page, limit: 20 });
  const [decide, setDecide] = React.useState<ProbationRow | null>(null);
  const [history, setHistory] = React.useState<ProbationRow | null>(null);
  const [edit, setEdit] = React.useState<ProbationRow | null>(null);
  const counts = q.data?.counts ?? {};
  return (
    <>
      <PageHeader eyebrow={t('probation.eyebrow')} title={t('probation.title')} description={t('probation.description')} />
      <div className="stagger mb-4 grid gap-3 sm:grid-cols-3">
        <FormField label={t('probation.filterStatus')}>
          <Select value={status} onChange={(e) => { setStatus(e.target.value as (typeof STATUSES)[number]); setPage(1); }}>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`probation.filter.${s}` as never)}</option>)}
          </Select>
        </FormField>
        <FormField label={t('probation.soonDays')}>
          <Select value={days} onChange={(e) => { setDays(e.target.value); setPage(1); }}>
            {['7', '14', '30', '60'].map((d) => <option key={d} value={d}>{t('probation.nDays', { n: Number(d) })}</option>)}
          </Select>
        </FormField>
      </div>
      {Object.keys(counts).length > 0 && (
        <ul className="mb-4 flex flex-wrap gap-2" aria-label={t('probation.counts')}>
          {Object.entries(counts).map(([s, n]) => <li key={s}><Badge tone={stateTone(s as ProbationState)}>{t(`probation.state.${s}` as never)}: {n}</Badge></li>)}
        </ul>
      )}
      <QueryState query={q} isEmpty={(q.data?.items.length ?? 0) === 0} emptyTitle={t('probation.empty')} emptyDescription={t('probation.emptyBody')}>
        <ul className="stagger space-y-2" aria-label={t('probation.title')}>
          {(q.data?.items ?? []).map((r) => (
            <li key={r.userId} className="hover-lift rounded-lg border border-line bg-surface p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/work/people/${r.userId}`} className="font-medium text-ink hover:underline">{r.name}</Link>
                  <p className="text-sm text-muted">{[r.positionTitle, r.department, r.managerName ? t('probation.manager', { name: r.managerName }) : null].filter(Boolean).join(' · ')}</p>
                  <p className="text-sm text-muted">{t('probation.period', { start: dates.date(r.startDate), end: dates.date(r.endDate), months: r.months })}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge tone={stateTone(r.state)}>{t(`probation.state.${r.state}` as never)}</Badge>
                  <span className="text-xs text-muted">{r.daysLeft >= 0 ? t('probation.daysLeft', { n: r.daysLeft }) : t('probation.daysOver', { n: -r.daysLeft })}</span>
                  {r.extensions > 0 && <span className="text-xs text-muted">{t('probation.extended', { n: r.extensions })}</span>}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {can('onboarding:manage') && r.state !== 'CONFIRMED' && <Button size="sm" onClick={() => setDecide(r)}>{t('probation.decide')}</Button>}
                {can('onboarding:manage') && <Button size="sm" variant="secondary" onClick={() => setHistory(r)}>{t('probation.history')}</Button>}
                {can('hr:records:manage') && <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>{t('probation.editHr')}</Button>}
              </div>
            </li>
          ))}
        </ul>
        {(q.data?.pagination?.hasMore || page > 1) && (
          <Pagination className="mt-4" page={page} hasPrev={page > 1} hasNext={Boolean(q.data?.pagination?.hasMore)} onPrev={() => setPage((p) => Math.max(1, p - 1))} onNext={() => setPage((p) => p + 1)}
            labels={{ nav: tc('pagination'), previous: tc('previous'), next: tc('next'), summary: () => '', page: () => '', pageOnly: (p) => tc('paginationPageOnly', { page: p }) }} />
        )}
      </QueryState>
      <Dialog open={Boolean(decide)} onOpenChange={(o) => !o && setDecide(null)}>
        <DialogContent title={t('decision.title', { name: decide?.name ?? '' })} description={t('decision.description')} closeLabel={tc('close')}>
          {decide && <DecisionForm row={decide} onDone={() => setDecide(null)} />}
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(history)} onOpenChange={(o) => !o && setHistory(null)}>
        <DialogContent title={t('history.title', { name: history?.name ?? '' })} closeLabel={tc('close')}>
          {history && <History userId={history.userId} />}
        </DialogContent>
      </Dialog>
      {edit && <HrProfileDialog userId={edit.userId} name={edit.name} open onOpenChange={(o) => !o && setEdit(null)} />}
    </>
  );
}

const schema = z
  .object({ decision: z.enum(['CONFIRM', 'EXTEND', 'MARK_FOR_REVIEW']), months: z.string(), note: z.string().trim().max(2000, 'tooLong') })
  .superRefine((v, ctx) => {
    if (v.decision === 'EXTEND' && !(Number(v.months) >= 1 && Number(v.months) <= 6)) ctx.addIssue({ code: 'custom', path: ['months'], message: 'monthsRange' });
    if (v.decision !== 'CONFIRM' && v.note.length < 3) ctx.addIssue({ code: 'custom', path: ['note'], message: 'noteRequired' });
  });
type Values = z.infer<typeof schema>;

function DecisionForm({ row, onDone }: { row: ProbationRow; onDone: () => void }) {
  const t = useTranslations('workHr');
  const tc = useTranslations('common');
  const fe = useFormErrors('workHr');
  const { toast } = useToast();
  const m = useProbationDecision(row.userId);
  const { register, control, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { decision: 'CONFIRM', months: '1', note: '' } });
  const decision = useWatch({ control, name: 'decision' });
  const submit = handleSubmit(async (v) => {
    const body: { decision: ProbationDecision; months?: number; note?: string } = { decision: v.decision };
    if (v.decision === 'EXTEND') body.months = Number(v.months);
    if (v.note) body.note = v.note;
    try { await m.mutateAsync(body); } catch { return; } // the error is shown by <MutationAlert/>
    toast({ title: t(`decision.done.${v.decision}` as never), tone: 'success' });
    onDone();
  });
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3">
      <FormField label={t('decision.decision')}>
        <Select {...register('decision')}>
          <option value="CONFIRM">{t('decision.CONFIRM')}</option>
          <option value="EXTEND">{t('decision.EXTEND')}</option>
          <option value="MARK_FOR_REVIEW">{t('decision.MARK_FOR_REVIEW')}</option>
        </Select>
      </FormField>
      {decision === 'EXTEND' && <FormField label={t('decision.months')} error={fe(formState.errors.months)}><Input inputMode="numeric" {...register('months')} /></FormField>}
      <FormField label={decision === 'CONFIRM' ? t('decision.noteOptional') : t('decision.note')} error={fe(formState.errors.note)}><Textarea rows={3} {...register('note')} /></FormField>
      <p className="text-xs text-muted">{t('decision.effect')}</p>
      <MutationAlert error={m.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>{tc('cancel')}</Button>
        <Button type="submit" loading={m.isPending}>{t('decision.submit')}</Button>
      </div>
    </form>
  );
}

function History({ userId }: { userId: string }) {
  const t = useTranslations('workHr');
  const dates = useDates();
  const q = useProbationHistory(userId);
  return (
    <QueryState query={q} isEmpty={(q.data?.length ?? 0) === 0} emptyTitle={t('history.empty')}>
      <ol className="space-y-3" aria-label={t('history.list')}>
        {(q.data ?? []).map((h) => (
          <li key={h.id} className="rounded-lg border border-line p-3 text-sm">
            <p className="font-medium text-ink">{h.decision ? t(`decision.${h.decision}` as never) : '—'}{h.months ? ` · ${t('history.months', { n: h.months })}` : ''}</p>
            <p className="text-muted">{t('history.ends', { date: dates.date(h.newEnd) })} · {h.decidedBy ?? '—'} · {dates.dateTime(h.decidedAt)}</p>
            {h.note && <p className="mt-1 whitespace-pre-wrap text-ink-700">{h.note}</p>}
          </li>
        ))}
      </ol>
    </QueryState>
  );
}
