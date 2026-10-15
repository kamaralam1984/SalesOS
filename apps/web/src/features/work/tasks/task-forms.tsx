'use client';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { Button, Dialog, DialogContent, FormField, Input, Select, Textarea, useToast } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { MutationAlert, useFormErrors } from '@/features/people/hub/shared';
import { useTeamMemberOptions } from '@/features/people/common/api';
import { useGoals } from '@/lib/api/hooks/work-goals';
import { TASK_PRIORITIES, useCreateTask, useUpdateTask, type TaskPriority, type WorkTaskDetail } from '@/lib/api/hooks/work-tasks';
import { isoToLocalInput, localInputToIso } from '../common/shared';

const baseShape = {
  title: z.string().trim().min(3, 'titleShort').max(200, 'tooLong'),
  description: z.string().trim().max(4000, 'tooLong'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  assigneeId: z.string(),
  dueAt: z.string(),
  goalId: z.string(),
  project: z.string().trim().max(120, 'tooLong'),
};
const createSchema = z.object(baseShape).refine((v) => !v.dueAt || (localInputToIso(v.dueAt) ?? '') >= new Date(Date.now() - 60_000).toISOString(), { message: 'pastDue', path: ['dueAt'] });
type Values = z.infer<typeof createSchema>;

function Fields({ form, assign, goalsEnabled, people, goals, editing }: {
  form: ReturnType<typeof useForm<Values>>;
  assign: boolean;
  goalsEnabled: boolean;
  people: Array<{ id: string; name: string }>;
  goals: Array<{ id: string; title: string }>;
  editing?: boolean;
}) {
  const t = useTranslations('workTasks');
  const fe = useFormErrors('workTasks');
  const { register, formState } = form;
  return (
    <>
      <FormField label={t('create.name')} error={fe(formState.errors.title)} required><Input {...register('title')} autoComplete="off" /></FormField>
      <FormField label={t('create.details')} error={fe(formState.errors.description)}><Textarea rows={3} {...register('description')} /></FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('create.priority')}>
          <Select {...register('priority')}>
            {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{t(`priority.${p}` as never)}</option>)}
          </Select>
        </FormField>
        <FormField label={t('create.due')} hint={t('create.dueHint')} error={fe(formState.errors.dueAt)}><Input type="datetime-local" {...register('dueAt')} /></FormField>
      </div>
      {assign && (
        <FormField label={t('create.assignee')} hint={editing ? t('reassignHint') : undefined}>
          <Select {...register('assigneeId')}>
            <option value="">{t('create.assigneeSelf')}</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </FormField>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {goalsEnabled && (
          <FormField label={t('create.goal')}>
            <Select {...register('goalId')}>
              <option value="">{t('create.noGoal')}</option>
              {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
            </Select>
          </FormField>
        )}
        <FormField label={t('create.project')} error={fe(formState.errors.project)}><Input {...register('project')} /></FormField>
      </div>
    </>
  );
}

function useFormOptions() {
  const { can } = useAuth();
  const assign = can('work-tasks:create', 'team');
  const goalsEnabled = can('goals:view');
  const people = useTeamMemberOptions(assign);
  const goals = useGoals({ view: 'mine', status: 'ACTIVE', page: 1, limit: 100 });
  return { assign, goalsEnabled, people: people.data ?? [], goals: goalsEnabled ? goals.data?.items ?? [] : [] };
}

export function CreateTaskDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const t = useTranslations('workTasks');
  const tc = useTranslations('common');
  const { user } = useAuth();
  const { toast } = useToast();
  const opts = useFormOptions();
  const create = useCreateTask();
  const form = useForm<Values>({
    resolver: zodResolver(createSchema),
    defaultValues: { title: '', description: '', priority: 'MEDIUM', assigneeId: '', dueAt: '', goalId: '', project: '' },
  });
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const res = await create.mutateAsync({
        title: v.title.trim(),
        priority: v.priority as TaskPriority,
        ...(v.description.trim() ? { description: v.description.trim() } : {}),
        ...(v.assigneeId && v.assigneeId !== user?.id ? { assigneeId: v.assigneeId } : {}),
        ...(localInputToIso(v.dueAt) ? { dueAt: localInputToIso(v.dueAt) } : {}),
        ...(v.goalId ? { goalId: v.goalId } : {}),
        ...(v.project.trim() ? { project: v.project.trim() } : {}),
      });
      toast({ tone: 'success', title: t('create.created') });
      onCreated(res.id);
    } catch {
      /* shown in the dialog */
    }
  });
  const formId = React.useId();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('create.title')}
        description={t('create.description')}
        size="lg"
        closeLabel={tc('close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button>
            <Button type="submit" form={formId} loading={create.isPending}>{t('create.submit')}</Button>
          </>
        }
      >
        <form id={formId} onSubmit={onSubmit} noValidate className="space-y-4" aria-label={t('create.title')}>
          <Fields form={form} {...opts} people={opts.people.filter((p) => p.id !== user?.id)} />
          <MutationAlert error={create.error} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditTaskDialog({ task, open, onOpenChange }: { task: WorkTaskDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('workTasks');
  const tc = useTranslations('common');
  const { toast } = useToast();
  const opts = useFormOptions();
  const update = useUpdateTask(task.id);
  const editSchema = React.useMemo(() => z.object(baseShape), []);
  const form = useForm<Values>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      title: task.title, description: task.description ?? '', priority: task.priority, assigneeId: task.assigneeId, dueAt: isoToLocalInput(task.dueAt), goalId: task.goalId ?? '', project: task.project ?? '',
    },
  });
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await update.mutateAsync({
        version: task.version,
        title: v.title.trim(),
        description: v.description.trim() || null,
        priority: v.priority,
        dueAt: localInputToIso(v.dueAt) ?? null,
        goalId: v.goalId || null,
        project: v.project.trim() || null,
        ...(v.assigneeId && v.assigneeId !== task.assigneeId ? { assigneeId: v.assigneeId } : {}),
      });
      toast({ tone: 'success', title: t('saved') });
      onOpenChange(false);
    } catch {
      /* shown in the dialog */
    }
  });
  const formId = React.useId();
  // the current assignee must stay selectable even when the people list is scoped differently
  const people = opts.people.some((p) => p.id === task.assigneeId) ? opts.people : [{ id: task.assigneeId, name: task.assigneeName ?? '—' }, ...opts.people];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('editTitle')}
        description={t('editDescription')}
        size="lg"
        closeLabel={tc('close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button>
            <Button type="submit" form={formId} loading={update.isPending}>{tc('save')}</Button>
          </>
        }
      >
        <form id={formId} onSubmit={onSubmit} noValidate className="space-y-4" aria-label={t('editTitle')}>
          <Fields form={form} {...opts} people={people} editing />
          <MutationAlert error={update.error} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
