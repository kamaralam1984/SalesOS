'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Copy, Download, UserPlus } from 'lucide-react';
import { Alert, Badge, Button, Dialog, DialogContent, FormField, Input, PageHeader, Panel, Select, Textarea, useToast } from '@salesos/ui';
import { RequirePermission } from '@/features/auth/require-permission';
import { MutationAlert, QueryState } from '@/features/people/hub/shared';
import { useJoinEmployee, useJoinerOptions, type JoinedEmployee, type JoinerOptions } from '@/lib/api/hooks/work-joiners';
import { useExportWorkforceReport, useWorkforceReport } from '@/lib/api/hooks/work-reports';
import { ProgressBar, useWorkDates } from '../common/shared';

export function JoinersPage() {
  return (
    <RequirePermission permission="joiners:manage">
      <Inner />
    </RequirePermission>
  );
}

const humanise = (k: string) => k.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const todayIso = () => new Date().toISOString().slice(0, 10);

function Inner() {
  const t = useTranslations('workHr');
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [joined, setJoined] = React.useState<JoinedEmployee | null>(null);
  const q = useWorkforceReport('new-joiners', { limit: 100 });
  const exp = useExportWorkforceReport('new-joiners');
  const rows = q.data?.report.rows ?? [];
  return (
    <>
      <PageHeader
        eyebrow={t('joiners.eyebrow')}
        title={t('joiners.title')}
        description={t('joiners.description')}
        actions={
          <>
            <Button variant="secondary" leadingIcon={<Download aria-hidden="true" />} loading={exp.isPending} onClick={() => exp.mutate({ filters: {}, format: 'xlsx' }, { onSuccess: () => toast({ tone: 'success', title: t('joiners.exported') }) })}>{t('joiners.excel')}</Button>
            <Button variant="gold" leadingIcon={<UserPlus aria-hidden="true" />} onClick={() => setOpen(true)}>{t('joiners.join')}</Button>
          </>
        }
      />
      {joined && <JoinedPanel j={joined} onClose={() => setJoined(null)} />}
      <QueryState query={q} isEmpty={rows.length === 0} emptyTitle={t('joiners.empty')} emptyDescription={t('joiners.emptyBody')}>
        <ul className="stagger grid gap-3 lg:grid-cols-2" aria-label={t('joiners.list')}>
          {rows.map((r) => <Card key={`${r.employee}-${r.joined}`} r={r} />)}
        </ul>
        <p className="mt-4 text-sm text-muted">
          {t('joiners.weeklyHint')} <Link className="text-blue-700 underline" href="/work/reports">{t('joiners.openReports')}</Link>
        </p>
      </QueryState>
      {open && <JoinDialog open={open} onOpenChange={setOpen} onJoined={(j) => { setOpen(false); setJoined(j); }} />}
    </>
  );
}

type Row = Record<string, string | number | boolean | null>;
function Card({ r }: { r: Row }) {
  const t = useTranslations('workHr');
  const d = useWorkDates();
  const day = Number(r.day ?? 0);
  const n = (v: unknown) => (typeof v === 'number' ? v : null);
  return (
    <li className="rounded-lg border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{String(r.employee)}</p>
          <p className="text-sm text-muted">{[r.position, r.manager ? t('joiners.manager', { name: String(r.manager) }) : null].filter(Boolean).join(' · ')}</p>
        </div>
        <Badge tone={day > 90 ? 'neutral' : day > 60 ? 'gold' : 'blue'}>{t('joiners.dayOf', { day })}</Badge>
      </div>
      <p className="mt-1 text-xs text-muted">{t('joiners.joinedOn', { date: d.day(String(r.joined)) })}</p>
      <div className="mt-3 space-y-2">
        <Meter label={t('joiners.training')} value={n(r.onboardingDonePct)} />
        <Meter label={t('joiners.tasks')} value={n(r.taskCompletionPct)} hint={t('joiners.tasksHint', { done: n(r.tasksDone) ?? 0, total: n(r.tasks) ?? 0 })} />
        <Meter label={t('joiners.attendance')} value={n(r.attendancePct)} />
        <Meter label={t('joiners.workReports')} value={n(r.avgDayReportPct)} />
        <Meter label={t('joiners.goals')} value={n(r.avgGoalProgressPct)} />
      </div>
      {r.nextReview && <p className="mt-3 text-sm text-ink">{t('joiners.nextReview', { what: String(r.nextReview) })}</p>}
    </li>
  );
}

function Meter({ label, value, hint }: { label: string; value: number | null; hint?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span className="text-ink">{value === null ? '—' : `${value}%`}{hint ? <span className="ml-2 text-xs text-muted">{hint}</span> : null}</span>
      </div>
      <ProgressBar value={value ?? 0} label={label} tone="blue" />
    </div>
  );
}

function JoinedPanel({ j, onClose }: { j: JoinedEmployee; onClose: () => void }) {
  const t = useTranslations('workHr');
  const { toast } = useToast();
  return (
    <Panel accent="gold" title={t('joiners.joinedTitle', { name: j.name })} className="mb-4">
      <p className="text-sm text-ink">{t('joiners.joinedBody', { items: j.planItems, tasks: j.tasks, reviews: j.reviewDays.join(', '), end: j.probationEnd })}</p>
      <div className="mt-3 rounded-lg border border-line bg-ivory-50 p-3">
        <p className="text-sm font-medium text-ink">{t('joiners.inviteTitle')}</p>
        <p className="text-xs text-muted">{t('joiners.inviteBody', { email: j.email })}</p>
        <code className="mt-2 block break-all rounded bg-surface p-2 text-xs text-ink">{j.invite.link}</code>
        <Button className="mt-2" size="sm" variant="secondary" leadingIcon={<Copy aria-hidden="true" />} onClick={() => { void navigator.clipboard?.writeText(j.invite.link); toast({ tone: 'success', title: t('joiners.copied') }); }}>{t('joiners.copy')}</Button>
      </div>
      {j.warnings.length > 0 && <Alert tone="warning" className="mt-3">{j.warnings.join(' ')}</Alert>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Link className="text-sm text-blue-700 underline" href="/work/tasks">{t('joiners.moreTasks')}</Link>
        <Button size="sm" variant="ghost" onClick={onClose}>{t('joiners.dismiss')}</Button>
      </div>
    </Panel>
  );
}

function JoinDialog({ open, onOpenChange, onJoined }: { open: boolean; onOpenChange: (o: boolean) => void; onJoined: (j: JoinedEmployee) => void }) {
  const t = useTranslations('workHr');
  const tc = useTranslations('common');
  const opts = useJoinerOptions();
  const join = useJoinEmployee();
  const [v, setV] = React.useState({ name: '', email: '', positionTitle: '', role: 'SALES_EXECUTIVE', managerId: '', department: '', joinDate: todayIso(), templateId: '' });
  const [picked, setPicked] = React.useState<Record<number, boolean>>({ 0: true, 1: true, 2: true });
  const [extra, setExtra] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const o: JoinerOptions | undefined = opts.data;
  const emailBad = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim());
  const bad = { name: v.name.trim().length < 1, email: emailBad, position: v.positionTitle.trim().length < 2, date: !/^\d{4}-\d{2}-\d{2}$/.test(v.joinDate) };
  const formId = React.useId();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.values(bad).some(Boolean) || !o) return;
    const tasks = [
      ...o.suggestedTasks.filter((_, i) => picked[i]).map((s) => ({ title: s.title, dueDay: s.dueDay, priority: s.priority })),
      ...extra.split('\n').map((l) => l.trim()).filter((l) => l.length >= 3).map((title) => ({ title, dueDay: 14, priority: 'MEDIUM' as const })),
    ];
    join.mutate(
      { name: v.name.trim(), email: v.email.trim().toLowerCase(), roles: [v.role], managerId: v.managerId || null, department: v.department.trim() || null, positionTitle: v.positionTitle.trim(), joinDate: v.joinDate, ...(v.templateId ? { templateId: v.templateId } : {}), tasks },
      { onSuccess: onJoined },
    );
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('joiners.dialog.title')}
        description={t('joiners.dialog.description')}
        size="lg"
        closeLabel={tc('close')}
        footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button><Button type="submit" form={formId} loading={join.isPending} disabled={!o}>{t('joiners.dialog.submit')}</Button></>}
      >
        <QueryState query={opts} isEmpty={!o} emptyTitle={t('joiners.dialog.noOptions')}>
          {o && (
            <form id={formId} noValidate onSubmit={submit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label={t('joiners.dialog.name')} error={touched && bad.name ? t('joiners.dialog.required') : undefined} required><Input value={v.name} onChange={set('name')} autoComplete="off" /></FormField>
                <FormField label={t('joiners.dialog.email')} error={touched && bad.email ? t('joiners.dialog.emailBad') : undefined} required><Input type="email" value={v.email} onChange={set('email')} autoComplete="off" /></FormField>
                <FormField label={t('joiners.dialog.post')} hint={t('joiners.dialog.postHint')} error={touched && bad.position ? t('joiners.dialog.required') : undefined} required><Input value={v.positionTitle} onChange={set('positionTitle')} /></FormField>
                <FormField label={t('joiners.dialog.role')}>
                  <Select value={v.role} onChange={set('role')}>{o.roles.map((r) => <option key={r} value={r}>{humanise(r)}</option>)}</Select>
                </FormField>
                <FormField label={t('joiners.dialog.manager')}>
                  <Select value={v.managerId} onChange={set('managerId')}>
                    <option value="">{t('joiners.dialog.noManager')}</option>
                    {o.managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </Select>
                </FormField>
                <FormField label={t('joiners.dialog.department')}><Input value={v.department} onChange={set('department')} /></FormField>
                <FormField label={t('joiners.dialog.joinDate')} error={touched && bad.date ? t('joiners.dialog.required') : undefined} required><Input type="date" value={v.joinDate} onChange={set('joinDate')} /></FormField>
                <FormField label={t('joiners.dialog.template')} hint={t('joiners.dialog.templateHint')}>
                  <Select value={v.templateId} onChange={set('templateId')}>
                    <option value="">{t('joiners.dialog.defaultTemplate')}</option>
                    {o.templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </Select>
                </FormField>
              </div>
              <fieldset className="rounded-lg border border-line p-3">
                <legend className="px-1 text-sm font-medium text-ink">{t('joiners.dialog.tasksTitle')}</legend>
                <p className="mb-2 text-xs text-muted">{t('joiners.dialog.tasksHint')}</p>
                <ul className="space-y-1">
                  {o.suggestedTasks.map((s, i) => (
                    <li key={s.title}>
                      <label className="flex items-start gap-2 text-sm text-ink">
                        <input type="checkbox" className="mt-1" checked={Boolean(picked[i])} onChange={(e) => setPicked((p) => ({ ...p, [i]: e.target.checked }))} />
                        <span>{s.title} <span className="text-muted">({t('joiners.dialog.dueDay', { n: s.dueDay })})</span></span>
                      </label>
                    </li>
                  ))}
                </ul>
                <FormField label={t('joiners.dialog.moreTasks')} hint={t('joiners.dialog.moreTasksHint')} className="mt-3"><Textarea rows={3} value={extra} onChange={(e) => setExtra(e.target.value)} /></FormField>
              </fieldset>
              <p className="text-xs text-muted">{t('joiners.dialog.planNote', { n: o.defaultPlan.length })}</p>
              <MutationAlert error={join.error} />
            </form>
          )}
        </QueryState>
      </DialogContent>
    </Dialog>
  );
}
