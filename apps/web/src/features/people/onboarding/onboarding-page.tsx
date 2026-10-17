'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Alert, Badge, Button, Combobox, DataTable, Dialog, DialogContent, EmptyState, ErrorState, FormField, Input, PageHeader, Panel, Select, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, type Column,
} from '@salesos/ui';
import { Can, usePermission } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useTeamMemberOptions } from '../common/api';
import { useCompetencies } from '../hiring/api';
import { ConfirmDialog, useDone, useFmt } from '../hrkit/kit';
import {
  useAcknowledgeExpectation, useCompleteProbation, useCreateExpectation, useCreatePlan, useCreateTemplate, useDeleteTemplate, useUpdateTemplate, useExpectationAdoption, useExpectations, usePlans, useProbation, useTemplates, type Expectation, type ProbationReview, type Template,
} from './api';
import { PlanCard } from './plan-card';

export function OnboardingPage() {
  return (
    <RequirePermission permission="onboarding:view">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('onboarding');
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <Tabs defaultValue="plans">
        <TabsList aria-label={t('title')}>
          <TabsTrigger value="plans">{t('tabs.plans')}</TabsTrigger>
          <TabsTrigger value="probation">{t('tabs.probation')}</TabsTrigger>
          <TabsTrigger value="templates">{t('tabs.templates')}</TabsTrigger>
          <TabsTrigger value="expectations">{t('tabs.expectations')}</TabsTrigger>
        </TabsList>
        <TabsContent value="plans"><PlansTab /></TabsContent>
        <TabsContent value="probation"><ProbationTab /></TabsContent>
        <TabsContent value="templates"><TemplatesTab /></TabsContent>
        <TabsContent value="expectations"><ExpectationsTab /></TabsContent>
      </Tabs>
    </>
  );
}

function PlansTab() {
  const t = useTranslations('onboarding');
  const apiErr = useApiErrorMessage();
  const q = usePlans();
  const [open, setOpen] = React.useState(false);
  return (
    <Panel accent="gold" title={t('tabs.plans')} actions={<Can permission="onboarding:manage"><Button className="glow-gold" onClick={() => setOpen(true)}>{t('plans.new')}</Button></Can>}>
      {q.isPending ? <Skeleton className="shimmer h-24 w-full" /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} description={apiErr(q.error).message} /> : q.data.items.length === 0 ? (
        <EmptyState title={t('plans.emptyTitle')} description={t('plans.emptyBody')} />
      ) : (
        <ul className="stagger space-y-4">{q.data.items.map((p) => <PlanCard key={p.id} plan={p} />)}</ul>
      )}
      <Dialog open={open} onOpenChange={setOpen}>{open && <PlanForm onClose={() => setOpen(false)} />}</Dialog>
    </Panel>
  );
}

function PlanForm({ onClose }: { onClose: () => void }) {
  const t = useTranslations('onboarding');
  const apiErr = useApiErrorMessage();
  const done = useDone();
  const people = useTeamMemberOptions();
  const templates = useTemplates();
  const create = useCreatePlan();
  const [emp, setEmp] = React.useState<string | null>(null);
  const [tpl, setTpl] = React.useState('');
  const [start, setStart] = React.useState(new Date().toISOString().slice(0, 10));
  const submit = async () => {
    try {
      await create.mutateAsync({ employeeId: emp, templateId: tpl, startDate: start, scheduleProbation: true });
      done(t('saved'));
      onClose();
    } catch { /* shown below */ }
  };
  return (
    <DialogContent title={t('plans.new')} description={t('plans.newBody')} footer={<><Button variant="secondary" onClick={onClose}>{t('cancel')}</Button><Button disabled={!emp || !tpl || !start} loading={create.isPending} onClick={() => void submit()}>{t('create')}</Button></>}>
      {create.isError && <Alert tone="danger" className="mb-3">{apiErr(create.error).message}</Alert>}
      <div className="grid gap-3">
        <FormField label={t('plans.employee')} required><Combobox options={(people.data ?? []).map((p) => ({ value: p.id, label: p.name }))} value={emp} onValueChange={setEmp} loading={people.isPending} placeholder={t('plans.pickEmployee')} /></FormField>
        <FormField label={t('plans.template')} required>
          <Select value={tpl} onChange={(e) => setTpl(e.target.value)}><option value="">—</option>{(templates.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
        </FormField>
        <FormField label={t('plans.startDate')} required><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></FormField>
        <p className="text-xs text-muted">{t('plans.probationNote')}</p>
      </div>
    </DialogContent>
  );
}

function ProbationTab() {
  const t = useTranslations('onboarding');
  const fmt = useFmt();
  const apiErr = useApiErrorMessage();
  const q = useProbation();
  const [target, setTarget] = React.useState<ProbationReview | null>(null);
  const cols: Column<ProbationReview>[] = [
    { id: 'emp', header: t('probation.employee'), primary: true, cell: (r) => r.employeeName ?? '—' },
    { id: 'day', header: t('probation.checkpoint'), cell: (r) => t('probation.day', { day: r.checkpointDay }) },
    { id: 'due', header: t('probation.due'), cell: (r) => <>{fmt.date(r.dueDate)}{r.overdue && <Badge tone="red" className="ml-2">{t('plans.overdue')}</Badge>}</> },
    { id: 'status', header: t('probation.status'), cell: (r) => (r.status === 'COMPLETED' ? <Badge tone="green">{t(`outcome.${r.outcome ?? 'ON_TRACK'}` as never)}</Badge> : <Badge tone="gold">{t(`probation.${r.status}` as never)}</Badge>) },
  ];
  return (
    <Panel accent="blue" title={t('tabs.probation')} description={t('probation.description')}>
      <DataTable
        caption={t('tabs.probation')}
        columns={cols}
        rows={q.data?.items}
        getRowId={(r) => r.id}
        loading={q.isPending}
        error={q.isError ? { message: apiErr(q.error).message, onRetry: () => void q.refetch() } : null}
        emptyTitle={t('probation.emptyTitle')}
        emptyDescription={t('probation.emptyBody')}
        rowActions={(r) => r.status === 'SCHEDULED' ? <Can permission="onboarding:manage"><Button size="sm" variant="secondary" onClick={() => setTarget(r)}>{t('probation.complete')}</Button></Can> : null}
        actionsHeader={t('actions')}
      />
      <Dialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>{target && <ProbationForm review={target} onClose={() => setTarget(null)} />}</Dialog>
    </Panel>
  );
}

function ProbationForm({ review, onClose }: { review: ProbationReview; onClose: () => void }) {
  const t = useTranslations('onboarding');
  const apiErr = useApiErrorMessage();
  const done = useDone();
  const complete = useCompleteProbation(review.id);
  const comps = useCompetencies();
  const [outcome, setOutcome] = React.useState('ON_TRACK');
  const [notes, setNotes] = React.useState('');
  const [scores, setScores] = React.useState<Record<string, string>>({});
  const submit = () => complete.mutate(
    { outcome, notes: notes || undefined, competencyScores: Object.fromEntries(Object.entries(scores).filter(([, v]) => v).map(([k, v]) => [k, Number(v)])) },
    { onSuccess: () => { done(t('saved')); onClose(); } },
  );
  return (
    <DialogContent size="lg" title={t('probation.completeTitle', { name: review.employeeName ?? '', day: review.checkpointDay })} description={t('probation.completeBody')} footer={<><Button variant="secondary" onClick={onClose}>{t('cancel')}</Button><Button loading={complete.isPending} onClick={submit}>{t('probation.complete')}</Button></>}>
      {complete.isError && <Alert tone="danger" className="mb-3">{apiErr(complete.error).message}</Alert>}
      <div className="grid gap-3">
        <FormField label={t('probation.outcome')} required>
          <Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>{['ON_TRACK', 'CONCERNS', 'CONFIRM', 'EXTEND', 'NOT_CONFIRMED'].map((o) => <option key={o} value={o}>{t(`outcome.${o}` as never)}</option>)}</Select>
        </FormField>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-ink">{t('probation.competencies')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(comps.data ?? []).filter((c) => c.isActive).map((c) => (
              <FormField key={c.key} label={c.name}><Select value={scores[c.key] ?? ''} onChange={(e) => setScores({ ...scores, [c.key]: e.target.value })}><option value="">—</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</Select></FormField>
            ))}
          </div>
        </fieldset>
        <FormField label={t('probation.notes')}><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></FormField>
      </div>
    </DialogContent>
  );
}

const tplSchema = z.object({
  roleKey: z.string().trim().min(2, 'required'),
  name: z.string().trim().min(3, 'min3'),
  probationDays: z.string().refine((v) => v.split(',').every((x) => /^\d+$/.test(x.trim())), 'days'),
  items: z.array(z.object({ title: z.string().trim().min(3, 'min3'), category: z.enum(['ONBOARDING', 'TRAINING', 'TOOLS', 'CULTURE']), dueDay: z.string().regex(/^\d+$/, 'integer') })).min(1, 'oneItem'),
});
function TemplatesTab() {
  const t = useTranslations('onboarding');
  const apiErr = useApiErrorMessage();
  const q = useTemplates();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Template | null>(null);
  const [removing, setRemoving] = React.useState<Template | null>(null);
  const del = useDeleteTemplate();
  const done = useDone();
  return (
    <Panel accent="green" title={t('tabs.templates')} actions={<Can permission="onboarding:manage" minScope="org"><Button onClick={() => setOpen(true)}>{t('templates.new')}</Button></Can>}>
      {q.isPending ? <Skeleton className="shimmer h-24 w-full" /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} description={apiErr(q.error).message} /> : q.data.length === 0 ? (
        <EmptyState title={t('templates.emptyTitle')} description={t('templates.emptyBody')} />
      ) : (
        <ul className="space-y-3">
          {q.data.map((x) => (
            <li key={x.id} className="accent-top hover-lift rounded-lg border border-line bg-surface p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="font-semibold text-ink">{x.name} <Badge tone="blue">{x.roleKey}</Badge></h3>
                <Can permission="onboarding:manage" minScope="org">
                  <span className="flex gap-1">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(x)}>{t('templates.edit')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setRemoving(x)}>{t('templates.delete')}</Button>
                  </span>
                </Can>
              </div>
              <p className="mt-1 text-sm text-muted">{t('templates.probationDays', { days: x.probationDays.join(', ') })}</p>
              <ol className="mt-2 list-decimal pl-5 text-sm">{x.items.map((i, n) => <li key={n}>{i.title} <span className="text-muted">({t('templates.dayN', { day: i.dueDay ?? 7 })})</span></li>)}</ol>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={open} onOpenChange={setOpen}>{open && <TemplateForm onClose={() => setOpen(false)} />}</Dialog>
      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>{editing && <TemplateForm template={editing} onClose={() => setEditing(null)} />}</Dialog>
      <ConfirmDialog
        open={Boolean(removing)} onOpenChange={(o) => !o && setRemoving(null)} title={t('templates.deleteTitle')} description={t('templates.deleteBody', { name: removing?.name ?? '' })}
        confirmLabel={t('templates.delete')} danger pending={del.isPending} error={del.error}
        onConfirm={() => removing && del.mutate({ id: removing.id }, { onSuccess: () => { setRemoving(null); done(t('templates.deleted')); } })}
      />
    </Panel>
  );
}
function TemplateForm({ onClose, template }: { onClose: () => void; template?: Template }) {
  const t = useTranslations('onboarding');
  const apiErr = useApiErrorMessage();
  const done = useDone();
  const create = useCreateTemplate();
  const update = useUpdateTemplate();
  const form = useForm<z.infer<typeof tplSchema>>({ resolver: zodResolver(tplSchema), defaultValues: template
      ? { roleKey: template.roleKey, name: template.name, probationDays: template.probationDays.join(', '), items: template.items.map((i) => ({ title: i.title, category: (i.category as 'ONBOARDING' | 'TRAINING' | 'TOOLS' | 'CULTURE') ?? 'ONBOARDING', dueDay: String(i.dueDay ?? 7) })) }
      : { roleKey: '', name: '', probationDays: '30, 60, 90', items: [{ title: '', category: 'ONBOARDING', dueDay: '7' }] } });
  const items = useFieldArray({ control: form.control, name: 'items' });
  const e = form.formState.errors;
  const fe = (x?: { message?: unknown }) => (typeof x?.message === 'string' ? t(`errors.${x.message}` as never) : undefined);
  const submit = form.handleSubmit(async (v) => {
    try {
      const body = { roleKey: v.roleKey, name: v.name, probationDays: v.probationDays.split(',').map((x) => Number(x.trim())), items: v.items.map((i) => ({ title: i.title, category: i.category, dueDay: Number(i.dueDay) })) };
      if (template) await update.mutateAsync({ id: template.id, body });
      else await create.mutateAsync(body);
      done(t('saved'));
      onClose();
    } catch (err) { form.setError('root', { message: apiErr(err).message }); }
  });
  return (
    <DialogContent size="lg" title={template ? t('templates.edit') : t('templates.new')} description={template ? t('templates.editBody') : t('templates.newBody')} footer={<><Button variant="secondary" onClick={onClose}>{t('cancel')}</Button><Button type="submit" form="tpl-form" loading={create.isPending || update.isPending}>{t('create')}</Button></>}>
      {e.root && <Alert tone="danger" className="mb-3">{e.root.message}</Alert>}
      <form id="tpl-form" onSubmit={submit} noValidate className="grid gap-3">
        <FormField label={t('templates.role')} required error={fe(e.roleKey)}><Input {...form.register('roleKey')} /></FormField>
        <FormField label={t('templates.name')} required error={fe(e.name)}><Input {...form.register('name')} /></FormField>
        <FormField label={t('templates.probationLabel')} hint={t('templates.probationHint')} error={fe(e.probationDays)}><Input {...form.register('probationDays')} /></FormField>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-ink">{t('templates.items')}</legend>
          {e.items?.message && <p role="alert" className="mb-1 text-sm text-red-700">{fe(e.items as { message?: unknown })}</p>}
          {items.fields.map((f, i) => (
            <div key={f.id} className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <FormField label={t('templates.itemTitle')} error={fe(e.items?.[i]?.title)} className="col-span-2"><Input {...form.register(`items.${i}.title`)} /></FormField>
              <FormField label={t('templates.category')}><Select {...form.register(`items.${i}.category`)}>{['ONBOARDING', 'TRAINING', 'TOOLS', 'CULTURE'].map((c) => <option key={c} value={c}>{t(`category.${c}` as never)}</option>)}</Select></FormField>
              <FormField label={t('templates.dueDay')} error={fe(e.items?.[i]?.dueDay)}><Input inputMode="numeric" {...form.register(`items.${i}.dueDay`)} /></FormField>
              <div className="flex items-end"><Button type="button" variant="ghost" onClick={() => items.remove(i)}>{t('remove')}</Button></div>
            </div>
          ))}
          <Button type="button" size="sm" variant="secondary" onClick={() => items.append({ title: '', category: 'ONBOARDING', dueDay: '7' })}>{t('templates.addItem')}</Button>
        </fieldset>
      </form>
    </DialogContent>
  );
}

export function ExpectationsTab() {
  const t = useTranslations('onboarding');
  const apiErr = useApiErrorMessage();
  const [role, setRole] = React.useState('');
  const q = useExpectations(role);
  const canSeeAdoption = usePermission('onboarding:view', 'team');
  const [open, setOpen] = React.useState(false);
  return (
    <Panel accent="gold" title={t('tabs.expectations')} description={t('expectations.description')} actions={<><Input aria-label={t('expectations.filterRole')} placeholder={t('expectations.filterRole')} value={role} onChange={(e) => setRole(e.target.value.toUpperCase())} className="w-48" /><Can permission="onboarding:manage" minScope="org"><Button onClick={() => setOpen(true)}>{t('expectations.new')}</Button></Can></>}>
      {q.isPending ? <Skeleton className="shimmer h-24 w-full" /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} description={apiErr(q.error).message} /> : q.data.length === 0 ? (
        <EmptyState title={t('expectations.emptyTitle')} description={t('expectations.emptyBody')} />
      ) : (
        <ul className="space-y-3">{q.data.map((x) => (
          <li key={x.id} className="accent-top hover-lift rounded-lg border border-line bg-surface p-4 shadow-sm"><p className="flex flex-wrap items-center gap-2"><span className="font-semibold text-ink">{x.title}</span><Badge tone="gold">{t(`expectations.kind.${x.kind}` as never)}</Badge><Badge tone="blue">{x.roleKey}</Badge></p><p className="mt-1 text-sm text-ink-600">{x.body}</p><AckRow x={x} /></li>
        ))}</ul>
      )}
      {canSeeAdoption && <AdoptionPanel />}
      <Dialog open={open} onOpenChange={setOpen}>{open && <ExpectationForm onClose={() => setOpen(false)} />}</Dialog>
    </Panel>
  );
}
/** The employee acknowledges the CURRENT text of an expectation of their own role (JD-HR-009). */
function AckRow({ x }: { x: Expectation }) {
  const t = useTranslations('onboarding');
  const apiErr = useApiErrorMessage();
  const done = useDone();
  const ack = useAcknowledgeExpectation();
  const [error, setError] = React.useState<string | null>(null);
  if (!x.mustAcknowledge) return null;
  if (x.acknowledgedByMe) return <p className="mt-2 text-sm text-green-700" data-testid="ack-done">{t('expectations.acknowledgedOn', { date: x.acknowledgedAt ? new Date(x.acknowledgedAt).toLocaleDateString('en-IN') : '' })}</p>;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <Button size="sm" loading={ack.isPending} onClick={() => { setError(null); ack.mutate({ id: x.id }, { onSuccess: () => done(t('expectations.acknowledgedToast')), onError: (e) => setError(apiErr(e).message) }); }}>{t('expectations.acknowledge')}</Button>
      <span className="text-xs text-muted">{t('expectations.acknowledgeHint')}</span>
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
    </div>
  );
}

/** Who has acknowledged (counts for everyone in scope; names of those still pending). */
function AdoptionPanel() {
  const t = useTranslations('onboarding');
  const apiErr = useApiErrorMessage();
  const q = useExpectationAdoption(true);
  return (
    <div className="mt-6 border-t border-line pt-4">
      <h3 className="text-sm font-semibold text-ink">{t('expectations.adoptionTitle')}</h3>
      {q.isPending ? <Skeleton className="shimmer mt-2 h-12 w-full" /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} description={apiErr(q.error).message} /> : q.data.length === 0 ? (
        <p className="mt-1 text-sm text-muted">{t('expectations.adoptionEmpty')}</p>
      ) : (
        <ul className="mt-2 space-y-2" aria-label={t('expectations.adoptionTitle')} data-testid="ack-adoption">{q.data.map((a) => (
          <li key={a.id} className="text-sm"><span className="font-medium text-ink">{a.title}</span> <span className="text-muted">({a.roleKey})</span> - {t('expectations.adoptionCount', { done: a.acknowledged, total: a.audience })}{a.pending.length > 0 && <span className="block text-xs text-muted">{t('expectations.pending', { names: a.pending.map((p) => p.name).join(', ') })}</span>}</li>
        ))}</ul>
      )}
    </div>
  );
}

function ExpectationForm({ onClose }: { onClose: () => void }) {
  const t = useTranslations('onboarding');
  const apiErr = useApiErrorMessage();
  const done = useDone();
  const create = useCreateExpectation();
  const [v, setV] = React.useState({ roleKey: '', kind: 'OWNERSHIP', title: '', body: '' });
  const valid = v.roleKey.trim().length >= 2 && v.title.trim().length >= 3 && v.body.trim().length >= 5;
  return (
    <DialogContent title={t('expectations.new')} footer={<><Button variant="secondary" onClick={onClose}>{t('cancel')}</Button><Button disabled={!valid} loading={create.isPending} onClick={() => create.mutate(v, { onSuccess: () => { done(t('saved')); onClose(); } })}>{t('create')}</Button></>}>
      {create.isError && <Alert tone="danger" className="mb-3">{apiErr(create.error).message}</Alert>}
      <div className="grid gap-3">
        <FormField label={t('templates.role')} required><Input value={v.roleKey} onChange={(e) => setV({ ...v, roleKey: e.target.value.toUpperCase() })} /></FormField>
        <FormField label={t('expectations.kindLabel')}><Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>{['OWNERSHIP', 'ACCOUNTABILITY', 'CULTURE'].map((k) => <option key={k} value={k}>{t(`expectations.kind.${k}` as never)}</option>)}</Select></FormField>
        <FormField label={t('templates.itemTitle')} required><Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></FormField>
        <FormField label={t('expectations.body')} required><Textarea rows={4} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} /></FormField>
      </div>
    </DialogContent>
  );
}
