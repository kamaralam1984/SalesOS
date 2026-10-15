'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { CalendarRange, Plus } from 'lucide-react';
import { Alert, Badge, Button, Dialog, DialogContent, EmptyState, FormField, Input, PageHeader, Pagination, Select, Textarea } from '@salesos/ui';
import { Can } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { ListShell, inputToIso, toInputDateTime, useFmt, usePaginationLabels } from '@/features/cx/shared';
import { cb, useAction, useList, useOne, type PlanLink } from './api';

const KINDS = ['CAMPAIGN', 'WEBINAR', 'EVENT', 'LEAD_GEN'] as const;

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
                  <div className="mb-2 flex flex-wrap items-center gap-2"><Badge tone="blue">{t(`plans.kindValue.${p.kind}`)}</Badge>{p.programName && <Badge>{p.programName}</Badge>}</div>
                  <p className="font-medium text-ink">{p.title}</p>
                  <p className="mt-0.5 text-sm text-muted">{fmt.date(p.windowStart)} – {fmt.date(p.windowEnd)}{p.event ? ` · ${p.event.title}` : ''}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-md bg-ivory-100 p-2.5"><dt className="text-xs font-medium tracking-wide text-muted uppercase">{t('plans.planned')}</dt><dd className="kpi-number text-lg font-semibold text-ink">{p.plannedLeads ?? '—'}</dd></div>
                    <div className="rounded-md bg-ivory-100 p-2.5"><dt className="text-xs font-medium tracking-wide text-muted uppercase">{t('plans.actual')}</dt><dd className="kpi-number text-lg font-semibold text-ink">{p.actualLeads ?? '—'}</dd></div>
                  </dl>
                  {Object.keys(p.attendance).length > 0 && <p className="mt-2 text-xs text-muted">{Object.entries(p.attendance).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>}
                  {p.salesPlanNote && <p className="mt-2 text-sm text-ink-700">{p.salesPlanNote}</p>}
                  <p className="mt-2 text-xs text-muted">{t('tasks.owner')}: {p.ownerName ?? '—'}</p>
                </li>
              ))}
            </ul>
            <Pagination className="mt-5" page={page} hasNext={Boolean(query.data?.pagination?.hasMore)} onPageChange={setPage} labels={labels} />
          </>
        )}
      </ListShell>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title={t('plans.newTitle')} description={t('plans.newDescription')} closeLabel={t('common.close')} size="lg">{creating && <CreateForm onDone={() => setCreating(false)} />}</DialogContent>
      </Dialog>
    </>
  );
}

interface Opt { id: string; title: string }
function CreateForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('collab');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const events = useOne<Array<{ id: string; title: string }>>(cb('events'), '/events', { limit: 50 });
  const create = useAction<Record<string, unknown>, PlanLink>('post', '/collaboration/plan-links');
  const [f, setF] = React.useState({ kind: 'WEBINAR', title: '', eventId: '', plannedLeads: '', salesPlanNote: '', start: toInputDateTime(0), end: toInputDateTime(24 * 14) });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const needsEvent = f.kind === 'WEBINAR' || f.kind === 'EVENT';
  const invalid = f.title.trim().length < 3 || (needsEvent && !f.eventId) || new Date(f.end) <= new Date(f.start);
  const eventOpts: Opt[] = events.data ?? [];
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!invalid) create.mutate({ kind: f.kind, title: f.title.trim(), ...(f.eventId ? { eventId: f.eventId } : {}), windowStart: inputToIso(f.start), windowEnd: inputToIso(f.end), ...(f.plannedLeads ? { plannedLeads: Number(f.plannedLeads) } : {}), ...(f.salesPlanNote.trim() ? { salesPlanNote: f.salesPlanNote.trim() } : {}) }, { onSuccess: onDone }); }}>
      {create.isError && <Alert tone="danger">{apiErr(create.error).message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('plans.kind')} required><Select value={f.kind} onChange={set('kind')}>{KINDS.map((k) => <option key={k} value={k}>{t(`plans.kindValue.${k}`)}</option>)}</Select></FormField>
        <FormField label={t('plans.fieldTitle')} required><Input value={f.title} onChange={set('title')} maxLength={200} /></FormField>
      </div>
      <FormField label={t('plans.event')} required={needsEvent} hint={t('plans.eventHint')}>
        <Select value={f.eventId} onChange={set('eventId')}><option value="">{events.isPending ? tc('loading') : t('plans.noEvent')}</option>{eventOpts.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</Select>
      </FormField>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label={t('plans.windowStart')} required><Input type="datetime-local" value={f.start} onChange={set('start')} /></FormField>
        <FormField label={t('plans.windowEnd')} required><Input type="datetime-local" value={f.end} onChange={set('end')} /></FormField>
        <FormField label={t('plans.plannedLeads')}><Input type="number" min={0} inputMode="numeric" value={f.plannedLeads} onChange={set('plannedLeads')} /></FormField>
      </div>
      <FormField label={t('plans.salesNote')} hint={t('plans.salesNoteHint')}><Textarea rows={3} value={f.salesPlanNote} onChange={set('salesPlanNote')} maxLength={4000} /></FormField>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onDone}>{tc('cancel')}</Button>
        <Button type="submit" loading={create.isPending} disabled={invalid}>{t('plans.create')}</Button>
      </div>
    </form>
  );
}
