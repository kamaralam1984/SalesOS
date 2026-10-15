'use client';
import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { Button, Checkbox, Dialog, DialogContent, FormField, Input, useToast } from '@salesos/ui';
import { MutationAlert, QueryState, useFormErrors } from '@/features/people/hub/shared';
import { useHrProfile, usePatchHrProfile, type HrProfile, type HrProfilePatch } from '@/lib/api/hooks/work-hr';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateInvalid').or(z.literal(''));
const schema = z.object({
  joinDate: day,
  probationMonths: z.string().regex(/^(\d{1,2})?$/, 'monthsInvalid').refine((v) => v === '' || (Number(v) >= 1 && Number(v) <= 12), 'monthsInvalid'),
  dateOfBirth: day.refine((v) => v === '' || (v < new Date().toISOString().slice(0, 10) && v >= '1900-01-01'), 'dobInvalid'),
  shareBirthday: z.boolean(),
  employeeCode: z.string().trim().max(40, 'tooLong').regex(/^[A-Za-z0-9._\-/]*$/, 'codeInvalid'),
  workLocation: z.string().trim().max(120, 'tooLong'),
});
type Values = z.infer<typeof schema>;

const initial = (p: HrProfile): Values => ({
  joinDate: p.joinDate ?? '',
  probationMonths: p.probationMonths != null ? String(p.probationMonths) : '',
  dateOfBirth: p.dateOfBirth ?? '',
  shareBirthday: Boolean(p.shareBirthday),
  employeeCode: p.employeeCode ?? '',
  workLocation: p.workLocation ?? '',
});

/** Only the fields the user changed; an emptied optional field clears the value (`null`). */
export function diffPatch(before: Values, after: Values): HrProfilePatch {
  const out: HrProfilePatch = {};
  if (after.joinDate !== before.joinDate && after.joinDate) out.joinDate = after.joinDate;
  if (after.probationMonths !== before.probationMonths) out.probationMonths = after.probationMonths === '' ? null : Number(after.probationMonths);
  if (after.dateOfBirth !== before.dateOfBirth) out.dateOfBirth = after.dateOfBirth === '' ? null : after.dateOfBirth;
  if (after.shareBirthday !== before.shareBirthday) out.shareBirthday = after.shareBirthday;
  if (after.employeeCode !== before.employeeCode) out.employeeCode = after.employeeCode === '' ? null : after.employeeCode;
  if (after.workLocation !== before.workLocation) out.workLocation = after.workLocation === '' ? null : after.workLocation;
  return out;
}

export function HrProfileDialog({ userId, name, open, onOpenChange }: { userId: string; name: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('workHr');
  const tc = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('profile.title', { name })} description={t('profile.description')} closeLabel={tc('close')}>
        {open && <Loader userId={userId} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function Loader({ userId, onDone }: { userId: string; onDone: () => void }) {
  const t = useTranslations('workHr');
  const q = useHrProfile(userId);
  return (
    <QueryState query={q} isEmpty={!q.data} emptyTitle={t('profile.empty')}>
      {q.data && <ProfileForm userId={userId} profile={q.data} onDone={onDone} />}
    </QueryState>
  );
}

function ProfileForm({ userId, profile, onDone }: { userId: string; profile: HrProfile; onDone: () => void }) {
  const t = useTranslations('workHr');
  const tc = useTranslations('common');
  const fe = useFormErrors('workHr');
  const { toast } = useToast();
  const patch = usePatchHrProfile(userId);
  const base = React.useMemo(() => initial(profile), [profile]);
  const { register, control, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: base });
  const submit = handleSubmit(async (v) => {
    const body = diffPatch(base, v);
    if (Object.keys(body).length === 0) { onDone(); return; }
    try { await patch.mutateAsync(body); } catch { return; } // the error is shown by <MutationAlert/>
    toast({ title: t('profile.saved'), tone: 'success' });
    onDone();
  });
  const e = formState.errors;
  return (
    <form onSubmit={(ev) => void submit(ev)} noValidate className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t('profile.joinDate')} error={fe(e.joinDate)}><Input type="date" {...register('joinDate')} /></FormField>
        <FormField label={t('profile.probationMonths')} hint={t('profile.probationHint')} error={fe(e.probationMonths)}><Input inputMode="numeric" {...register('probationMonths')} /></FormField>
        <FormField label={t('profile.dateOfBirth')} hint={t('profile.dobHint')} error={fe(e.dateOfBirth)}><Input type="date" {...register('dateOfBirth')} /></FormField>
        <FormField label={t('profile.employeeCode')} error={fe(e.employeeCode)}><Input {...register('employeeCode')} /></FormField>
        <FormField label={t('profile.workLocation')} error={fe(e.workLocation)} className="sm:col-span-2"><Input {...register('workLocation')} /></FormField>
      </div>
      <Controller control={control} name="shareBirthday" render={({ field }) => <Checkbox label={t('profile.shareBirthday')} checked={field.value} onCheckedChange={(c) => field.onChange(c === true)} />} />
      <p className="text-xs text-muted">{t('profile.audited')}</p>
      <MutationAlert error={patch.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>{tc('cancel')}</Button>
        <Button type="submit" loading={patch.isPending}>{tc('save')}</Button>
      </div>
    </form>
  );
}
