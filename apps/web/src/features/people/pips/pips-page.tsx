'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Dialog, DialogContent, FormField, Input, PageHeader, Pagination, Select, Textarea, useToast } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useTeamMemberOptions } from '../common/api';
import { MutationAlert, QueryState, RestrictedBanner, toneFor, useFormatDate, useFormErrors } from '../hub/shared';
import { PIP_STATUSES, slug } from './pip-logic';
import { useCreatePip, useProposePip, usePips, type Pip } from './api';

export function PipsPage() {
  return (
    <RequirePermission permission="pip:view">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('pips');
  const tc = useTranslations('common');
  const fmt = useFormatDate();
  const router = useRouter();
  const { can } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const [page, setPage] = React.useState(1);
  const q = usePips({ page, limit: 10, status: status || undefined });
  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={can('pip:create') ? <Button leadingIcon={<Plus aria-hidden="true" />} onClick={() => setOpen(true)}>{t('new')}</Button> : can('pip:propose') ? <Button leadingIcon={<Plus aria-hidden="true" />} onClick={() => setOpen(true)}>{t('propose')}</Button> : undefined}
      />
      <RestrictedBanner />
      <FormField label={t('filterStatus')} className="mb-4 w-60">
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">{t('any')}</option>
          {PIP_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}` as never)}</option>)}
        </Select>
      </FormField>
      <QueryState query={q} isEmpty={(q.data?.items.length ?? 0) === 0} emptyTitle={t('empty')} emptyDescription={t('emptyBody')}>
        <ul className="stagger space-y-2" aria-label={t('title')}>
          {(q.data?.items ?? []).map((p: Pip) => (
            <li key={p.id}>
              <Link href={`/people/pips/${p.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface p-3.5 hover-lift focus-visible:outline-2 focus-visible:outline-focus">
                <span>
                  <span className="block font-medium text-ink">{p.employeeName ?? '—'}</span>
                  <span className="text-sm text-muted">
                    {p.startDate ? `${fmt.date(p.startDate)} – ${fmt.date(p.endDate)}` : t('notStarted')} · {t('checkpointsCount', { n: p.checkpoints.length })}
                  </span>
                </span>
                <span className="flex items-center gap-2">{p.proposedByManager && <Badge tone="gold">{t('proposedBadge')}</Badge>}<Badge tone={toneFor(p.status)}>{t(`status.${p.status}` as never)}</Badge></span>
              </Link>
            </li>
          ))}
        </ul>
        {(q.data?.pagination?.hasMore || page > 1) && (
          <Pagination
            className="mt-4"
            page={page}
            hasPrev={page > 1}
            hasNext={Boolean(q.data?.pagination?.hasMore)}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => p + 1)}
            labels={{ nav: tc('pagination'), previous: tc('previous'), next: tc('next'), summary: () => '', page: () => '', pageOnly: (p) => tc('paginationPageOnly', { page: p }) }}
          />
        )}
      </QueryState>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={can('pip:create') ? t('createTitle') : t('proposeTitle')} description={can('pip:create') ? t('createDescription') : t('proposeDescription')} size="lg" closeLabel={tc('close')}>
          {open && <CreatePipForm propose={!can('pip:create')} onDone={(id) => { setOpen(false); if (id) router.push(`/people/pips/${id}`); }} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

const gapSchema = z.object({ name: z.string().trim().min(2, 'required').max(120, 'tooLong'), target: z.string().optional(), actual: z.string().optional() });
const createSchema = z.object({
  employeeId: z.string().min(1, 'required'),
  reason: z.string().trim().min(10, 'reasonShort').max(4000, 'tooLong'),
  evidence: z.string().max(8000, 'tooLong').optional(),
  kpiGaps: z.array(gapSchema).min(1, 'gapsRequired').max(20),
});
type CreateValues = z.infer<typeof createSchema>;
const num = (v?: string) => (v && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);

function CreatePipForm({ onDone, propose = false }: { onDone: (id?: string) => void; propose?: boolean }) {
  const t = useTranslations('pips');
  const fe = useFormErrors('pips');
  const { user } = useAuth();
  const { toast } = useToast();
  const people = useTeamMemberOptions();
  const createFull = useCreatePip();
  const createProposal = useProposePip();
  const create = propose ? createProposal : createFull;
  const { register, control, handleSubmit, formState } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { employeeId: '', reason: '', evidence: '', kpiGaps: [{ name: '', target: '', actual: '' }] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'kpiGaps' });
  const employees = (people.data ?? []).filter((p) => p.id !== user?.id);
  const onSubmit = handleSubmit(async (v) => {
    try {
      const res = (await create.mutateAsync({
        employeeId: v.employeeId,
        reason: v.reason.trim(),
        ...(v.evidence?.trim() ? { evidence: v.evidence.trim() } : {}),
        kpiGaps: v.kpiGaps.map((g) => ({ key: slug(g.name), name: g.name.trim(), ...(num(g.target) !== undefined ? { target: num(g.target) } : {}), ...(num(g.actual) !== undefined ? { actual: num(g.actual) } : {}) })),
      })) as Pip;
      toast({ tone: 'success', title: propose ? t('proposed') : t('created') });
      onDone(res?.id);
    } catch {
      /* shown below */
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label={t('createTitle')}>
      <FormField label={t('employee')} error={fe(formState.errors.employeeId)} required>
        <Select {...register('employeeId')}>
          <option value="">{t('choose')}</option>
          {employees.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </FormField>
      <FormField label={t('reason')} hint={t('reasonHint')} error={fe(formState.errors.reason)} required><Textarea rows={3} {...register('reason')} /></FormField>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink">{t('gaps')}</legend>
        <p className="text-xs text-muted">{t('gapsHint')}</p>
        {fields.map((f, i) => (
          <div key={f.id} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[1fr_7rem_7rem_auto] sm:items-end">
            <FormField label={t('gapName')} error={fe(formState.errors.kpiGaps?.[i]?.name)} required><Input {...register(`kpiGaps.${i}.name`)} /></FormField>
            <FormField label={t('gapTarget')}><Input type="number" inputMode="decimal" {...register(`kpiGaps.${i}.target`)} /></FormField>
            <FormField label={t('gapActual')}><Input type="number" inputMode="decimal" {...register(`kpiGaps.${i}.actual`)} /></FormField>
            <Button type="button" variant="ghost" size="icon" aria-label={t('removeRow')} disabled={fields.length === 1} onClick={() => remove(i)}><Trash2 aria-hidden="true" /></Button>
          </div>
        ))}
        <Button type="button" variant="secondary" size="sm" leadingIcon={<Plus aria-hidden="true" />} onClick={() => append({ name: '', target: '', actual: '' })}>{t('addGap')}</Button>
      </fieldset>
      <FormField label={t('evidence')} error={fe(formState.errors.evidence)}><Textarea rows={3} {...register('evidence')} /></FormField>
      <MutationAlert error={create.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => onDone()}>{t('cancel')}</Button>
        <Button type="submit" loading={create.isPending}>{t('createSave')}</Button>
      </div>
    </form>
  );
}
