'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { CalendarRange, Pencil, Plus } from 'lucide-react';
import { Alert, Badge, Button, Dialog, DialogContent, EmptyState, FormField, Input, PageHeader, Pagination, Select, Textarea } from '@salesos/ui';
import { Can } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { ListShell, inputToIso, toInputDateTime, useFmt, usePaginationLabels } from '@/features/cx/shared';
import { cb, useAction, useList, useOne, type PlanLink, type PlanStatus } from './api';

const KINDS = ['CAMPAIGN', 'WEBINAR', 'EVENT', 'LEAD_GEN'] as const;
const STATUSES: PlanStatus[] = ['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED'];
const statusTone = (s: string) => (s === 'ACTIVE' ? 'blue' : s === 'COMPLETED' ? 'green' : s === 'CANCELLED' ? 'red' : 'neutral') as 'blue' | 'green' | 'red' | 'neutral';

export function PlansPage() {
  return (
    <RequirePermission permission="xf-tasks:view">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('collab');
  const fmt = useFmt();
  const labels = usePaginationLabels();
  const [kind, setKind] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<PlanLink | null>(null);
  const query = useList<PlanLink>(cb('plans'), '/collaboration/plan-links', { page, limit: 12, kind: kind || undefined });
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('plans.title')} description={t('plans.description')} actions={<Can permission="xf-tasks:create"><Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" />{t('plans.new')}</Button></Can>} />
      <div className="enter-up mb-4 w-full sm:w-56"><FormField label={t('plans.kind')} hideLabel><Select value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}><option value="">{t('plans.allKinds')}</option>{KINDS.map((k) => <option key={k} value={k}>{t(`plans.kindValue.${k}`)}</option>)}</Select></FormField></div>
      <ListShell query={query} skeletons={3}>
        {query.data && query.data.items.length === 0 ? (
          <EmptyState icon={<CalendarRange className="size-6" aria-hidden="true" />} title={kind ? t('tasks.noMatches') : t('plans.empty')} description={t('plans.emptyHint')} />
        ) : (
          <>
            <ul className="stagger grid gap-3 md:grid-cols-2" aria-label={t('plans.listLabel')}>
              {query.data?.items.map((p) => (
                <li key={p.id} className="hover-lift accent-top min-w-0 rounded-lg border border-line bg-surface p-4 shadow-xs break-words">
                  <div className="mb-2 flex flex-wrap items-center gap-2"><Badge tone="blue">{t(`plans.kindValue.${p.kind}`)}</Badge>{p.programName && <Badge>{p.programName}</Badge>}<Badge tone={statusTone(p.status)}>{t(`plans.statusValue.${p.status}` as never)}</Badge></div>
                  <p className="font-medium text-ink">{p.title}</p>
                  <p className="mt-0.5 text-sm text-muted">{fmt.date(p.windowStart)} – {fmt.date(p.windowEnd)}{p.event ? ` · ${p.event.title}` : ''}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-md bg-ivory-100 p-2.5"><dt className="text-xs font-medium tracking-wide text-muted uppercase">{t('plans.planned')}</dt><dd className="kpi-number text-lg font-semibold text-ink">{p.plannedLeads ?? '—'}</dd></div>
                    <div className="rounded-md bg-ivory-100 p-2.5"><dt className="text-xs font-medium tracking-wide text-muted uppercase">{t('plans.actual')}</dt><dd className="kpi-number text-lg font-semibold text-ink">{p.actualLeads ?? '—'}</dd></div>
                  </dl>
                  {Object.keys(p.attendance).length > 0 && <p className="mt-2 text-xs text-muted">{Object.entries(p.attendance).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>}
                  {p.salesPlanNote && <p className="mt-2 text-sm text-ink-700">{p.salesPlanNote}</p>}
                  {p.actualLeads === null && <p className="mt-2 text-xs text-muted">{t('plans.noKeyHint')}</p>}
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted">{t('tasks.owner')}: {p.ownerName ?? '—'}</p><Can permission="xf-tasks:update"><Button variant="secondary" leadingIcon={<Pencil aria-hidden="true" />} onClick={() => setEditing(p)}>{t('plans.edit')}</Button></Can></div>
                </li>
              ))}
            </ul>
            <Pagination className="mt-5" page={page} hasNext={Boolean(query.data?.pagination?.hasMore)} onPageChange={setPage} labels={labels} />
          </>
        )}
      </ListShell>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title={t('plans.newTitle')} description={t('plans.newDescription')} closeLabel={t('common.close')} size="lg">{creating && <PlanForm onDone={() => setCreating(false)} />}</DialogContent>
      </Dialog>
      <Dialog open={Boolean(editing)} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent title={t('plans.editTitle')} description={t('plans.newDescription')} closeLabel={t('common.close')} size="lg">{editing && <PlanForm plan={editing} onDone={() => setEditing(null)} />}</DialogContent>
      </Dialog>
    </>
  );
}

interface Opt { id: string; title?: string; name?: string }
const label = (o: Opt) => o.title ?? o.name ?? o.id;
const isoToInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Create (no `plan`) or edit (`plan`) form. Edit sends only what changed; closed plans are read-only (server returns 409 too). */
function PlanForm({ plan, onDone }: { plan?: PlanLink; onDone: () => void }) {
  const t = useTranslations('collab');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const editing = Boolean(plan);
  const closed = plan?.status === 'COMPLETED' || plan?.status === 'CANCELLED';
  const events = useOne<Opt[]>(cb('events'), '/events', { limit: 50 });
  const programs = useOne<Opt[]>(cb('programs'), '/programs');
  const campaigns = useOne<Opt[]>(cb('campaigns'), '/campaigns');
  const sources = useOne<Opt[]>(cb('sources'), '/lead-sources');
  const create = useAction<Record<string, unknown>, PlanLink>('post', '/collaboration/plan-links');
  const update = useAction<Record<string, unknown>, PlanLink>('patch', `/collaboration/plan-links/${plan?.id ?? ''}`);
  const mutation = editing ? update : create;
  const [f, setF] = React.useState({
    kind: plan?.kind ?? 'WEBINAR', title: plan?.title ?? '', eventId: plan?.event?.id ?? '', programId: plan?.programId ?? '', campaignId: plan?.campaignId ?? '', sourceId: plan?.sourceId ?? '',
    plannedLeads: plan?.plannedLeads != null ? String(plan.plannedLeads) : '', salesPlanNote: plan?.salesPlanNote ?? '',
    start: plan ? isoToInput(plan.windowStart) : toInputDateTime(0), end: plan ? isoToInput(plan.windowEnd) : toInputDateTime(24 * 14), status: (plan?.status ?? 'PLANNED') as PlanStatus,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const needsEvent = !editing && (f.kind === 'WEBINAR' || f.kind === 'EVENT');
  const invalid = closed || f.title.trim().length < 3 || (needsEvent && !f.eventId) || new Date(f.end) <= new Date(f.start);
  const opts = (q: { data?: Opt[] }) => (Array.isArray(q.data) ? q.data : []);
  const refSelect = (key: 'programId' | 'campaignId' | 'sourceId', labelKey: string, q: { data?: Opt[]; isPending: boolean }) => (
    <FormField label={t(labelKey as never)}>
      <Select value={f[key]} onChange={set(key)} disabled={closed}><option value="">{q.isPending ? tc('loading') : t('plans.noEvent')}</option>{opts(q).map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)}</Select>
    </FormField>
  );
  const submit = () => {
    if (invalid) return;
    const common = { title: f.title.trim(), windowStart: inputToIso(f.start), windowEnd: inputToIso(f.end) };
    if (plan) {
      mutation.mutate({
        ...common,
        status: f.status,
        plannedLeads: f.plannedLeads === '' ? null : Number(f.plannedLeads),
        salesPlanNote: f.salesPlanNote.trim() === '' ? null : f.salesPlanNote.trim(),
        programId: f.programId || null, campaignId: f.campaignId || null, sourceId: f.sourceId || null,
      }, { onSuccess: onDone });
      return;
    }
    mutation.mutate({
      kind: f.kind, ...common, ...(f.eventId ? { eventId: f.eventId } : {}), ...(f.programId ? { programId: f.programId } : {}), ...(f.campaignId ? { campaignId: f.campaignId } : {}), ...(f.sourceId ? { sourceId: f.sourceId } : {}),
      ...(f.plannedLeads ? { plannedLeads: Number(f.plannedLeads) } : {}), ...(f.salesPlanNote.trim() ? { salesPlanNote: f.salesPlanNote.trim() } : {}),
    }, { onSuccess: onDone });
  };
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {mutation.isError && <Alert tone="danger">{apiErr(mutation.error).message}</Alert>}
      {closed && <Alert tone="info">{t('plans.closedNote')}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('plans.kind')} required><Select value={f.kind} onChange={set('kind')} disabled={editing}>{KINDS.map((k) => <option key={k} value={k}>{t(`plans.kindValue.${k}`)}</option>)}</Select></FormField>
        <FormField label={t('plans.fieldTitle')} required><Input value={f.title} onChange={set('title')} maxLength={200} disabled={closed} /></FormField>
      </div>
      {!editing && (
        <FormField label={t('plans.event')} required={needsEvent} hint={t('plans.eventHint')}>
          <Select value={f.eventId} onChange={set('eventId')}><option value="">{events.isPending ? tc('loading') : t('plans.noEvent')}</option>{opts(events).map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)}</Select>
        </FormField>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        {refSelect('programId', 'plans.program', programs)}
        {refSelect('campaignId', 'plans.campaign', campaigns)}
        {refSelect('sourceId', 'plans.source', sources)}
      </div>
      <p className="-mt-2 text-xs text-muted">{t('plans.refHint')}</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label={t('plans.windowStart')} required><Input type="datetime-local" value={f.start} onChange={set('start')} disabled={closed} /></FormField>
        <FormField label={t('plans.windowEnd')} required><Input type="datetime-local" value={f.end} onChange={set('end')} disabled={closed} /></FormField>
        <FormField label={t('plans.plannedLeads')}><Input type="number" min={0} inputMode="numeric" value={f.plannedLeads} onChange={set('plannedLeads')} disabled={closed} /></FormField>
      </div>
      {editing && (
        <FormField label={t('plans.status')} hint={t('plans.statusHint')}>
          <Select value={f.status} onChange={set('status')} disabled={closed}>{STATUSES.map((s) => <option key={s} value={s} disabled={plan?.status === 'ACTIVE' && s === 'PLANNED'}>{t(`plans.statusValue.${s}` as never)}</option>)}</Select>
        </FormField>
      )}
      <FormField label={t('plans.salesNote')} hint={t('plans.salesNoteHint')}><Textarea rows={3} value={f.salesPlanNote} onChange={set('salesPlanNote')} maxLength={4000} disabled={closed} /></FormField>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onDone}>{tc('cancel')}</Button>
        <Button type="submit" loading={mutation.isPending} disabled={invalid}>{editing ? t('plans.save') : t('plans.create')}</Button>
      </div>
    </form>
  );
}
