'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { LifeBuoy, Plus, Search } from 'lucide-react';
import { Alert, Button, Dialog, DialogContent, EmptyState, FormField, Input, PageHeader, Pagination, Panel, Select, Stat, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from '@salesos/ui';
import { Can } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { ck, useAction, useList, useOne, type Complaint, type ComplaintTrends, type Person } from './api';
import { LeadPicker, type PickedLead } from './lead-picker';
import { ComplaintStatusBadge, ListShell, PriorityBadge, SlaCountdown, useDebounced, useFmt, usePaginationLabels } from './shared';
import { Hint } from '@/features/hints/hint-views';
import { CountUp } from '@/components/motion';

export const COMPLAINT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED', 'REOPENED'] as const;
export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;
export const CATEGORIES = ['PAYMENT_BILLING', 'PROGRAM_CONTENT', 'DELIVERY_ACCESS', 'SALES_CONDUCT', 'REFUND', 'SUPPORT_RESPONSE', 'TECHNICAL', 'OTHER'] as const;
export const ROOT_CAUSES = ['EXPECTATION_MISMATCH', 'MISLEADING_PROMISE', 'PRODUCT_FIT', 'PRICING_PAYMENT', 'DELIVERY_DELAY', 'SUPPORT_QUALITY', 'TECHNICAL_ISSUE', 'PERSONAL_CIRCUMSTANCES', 'PROCESS_GAP', 'OTHER'] as const;

export function ComplaintsPage() {
  return (
    <RequirePermission permission="complaints:view">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('cx');
  const tc = useTranslations('common');
  const fmt = useFmt();
  const labels = usePaginationLabels();
  const [tab, setTab] = React.useState('list');
  const [status, setStatus] = React.useState('');
  const [priority, setPriority] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [breached, setBreached] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [creating, setCreating] = React.useState(false);
  const q = useDebounced(search.trim());
  const query = useList<Complaint>(ck('complaints', 'list'), '/cx/complaints', { page, limit: 12, status: status || undefined, priority: priority || undefined, q: q.length >= 2 ? q : undefined, breached: breached || undefined });
  const filtered = Boolean(status || priority || q || breached);

  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('complaints.title')}
        description={t('complaints.description')}
        actions={<><Hint id="complaintClock" /><Can permission="complaints:create"><Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" />{t('complaints.new')}</Button></Can></>}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={t('complaints.tabs')}>
          <TabsTrigger value="list">{t('complaints.tabList')}</TabsTrigger>
          <TabsTrigger value="trends">{t('complaints.tabTrends')}</TabsTrigger>
        </TabsList>
        <TabsContent value="list">
          <form role="search" className="mb-5 grid gap-3 sm:grid-cols-[1fr_10rem_9rem_auto]" onSubmit={(e) => e.preventDefault()}>
            <FormField label={t('complaints.search')} hideLabel>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-500" aria-hidden="true" />
                <Input className="pl-9" type="search" placeholder={t('complaints.searchPlaceholder')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
              </div>
            </FormField>
            <FormField label={t('complaints.status')} hideLabel>
              <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
                <option value="">{t('complaints.allStatuses')}</option>
                {COMPLAINT_STATUSES.map((s) => <option key={s} value={s}>{t(`complaintStatus.${s}`)}</option>)}
              </Select>
            </FormField>
            <FormField label={t('complaints.priority')} hideLabel>
              <Select value={priority} onChange={(e) => { setPriority(e.target.value); setPage(1); }}>
                <option value="">{t('complaints.allPriorities')}</option>
                {PRIORITIES.map((p) => <option key={p} value={p}>{t(`priority.${p}`)}</option>)}
              </Select>
            </FormField>
            <label className="flex min-h-11 items-center gap-2 text-sm text-ink md:min-h-10">
              <input type="checkbox" className="size-4 accent-gold-600" checked={breached} onChange={(e) => { setBreached(e.target.checked); setPage(1); }} />
              {t('complaints.breachedOnly')}
            </label>
          </form>
          <ListShell query={query}>
            {query.data && query.data.items.length === 0 ? (
              <EmptyState
                icon={<LifeBuoy className="size-6" aria-hidden="true" />}
                title={filtered ? t('complaints.noMatches') : t('complaints.empty')}
                description={filtered ? t('complaints.noMatchesHint') : t('complaints.emptyHint')}
                action={filtered ? <Button variant="secondary" onClick={() => { setStatus(''); setPriority(''); setSearch(''); setBreached(false); setPage(1); }}>{tc('clearFilters')}</Button> : undefined}
              />
            ) : (
              <>
                <ul className="stagger grid gap-3" aria-label={t('complaints.listLabel')}>
                  {query.data?.items.map((c) => (
                    <li key={c.id}>
                      <Link href={`/cx/complaints/${c.id}`} className="hover-lift block rounded-lg border border-line bg-surface p-4 shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <PriorityBadge priority={c.priority} />
                          <ComplaintStatusBadge status={c.status} />
                          {c.autoAssigned && <span className="text-xs text-muted">{t('complaints.autoAssigned')}</span>}
                        </div>
                        <p className="font-medium text-ink">{c.title}</p>
                        <p className="mt-0.5 text-sm text-muted">
                          {c.learner?.name ?? t('complaints.noLearner')} · {t('complaints.owner')}: {c.ownerName ?? '—'} · {fmt.dateTime(c.createdAt)}
                        </p>
                        {['RESOLVED', 'CLOSED'].includes(c.status) ? null : (
                          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
                            {!c.acknowledgedAt && <SlaCountdown label={t('sla.firstResponse')} dueAt={c.sla.firstResponseDueAt} breachedAt={c.sla.firstResponseBreachedAt} />}
                            <SlaCountdown label={t('sla.resolution')} dueAt={c.sla.resolutionDueAt} breachedAt={c.sla.resolutionBreachedAt} />
                          </div>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
                <Pagination className="mt-5" page={page} hasNext={Boolean(query.data?.pagination?.hasMore)} onPageChange={setPage} labels={labels} />
              </>
            )}
          </ListShell>
        </TabsContent>
        <TabsContent value="trends">
          <Trends />
        </TabsContent>
      </Tabs>
      <CreateComplaintDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function Trends() {
  const t = useTranslations('cx');
  const query = useOne<ComplaintTrends>(ck('complaints', 'trends'), '/cx/complaints/trends', { bucket: 'month' });
  return (
    <ListShell query={query}>
      {query.data && (
        query.data.totals.opened === 0 ? (
          <EmptyState title={t('trends.empty')} description={t('trends.emptyHint')} icon={<LifeBuoy className="size-6" aria-hidden="true" />} />
        ) : (
          <div className="enter-up space-y-5">
            <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={t('trends.opened')} value={<CountUp value={query.data.totals.opened} />} hint={t('trends.window')} />
              <Stat label={t('trends.resolutionRate')} value={query.data.totals.resolutionRatePct === null ? t('common.dash') : `${query.data.totals.resolutionRatePct}%`} />
              <Stat label={t('trends.slaAdherence')} value={query.data.totals.slaAdherencePct === null ? t('common.dash') : `${query.data.totals.slaAdherencePct}%`} />
              <Stat label={t('trends.meanHours')} value={query.data.totals.meanHoursToResolve === null ? t('common.dash') : query.data.totals.meanHoursToResolve} hint={t('trends.hours')} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel accent="gold" title={t('trends.byRootCause')} description={t('trends.byRootCauseHint')}>
                <BarList rows={query.data.byRootCause.map((r) => ({ key: r.key, label: t(`rootCause.${r.key}` as never), count: r.count }))} empty={t('trends.noRootCauses')} />
              </Panel>
              <Panel accent="blue" title={t('trends.byCategory')}>
                <BarList rows={query.data.byCategory.map((r) => ({ key: r.key, label: t(`category.${r.key}` as never), count: r.count }))} empty={t('trends.empty')} />
              </Panel>
            </div>
            <Panel accent="green" title={t('trends.overTime')}>
              <div className="overflow-x-auto"><table className="w-full min-w-[26rem] text-sm">
                <caption className="sr-only">{t('trends.overTime')}</caption>
                <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="py-2 pr-3 font-medium">{t('trends.period')}</th><th scope="col" className="py-2 pr-3 font-medium">{t('trends.opened')}</th><th scope="col" className="py-2 pr-3 font-medium">{t('trends.resolved')}</th><th scope="col" className="py-2 pr-3 font-medium">{t('trends.withinSla')}</th><th scope="col" className="py-2 font-medium">{t('trends.breached')}</th></tr></thead>
                <tbody>
                  {query.data.series.map((s) => (
                    <tr key={s.bucket} className="border-b border-line/60 last:border-0"><th scope="row" className="py-2 pr-3 text-left font-medium">{s.bucket}</th><td className="py-2 pr-3">{s.opened}</td><td className="py-2 pr-3">{s.resolved}</td><td className="py-2 pr-3">{s.resolvedWithinSla}</td><td className="py-2">{s.breached}</td></tr>
                  ))}
                </tbody>
              </table></div>
            </Panel>
          </div>
        )
      )}
    </ListShell>
  );
}

export function BarList({ rows, empty }: { rows: Array<{ key: string; label: string; count: number }>; empty: string }) {
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="mb-1 flex justify-between gap-3 text-sm"><span className="text-ink">{r.label}</span><span className="font-medium tabular-nums text-ink-700">{r.count}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-ivory-300" aria-hidden="true"><div className="h-full rounded-full bg-blue-600 transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${(r.count / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

export function useAssignable(purpose: 'complaint' | 'action-item', enabled: boolean) {
  return useOne<Person[]>(ck('assignable', purpose), '/cx/assignable-users', { purpose }, enabled);
}

function CreateComplaintDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('cx');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('complaints.newTitle')} description={t('complaints.newDescription')} closeLabel={t('common.close')} size="lg">
        {open && <CreateForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('cx');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const people = useAssignable('complaint', true);
  const create = useAction<Record<string, unknown>, Complaint>('post', '/cx/complaints');
  const [f, setF] = React.useState({ title: '', description: '', category: 'OTHER', priority: 'P3', ownerId: '' });
  const [lead, setLead] = React.useState<PickedLead | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const invalid = f.title.trim().length < 3 || f.description.trim().length < 3;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid) return;
        create.mutate({ title: f.title.trim(), description: f.description.trim(), category: f.category, priority: f.priority, ...(f.ownerId ? { ownerId: f.ownerId } : {}), ...(lead ? { leadId: lead.id } : {}) }, { onSuccess: onDone });
      }}
    >
      {create.isError && <Alert tone="danger">{apiErr(create.error).message}</Alert>}
      <FormField label={t('complaints.fieldTitle')} required><Input value={f.title} onChange={set('title')} maxLength={200} /></FormField>
      <FormField label={t('complaints.fieldDescription')} required><Textarea value={f.description} onChange={set('description')} maxLength={5000} /></FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('complaints.fieldCategory')} required>
          <Select value={f.category} onChange={set('category')}>{CATEGORIES.map((c) => <option key={c} value={c}>{t(`category.${c}`)}</option>)}</Select>
        </FormField>
        <FormField label={t('complaints.fieldPriority')} required hint={t('complaints.priorityHint')}>
          <Select value={f.priority} onChange={set('priority')}>{PRIORITIES.map((p) => <option key={p} value={p}>{t(`priority.${p}`)}</option>)}</Select>
        </FormField>
      </div>
      <FormField label={t('complaints.fieldOwner')} hint={t('complaints.ownerHint')}>
        <Select value={f.ownerId} onChange={set('ownerId')}>
          <option value="">{t('complaints.ownerAuto')}</option>
          {people.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </FormField>
      <LeadPicker value={lead} onChange={setLead} label={t('complaints.fieldLead')} hint={t('complaints.leadHint')} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onDone}>{tc('cancel')}</Button>
        <Button type="submit" loading={create.isPending} disabled={invalid}>{t('complaints.create')}</Button>
      </div>
    </form>
  );
}
