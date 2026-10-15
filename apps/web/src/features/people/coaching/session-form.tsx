'use client';
import * as React from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Alert, Button, Checkbox, FormField, Input, Select, Skeleton, Textarea, useToast } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { useTeamMemberOptions } from '../common/api';
import { MutationAlert, useFormErrors } from '../hub/shared';
import { ActionRows } from './action-rows';
import { COACHING_TOPICS, NOTE_VISIBILITY, SESSION_KINDS, useCreateSession } from './api';
import { buildSessionPayload, localNow, sessionFormSchema, type SessionFormValues } from './schemas';

export function SessionForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('coaching');
  const { user } = useAuth();
  const { toast } = useToast();
  const fe = useFormErrors('coaching');
  const people = useTeamMemberOptions();
  const create = useCreateSession();
  const form = useForm<SessionFormValues>({
    resolver: zodResolver(sessionFormSchema),
    defaultValues: { kind: 'COACHING', sessionDate: localNow(), durationMin: 30, topics: [], participantIds: [], notes: '', noteVisibility: 'PARTICIPANTS', callRef: '', actions: [] },
  });
  const { register, control, handleSubmit, formState } = form;
  const me = user?.id ?? '';
  const candidates = (people.data ?? []).filter((p) => p.id !== me);
  const participantIds = useWatch({ control, name: 'participantIds' });
  const owners = [{ id: me, name: t('form.me') }, ...candidates.filter((c) => participantIds.includes(c.id)).map((c) => ({ id: c.id, name: c.name }))];
  const visibility = useWatch({ control, name: 'noteVisibility' });

  const onSubmit = handleSubmit(async (v) => {
    try {
      await create.mutateAsync(buildSessionPayload(v));
      toast({ tone: 'success', title: t('form.saved') });
      onDone();
    } catch {
      /* shown by MutationAlert */
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5" aria-label={t('form.title')}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('form.kind')} required>
          <Select {...register('kind')}>
            {SESSION_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}` as never)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('form.date')} error={fe(formState.errors.sessionDate)} required>
          <Input type="datetime-local" {...register('sessionDate')} />
        </FormField>
        <FormField label={t('form.duration')} hint={t('form.durationHint')} error={fe(formState.errors.durationMin)} required>
          <Input type="number" inputMode="numeric" min={5} max={480} {...register('durationMin', { valueAsNumber: true })} />
        </FormField>
        <FormField label={t('form.callRef')} hint={t('form.callRefHint')}>
          <Input {...register('callRef')} />
        </FormField>
      </div>

      <Controller
        control={control}
        name="topics"
        render={({ field }) => (
          <fieldset aria-describedby="topics-err">
            <legend className="mb-1.5 text-sm font-medium text-ink">
              {t('form.topics')} <span aria-hidden="true" className="text-red-700">*</span>
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {COACHING_TOPICS.map((tp) => (
                <Checkbox
                  key={tp}
                  label={t(`topics.${tp}` as never)}
                  checked={field.value.includes(tp)}
                  onCheckedChange={(c) => field.onChange(c === true ? [...field.value, tp] : field.value.filter((x) => x !== tp))}
                />
              ))}
            </div>
            <p id="topics-err" role={formState.errors.topics ? 'alert' : undefined} className="mt-1 text-sm text-red-700">
              {fe(formState.errors.topics)}
            </p>
          </fieldset>
        )}
      />

      <Controller
        control={control}
        name="participantIds"
        render={({ field }) => (
          <fieldset aria-describedby="participants-err">
            <legend className="mb-1.5 text-sm font-medium text-ink">
              {t('form.participants')} <span aria-hidden="true" className="text-red-700">*</span>
            </legend>
            {people.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : people.isError ? (
              <Alert tone="danger">{t('form.peopleError')}</Alert>
            ) : candidates.length === 0 ? (
              <Alert tone="info">{t('form.noPeople')}</Alert>
            ) : (
              <div className="grid max-h-48 gap-2 overflow-y-auto rounded-md border border-line p-3 sm:grid-cols-2">
                {candidates.map((p) => (
                  <Checkbox
                    key={p.id}
                    label={p.name}
                    checked={field.value.includes(p.id)}
                    onCheckedChange={(c) => field.onChange(c === true ? [...field.value, p.id] : field.value.filter((x) => x !== p.id))}
                  />
                ))}
              </div>
            )}
            <p id="participants-err" role={formState.errors.participantIds ? 'alert' : undefined} className="mt-1 text-sm text-red-700">
              {fe(formState.errors.participantIds)}
            </p>
          </fieldset>
        )}
      />

      <FormField label={t('form.notes')} error={fe(formState.errors.notes)} hint={t('form.notesHint')}>
        <Textarea rows={4} {...register('notes')} />
      </FormField>
      <FormField label={t('form.visibility')} hint={t(`visibilityHelp.${visibility}` as never)}>
        <Select {...register('noteVisibility')}>
          {NOTE_VISIBILITY.map((v) => (
            <option key={v} value={v}>
              {t(`visibility.${v}` as never)}
            </option>
          ))}
        </Select>
      </FormField>

      <ActionRows control={control as never} register={register as never} owners={owners} defaultOwnerId={me} errors={formState.errors.actions as never} fe={fe} />

      <MutationAlert error={create.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('form.cancel')}
        </Button>
        <Button type="submit" loading={create.isPending}>
          {t('form.save')}
        </Button>
      </div>
    </form>
  );
}
