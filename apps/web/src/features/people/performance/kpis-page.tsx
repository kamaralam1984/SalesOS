'use client';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import {
  Alert, Badge, Button, Checkbox, Dialog, DialogContent, FormField, Input, PageHeader, Select, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, useToast,
} from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { toDateInput, useTeamMemberOptions } from '../common/api';
import { MutationAlert, QueryState, useFormatDate, useFormErrors } from '../hub/shared';
import { useCreateKpiDefinition, useKpiAssignments, useKpiDefinitions, useSaveAssignment, useSaveScorecard, useScorecards, type KpiDefinition } from './api';
import { addDaysYmd, buildAssignmentItems, buildScorecardInputs, mondayOf, type ScoreRow, type Selection } from './kpi-logic';

export function KpisPage() {
  return (
    <RequirePermission permission="kpi-assignments:view">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('performance');
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('kpis.title')} description={t('kpis.description')} />
      <Tabs defaultValue="assignments">
        <TabsList aria-label={t('kpis.title')}>
          <TabsTrigger value="assignments">{t('kpis.tabs.assignments')}</TabsTrigger>
          <TabsTrigger value="scorecards">{t('kpis.tabs.scorecards')}</TabsTrigger>
          <TabsTrigger value="definitions">{t('kpis.tabs.definitions')}</TabsTrigger>
        </TabsList>
        <TabsContent value="assignments"><Assignments /></TabsContent>
        <TabsContent value="scorecards"><Scorecards /></TabsContent>
        <TabsContent value="definitions"><Definitions /></TabsContent>
      </Tabs>
    </>
  );
}

function ItemList({ items }: { items: { key: string; name: string; kind?: string; target?: number; actual?: number; unit?: string; source?: string; note?: string }[] }) {
  const t = useTranslations('performance');
  return (
    <ul className="mt-2 divide-y divide-line text-sm">
      {items.map((i) => (
        <li key={i.key} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
          <span className="text-ink">{i.name}{i.kind ? <Badge className="ml-2">{i.kind}</Badge> : null}</span>
          <span className="text-muted">
            {i.target !== undefined && `${t('kpis.target')}: ${i.target}${i.unit ? ` ${i.unit}` : ''}`}
            {i.actual !== undefined && ` · ${t('kpis.actual')}: ${i.actual}`}
            {i.actual === undefined && i.note && ` · ${t('kpis.autoNoNumber', { reason: i.note })}`}
            {i.source && <Badge className="ml-2">{t(i.source === 'PHASE5' ? 'kpis.sourceAuto' : 'kpis.sourceManual')}</Badge>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Assignments() {
  const t = useTranslations('performance');
  const fmt = useFormatDate();
  const { can } = useAuth();
  const [week, setWeek] = React.useState(() => mondayOf(toDateInput()));
  const [open, setOpen] = React.useState(false);
  const q = useKpiAssignments({ weekStart: week, limit: 50 });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setWeek(addDaysYmd(week, -7))}>{t('kpis.prevWeek')}</Button>
          <FormField label={t('kpis.week')} hint={t('kpis.weekHint')} className="w-44">
            <Input type="date" value={week} onChange={(e) => e.target.value && setWeek(mondayOf(e.target.value))} />
          </FormField>
          <Button variant="secondary" size="sm" onClick={() => setWeek(addDaysYmd(week, 7))}>{t('kpis.nextWeek')}</Button>
        </div>
        {can('kpi-assignments:manage') && (
          <Button leadingIcon={<Plus aria-hidden="true" />} onClick={() => setOpen(true)}>{t('kpis.assign')}</Button>
        )}
      </div>
      <QueryState query={q} isEmpty={(q.data?.items.length ?? 0) === 0} emptyTitle={t('kpis.noAssignments')} emptyDescription={t('kpis.noAssignmentsBody')}>
        <div className="stagger space-y-3">
          {(q.data?.items ?? []).map((a) => (
            <article key={a.id} className="accent-top hover-lift enter-up rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="font-display text-base font-semibold text-ink">{a.assigneeName ?? '—'}</h2>
              <p className="text-xs text-muted">{t('kpis.setBy', { name: a.setByName ?? '—', date: fmt.date(a.weekStart) })}</p>
              <ItemList items={a.items} />
            </article>
          ))}
        </div>
      </QueryState>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t('kpis.assignTitle')} description={t('kpis.assignDescription', { week: fmt.date(week) })} size="lg" closeLabel={t('close')}>
          {open && <AssignForm week={week} onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AssignForm({ week, onDone }: { week: string; onDone: () => void }) {
  const t = useTranslations('performance');
  const { user } = useAuth();
  const { toast } = useToast();
  const people = useTeamMemberOptions();
  const defs = useKpiDefinitions();
  const save = useSaveAssignment();
  const [assignee, setAssignee] = React.useState('');
  const [sel, setSel] = React.useState<Selection>({});
  const [err, setErr] = React.useState<string | null>(null);
  const targets = (people.data ?? []).filter((p) => p.id !== user?.id);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const items = buildAssignmentItems(defs.data ?? [], sel);
    if (!assignee) return setErr(t('kpis.errAssignee'));
    if (items.length === 0) return setErr(t('kpis.errItems'));
    setErr(null);
    try {
      await save.mutateAsync({ assigneeId: assignee, weekStart: week, items });
      toast({ tone: 'success', title: t('kpis.assignSaved') });
      onDone();
    } catch {
      /* shown below */
    }
  };
  return (
    <form onSubmit={submit} className="space-y-4" noValidate aria-label={t('kpis.assignTitle')}>
      <FormField label={t('kpis.assignee')} required>
        <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">{t('choose')}</option>
          {targets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </FormField>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink">{t('kpis.pick')}</legend>
        <QueryState query={defs} isEmpty={(defs.data?.length ?? 0) === 0} emptyTitle={t('kpis.noDefinitions')} emptyDescription={t('kpis.noDefinitionsBody')}>
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {(defs.data ?? []).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line p-2.5">
                <Checkbox
                  label={`${d.name} (${d.kind})`}
                  checked={sel[d.id]?.selected ?? false}
                  onCheckedChange={(c) => setSel((s) => ({ ...s, [d.id]: { selected: c === true, target: s[d.id]?.target ?? '' } }))}
                />
                {d.kind === 'KPI' && sel[d.id]?.selected && (
                  <FormField label={t('kpis.target')} hideLabel className="w-32">
                    <Input type="number" inputMode="decimal" placeholder={d.unit ? `${t('kpis.target')} (${d.unit})` : t('kpis.target')} aria-label={`${t('kpis.target')}: ${d.name}`} value={sel[d.id]?.target ?? ''} onChange={(e) => setSel((s) => ({ ...s, [d.id]: { selected: true, target: e.target.value } }))} />
                  </FormField>
                )}
              </li>
            ))}
          </ul>
        </QueryState>
      </fieldset>
      {err && <Alert tone="danger">{err}</Alert>}
      <MutationAlert error={save.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>{t('cancel')}</Button>
        <Button type="submit" loading={save.isPending}>{t('kpis.assignSave')}</Button>
      </div>
    </form>
  );
}

function Scorecards() {
  const t = useTranslations('performance');
  const fmt = useFormatDate();
  const { can } = useAuth();
  const [open, setOpen] = React.useState(false);
  const q = useScorecards({ limit: 25 });
  return (
    <div className="space-y-4">
      <Alert tone="info" title={t('kpis.inputsOnlyTitle')}>{t('kpis.inputsOnlyBody')}</Alert>
      {can('kpi-assignments:manage') && (
        <div className="flex justify-end"><Button leadingIcon={<Plus aria-hidden="true" />} onClick={() => setOpen(true)}>{t('kpis.enterScorecard')}</Button></div>
      )}
      <QueryState query={q} isEmpty={(q.data?.items.length ?? 0) === 0} emptyTitle={t('kpis.noScorecards')} emptyDescription={t('kpis.noScorecardsBody')}>
        <div className="stagger space-y-3">
          {(q.data?.items ?? []).map((s) => (
            <article key={s.id} className="accent-top hover-lift enter-up rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="font-display text-base font-semibold text-ink">{s.subjectName ?? '—'}</h2>
              <p className="text-xs text-muted">{t(`kpis.period.${s.periodType}` as never)} · {fmt.date(s.periodStart)} – {fmt.date(s.periodEnd)}</p>
              <ItemList items={s.inputs} />
              {s.comments && <p className="mt-2 text-sm text-muted">{s.comments}</p>}
            </article>
          ))}
        </div>
      </QueryState>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t('kpis.enterScorecard')} description={t('kpis.scorecardDescription')} size="lg" closeLabel={t('close')}>
          {open && <ScorecardForm onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ScorecardForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('performance');
  const { user } = useAuth();
  const { toast } = useToast();
  const people = useTeamMemberOptions();
  const defs = useKpiDefinitions();
  const save = useSaveScorecard();
  const monday = mondayOf(toDateInput());
  const [subject, setSubject] = React.useState('');
  const [type, setType] = React.useState<'WEEK' | 'MONTH'>('WEEK');
  const [start, setStart] = React.useState(addDaysYmd(monday, -7));
  const [end, setEnd] = React.useState(addDaysYmd(monday, -1));
  const [comments, setComments] = React.useState('');
  const [rows, setRows] = React.useState<Record<string, ScoreRow>>({});
  const [err, setErr] = React.useState<string | null>(null);
  const kpis = (defs.data ?? []).filter((d) => d.kind === 'KPI');
  const subjects = (people.data ?? []).filter((p) => p.id !== user?.id);
  const set = (id: string, k: keyof ScoreRow, v: string) => setRows((r) => ({ ...r, [id]: { target: r[id]?.target ?? '', actual: r[id]?.actual ?? '', [k]: v } }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const inputs = buildScorecardInputs(kpis, rows);
    if (!subject) return setErr(t('kpis.errAssignee'));
    if (end < start) return setErr(t('kpis.errPeriod'));
    if (inputs.length === 0) return setErr(t('kpis.errScoreRows'));
    setErr(null);
    try {
      await save.mutateAsync({ subjectId: subject, periodType: type, periodStart: start, periodEnd: end, inputs, ...(comments.trim() ? { comments: comments.trim() } : {}) });
      toast({ tone: 'success', title: t('kpis.scorecardSaved') });
      onDone();
    } catch {
      /* shown below */
    }
  };
  return (
    <form onSubmit={submit} className="space-y-4" noValidate aria-label={t('kpis.enterScorecard')}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t('kpis.person')} required>
          <Select value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">{t('choose')}</option>
            {subjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </FormField>
        <FormField label={t('kpis.periodType')}>
          <Select value={type} onChange={(e) => setType(e.target.value as 'WEEK' | 'MONTH')}>
            <option value="WEEK">{t('kpis.period.WEEK')}</option>
            <option value="MONTH">{t('kpis.period.MONTH')}</option>
          </Select>
        </FormField>
        <FormField label={t('kpis.periodStart')} required><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></FormField>
        <FormField label={t('kpis.periodEnd')} required><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></FormField>
      </div>
      <QueryState query={defs} isEmpty={kpis.length === 0} emptyTitle={t('kpis.noDefinitions')} emptyDescription={t('kpis.noDefinitionsBody')}>
        <ul className="space-y-2">
          {kpis.map((d) => (
            <li key={d.id} className="grid items-end gap-2 rounded-md border border-line p-2.5 sm:grid-cols-[1fr_8rem_8rem]">
              <span className="text-sm font-medium text-ink">{d.name}{d.unit ? ` (${d.unit})` : ''}</span>
              <FormField label={t('kpis.target')}><Input type="number" inputMode="decimal" value={rows[d.id]?.target ?? ''} onChange={(e) => set(d.id, 'target', e.target.value)} /></FormField>
              <FormField label={t('kpis.actual')} {...(d.dictionaryKey ? { hint: t('kpis.actualAutoHint') } : {})}><Input type="number" inputMode="decimal" value={rows[d.id]?.actual ?? ''} onChange={(e) => set(d.id, 'actual', e.target.value)} /></FormField>
            </li>
          ))}
        </ul>
      </QueryState>
      <FormField label={t('kpis.comments')}><Textarea rows={2} value={comments} onChange={(e) => setComments(e.target.value)} /></FormField>
      {err && <Alert tone="danger">{err}</Alert>}
      <MutationAlert error={save.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>{t('cancel')}</Button>
        <Button type="submit" loading={save.isPending}>{t('kpis.scorecardSave')}</Button>
      </div>
    </form>
  );
}

const defSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,59}$/, 'keyFormat'),
  name: z.string().trim().min(2, 'required').max(120, 'tooLong'),
  kind: z.enum(['KPI', 'KRA']),
  unit: z.string().max(30, 'tooLong').optional(),
  dictionaryKey: z.string().max(80, 'tooLong').optional(),
  description: z.string().max(1000, 'tooLong').optional(),
});
type DefValues = z.infer<typeof defSchema>;

function Definitions() {
  const t = useTranslations('performance');
  const { can } = useAuth();
  const [open, setOpen] = React.useState(false);
  const q = useKpiDefinitions();
  return (
    <div className="space-y-4">
      {can('kpi-assignments:manage') && (
        <div className="flex justify-end"><Button leadingIcon={<Plus aria-hidden="true" />} onClick={() => setOpen(true)}>{t('kpis.newDefinition')}</Button></div>
      )}
      <QueryState query={q} isEmpty={(q.data?.length ?? 0) === 0} emptyTitle={t('kpis.noDefinitions')} emptyDescription={t('kpis.noDefinitionsBody')}>
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {(q.data ?? []).map((d: KpiDefinition) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <span>
                <span className="font-medium text-ink">{d.name}</span>
                <span className="block text-xs text-muted">{d.key}{d.dictionaryKey ? ` · ${t('kpis.dictionary')}: ${d.dictionaryKey}` : ''}</span>
              </span>
              <Badge tone={d.kind === 'KPI' ? 'blue' : 'gold'}>{d.kind}</Badge>
            </li>
          ))}
        </ul>
      </QueryState>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t('kpis.newDefinition')} size="md" closeLabel={t('close')}>
          {open && <DefinitionForm onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DefinitionForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('performance');
  const fe = useFormErrors('performance');
  const { toast } = useToast();
  const create = useCreateKpiDefinition();
  const { register, handleSubmit, formState } = useForm<DefValues>({ resolver: zodResolver(defSchema), defaultValues: { key: '', name: '', kind: 'KPI', unit: '', dictionaryKey: '', description: '' } });
  const onSubmit = handleSubmit(async (v) => {
    try {
      await create.mutateAsync({ key: v.key, name: v.name, kind: v.kind, ...(v.unit ? { unit: v.unit } : {}), ...(v.dictionaryKey ? { dictionaryKey: v.dictionaryKey } : {}), ...(v.description ? { description: v.description } : {}) });
      toast({ tone: 'success', title: t('kpis.definitionSaved') });
      onDone();
    } catch {
      /* shown below */
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3" aria-label={t('kpis.newDefinition')}>
      <FormField label={t('kpis.defName')} error={fe(formState.errors.name)} required><Input {...register('name')} /></FormField>
      <FormField label={t('kpis.defKey')} hint={t('kpis.defKeyHint')} error={fe(formState.errors.key)} required><Input {...register('key')} /></FormField>
      <FormField label={t('kpis.defKind')}>
        <Select {...register('kind')}><option value="KPI">KPI</option><option value="KRA">KRA</option></Select>
      </FormField>
      <FormField label={t('kpis.defUnit')}><Input {...register('unit')} /></FormField>
      <FormField label={t('kpis.defDictionary')} hint={t('kpis.defDictionaryHint')}><Input {...register('dictionaryKey')} /></FormField>
      <FormField label={t('kpis.defDescription')}><Textarea rows={2} {...register('description')} /></FormField>
      <MutationAlert error={create.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>{t('cancel')}</Button>
        <Button type="submit" loading={create.isPending}>{t('kpis.defSave')}</Button>
      </div>
    </form>
  );
}
