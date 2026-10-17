'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus } from 'lucide-react';
import {
  Alert, Badge, Button, Dialog, DialogContent, EmptyState, ErrorState, FormField, Input, PageHeader, Panel, Select, Sheet, SheetContent, Skeleton, StatusBadge, Tabs, TabsContent, TabsList, TabsTrigger, Textarea,
} from '@salesos/ui';
import { Can, usePermission } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useDone, useFmt } from '../hrkit/kit';
import {
  STAGES, useAddFeedback, useCandidate, useCandidates, useCompetencies, useCreateCandidate, useCreateRequisition, useMoveCandidate, useRequisitions, useRoleProfiles, useSaveProfile,
  type Candidate, type CandidateStage, type Requisition, type RoleProfile,
} from './api';
import { ProfileMatchList } from './profile-match';

export function HiringPage() {
  return (
    <RequirePermission permission="hiring:view">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('hiring');
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <Alert tone="info" className="enter-fade mb-5" live={false}>{t('restricted')}</Alert>
      <Tabs defaultValue="pipeline">
        <TabsList aria-label={t('title')}>
          <TabsTrigger value="pipeline">{t('tabs.pipeline')}</TabsTrigger>
          <TabsTrigger value="profiles">{t('tabs.profiles')}</TabsTrigger>
        </TabsList>
        <TabsContent value="pipeline"><PipelineTab /></TabsContent>
        <TabsContent value="profiles"><ProfilesTab /></TabsContent>
      </Tabs>
    </>
  );
}

function PipelineTab() {
  const t = useTranslations('hiring');
  const apiErr = useApiErrorMessage();
  const fmt = useFmt();
  const q = useRequisitions();
  const [selected, setSelected] = React.useState<Requisition | null>(null);
  const [creating, setCreating] = React.useState(false);
  return (
    <div className="space-y-5">
      <Panel accent="gold" title={t('pipeline.title')} actions={<Can permission="hiring:manage"><Button className="glow-gold" leadingIcon={<Plus />} onClick={() => setCreating(true)}>{t('pipeline.newRequisition')}</Button></Can>}>
        {q.isPending ? <Skeleton className="shimmer h-24 w-full" /> : q.isError ? (
          <ErrorState onRetry={() => void q.refetch()} description={apiErr(q.error).message} />
        ) : q.data.items.length === 0 ? (
          <EmptyState title={t('pipeline.emptyTitle')} description={t('pipeline.emptyBody')} />
        ) : (
          <ul className="stagger grid gap-3 md:grid-cols-2">
            {q.data.items.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setSelected(r)} aria-pressed={selected?.id === r.id} className={`hover-lift w-full rounded-lg border p-4 text-left transition hover:border-gold-300 ${selected?.id === r.id ? 'glow-gold border-gold-400 bg-gold-50' : 'border-line bg-surface'}`}>
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-ink">{r.title}</span>
                    <StatusBadge status={r.status === 'OPEN' ? 'success' : r.status === 'ON_HOLD' ? 'warning' : 'neutral'}>{t(`reqStatus.${r.status}` as never)}</StatusBadge>
                  </span>
                  <span className="mt-1 block text-sm text-muted">{t('pipeline.meta', { headcount: r.headcount, manager: r.hiringManagerName ?? '—' })}{r.targetDate ? ` · ${t('pipeline.target', { date: fmt.date(r.targetDate) })}` : ''}</span>
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    {STAGES.filter((s) => r.stages[s]).map((s) => <Badge key={s} tone="blue">{t(`stage.${s}` as never)} {r.stages[s]}</Badge>)}
                    {r.candidateCount === 0 && <span className="text-xs text-muted">{t('pipeline.noCandidates')}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {selected && <CandidatesPanel key={selected.id} req={selected} />}
      <Dialog open={creating} onOpenChange={setCreating}>{creating && <RequisitionForm onClose={() => setCreating(false)} />}</Dialog>
    </div>
  );
}

/** Roles a company opening can be for. Anything else is a custom role the HR types in (and is offered again next time). */
const COMPANY_ROLES = ['SALES_EXECUTIVE', 'SALES_MANAGER', 'SALES_TEAM_LEAD', 'HR', 'FINANCE', 'MARKETING', 'COMMUNITY', 'OPERATIONS', 'STUDENT_SUCCESS', 'ADMIN'] as const;
const CUSTOM = '__CUSTOM__';
/** "Content Writer" -> CONTENT_WRITER (the stored role key; max 60). */
export const customRoleKey = (name: string) => name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
/** YYYY-MM-DD, n days from today. */
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const reqSchema = z.object({
  title: z.string().trim().min(3, 'min3'),
  roleKey: z.string().min(1, 'required'),
  customRole: z.string().trim().max(60),
  headcount: z.string().regex(/^\d+$/, 'integer').refine((v) => Number(v) >= 1 && Number(v) <= 50, 'integer'),
  targetDate: z.string(),
  notes: z.string().max(2000),
}).superRefine((v, ctx) => {
  if (v.roleKey === CUSTOM && customRoleKey(v.customRole).length < 2) ctx.addIssue({ code: 'custom', path: ['customRole'], message: 'required' });
});
function RequisitionForm({ onClose }: { onClose: () => void }) {
  const t = useTranslations('hiring');
  const apiErr = useApiErrorMessage();
  const done = useDone();
  const create = useCreateRequisition();
  const profiles = useRoleProfiles();
  const form = useForm<z.infer<typeof reqSchema>>({ resolver: zodResolver(reqSchema), defaultValues: { title: '', roleKey: '', customRole: '', headcount: '1', targetDate: inDays(30), notes: '' } });
  const fe = (x?: { message?: unknown }) => (typeof x?.message === 'string' ? t(`errors.${x.message}` as never) : undefined);
  const e = form.formState.errors;
  const roleKey = form.watch('roleKey');
  const headcount = Number(form.watch('headcount')) || 1;
  const saved = (profiles.data ?? []).map((p) => p.roleKey).filter((k) => !(COMPANY_ROLES as readonly string[]).includes(k));
  const roleName = (k: string) => ((COMPANY_ROLES as readonly string[]).includes(k) ? t(`pipeline.roleNames.${k}` as never) : k.replace(/_/g, ' '));
  const setCount = (n: number) => form.setValue('headcount', String(Math.min(50, Math.max(1, n))), { shouldValidate: true });
  const pickRole = (k: string) => {
    form.setValue('roleKey', k, { shouldValidate: true });
    if (k && k !== CUSTOM && !form.getFieldState('title').isDirty) form.setValue('title', roleName(k), { shouldValidate: true });
  };
  const submit = form.handleSubmit(async (v) => {
    try {
      const key = v.roleKey === CUSTOM ? customRoleKey(v.customRole) : v.roleKey;
      const prof = profiles.data?.find((p) => p.roleKey === key);
      await create.mutateAsync({ title: v.title, roleKey: key, headcount: Number(v.headcount), ...(v.targetDate ? { targetDate: v.targetDate } : {}), ...(v.notes ? { notes: v.notes } : {}), ...(prof?.id ? { profileId: prof.id } : {}) });
      done(t('saved'));
      onClose();
    } catch (err) { form.setError('root', { message: apiErr(err).message }); }
  });
  return (
    <DialogContent title={t('pipeline.newRequisition')} description={t('pipeline.newRequisitionBody')} footer={<><Button variant="secondary" onClick={onClose}>{t('cancel')}</Button><Button type="submit" form="req-form" loading={create.isPending}>{t('create')}</Button></>}>
      {e.root && <Alert tone="danger" className="mb-3">{e.root.message}</Alert>}
      <form id="req-form" onSubmit={submit} noValidate className="grid gap-3">
        <FormField label={t('pipeline.roleKey')} required error={fe(e.roleKey)} hint={t('pipeline.roleKeyHint')}>
          <Select value={roleKey} onChange={(ev) => pickRole(ev.target.value)}>
            <option value="">{t('pipeline.pickRole')}</option>
            {COMPANY_ROLES.map((k) => <option key={k} value={k}>{roleName(k)}</option>)}
            {saved.map((k) => <option key={k} value={k}>{roleName(k)}</option>)}
            <option value={CUSTOM}>{t('pipeline.customRole')}</option>
          </Select>
        </FormField>
        {roleKey === CUSTOM && (
          <FormField label={t('pipeline.customRoleName')} required error={fe(e.customRole)} hint={t('pipeline.customRoleHint')}><Input autoFocus {...form.register('customRole')} /></FormField>
        )}
        <FormField label={t('pipeline.reqTitle')} required error={fe(e.title)}><Input {...form.register('title')} /></FormField>
        <FormField label={t('pipeline.headcount')} required error={fe(e.headcount)} hint={t('pipeline.positionsHint')}>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" aria-label={t('pipeline.minus')} className="min-h-11 min-w-11" disabled={headcount <= 1} onClick={() => setCount(headcount - 1)}>−</Button>
            <Input inputMode="numeric" className="text-center" {...form.register('headcount')} />
            <Button type="button" variant="secondary" aria-label={t('pipeline.plus')} className="min-h-11 min-w-11" disabled={headcount >= 50} onClick={() => setCount(headcount + 1)}>+</Button>
          </div>
        </FormField>
        <FormField label={t('pipeline.targetDate')} hint={t('pipeline.targetDateHint')}><Input type="date" min={inDays(0)} {...form.register('targetDate')} /></FormField>
        <p className="rounded-md border border-gold-300 bg-gold-50 p-3 text-sm text-ink">{t('pipeline.plan90')}</p>
        <FormField label={t('pipeline.notes')}><Textarea rows={2} {...form.register('notes')} /></FormField>
      </form>
    </DialogContent>
  );
}

function CandidatesPanel({ req }: { req: Requisition }) {
  const t = useTranslations('hiring');
  const apiErr = useApiErrorMessage();
  const q = useCandidates(req.id);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const grouped = STAGES.map((s) => ({ s, rows: (q.data?.items ?? []).filter((c) => c.stage === s) })).filter((g) => g.rows.length > 0);
  return (
    <Panel accent="blue" title={t('candidates.title', { title: req.title })} actions={<Can permission="hiring:manage"><Button size="sm" onClick={() => setAdding(true)}>{t('candidates.add')}</Button></Can>}>
      {q.isPending ? <Skeleton className="shimmer h-24 w-full" /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} description={apiErr(q.error).message} /> : grouped.length === 0 ? (
        <EmptyState title={t('candidates.emptyTitle')} description={t('candidates.emptyBody')} />
      ) : (
        <div className="space-y-4">
          {grouped.map((g) => (
            <section key={g.s} aria-label={t(`stage.${g.s}` as never)}>
              <h3 className="mb-1.5 text-sm font-semibold text-ink-600">{t(`stage.${g.s}` as never)} ({g.rows.length})</h3>
              <ul className="stagger-fast grid gap-2 md:grid-cols-2">
                {g.rows.map((c) => (
                  <li key={c.id}><button type="button" onClick={() => setOpenId(c.id)} className="hover-lift w-full rounded-md border border-line bg-surface p-3 text-left hover:border-gold-300"><span className="font-medium text-ink">{c.name}</span><span className="block text-xs text-muted">{c.experienceYears != null ? t('candidates.years', { count: c.experienceYears }) : t('candidates.yearsUnknown')}</span></button></li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <Dialog open={adding} onOpenChange={setAdding}>{adding && <CandidateForm requisitionId={req.id} onClose={() => setAdding(false)} />}</Dialog>
      <Sheet open={openId !== null} onOpenChange={(o) => !o && setOpenId(null)}>{openId && <CandidateSheet id={openId} />}</Sheet>
    </Panel>
  );
}

const candSchema = z.object({
  name: z.string().trim().min(2, 'min2'),
  email: z.string().trim().refine((v) => v === '' || /^\S+@\S+\.\S+$/.test(v), 'email'),
  phone: z.string().max(30),
  source: z.string().max(80),
  educationLevel: z.string().max(120),
  experienceYears: z.string().refine((v) => v === '' || /^\d+$/.test(v), 'integer'),
  teamMgmtYears: z.string().refine((v) => v === '' || /^\d+$/.test(v), 'integer'),
  industries: z.string().max(300),
});
function CandidateForm({ requisitionId, onClose }: { requisitionId: string; onClose: () => void }) {
  const t = useTranslations('hiring');
  const apiErr = useApiErrorMessage();
  const done = useDone();
  const create = useCreateCandidate();
  const form = useForm<z.infer<typeof candSchema>>({ resolver: zodResolver(candSchema), defaultValues: { name: '', email: '', phone: '', source: '', educationLevel: '', experienceYears: '', teamMgmtYears: '', industries: '' } });
  const e = form.formState.errors;
  const fe = (x?: { message?: unknown }) => (typeof x?.message === 'string' ? t(`errors.${x.message}` as never) : undefined);
  const submit = form.handleSubmit(async (v) => {
    try {
      await create.mutateAsync({
        requisitionId, name: v.name, ...(v.email ? { email: v.email } : {}), ...(v.phone ? { phone: v.phone } : {}), ...(v.source ? { source: v.source } : {}), ...(v.educationLevel ? { educationLevel: v.educationLevel } : {}),
        ...(v.experienceYears ? { experienceYears: Number(v.experienceYears) } : {}), ...(v.teamMgmtYears ? { teamMgmtYears: Number(v.teamMgmtYears) } : {}),
        industries: v.industries.split(',').map((x) => x.trim()).filter(Boolean),
      });
      done(t('saved'));
      onClose();
    } catch (err) { form.setError('root', { message: apiErr(err).message }); }
  });
  return (
    <DialogContent title={t('candidates.add')} description={t('candidates.addBody')} footer={<><Button variant="secondary" onClick={onClose}>{t('cancel')}</Button><Button type="submit" form="cand-form" loading={create.isPending}>{t('create')}</Button></>}>
      {e.root && <Alert tone="danger" className="mb-3">{e.root.message}</Alert>}
      <form id="cand-form" onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2">
        <FormField label={t('candidates.name')} required error={fe(e.name)} className="sm:col-span-2"><Input {...form.register('name')} /></FormField>
        <FormField label={t('candidates.email')} error={fe(e.email)}><Input type="email" {...form.register('email')} /></FormField>
        <FormField label={t('candidates.phone')}><Input {...form.register('phone')} /></FormField>
        <FormField label={t('candidates.source')}><Input {...form.register('source')} /></FormField>
        <FormField label={t('candidates.education')}><Input {...form.register('educationLevel')} /></FormField>
        <FormField label={t('candidates.experienceYears')} error={fe(e.experienceYears)}><Input inputMode="numeric" {...form.register('experienceYears')} /></FormField>
        <FormField label={t('candidates.teamMgmtYears')} error={fe(e.teamMgmtYears)}><Input inputMode="numeric" {...form.register('teamMgmtYears')} /></FormField>
        <FormField label={t('candidates.industries')} hint={t('candidates.industriesHint')} className="sm:col-span-2"><Input {...form.register('industries')} /></FormField>
      </form>
    </DialogContent>
  );
}

export function RestrictedNotes({ notes, restricted }: { notes: string | null; restricted: boolean }) {
  const t = useTranslations('hiring');
  if (notes) return <p className="mt-1 text-sm whitespace-pre-wrap">{notes}</p>;
  if (restricted) return <p className="mt-1 text-sm text-muted italic">{t('feedback.restricted')}</p>;
  return null;
}

function CandidateSheet({ id }: { id: string }) {
  const t = useTranslations('hiring');
  const apiErr = useApiErrorMessage();
  const fmt = useFmt();
  const q = useCandidate(id);
  const canManage = usePermission('hiring:manage');
  return (
    <SheetContent title={q.data?.name ?? t('candidates.detail')} description={q.data?.requisitionTitle}>
      {q.isPending ? <Skeleton className="shimmer h-40 w-full" /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} description={apiErr(q.error).message} /> : (
        <div className="space-y-5">
          <section><h3 className="mb-2 font-semibold text-ink">{t('match.title')}</h3><ProfileMatchList match={q.data.profileMatch} /></section>
          <section>
            <h3 className="mb-2 font-semibold text-ink">{t('candidates.stage')}</h3>
            <p className="text-sm"><Badge tone="blue">{t(`stage.${q.data.stage}` as never)}</Badge>{q.data.stageReason ? ` · ${q.data.stageReason}` : ''}</p>
            {canManage && <MoveStage c={q.data} />}
          </section>
          <section>
            <h3 className="mb-2 font-semibold text-ink">{t('feedback.title')}</h3>
            {q.data.feedback.length === 0 ? <p className="text-sm text-muted">{t('feedback.empty')}</p> : (
              <ul className="space-y-3">
                {q.data.feedback.map((f) => (
                  <li key={f.id} className="rounded-md border border-line p-3 text-sm">
                    <p className="font-medium">{t('feedback.round', { round: f.round })} · {f.interviewerName ?? '—'} · {fmt.dateTime(f.interviewAt)}</p>
                    <p className="mt-0.5"><Badge tone={f.recommendation.includes('YES') ? 'green' : 'red'}>{t(`feedback.rec.${f.recommendation}` as never)}</Badge></p>
                    {Object.keys(f.competencyScores).length > 0 && <p className="mt-1 text-xs text-muted">{Object.entries(f.competencyScores).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>}
                    <RestrictedNotes notes={f.notes} restricted={f.notesRestricted} />
                  </li>
                ))}
              </ul>
            )}
            {canManage && <FeedbackForm candidateId={id} />}
          </section>
        </div>
      )}
    </SheetContent>
  );
}

function MoveStage({ c }: { c: Candidate }) {
  const t = useTranslations('hiring');
  const done = useDone();
  const move = useMoveCandidate(c.id);
  const [stage, setStage] = React.useState<CandidateStage>(c.stage);
  const [reason, setReason] = React.useState('');
  const [confirm, setConfirm] = React.useState(false);
  const terminal = ['HIRED', 'REJECTED', 'WITHDRAWN'].includes(c.stage);
  const needsReason = stage === 'REJECTED' || stage === 'WITHDRAWN';
  if (terminal) return <p className="mt-2 text-sm text-muted">{t('candidates.terminal')}</p>;
  const apply = () => move.mutate({ stage, ...(reason.trim() ? { reason: reason.trim() } : {}) }, { onSuccess: () => { done(t('saved')); setConfirm(false); } });
  return (
    <div className="mt-3 grid gap-2">
      <FormField label={t('candidates.moveTo')}>
        <Select value={stage} onChange={(e) => setStage(e.target.value as CandidateStage)}>{STAGES.map((s) => <option key={s} value={s}>{t(`stage.${s}` as never)}</option>)}</Select>
      </FormField>
      {needsReason && <FormField label={t('candidates.reason')} required><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>}
      {move.isError && <Alert tone="danger">{(move.error as Error).message}</Alert>}
      <Button size="sm" disabled={stage === c.stage || (needsReason && !reason.trim())} loading={move.isPending} onClick={() => (needsReason ? setConfirm(true) : apply())}>{t('candidates.move')}</Button>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        {confirm && <DialogContent title={t('candidates.confirmTitle')} description={t('candidates.confirmBody')} footer={<><Button variant="secondary" onClick={() => setConfirm(false)}>{t('cancel')}</Button><Button variant="danger" loading={move.isPending} onClick={apply}>{t('candidates.move')}</Button></>}><p className="text-sm">{reason}</p></DialogContent>}
      </Dialog>
    </div>
  );
}

const fbSchema = z.object({ recommendation: z.enum(['STRONG_YES', 'YES', 'NO', 'STRONG_NO']), round: z.string().regex(/^\d+$/, 'integer'), interviewAt: z.string().min(1, 'required'), notes: z.string().max(8000) });
function FeedbackForm({ candidateId }: { candidateId: string }) {
  const t = useTranslations('hiring');
  const apiErr = useApiErrorMessage();
  const done = useDone();
  const add = useAddFeedback(candidateId);
  const comps = useCompetencies();
  const [scores, setScores] = React.useState<Record<string, string>>({});
  const form = useForm<z.infer<typeof fbSchema>>({ resolver: zodResolver(fbSchema), defaultValues: { recommendation: 'YES', round: '1', interviewAt: new Date().toISOString().slice(0, 16), notes: '' } });
  const e = form.formState.errors;
  const fe = (x?: { message?: unknown }) => (typeof x?.message === 'string' ? t(`errors.${x.message}` as never) : undefined);
  const submit = form.handleSubmit(async (v) => {
    try {
      const competencyScores = Object.fromEntries(Object.entries(scores).filter(([, s]) => s).map(([k, s]) => [k, Number(s)]));
      await add.mutateAsync({ recommendation: v.recommendation, round: Number(v.round), interviewAt: new Date(v.interviewAt).toISOString(), competencyScores, ...(v.notes ? { notes: v.notes } : {}) });
      done(t('saved'));
      form.reset();
      setScores({});
    } catch (err) { form.setError('root', { message: apiErr(err).message }); }
  });
  return (
    <form onSubmit={submit} noValidate className="mt-4 grid gap-3 rounded-md bg-ivory-100 p-3" aria-label={t('feedback.add')}>
      <h4 className="font-medium text-ink">{t('feedback.add')}</h4>
      {e.root && <Alert tone="danger">{e.root.message}</Alert>}
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t('feedback.roundLabel')} error={fe(e.round)}><Input inputMode="numeric" {...form.register('round')} /></FormField>
        <FormField label={t('feedback.when')} error={fe(e.interviewAt)}><Input type="datetime-local" {...form.register('interviewAt')} /></FormField>
      </div>
      <FormField label={t('feedback.recommendation')}><Select {...form.register('recommendation')}>{(['STRONG_YES', 'YES', 'NO', 'STRONG_NO'] as const).map((r) => <option key={r} value={r}>{t(`feedback.rec.${r}` as never)}</option>)}</Select></FormField>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-ink">{t('feedback.competencies')}</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(comps.data ?? []).filter((c) => c.isActive).map((c) => (
            <FormField key={c.key} label={c.name}>
              <Select value={scores[c.key] ?? ''} onChange={(ev) => setScores({ ...scores, [c.key]: ev.target.value })}>
                <option value="">—</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            </FormField>
          ))}
        </div>
      </fieldset>
      <FormField label={t('feedback.notes')} hint={t('feedback.notesHint')}><Textarea rows={3} {...form.register('notes')} /></FormField>
      <Button type="submit" size="sm" loading={add.isPending}>{t('feedback.save')}</Button>
    </form>
  );
}

// --------------------------------------------------------------- role profiles
function ProfilesTab() {
  const t = useTranslations('hiring');
  const apiErr = useApiErrorMessage();
  const q = useRoleProfiles();
  const canManage = usePermission('hiring:manage', 'org');
  const [editing, setEditing] = React.useState<RoleProfile | 'new' | null>(null);
  return (
    <Panel accent="green" title={t('profiles.title')} description={t('profiles.description')} actions={canManage ? <Button onClick={() => setEditing('new')}>{t('profiles.new')}</Button> : undefined}>
      {q.isPending ? <Skeleton className="shimmer h-24 w-full" /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} description={apiErr(q.error).message} /> : q.data.length === 0 ? (
        <EmptyState title={t('profiles.emptyTitle')} description={t('profiles.emptyBody')} />
      ) : (
        <ul className="space-y-3">
          {q.data.map((p) => (
            <li key={p.roleKey} className="accent-top hover-lift rounded-lg border border-line bg-surface p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-ink">{p.title}</h3>{canManage && <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>{t('profiles.edit')}</Button>}</div>
              <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                <Item k={t('profiles.education')} v={p.minEducation} />
                <Item k={t('profiles.preferredEducation')} v={p.preferredEducation} />
                <Item k={t('profiles.experience')} v={p.minExperienceYears != null ? `${p.minExperienceYears}${p.maxExperienceYears != null ? `–${p.maxExperienceYears}` : '+'}` : null} />
                <Item k={t('profiles.teamMgmt')} v={p.minTeamMgmtYears != null ? String(p.minTeamMgmtYears) : null} />
                <Item k={t('profiles.industries')} v={p.preferredIndustries.join(', ')} />
                <Item k={t('profiles.backgrounds')} v={p.requiredBackgrounds.join(', ')} />
              </dl>
              {(p.additionalCriteria?.length ?? 0) > 0 && (
                <div className="mt-2 text-sm"><p className="text-muted">{t('profiles.additional')}</p><ul className="list-disc pl-5">{p.additionalCriteria!.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>{editing !== null && <ProfileForm profile={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}</Dialog>
    </Panel>
  );
}
const Item = ({ k, v }: { k: string; v: string | null }) => (
  <div><dt className="inline text-muted">{k}: </dt><dd className="inline">{v || '—'}</dd></div>
);

const profSchema = z.object({
  roleKey: z.string().trim().min(2, 'required'),
  title: z.string().trim().min(2, 'required'),
  minEducation: z.string().max(200),
  preferredEducation: z.string().max(200),
  minExperienceYears: z.string().refine((v) => v === '' || /^\d+$/.test(v), 'integer'),
  maxExperienceYears: z.string().refine((v) => v === '' || /^\d+$/.test(v), 'integer'),
  minTeamMgmtYears: z.string().refine((v) => v === '' || /^\d+$/.test(v), 'integer'),
  preferredIndustries: z.string().max(500),
  requiredBackgrounds: z.string().max(500),
  additional: z.array(z.object({ text: z.string().trim().min(1, 'required').max(300) })),
});
const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
function ProfileForm({ profile, onClose }: { profile: RoleProfile | null; onClose: () => void }) {
  const t = useTranslations('hiring');
  const apiErr = useApiErrorMessage();
  const done = useDone();
  const save = useSaveProfile();
  const form = useForm<z.infer<typeof profSchema>>({
    resolver: zodResolver(profSchema),
    defaultValues: {
      roleKey: profile?.roleKey ?? '', title: profile?.title ?? '', minEducation: profile?.minEducation ?? '', preferredEducation: profile?.preferredEducation ?? '',
      minExperienceYears: profile?.minExperienceYears?.toString() ?? '', maxExperienceYears: profile?.maxExperienceYears?.toString() ?? '', minTeamMgmtYears: profile?.minTeamMgmtYears?.toString() ?? '',
      preferredIndustries: profile?.preferredIndustries.join(', ') ?? '', requiredBackgrounds: profile?.requiredBackgrounds.join(', ') ?? '',
      additional: (profile?.additionalCriteria ?? []).map((text) => ({ text })),
    },
  });
  const extra = useFieldArray({ control: form.control, name: 'additional' });
  const e = form.formState.errors;
  const fe = (x?: { message?: unknown }) => (typeof x?.message === 'string' ? t(`errors.${x.message}` as never) : undefined);
  const submit = form.handleSubmit(async (v) => {
    try {
      await save.mutateAsync({
        roleKey: v.roleKey, title: v.title, ...(v.minEducation ? { minEducation: v.minEducation } : {}), ...(v.preferredEducation ? { preferredEducation: v.preferredEducation } : {}),
        ...(v.minExperienceYears ? { minExperienceYears: Number(v.minExperienceYears) } : {}), ...(v.maxExperienceYears ? { maxExperienceYears: Number(v.maxExperienceYears) } : {}),
        ...(v.minTeamMgmtYears ? { minTeamMgmtYears: Number(v.minTeamMgmtYears) } : {}),
        preferredIndustries: csv(v.preferredIndustries), requiredBackgrounds: csv(v.requiredBackgrounds), additionalCriteria: v.additional.map((a) => a.text),
      });
      done(t('saved'));
      onClose();
    } catch (err) { form.setError('root', { message: apiErr(err).message }); }
  });
  return (
    <DialogContent size="lg" title={profile ? t('profiles.editTitle') : t('profiles.new')} description={t('profiles.formBody')} footer={<><Button variant="secondary" onClick={onClose}>{t('cancel')}</Button><Button type="submit" form="prof-form" loading={save.isPending}>{t('profiles.save')}</Button></>}>
      {e.root && <Alert tone="danger" className="mb-3">{e.root.message}</Alert>}
      <form id="prof-form" onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2">
        <FormField label={t('profiles.roleKey')} required error={fe(e.roleKey)}><Input readOnly={Boolean(profile)} {...form.register('roleKey')} /></FormField>
        <FormField label={t('profiles.titleLabel')} required error={fe(e.title)}><Input {...form.register('title')} /></FormField>
        <FormField label={t('profiles.education')} className="sm:col-span-2"><Input {...form.register('minEducation')} /></FormField>
        <FormField label={t('profiles.preferredEducation')} className="sm:col-span-2"><Input {...form.register('preferredEducation')} /></FormField>
        <FormField label={t('profiles.minExp')} error={fe(e.minExperienceYears)}><Input inputMode="numeric" {...form.register('minExperienceYears')} /></FormField>
        <FormField label={t('profiles.maxExp')} error={fe(e.maxExperienceYears)}><Input inputMode="numeric" {...form.register('maxExperienceYears')} /></FormField>
        <FormField label={t('profiles.teamMgmt')} error={fe(e.minTeamMgmtYears)}><Input inputMode="numeric" {...form.register('minTeamMgmtYears')} /></FormField>
        <FormField label={t('profiles.industries')} hint={t('candidates.industriesHint')}><Input {...form.register('preferredIndustries')} /></FormField>
        <FormField label={t('profiles.backgrounds')} hint={t('candidates.industriesHint')} className="sm:col-span-2"><Input {...form.register('requiredBackgrounds')} /></FormField>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-sm font-medium text-ink">{t('profiles.additional')}</legend>
          <p className="mb-2 text-xs text-muted">{t('profiles.additionalHint')}</p>
          {extra.fields.map((f, i) => (
            <div key={f.id} className="mb-2 flex gap-2">
              <Input aria-label={t('profiles.criterion', { n: i + 1 })} {...form.register(`additional.${i}.text`)} />
              <Button type="button" variant="ghost" onClick={() => extra.remove(i)}>{t('remove')}</Button>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={() => extra.append({ text: '' })}>{t('profiles.addCriterion')}</Button>
        </fieldset>
      </form>
    </DialogContent>
  );
}
