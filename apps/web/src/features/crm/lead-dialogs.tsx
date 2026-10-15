'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Button, Combobox, DatePicker, Dialog, DialogContent, FormField, Input, Select, Textarea, useToast } from '@salesos/ui';
import {
  useAssignLead,
  useAssignableUsers,
  useChangeStatus,
  useCreateLead,
  useCreateTask,
  useLeadMeta,
  useUpdateLead,
  useUpdateTask,
  type CrmTask,
  type Lead,
  type UpdateLeadInput,
} from '@/lib/api/hooks/crm';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useFieldError } from '@/hooks/use-field-error';
import { fromIstInput, isPast, quickPick, toIstInput, type QuickPick } from './lib';
import { Hint } from '@/features/hints/hint-views';

/* ------------------------------------------------------------------ change status */
const statusSchema = (needsLost: (s: string) => 'LOST' | 'WON' | null) =>
  z
    .object({ status: z.string().min(1, 'required'), reason: z.string().max(500, 'tooLong').optional(), lostReason: z.string().optional(), lostNote: z.string().max(1000, 'tooLong').optional(), wonValue: z.string().optional() })
    .superRefine((v, ctx) => {
      const k = needsLost(v.status);
      if (k === 'LOST' && !v.lostReason) ctx.addIssue({ code: 'custom', path: ['lostReason'], message: 'crmLostReasonRequired' });
      if (k === 'WON' && !(Number(v.wonValue) > 0)) ctx.addIssue({ code: 'custom', path: ['wonValue'], message: 'crmWonValueRequired' });
    });
type StatusValues = z.infer<ReturnType<typeof statusSchema>>;

export function StatusDialog({ open, onOpenChange, lead }: { open: boolean; onOpenChange: (o: boolean) => void; lead: Pick<Lead, 'id' | 'status' | 'fullName' | 'version'> }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <StatusBody lead={lead} onOpenChange={onOpenChange} />}
    </Dialog>
  );
}

export function StatusBody({ lead, onOpenChange }: { lead: Pick<Lead, 'id' | 'status' | 'fullName' | 'version'>; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('crm.status');
  const tc = useTranslations('common');
  const fe = useFieldError();
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const meta = useLeadMeta();
  const change = useChangeStatus();
  const [error, setError] = React.useState<string | null>(null);
  const catOf = React.useCallback((s: string) => meta.data?.stages.find((x) => x.key === s)?.category, [meta.data]);
  const schema = React.useMemo(() => statusSchema((s) => (catOf(s) === 'LOST' ? 'LOST' : catOf(s) === 'WON' ? 'WON' : null)), [catOf]);
  const form = useForm<StatusValues>({ resolver: zodResolver(schema), defaultValues: { status: '', reason: '', lostReason: '', lostNote: '', wonValue: '' } });
  const target = form.watch('status');
  const kind = catOf(target);
  const lostCfg = meta.data?.lostReasons.find((r) => r.key === form.watch('lostReason'));
  async function submit(v: StatusValues) {
    setError(null);
    if (kind === 'LOST' && lostCfg?.requiresNote && !v.lostNote?.trim()) {
      form.setError('lostNote', { message: 'crmLostNoteRequired' });
      return;
    }
    try {
      await change.mutateAsync({
        id: lead.id,
        status: v.status,
        reason: v.reason?.trim() || undefined,
        lostReason: kind === 'LOST' ? v.lostReason : undefined,
        lostNote: kind === 'LOST' ? v.lostNote?.trim() || undefined : undefined,
        wonValue: kind === 'WON' ? Number(v.wonValue) : undefined,
      });
      toast({ tone: 'success', title: t('changed', { name: lead.fullName }) });
      onOpenChange(false);
    } catch (e) {
      setError(apiErr(e).message);
    }
  }
  return (
    <DialogContent
      size="md"
      title={t('title')}
      description={t('description', { name: lead.fullName })}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button>
          <Button type="submit" form="status-form" loading={change.isPending} loadingLabel={tc('saving')}>{t('save')}</Button>
        </>
      }
    >
      <form id="status-form" onSubmit={form.handleSubmit(submit)} noValidate className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <FormField label={t('newStage')} error={fe(form.formState.errors.status)} required info={<Hint id="leadStage" />}>
          <Select {...form.register('status')}>
            <option value="">{t('choose')}</option>
            {(meta.data?.stages ?? []).filter((s) => s.key !== lead.status).map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </Select>
        </FormField>
        {kind === 'LOST' && (
          <>
            <FormField label={t('lostReason')} error={fe(form.formState.errors.lostReason)} required>
              <Select {...form.register('lostReason')}>
                <option value="">{t('choose')}</option>
                {(meta.data?.lostReasons ?? []).map((r) => (<option key={r.key} value={r.key}>{r.label}</option>))}
              </Select>
            </FormField>
            <FormField label={t('lostNote')} error={fe(form.formState.errors.lostNote)} required={Boolean(lostCfg?.requiresNote)}>
              <Textarea rows={2} {...form.register('lostNote')} />
            </FormField>
          </>
        )}
        {kind === 'WON' && (
          <FormField label={t('wonValue')} error={fe(form.formState.errors.wonValue)} required>
            <Input inputMode="decimal" {...form.register('wonValue')} />
          </FormField>
        )}
        <FormField label={t('reason')} hint={t('reasonHint')} error={fe(form.formState.errors.reason)}>
          <Textarea rows={2} {...form.register('reason')} />
        </FormField>
      </form>
    </DialogContent>
  );
}

/* ------------------------------------------------------------------ assign / reassign */
const assignSchema = z.object({ mode: z.enum(['user', 'round_robin']), toUserId: z.string().optional(), reason: z.string().trim().min(3, 'crmReasonMin') }).superRefine((v, ctx) => {
  if (v.mode === 'user' && !v.toUserId) ctx.addIssue({ code: 'custom', path: ['toUserId'], message: 'required' });
});
type AssignValues = z.infer<typeof assignSchema>;

export function AssignDialog({ open, onOpenChange, lead }: { open: boolean; onOpenChange: (o: boolean) => void; lead: Pick<Lead, 'id' | 'fullName' | 'assignedTo'> }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <AssignBody lead={lead} onOpenChange={onOpenChange} />}
    </Dialog>
  );
}

function AssignBody({ lead, onOpenChange }: { lead: Pick<Lead, 'id' | 'fullName' | 'assignedTo'>; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('crm.assign');
  const tc = useTranslations('common');
  const fe = useFieldError();
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const users = useAssignableUsers();
  const assign = useAssignLead();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<AssignValues>({ resolver: zodResolver(assignSchema), defaultValues: { mode: 'user', toUserId: '', reason: '' } });
  const mode = form.watch('mode');
  async function submit(v: AssignValues) {
    setError(null);
    try {
      const res = await assign.mutateAsync({ id: lead.id, mode: v.mode, toUserId: v.mode === 'user' ? v.toUserId : undefined, reason: v.reason });
      toast({ tone: 'success', title: t('done', { name: lead.fullName, owner: res.assignedTo?.name ?? '—' }) });
      onOpenChange(false);
    } catch (e) {
      setError(apiErr(e).message);
    }
  }
  return (
    <DialogContent
      size="md"
      title={lead.assignedTo ? t('reassignTitle') : t('assignTitle')}
      description={t('description', { name: lead.fullName })}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button>
          <Button type="submit" form="assign-form" loading={assign.isPending} loadingLabel={tc('saving')}>{t('submit')}</Button>
        </>
      }
    >
      <form id="assign-form" onSubmit={form.handleSubmit(submit)} noValidate className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <FormField label={t('mode')}>
          <Select {...form.register('mode')}>
            <option value="user">{t('modeUser')}</option>
            <option value="round_robin">{t('modeRoundRobin')}</option>
          </Select>
        </FormField>
        {mode === 'user' && (
          <FormField label={t('owner')} error={fe(form.formState.errors.toUserId)} required>
            <Controller
              control={form.control}
              name="toUserId"
              render={({ field }) => (
                <Combobox
                  options={(users.data ?? []).filter((u) => u.id !== lead.assignedTo?.id).map((u) => ({ value: u.id, label: u.name, description: u.email }))}
                  value={field.value || null}
                  onValueChange={(v) => field.onChange(v ?? '')}
                  loading={users.isPending}
                  placeholder={t('ownerPlaceholder')}
                  emptyText={tc('noMatches')}
                  clearLabel={tc('clear')}
                />
              )}
            />
          </FormField>
        )}
        <FormField label={t('reason')} error={fe(form.formState.errors.reason)} required hint={t('reasonHint')}>
          <Textarea rows={2} {...form.register('reason')} />
        </FormField>
      </form>
    </DialogContent>
  );
}

/* ------------------------------------------------------------------ create task */
const taskSchema = z.object({
  title: z.string().trim().min(1, 'required').max(200, 'tooLong'),
  type: z.string().min(1),
  dueAt: z.string().min(1, 'required'),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']),
});
type TaskValues = z.infer<typeof taskSchema>;

export function TaskDialog({ open, onOpenChange, leadId, leadName }: { open: boolean; onOpenChange: (o: boolean) => void; leadId?: string; leadName?: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <TaskBody leadId={leadId} leadName={leadName} onOpenChange={onOpenChange} />}
    </Dialog>
  );
}

function TaskBody({ leadId, leadName, onOpenChange }: { leadId?: string; leadName?: string; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('crm.task');
  const tc = useTranslations('common');
  const tp = useTranslations('crm.disposition');
  const tTask = useTranslations('crm.taskType');
  const fe = useFieldError();
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const meta = useLeadMeta();
  const create = useCreateTask();
  const [error, setError] = React.useState<string | null>(null);
  const [defaultDue] = React.useState(() => quickPick('tomorrow10'));
  const form = useForm<TaskValues>({ resolver: zodResolver(taskSchema), defaultValues: { title: leadName ? `Follow up: ${leadName}` : '', type: 'FOLLOW_UP', dueAt: defaultDue, priority: 'NORMAL' } });
  async function submit(v: TaskValues) {
    setError(null);
    const iso = fromIstInput(v.dueAt);
    if (!iso || isPast(iso)) {
      form.setError('dueAt', { message: 'crmPast' });
      return;
    }
    try {
      await create.mutateAsync({ leadId, type: v.type as never, title: v.title, dueAt: iso, priority: v.priority });
      toast({ tone: 'success', title: t('created') });
      onOpenChange(false);
    } catch (e) {
      setError(apiErr(e).message);
    }
  }
  return (
    <DialogContent
      size="md"
      title={t('createTitle')}
      description={leadName}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button>
          <Button type="submit" form="task-form" loading={create.isPending} loadingLabel={tc('saving')}>{t('create')}</Button>
        </>
      }
    >
      <form id="task-form" onSubmit={form.handleSubmit(submit)} noValidate className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <FormField label={t('title')} error={fe(form.formState.errors.title)} required>
          <Input {...form.register('title')} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('type')}>
            <Select {...form.register('type')}>
              {(meta.data?.taskTypes ?? []).filter((x) => !['ONBOARDING', 'MANAGER_REVIEW'].includes(x.key)).map((x) => (
                <option key={x.key} value={x.key}>{tTask(x.key as 'CALL')}</option>
              ))}
            </Select>
          </FormField>
          <FormField label={t('priority')}>
            <Select {...form.register('priority')}>
              {(['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const).map((p) => (<option key={p} value={p}>{t(`priority${p}` as 'priorityLOW')}</option>))}
            </Select>
          </FormField>
        </div>
        <FormField label={t('dueAt')} error={fe(form.formState.errors.dueAt)} required>
          <Controller control={form.control} name="dueAt" render={({ field }) => <DatePicker mode="datetime-local" value={field.value} onValueChange={field.onChange} />} />
        </FormField>
        <div className="flex flex-wrap gap-2" role="group" aria-label={tp('quickPicks')}>
          {(['plus3h', 'tomorrow10', 'plus2d'] as QuickPick[]).map((p) => (
            <Button key={p} type="button" size="sm" variant="secondary" onClick={() => form.setValue('dueAt', quickPick(p), { shouldValidate: true })}>{tp(`pick.${p}`)}</Button>
          ))}
        </div>
      </form>
    </DialogContent>
  );
}

/* ------------------------------------------------------------------ create lead */
const leadSchema = z
  .object({
    fullName: z.string().trim().min(1, 'required').max(200, 'tooLong'),
    phone: z.string().trim().max(40, 'tooLong').optional(),
    email: z.string().trim().max(254, 'tooLong').optional(),
    sourceId: z.string().optional(),
    programId: z.string().optional(),
    interestLevel: z.string().optional(),
    note: z.string().max(4000, 'tooLong').optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.phone && !v.email) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'crmContactRequired' });
    if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) ctx.addIssue({ code: 'custom', path: ['email'], message: 'email' });
  });
type LeadValues = z.infer<typeof leadSchema>;

export function CreateLeadDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (id: string) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <CreateLeadBody onOpenChange={onOpenChange} onCreated={onCreated} />}
    </Dialog>
  );
}

function CreateLeadBody({ onOpenChange, onCreated }: { onOpenChange: (o: boolean) => void; onCreated?: (id: string) => void }) {
  const t = useTranslations('crm.createLead');
  const tc = useTranslations('common');
  const fe = useFieldError();
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const meta = useLeadMeta();
  const create = useCreateLead();
  const [error, setError] = React.useState<string | null>(null);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [idemKey] = React.useState(() => `ui-lead-${Math.random().toString(36).slice(2)}`);
  const form = useForm<LeadValues>({ resolver: zodResolver(leadSchema), defaultValues: { fullName: '', phone: '', email: '', sourceId: '', programId: '', interestLevel: '', note: '' } });
  async function submit(v: LeadValues) {
    setError(null);
    try {
      const r = await create.mutateAsync({
        idempotencyKey: idemKey,
        fullName: v.fullName,
        phone: v.phone || undefined,
        email: v.email || undefined,
        sourceId: v.sourceId || null,
        programId: v.programId || null,
        interestLevel: (v.interestLevel || null) as never,
        note: v.note || undefined,
      });
      if (r.possibleDuplicates.length || r.warnings.length) {
        setWarnings([...r.warnings, ...r.possibleDuplicates.map((d) => t('duplicateOf', { name: d.fullName }))]);
        toast({ tone: 'warning', title: t('createdWithWarnings', { name: v.fullName }) });
      } else {
        toast({ tone: 'success', title: t('created', { name: v.fullName }) });
        onOpenChange(false);
      }
      onCreated?.(r.lead.id);
    } catch (e) {
      setError(apiErr(e).message);
    }
  }
  return (
    <DialogContent
      size="md"
      title={t('title')}
      description={t('description')}
      closeLabel={tc('close')}
      footer={
        warnings.length ? (
          <Button onClick={() => onOpenChange(false)}>{t('done')}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button>
            <Button type="submit" form="create-lead-form" loading={create.isPending} loadingLabel={tc('saving')}>{t('create')}</Button>
          </>
        )
      }
    >
      {warnings.length ? (
        <div className="space-y-2" role="status">
          {warnings.map((w) => (<Alert key={w} tone="warning">{w}</Alert>))}
        </div>
      ) : (
        <form id="create-lead-form" onSubmit={form.handleSubmit(submit)} noValidate className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <FormField label={t('fullName')} error={fe(form.formState.errors.fullName)} required>
            <Input autoComplete="off" {...form.register('fullName')} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('phone')} error={fe(form.formState.errors.phone)} hint={t('phoneHint')}>
              <Input type="tel" inputMode="tel" autoComplete="off" {...form.register('phone')} />
            </FormField>
            <FormField label={t('email')} error={fe(form.formState.errors.email)}>
              <Input type="email" autoComplete="off" {...form.register('email')} />
            </FormField>
            <FormField label={t('source')}>
              <Select {...form.register('sourceId')}>
                <option value="">{t('none')}</option>
                {(meta.data?.sources ?? []).map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
              </Select>
            </FormField>
            <FormField label={t('program')}>
              <Select {...form.register('programId')}>
                <option value="">{t('none')}</option>
                {(meta.data?.programs ?? []).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </Select>
            </FormField>
          </div>
          <FormField label={t('note')} error={fe(form.formState.errors.note)}>
            <Textarea rows={2} {...form.register('note')} />
          </FormField>
        </form>
      )}
    </DialogContent>
  );
}

/* ------------------------------------------------------------------ edit lead fields */
const editLeadSchema = z
  .object({
    fullName: z.string().trim().min(1, 'required').max(200, 'tooLong'),
    phone: z.string().trim().max(40, 'tooLong').optional(),
    email: z.string().trim().max(254, 'tooLong').optional(),
    sourceId: z.string().optional(),
    programId: z.string().optional(),
    interestLevel: z.string().optional(),
    estimatedValue: z.string().trim().max(20, 'tooLong').optional(),
    preferredLanguage: z.string().trim().max(40, 'tooLong').optional(),
    consentStatus: z.enum(['UNKNOWN', 'GRANTED', 'WITHDRAWN', 'DND']),
    isKeyProspect: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (!v.phone && !v.email) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'crmContactRequired' });
    if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) ctx.addIssue({ code: 'custom', path: ['email'], message: 'email' });
    if (v.estimatedValue && !/^\d{1,12}(\.\d{1,2})?$/.test(v.estimatedValue)) ctx.addIssue({ code: 'custom', path: ['estimatedValue'], message: 'crmAmountInvalid' });
  });
type EditLeadValues = z.infer<typeof editLeadSchema>;
type EditableLead = Pick<Lead, 'id' | 'fullName' | 'phone' | 'email' | 'source' | 'program' | 'interestLevel' | 'estimatedValue' | 'consent' | 'isKeyProspect' | 'version'> & { preferredLanguage?: string | null };

/** Builds the PATCH body: only fields that changed (so an edit never overwrites a concurrent change to another field). */
export function leadPatch(lead: EditableLead, v: EditLeadValues): Omit<UpdateLeadInput, 'id'> {
  const patch: Omit<UpdateLeadInput, 'id'> = {};
  if (v.fullName.trim() !== lead.fullName) patch.fullName = v.fullName.trim();
  if ((v.phone || '') !== (lead.phone ?? '')) patch.phone = v.phone || null;
  if ((v.email || '') !== (lead.email ?? '')) patch.email = v.email || null;
  if ((v.sourceId || '') !== (lead.source?.id ?? '')) patch.sourceId = v.sourceId || null;
  if ((v.programId || '') !== (lead.program?.id ?? '')) patch.programId = v.programId || null;
  if ((v.interestLevel || '') !== (lead.interestLevel ?? '')) patch.interestLevel = (v.interestLevel || null) as never;
  if ((v.estimatedValue || '') !== String(lead.estimatedValue ?? '').replace(/\.00$/, '')) patch.estimatedValue = v.estimatedValue || null;
  if ((v.preferredLanguage || '') !== (lead.preferredLanguage ?? '')) patch.preferredLanguage = v.preferredLanguage || null;
  if (v.consentStatus !== (lead.consent?.status ?? 'UNKNOWN')) patch.consentStatus = v.consentStatus;
  if (v.isKeyProspect !== Boolean(lead.isKeyProspect)) patch.isKeyProspect = v.isKeyProspect;
  return patch;
}

export function EditLeadDialog({ open, onOpenChange, lead }: { open: boolean; onOpenChange: (o: boolean) => void; lead: EditableLead }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <EditLeadBody lead={lead} onOpenChange={onOpenChange} />}
    </Dialog>
  );
}

function EditLeadBody({ lead, onOpenChange }: { lead: EditableLead; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('crm.editLead');
  const tc = useTranslations('common');
  const tcr = useTranslations('crm.createLead');
  const fe = useFieldError();
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const meta = useLeadMeta();
  const update = useUpdateLead();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<EditLeadValues>({
    resolver: zodResolver(editLeadSchema),
    defaultValues: {
      fullName: lead.fullName, phone: lead.phone ?? '', email: lead.email ?? '', sourceId: lead.source?.id ?? '', programId: lead.program?.id ?? '',
      interestLevel: lead.interestLevel ?? '', estimatedValue: String(lead.estimatedValue ?? '').replace(/\.00$/, ''), preferredLanguage: lead.preferredLanguage ?? '',
      consentStatus: (lead.consent?.status as EditLeadValues['consentStatus']) ?? 'UNKNOWN', isKeyProspect: Boolean(lead.isKeyProspect),
    },
  });
  async function submit(v: EditLeadValues) {
    setError(null);
    const patch = leadPatch(lead, v);
    if (Object.keys(patch).length === 0) {
      onOpenChange(false);
      return;
    }
    try {
      await update.mutateAsync({ id: lead.id, version: lead.version, ...patch });
      toast({ tone: 'success', title: t('saved', { name: v.fullName }) });
      onOpenChange(false);
    } catch (e) {
      setError(apiErr(e).message);
    }
  }
  return (
    <DialogContent
      size="lg"
      title={t('title')}
      description={t('description', { name: lead.fullName })}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button>
          <Button type="submit" form="edit-lead-form" loading={update.isPending} loadingLabel={tc('saving')}>{t('save')}</Button>
        </>
      }
    >
      <form id="edit-lead-form" onSubmit={form.handleSubmit(submit)} noValidate className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <FormField label={tcr('fullName')} error={fe(form.formState.errors.fullName)} required>
          <Input autoComplete="off" {...form.register('fullName')} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={tcr('phone')} error={fe(form.formState.errors.phone)} hint={tcr('phoneHint')}>
            <Input type="tel" inputMode="tel" autoComplete="off" {...form.register('phone')} />
          </FormField>
          <FormField label={tcr('email')} error={fe(form.formState.errors.email)}>
            <Input type="email" autoComplete="off" {...form.register('email')} />
          </FormField>
          <FormField label={tcr('source')}>
            <Select {...form.register('sourceId')}>
              <option value="">{tcr('none')}</option>
              {(meta.data?.sources ?? []).map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </Select>
          </FormField>
          <FormField label={tcr('program')}>
            <Select {...form.register('programId')}>
              <option value="">{tcr('none')}</option>
              {(meta.data?.programs ?? []).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </Select>
          </FormField>
          <FormField label={t('interest')}>
            <Select {...form.register('interestLevel')}>
              <option value="">{tcr('none')}</option>
              {(['HIGH', 'MEDIUM', 'LOW'] as const).map((l) => (<option key={l} value={l}>{t(`interest${l}` as 'interestHIGH')}</option>))}
            </Select>
          </FormField>
          <FormField label={t('estimatedValue')} error={fe(form.formState.errors.estimatedValue)} hint={t('estimatedValueHint')}>
            <Input inputMode="decimal" {...form.register('estimatedValue')} />
          </FormField>
          <FormField label={t('language')}>
            <Input {...form.register('preferredLanguage')} />
          </FormField>
          <FormField label={t('consent')} hint={t('consentHint')}>
            <Select {...form.register('consentStatus')}>
              {(['UNKNOWN', 'GRANTED', 'WITHDRAWN', 'DND'] as const).map((c) => (<option key={c} value={c}>{t(`consent${c}` as 'consentGRANTED')}</option>))}
            </Select>
          </FormField>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" className="size-4" {...form.register('isKeyProspect')} />
          {t('keyProspect')}
        </label>
      </form>
    </DialogContent>
  );
}

/* ------------------------------------------------------------------ edit / reschedule task */
const editTaskSchema = z.object({
  title: z.string().trim().min(1, 'required').max(200, 'tooLong'),
  dueAt: z.string().min(1, 'required'),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']),
  description: z.string().max(2000, 'tooLong').optional(),
});
type EditTaskValues = z.infer<typeof editTaskSchema>;
type EditableTask = Pick<CrmTask, 'id' | 'title' | 'dueAt' | 'priority' | 'version'> & { description?: string | null };

export function EditTaskDialog({ open, onOpenChange, task }: { open: boolean; onOpenChange: (o: boolean) => void; task: EditableTask }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <EditTaskBody task={task} onOpenChange={onOpenChange} />}
    </Dialog>
  );
}

function EditTaskBody({ task, onOpenChange }: { task: EditableTask; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('crm.editTask');
  const tt = useTranslations('crm.task');
  const tc = useTranslations('common');
  const tp = useTranslations('crm.disposition');
  const fe = useFieldError();
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const update = useUpdateTask();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<EditTaskValues>({ resolver: zodResolver(editTaskSchema), defaultValues: { title: task.title, dueAt: toIstInput(new Date(task.dueAt)), priority: task.priority, description: task.description ?? '' } });
  async function submit(v: EditTaskValues) {
    setError(null);
    const iso = fromIstInput(v.dueAt);
    const body: { title?: string; dueAt?: string; priority?: CrmTask['priority']; description?: string } = {};
    if (v.title.trim() !== task.title) body.title = v.title.trim();
    if (v.priority !== task.priority) body.priority = v.priority;
    // compare the picker value (minute precision) with its initial value, so seconds on the stored time never count as a reschedule
    if (iso && v.dueAt !== toIstInput(new Date(task.dueAt))) {
      // moving the due time is a reschedule: it must be in the future (it restarts the reminder / overdue clock)
      if (isPast(iso)) {
        form.setError('dueAt', { message: 'crmPast' });
        return;
      }
      body.dueAt = iso;
    }
    if ((v.description ?? '') !== (task.description ?? '')) body.description = v.description ?? '';
    if (Object.keys(body).length === 0) {
      onOpenChange(false);
      return;
    }
    try {
      await update.mutateAsync({ id: task.id, ...body, version: task.version } as never);
      toast({ tone: 'success', title: body.dueAt ? t('rescheduled') : t('saved') });
      onOpenChange(false);
    } catch (e) {
      setError(apiErr(e).message);
    }
  }
  return (
    <DialogContent
      size="md"
      title={t('title')}
      description={t('description')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button>
          <Button type="submit" form="edit-task-form" loading={update.isPending} loadingLabel={tc('saving')}>{t('save')}</Button>
        </>
      }
    >
      <form id="edit-task-form" onSubmit={form.handleSubmit(submit)} noValidate className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <FormField label={tt('title')} error={fe(form.formState.errors.title)} required>
          <Input {...form.register('title')} />
        </FormField>
        <FormField label={tt('priority')}>
          <Select {...form.register('priority')}>
            {(['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const).map((p) => (<option key={p} value={p}>{tt(`priority${p}` as 'priorityLOW')}</option>))}
          </Select>
        </FormField>
        <FormField label={tt('dueAt')} error={fe(form.formState.errors.dueAt)} hint={t('rescheduleHint')} required>
          <Controller control={form.control} name="dueAt" render={({ field }) => <DatePicker mode="datetime-local" value={field.value} onValueChange={field.onChange} />} />
        </FormField>
        <div className="flex flex-wrap gap-2" role="group" aria-label={tp('quickPicks')}>
          {(['plus3h', 'tomorrow10', 'plus2d'] as QuickPick[]).map((p) => (
            <Button key={p} type="button" size="sm" variant="secondary" onClick={() => form.setValue('dueAt', quickPick(p), { shouldValidate: true })}>{tp(`pick.${p}`)}</Button>
          ))}
        </div>
        <FormField label={t('notes')} error={fe(form.formState.errors.description)}>
          <Textarea rows={3} {...form.register('description')} />
        </FormField>
      </form>
    </DialogContent>
  );
}
