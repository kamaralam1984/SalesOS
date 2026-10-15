'use client';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Alert, Button, FormField, Input, Select, Textarea, useToast } from '@salesos/ui';
import { Lock } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-provider';
import { useTeamMemberOptions } from '../common/api';
import { MutationAlert, useFormErrors } from '../hub/shared';
import { ActionRows } from './action-rows';
import { useCreateOneOnOne } from './api';
import { buildOneOnOnePayload, localNow, oneOnOneFormSchema, type OneOnOneFormValues } from './schemas';

export function OneOnOneForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('coaching');
  const { user } = useAuth();
  const { toast } = useToast();
  const fe = useFormErrors('coaching');
  const people = useTeamMemberOptions();
  const create = useCreateOneOnOne();
  const form = useForm<OneOnOneFormValues>({
    resolver: zodResolver(oneOnOneFormSchema),
    defaultValues: { employeeId: '', status: 'HELD', scheduledFor: localNow(), durationMin: 30, agenda: '', sharedNotes: '', privateNotes: '', actions: [] },
  });
  const { register, control, handleSubmit, formState } = form;
  const me = user?.id ?? '';
  const employees = (people.data ?? []).filter((p) => p.id !== me);
  const employeeId = useWatch({ control, name: 'employeeId' });
  const owners = [{ id: me, name: t('form.me') }, ...employees.filter((e) => e.id === employeeId).map((e) => ({ id: e.id, name: e.name }))];
  const onSubmit = handleSubmit(async (v) => {
    try {
      await create.mutateAsync(buildOneOnOnePayload(v));
      toast({ tone: 'success', title: t('oneOnOnes.saved') });
      onDone();
    } catch {
      /* shown below */
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label={t('oneOnOnes.formTitle')}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('oneOnOnes.employee')} error={fe(formState.errors.employeeId)} required>
          <Select {...register('employeeId')}>
            <option value="">{t('form.choose')}</option>
            {employees.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('oneOnOnes.state')}>
          <Select {...register('status')}>
            <option value="HELD">{t('oneStatus.HELD')}</option>
            <option value="SCHEDULED">{t('oneStatus.SCHEDULED')}</option>
          </Select>
        </FormField>
        <FormField label={t('form.date')} error={fe(formState.errors.scheduledFor)} required>
          <Input type="datetime-local" {...register('scheduledFor')} />
        </FormField>
        <FormField label={t('form.duration')} error={fe(formState.errors.durationMin)} required>
          <Input type="number" inputMode="numeric" min={5} max={240} {...register('durationMin', { valueAsNumber: true })} />
        </FormField>
      </div>
      <FormField label={t('oneOnOnes.agenda')} error={fe(formState.errors.agenda)}>
        <Textarea rows={2} {...register('agenda')} />
      </FormField>
      <FormField label={t('oneOnOnes.sharedNotes')} hint={t('oneOnOnes.sharedHint')} error={fe(formState.errors.sharedNotes)}>
        <Textarea rows={3} {...register('sharedNotes')} />
      </FormField>
      <div className="rounded-md border border-gold-300 bg-gold-50 p-3">
        <FormField label={<span className="inline-flex items-center gap-1.5"><Lock aria-hidden="true" className="size-3.5" />{t('oneOnOnes.privateNotes')}</span>} hint={t('oneOnOnes.privateHint')} error={fe(formState.errors.privateNotes)}>
          <Textarea rows={3} {...register('privateNotes')} />
        </FormField>
      </div>
      <ActionRows control={control as never} register={register as never} owners={owners} defaultOwnerId={me} errors={formState.errors.actions as never} fe={fe} />
      {people.isError && <Alert tone="danger">{t('form.peopleError')}</Alert>}
      <MutationAlert error={create.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>{t('form.cancel')}</Button>
        <Button type="submit" loading={create.isPending}>{t('form.save')}</Button>
      </div>
    </form>
  );
}
