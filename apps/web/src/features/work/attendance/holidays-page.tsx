'use client';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { CalendarPlus, Sparkles } from 'lucide-react';
import { Alert, Badge, Button, Dialog, DialogContent, FormField, Input, PageHeader, Select, useToast } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { ConfirmDialog, MutationAlert, QueryState, useFormErrors } from '@/features/people/hub/shared';
import {
  HOLIDAY_KINDS, useApproveHoliday, useCreateHoliday, useDeleteHoliday, useHolidays, useSuggestHolidays, useUpdateHoliday,
  type Holiday, type HolidayKind,
} from '@/lib/api/hooks/work-attendance';
import { today } from './attendance-logic';
import { useWhen } from './format';

export function HolidaysPage() {
  return (
    <RequirePermission permission="holidays:view">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('workHolidays');
  const w = useWhen();
  const { can } = useAuth();
  const { toast } = useToast();
  const manage = can('holidays:manage');
  const [year, setYear] = React.useState(Number(today().slice(0, 4)));
  const [edit, setEdit] = React.useState<Holiday | 'new' | null>(null);
  const [del, setDel] = React.useState<Holiday | null>(null);
  const q = useHolidays(year);
  const suggest = useSuggestHolidays();
  const approve = useApproveHoliday();
  const remove = useDeleteHoliday();
  const rows = q.data ?? [];
  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={
          manage ? (
            <>
              <Button variant="secondary" leadingIcon={<Sparkles aria-hidden="true" />} loading={suggest.isPending} onClick={() => suggest.mutate(year, { onSuccess: (r) => toast({ tone: 'success', title: r.created.length ? t('suggestDone', { n: r.created.length }) : t('suggestNone') }) })}>
                {t('suggest', { year })}
              </Button>
              <Button leadingIcon={<CalendarPlus aria-hidden="true" />} onClick={() => setEdit('new')}>{t('add')}</Button>
            </>
          ) : undefined
        }
      />
      <div className="mb-4 flex items-end gap-2">
        <FormField label={t('year')} className="w-32"><Input type="number" min={2000} max={2100} value={year} onChange={(e) => { const n = Number(e.target.value); if (n >= 2000 && n <= 2100) setYear(n); }} /></FormField>
      </div>
      {manage && rows.some((h) => h.status === 'SUGGESTED') && <Alert tone="info" className="mb-4">{t('suggestionNote')}</Alert>}
      <MutationAlert error={suggest.error ?? approve.error ?? remove.error} />
      <QueryState query={q} isEmpty={rows.length === 0} emptyTitle={t('empty', { year })} emptyDescription={t('emptyBody')}>
        <ul className="stagger space-y-2" aria-label={t('list')}>
          {rows.map((h) => (
            <li key={h.id} className="hover-lift flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3.5">
              <span className="min-w-0">
                <span className="block font-medium text-ink">{h.name}</span>
                <span className="text-sm text-muted">{w.day(h.date)} · {w.weekday(h.date)} · {t(`kind.${h.kind}` as never)}{h.location ? ` · ${h.location}` : ''}</span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={h.status === 'APPROVED' ? 'green' : 'gold'}>{h.status === 'APPROVED' ? t('approvedBadge') : t('suggestedBadge')}</Badge>
                {manage && h.status === 'SUGGESTED' && <Button size="sm" loading={approve.isPending && approve.variables === h.id} onClick={() => approve.mutate(h.id, { onSuccess: () => toast({ tone: 'success', title: t('approvedToast') }) })}>{t('approve')}</Button>}
                {manage && <Button size="sm" variant="ghost" onClick={() => setEdit(h)}>{t('edit')}</Button>}
                {manage && <Button size="sm" variant="ghost" onClick={() => setDel(h)}>{t('delete')}</Button>}
              </span>
            </li>
          ))}
        </ul>
      </QueryState>
      {edit && <HolidayDialog holiday={edit === 'new' ? null : edit} year={year} onOpenChange={(o) => !o && setEdit(null)} />}
      {del && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDel(null)}
          title={t('deleteTitle', { name: del.name })}
          description={t('deleteBody')}
          confirmLabel={t('delete')}
          danger
          pending={remove.isPending}
          error={remove.error}
          onConfirm={() => remove.mutate(del.id, { onSuccess: () => { toast({ tone: 'success', title: t('deletedToast') }); setDel(null); } })}
        />
      )}
    </>
  );
}

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'required'),
  name: z.string().trim().min(2, 'nameShort').max(120, 'tooLong'),
  kind: z.enum(HOLIDAY_KINDS as unknown as [HolidayKind, ...HolidayKind[]]),
  location: z.string().trim().max(60, 'tooLong'),
});
type Values = z.infer<typeof schema>;

function HolidayDialog({ holiday, year, onOpenChange }: { holiday: Holiday | null; year: number; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('workHolidays');
  const tc = useTranslations('common');
  const fe = useFormErrors('workHolidays');
  const { toast } = useToast();
  const create = useCreateHoliday();
  const update = useUpdateHoliday();
  const m = holiday ? update : create;
  const { register, handleSubmit, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { date: holiday?.date ?? `${year}-01-01`, name: holiday?.name ?? '', kind: holiday?.kind ?? 'COMPANY', location: holiday?.location ?? '' },
  });
  const formId = React.useId();
  const submit = handleSubmit(async (v) => {
    const body = { date: v.date, name: v.name.trim(), kind: v.kind, location: v.location.trim() || null };
    try {
      if (holiday) await update.mutateAsync({ id: holiday.id, body });
      else await create.mutateAsync(body);
      toast({ tone: 'success', title: t('saved') });
      onOpenChange(false);
    } catch {
      /* shown in the dialog */
    }
  });
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        title={holiday ? t('form.editTitle') : t('form.title')}
        description={t('form.description')}
        closeLabel={tc('close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button>
            <Button type="submit" form={formId} loading={m.isPending}>{t('form.submit')}</Button>
          </>
        }
      >
        <form id={formId} onSubmit={submit} noValidate className="space-y-4" aria-label={holiday ? t('form.editTitle') : t('form.title')}>
          <FormField label={t('form.name')} error={fe(formState.errors.name)} required><Input {...register('name')} autoComplete="off" /></FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('form.date')} error={fe(formState.errors.date)} required><Input type="date" {...register('date')} /></FormField>
            <FormField label={t('form.kind')} hint={t('form.kindHint')}><Select {...register('kind')}>{HOLIDAY_KINDS.map((k) => <option key={k} value={k}>{t(`kind.${k}` as never)}</option>)}</Select></FormField>
          </div>
          <FormField label={t('form.location')} hint={t('form.locationHint')} error={fe(formState.errors.location)}><Input {...register('location')} /></FormField>
          <MutationAlert error={m.error} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
