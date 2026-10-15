'use client';
import * as React from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Alert, Button, FormField, Select, Textarea, Input, useToast } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { useTeamMemberOptions } from '../common/api';
import { ActionRows } from '../coaching/action-rows';
import { MutationAlert, QueryState, useFormErrors } from '../hub/shared';
import { useCompetencies, useCreateReview, useUpdateReview, type Review } from './api';
import { CompetencyScorer } from './competency-scorer';
import { buildReviewPayload, previousMonth, reviewFormSchema, type ReviewFormValues } from './review-logic';

/** Create (no `existing`) or edit a DRAFT monthly review. */
export function ReviewForm({ existing, onDone }: { existing?: Review; onDone: (id?: string) => void }) {
  const t = useTranslations('performance');
  const fe = useFormErrors('performance');
  const { user } = useAuth();
  const { toast } = useToast();
  const people = useTeamMemberOptions(!existing);
  const comps = useCompetencies();
  const create = useCreateReview();
  const update = useUpdateReview(existing?.id ?? '');
  const pm = previousMonth();
  const form = useForm<ReviewFormValues>({
    resolver: zodResolver(reviewFormSchema),
    defaultValues: {
      employeeId: existing?.employeeId ?? '',
      periodStart: existing?.periodStart ?? pm.start,
      periodEnd: existing?.periodEnd ?? pm.end,
      competencyScores: existing?.competencyScores ?? {},
      rating: existing?.rating ?? undefined,
      strengths: existing?.strengths ?? '',
      improvements: existing?.improvements ?? '',
      goals: existing?.goals ?? '',
      actions: [],
    },
  });
  const { register, control, handleSubmit, formState } = form;
  const mutation = existing ? update : create;
  const me = user?.id ?? '';
  const employees = (people.data ?? []).filter((p) => p.id !== me);
  const employeeId = useWatch({ control, name: 'employeeId' });
  const owners = [{ id: me, name: t('review.me') }, ...employees.filter((e) => e.id === employeeId).map((e) => ({ id: e.id, name: e.name }))];

  const onSubmit = handleSubmit(async (v) => {
    if (!existing && !v.employeeId) return form.setError('employeeId', { message: 'required' });
    try {
      const res = (await mutation.mutateAsync(buildReviewPayload(v, existing ? 'edit' : 'create'))) as Review;
      toast({ tone: 'success', title: t(existing ? 'review.updated' : 'review.created') });
      onDone(res?.id);
    } catch {
      /* shown below */
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5" aria-label={t(existing ? 'review.editTitle' : 'review.newTitle')}>
      {!existing && (
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label={t('review.employee')} error={fe(formState.errors.employeeId)} required>
            <Select {...register('employeeId')}>
              <option value="">{t('choose')}</option>
              {employees.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </FormField>
          <FormField label={t('review.periodStart')} error={fe(formState.errors.periodStart)} required><Input type="date" {...register('periodStart')} /></FormField>
          <FormField label={t('review.periodEnd')} error={fe(formState.errors.periodEnd)} required><Input type="date" {...register('periodEnd')} /></FormField>
        </div>
      )}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-ink">{t('review.competencies')}</h3>
        <QueryState query={comps} isEmpty={(comps.data?.length ?? 0) === 0} emptyTitle={t('review.noCompetencies')}>
          <Controller control={control} name="competencyScores" render={({ field }) => <CompetencyScorer competencies={comps.data ?? []} value={field.value} onChange={field.onChange} />} />
        </QueryState>
      </section>
      <FormField label={t('review.rating')} hint={t('review.ratingHint')} error={fe(formState.errors.rating)} className="max-w-xs">
        <Select {...register('rating', { setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)) })}>
          <option value="">{t('choose')}</option>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
        </Select>
      </FormField>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label={t('review.strengths')}><Textarea rows={3} {...register('strengths')} /></FormField>
        <FormField label={t('review.improvements')}><Textarea rows={3} {...register('improvements')} /></FormField>
        <FormField label={t('review.goals')}><Textarea rows={3} {...register('goals')} /></FormField>
      </div>
      {!existing && <ActionRows control={control as never} register={register as never} owners={owners} defaultOwnerId={me} errors={formState.errors.actions as never} fe={fe} />}
      {people.isError && <Alert tone="danger">{t('review.peopleError')}</Alert>}
      <MutationAlert error={mutation.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => onDone()}>{t('cancel')}</Button>
        <Button type="submit" loading={mutation.isPending}>{t('review.saveDraft')}</Button>
      </div>
    </form>
  );
}
