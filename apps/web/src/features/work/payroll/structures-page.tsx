'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Dialog, DialogContent, FormField, Input, PageHeader, Pagination, Select, useToast } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { QueryState, useFormatDate, useFormErrors } from '@/features/people/hub/shared';
import { useCreateStructure, useStructureHistory, useStructures, type StructureRow } from '@/lib/api/hooks/work-payroll';
import { formatMoney, isPositiveMoney } from './money';
import { PayrollError, StatutoryNotice } from './shared';

export function StructuresPage() {
  return (
    <RequirePermission permission="payroll:structure:view">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('workPayroll');
  const tc = useTranslations('common');
  const fmt = useFormatDate();
  const { can } = useAuth();
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [form, setForm] = React.useState<StructureRow | null>(null);
  const [history, setHistory] = React.useState<StructureRow | null>(null);
  const q = useStructures({ page, limit: 20, search: search.trim() || undefined });
  const items = q.data?.items ?? [];
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('structures.title')} description={t('structures.description')} />
      <StatutoryNotice className="mb-4" />
      <FormField label={t('structures.search')} className="mb-4 w-full sm:w-72">
        <Input type="search" value={search} placeholder={t('structures.searchPlaceholder')} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </FormField>
      <QueryState query={q} isEmpty={items.length === 0} emptyTitle={t('structures.empty')} emptyDescription={t('structures.emptyBody')}>
        <ul className="stagger-fast space-y-2" aria-label={t('structures.listLabel')}>
          {items.map((r) => (
            <li key={r.userId} className="hover-lift rounded-lg border border-line bg-surface p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{r.name}</p>
                  <p className="text-sm text-muted">{[r.employeeCode, r.designation, r.department].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                {r.current ? (
                  <dl className="grid grid-cols-2 gap-x-6 text-right text-sm">
                    <div><dt className="text-xs text-muted">{t('structures.monthly')}</dt><dd className="font-medium tabular-nums">{formatMoney(r.current.monthlyEarnings, r.current.currency)}</dd></div>
                    <div><dt className="text-xs text-muted">{t('structures.monthlyDeductions')}</dt><dd className="tabular-nums">{formatMoney(r.current.monthlyDeductions, r.current.currency)}</dd></div>
                  </dl>
                ) : (
                  <Badge tone="gold">{t('structures.none')}</Badge>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {r.current && <span className="text-xs text-muted">{t('structures.current', { date: fmt.date(r.current.effectiveFrom) })}</span>}
                {r.upcomingVersions > 0 && <Badge tone="blue">{t('structures.upcoming', { n: r.upcomingVersions })}</Badge>}
                <span className="ml-auto flex gap-2">
                  {r.current && <Button size="sm" variant="ghost" onClick={() => setHistory(r)}>{t('structures.history')}<span className="sr-only"> {r.name}</span></Button>}
                  {can('payroll:structure:manage') && <Button size="sm" variant="secondary" leadingIcon={<Plus aria-hidden="true" />} onClick={() => setForm(r)}>{t('structures.addVersion')}<span className="sr-only"> {r.name}</span></Button>}
                </span>
              </div>
            </li>
          ))}
        </ul>
        {(q.data?.pagination?.hasMore || page > 1) && (
          <Pagination className="mt-4" page={page} hasPrev={page > 1} hasNext={Boolean(q.data?.pagination?.hasMore)} onPrev={() => setPage((p) => Math.max(1, p - 1))} onNext={() => setPage((p) => p + 1)} labels={{ nav: tc('pagination'), previous: tc('previous'), next: tc('next'), summary: () => '', page: () => '', pageOnly: (p) => tc('paginationPageOnly', { page: p }) }} />
        )}
      </QueryState>
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent title={t('structures.formTitle', { name: form?.name ?? '' })} description={t('structures.formDescription')} size="lg" closeLabel={tc('close')}>
          {form && <StructureForm row={form} onDone={() => setForm(null)} />}
        </DialogContent>
      </Dialog>
      <Dialog open={!!history} onOpenChange={(o) => !o && setHistory(null)}>
        <DialogContent title={t('structures.historyTitle', { name: history?.name ?? '' })} description={t('structures.historyDescription')} size="lg" closeLabel={tc('close')}>
          {history && <HistoryList userId={history.userId} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function HistoryList({ userId }: { userId: string }) {
  const t = useTranslations('workPayroll');
  const fmt = useFormatDate();
  const q = useStructureHistory(userId);
  const versions = q.data?.versions ?? [];
  return (
    <QueryState query={q} isEmpty={versions.length === 0} emptyTitle={t('structures.none')}>
      <ol className="space-y-3">
        {versions.map((v) => (
          <li key={v.id} className="rounded-md border border-line p-3">
            <p className="font-medium text-ink">{t('structures.current', { date: fmt.date(v.effectiveFrom) })}</p>
            <p className="text-xs text-muted">{t('structures.versionBy', { name: v.createdByName ?? t('structures.unknownUser') })}{v.note ? ` · ${v.note}` : ''}</p>
            <ul className="mt-2 space-y-0.5 text-sm">
              {v.components.map((c) => (
                <li key={c.key} className="flex justify-between gap-2"><span>{c.name} <span className="text-xs text-muted">({t(`kind.${c.kind}`)})</span></span><span className="tabular-nums">{formatMoney(c.amount, v.currency)}</span></li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </QueryState>
  );
}

const component = z.object({
  key: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,29}$/, 'keyFormat'),
  name: z.string().trim().min(1, 'required').max(80, 'tooLong'),
  kind: z.enum(['EARNING', 'DEDUCTION']),
  amount: z.string().refine(isPositiveMoney, 'amountFormat'),
});
const schema = z
  .object({
    effectiveFrom: z.string().min(1, 'dateRequired'),
    currency: z.string().regex(/^[A-Z]{3}$/, 'required'),
    note: z.string().max(500, 'tooLong').optional(),
    components: z.array(component).min(1).max(30),
  })
  .superRefine((v, ctx) => {
    if (!v.components.some((c) => c.kind === 'EARNING')) ctx.addIssue({ code: 'custom', path: ['components'], message: 'earningRequired' });
    const keys = v.components.map((c) => c.key);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', path: ['components'], message: 'keyUnique' });
  });
type Values = z.infer<typeof schema>;

function StructureForm({ row, onDone }: { row: StructureRow; onDone: () => void }) {
  const t = useTranslations('workPayroll.structures');
  const tp = useTranslations('workPayroll');
  const fe = useFormErrors('workPayroll.structures');
  const { toast } = useToast();
  const create = useCreateStructure();
  const seed = row.current?.components.map((c) => ({ ...c })) ?? [{ key: 'BASIC', name: 'Basic', kind: 'EARNING' as const, amount: '' }];
  const { register, control, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { effectiveFrom: '', currency: row.current?.currency ?? 'INR', note: '', components: seed } });
  const { fields, append, remove } = useFieldArray({ control, name: 'components' });
  const submit = handleSubmit(async (v) => {
    try {
      await create.mutateAsync({ userId: row.userId, effectiveFrom: v.effectiveFrom, currency: v.currency, components: v.components.map((c) => ({ ...c, amount: c.amount.trim() })), ...(v.note?.trim() ? { note: v.note.trim() } : {}) });
      toast({ tone: 'success', title: t('saved') });
      onDone();
    } catch { /* shown below, nothing is claimed as saved */ }
  });
  const listError = (formState.errors.components as { message?: string; root?: { message?: string } } | undefined);
  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label={t('formTitle', { name: row.name })}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t('effectiveFrom')} error={fe(formState.errors.effectiveFrom)} required><Input type="date" {...register('effectiveFrom')} /></FormField>
        <FormField label={t('currency')} error={fe(formState.errors.currency)} required><Input maxLength={3} {...register('currency')} /></FormField>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink">{t('components')}</legend>
        {fields.map((f, i) => (
          <div key={f.id} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[8rem_1fr_8rem_9rem_auto] sm:items-end">
            <FormField label={t('componentKey')} hint={i === 0 ? t('componentKeyHint') : undefined} error={fe(formState.errors.components?.[i]?.key)}><Input {...register(`components.${i}.key`)} /></FormField>
            <FormField label={t('componentName')} error={fe(formState.errors.components?.[i]?.name)}><Input {...register(`components.${i}.name`)} /></FormField>
            <FormField label={t('componentKind')}><Select {...register(`components.${i}.kind`)}><option value="EARNING">{tp('kind.EARNING')}</option><option value="DEDUCTION">{tp('kind.DEDUCTION')}</option></Select></FormField>
            <FormField label={t('componentAmount')} error={fe(formState.errors.components?.[i]?.amount)}><Input inputMode="decimal" {...register(`components.${i}.amount`)} /></FormField>
            <Button type="button" size="icon" variant="ghost" aria-label={t('removeComponent', { n: i + 1 })} disabled={fields.length === 1} onClick={() => remove(i)}><Trash2 aria-hidden="true" className="size-4" /></Button>
          </div>
        ))}
        <Button type="button" size="sm" variant="secondary" leadingIcon={<Plus aria-hidden="true" />} onClick={() => append({ key: '', name: '', kind: 'EARNING', amount: '' })}>{t('addComponent')}</Button>
        {(listError?.message || listError?.root?.message) && <p role="alert" className="text-sm text-red-700">{fe({ message: listError.message ?? listError.root?.message })}</p>}
      </fieldset>
      <FormField label={t('note')} error={fe(formState.errors.note)}><Input {...register('note')} /></FormField>
      <PayrollError error={create.error} />
      <Button type="submit" loading={create.isPending}>{t('save')}</Button>
    </form>
  );
}
