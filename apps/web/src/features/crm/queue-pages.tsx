'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertTriangle, GitMerge, UserCog } from 'lucide-react';
import { Alert, Badge, Button, Checkbox, Combobox, DataTable, Dialog, DialogContent, FormField, Panel, Pagination, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, useToast, type Column } from '@salesos/ui';
import { PageHeader, StaggerList } from './motion';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import {
  useAssignableUsers,
  useBulkAssign,
  useDismissDuplicate,
  useDuplicates,
  useExceptions,
  useMergeDuplicate,
  useReactivate,
  useReactivation,
  useReassignmentQueue,
  useResolveException,
  type BulkResult,
  type DuplicateRow,
  type ExceptionRow,
  type Lead,
  type QueueEntry,
  type ReactivationRow,
} from '@/lib/api/hooks/crm';
import { CrmFrame, DataState, StageBadge, useCrmFormat } from './common';
import { AssignDialog } from './lead-dialogs';
import { humanize } from './lib';
import { Hint } from '@/features/hints/hint-views';

/* ---------------------------------------------------------------- exception queue */
const KINDS = ['NO_OWNER', 'NO_NEXT_ACTION', 'UNATTENDED', 'MANAGER_REVIEW', 'OWNER_DEACTIVATED'] as const;

export function ExceptionsPage() {
  return (
    <RequirePermission permission="leads:exceptions:view" minScope="team">
      <CrmFrame>
        <ExceptionsInner />
      </CrmFrame>
    </RequirePermission>
  );
}

function ExceptionsInner() {
  const t = useTranslations('crm.exceptions');
  const tc = useTranslations('common');
  const f = useCrmFormat();
  const [kind, setKind] = React.useState<string>('ALL');
  const [page, setPage] = React.useState(1);
  const q = useExceptions(kind === 'ALL' ? undefined : kind, page);
  const [assign, setAssign] = React.useState<Lead | null>(null);
  const [resolve, setResolve] = React.useState<ExceptionRow | null>(null);
  const err = useApiErrorMessage();
  const counts = q.data?.counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const columns: Column<ExceptionRow>[] = [
    { id: 'lead', header: t('colLead'), primary: true, cell: (e) => (<Link href={`/crm/leads/${e.lead.id}`} className="font-medium text-ink hover:underline">{e.lead.fullName}</Link>) },
    { id: 'kind', header: t('colKind'), cell: (e) => (<Badge tone={e.kind === 'MANAGER_REVIEW' || e.kind === 'OWNER_DEACTIVATED' ? 'red' : 'gold'}><span className="inline-flex items-center gap-1">{(e.kind === 'MANAGER_REVIEW' || e.kind === 'OWNER_DEACTIVATED') && <AlertTriangle className="size-3" aria-hidden="true" />}{t(`kind.${e.kind}` as 'kind.NO_OWNER')}</span></Badge>) },
    { id: 'owner', header: t('colOwner'), cell: (e) => e.lead.assignedTo?.name ?? <span className="inline-flex items-center gap-1 font-medium text-red-700"><AlertTriangle className="size-3.5" aria-hidden="true" />{t('unassigned')}</span> },
    { id: 'detail', header: t('colDetail'), hideOnMobile: true, cell: (e) => e.detail ?? '—' },
    { id: 'since', header: t('colSince'), cell: (e) => f.relative(e.detectedAt) },
    { id: 'age', header: t('colAgeing'), hideOnMobile: true, cell: (e) => t('ageing', { created: e.lead.ageing?.sinceCreationDays ?? 0, activity: e.lead.ageing?.sinceActivityDays ?? 0 }) },
  ];
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} actions={<Hint id="exceptionQueue" />} />
      <Tabs value={kind} onValueChange={(v) => { setKind(v); setPage(1); }} className="mb-4">
        <TabsList aria-label={t('filterKind')} className="max-w-full overflow-x-auto">
          <TabsTrigger value="ALL">{t('all', { count: total })}</TabsTrigger>
          {KINDS.map((k) => (<TabsTrigger key={k} value={k}>{t(`kind.${k}` as 'kind.NO_OWNER')} ({counts[k] ?? 0})</TabsTrigger>))}
        </TabsList>
        {['ALL', ...KINDS].map((v) => (<TabsContent key={v} value={v} />))}
      </Tabs>
      <DataTable
        caption={t('title')}
        columns={columns}
        rows={q.data?.items}
        getRowId={(e) => e.id}
        loading={q.isPending}
        loadingLabel={tc('loading')}
        error={q.isError ? { message: err(q.error).message, onRetry: () => void q.refetch() } : null}
        emptyTitle={t('emptyTitle')}
        emptyDescription={t('emptyDescription')}
        actionsHeader={tc('actions')}
        rowActions={(e) => (
          <span className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" leadingIcon={<UserCog className="size-4" aria-hidden="true" />} onClick={() => setAssign(e.lead)}>{e.lead.assignedTo ? t('reassign') : t('assign')}</Button>
            {(e.kind === 'MANAGER_REVIEW' || e.kind === 'UNATTENDED') && <Button size="sm" variant="ghost" onClick={() => setResolve(e)}>{t('resolve')}</Button>}
          </span>
        )}
      />
      <Pagination className="mt-4" hasPrev={page > 1} hasNext={Boolean(q.data?.pagination?.hasMore)} onPrev={() => setPage((p) => Math.max(1, p - 1))} onNext={() => setPage((p) => p + 1)} labels={{ nav: tc('pagination'), previous: tc('previous'), next: tc('next'), summary: () => '', page: () => '', pageOnly: (p) => tc('paginationPageOnly', { page: p }) }} />
      {assign && <AssignDialog open onOpenChange={(o) => !o && setAssign(null)} lead={assign} />}
      {resolve && <ResolveDialog row={resolve} onClose={() => setResolve(null)} />}
    </>
  );
}

function ResolveDialog({ row, onClose }: { row: ExceptionRow; onClose: () => void }) {
  const t = useTranslations('crm.exceptions');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const res = useResolveException();
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        size="sm"
        title={t('resolveTitle')}
        description={row.lead.fullName}
        closeLabel={tc('close')}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>{tc('cancel')}</Button>
            <Button
              loading={res.isPending}
              disabled={note.trim().length < 3}
              onClick={async () => {
                setError(null);
                try {
                  await res.mutateAsync({ id: row.id, note: note.trim() });
                  toast({ tone: 'success', title: t('resolved') });
                  onClose();
                } catch (e) {
                  setError(apiErr(e).message);
                }
              }}
            >
              {t('resolve')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <Alert tone="danger">{error}</Alert>}
          <FormField label={t('note')} hint={t('noteHint')} required>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- reassignment queue */
export function ReassignmentPage() {
  const t = useTranslations('crm.reassignment');
  return (
    <RequirePermission permission="leads:reassignment-queue:resolve">
      <CrmFrame>
        <Tabs defaultValue="open">
          <TabsList aria-label={t('tabs')} className="mb-4">
            <TabsTrigger value="open">{t('tabOpen')}</TabsTrigger>
            <TabsTrigger value="history">{t('tabHistory')}</TabsTrigger>
          </TabsList>
          <TabsContent value="open"><ReassignmentInner /></TabsContent>
          <TabsContent value="history"><ReassignmentHistory /></TabsContent>
        </Tabs>
      </CrmFrame>
    </RequirePermission>
  );
}

/** Who moved what to whom, when and why (resolved queue entries; lead ownership history is also on the lead page). */
export function ReassignmentHistory() {
  const t = useTranslations('crm.reassignment');
  const f = useCrmFormat();
  const q = useReassignmentQueue('RESOLVED');
  return (
    <DataState q={q} isEmpty={(d) => d.length === 0} empty={{ title: t('historyEmptyTitle'), description: t('historyEmptyDescription') }}>
      {(rows) => (
        <div role="list" aria-label={t('tabHistory')} data-testid="reassignment-history" className="rounded-lg border border-line bg-surface">
         <StaggerList as="div" className="divide-y divide-line">
          {rows.map((r: QueueEntry) => (
            <div role="listitem" key={r.id} className="p-4 text-sm transition-colors hover:bg-ivory-100" data-entry-id={r.id}>
              <p className="font-medium text-ink">
                {r.lead ? <Link href={`/crm/leads/${r.lead.id}`} className="link-underline">{r.lead.fullName}</Link> : r.task?.title}
                <Badge className="ml-2" tone={r.task && !r.lead ? 'blue' : 'gold'}>{r.task && !r.lead ? t('kindTask') : t('kindLead')}</Badge>
              </p>
              <p className="text-ink-700">{t('movedFromTo', { from: r.previousOwner?.name ?? '—', to: r.newOwner?.name ?? '—' })}</p>
              <p className="text-xs text-muted">
                {r.resolvedAt ? f.dateTime(r.resolvedAt) : ''}{r.resolvedBy?.name ? ` · ${t('byUser', { name: r.resolvedBy.name })}` : ''} · {humanize(r.reason)}
              </p>
              {r.resolutionNote && <p className="mt-1 text-xs text-ink-600">{r.resolutionNote}</p>}
            </div>
          ))}
         </StaggerList>
        </div>
      )}
    </DataState>
  );
}

function ReassignmentInner() {
  const t = useTranslations('crm.reassignment');
  const tc = useTranslations('common');
  const f = useCrmFormat();
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const q = useReassignmentQueue('OPEN');
  const users = useAssignableUsers();
  const bulk = useBulkAssign();
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  const [to, setTo] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState('');
  const [result, setResult] = React.useState<BulkResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const rows = q.data ?? [];
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const canSubmit = sel.size > 0 && to && reason.trim().length >= 3;
  const submit = async () => {
    setError(null);
    try {
      const r = await bulk.mutateAsync({ entryIds: [...sel], toUserId: to!, reason: reason.trim() });
      setResult(r);
      setSel(new Set());
      toast({ tone: r.skipped ? 'warning' : 'success', title: t('resultToast', { resolved: r.resolved, skipped: r.skipped }) });
    } catch (e) {
      setError(apiErr(e).message);
    }
  };
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <DataState q={q} isEmpty={(d) => d.length === 0 && !result} empty={{ title: t('emptyTitle'), description: t('emptyDescription') }}>
        {() => (
          <div className="space-y-5">
            <Panel title={t('assignPanel')} description={t('selected', { count: sel.size })}>
              <div className="grid gap-4 md:grid-cols-2">
                <FormField label={t('newOwner')} required>
                  <Combobox options={(users.data ?? []).map((u) => ({ value: u.id, label: u.name, description: u.email }))} value={to} onValueChange={setTo} loading={users.isPending} placeholder={t('ownerPlaceholder')} emptyText={tc('noMatches')} clearLabel={tc('clear')} />
                </FormField>
                <FormField label={t('reason')} required hint={t('reasonHint')}>
                  <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                </FormField>
              </div>
              {error && <Alert tone="danger" className="mt-3">{error}</Alert>}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button disabled={!canSubmit} loading={bulk.isPending} loadingLabel={tc('saving')} onClick={() => void submit()}>{t('assignSelected', { count: sel.size })}</Button>
                <Button variant="ghost" onClick={() => setSel(new Set(rows.map((r) => r.id)))}>{t('selectAll')}</Button>
                <Button variant="ghost" onClick={() => setSel(new Set())}>{t('clearSelection')}</Button>
              </div>
            </Panel>
            {result && (
              <Panel title={t('resultTitle')} description={t('resultToast', { resolved: result.resolved, skipped: result.skipped })}>
                <ul className="space-y-1 text-sm" aria-label={t('resultTitle')}>
                  {result.results.map((r) => (
                    <li key={r.entryId} className="flex items-center gap-2">
                      <Badge tone={r.status === 'RESOLVED' ? 'green' : 'red'}>{r.status === 'RESOLVED' ? t('ok') : t('skipped')}</Badge>
                      <code className="text-xs text-muted">{r.entryId.slice(0, 8)}</code>
                      {r.error && <span className="text-muted">{r.error}</span>}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            <div role="list" aria-label={t('title')} className="rounded-lg border border-line bg-surface">
             <StaggerList as="div" className="divide-y divide-line">
              {rows.map((r: QueueEntry) => (
                <div role="listitem" key={r.id} className="flex items-start gap-3 p-4 transition-colors hover:bg-ivory-100" data-entry-id={r.id}>
                  <Checkbox checked={sel.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label={t('select', { name: r.lead?.fullName ?? r.task?.title ?? '' })} />
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-ink">
                      {r.lead ? <Link href={`/crm/leads/${r.lead.id}`} className="link-underline">{r.lead.fullName}</Link> : r.task?.title}
                      <Badge className="ml-2" tone={r.task && !r.lead ? 'blue' : 'gold'}>{r.task ? t('kindTask') : t('kindLead')}</Badge>
                    </p>
                    <p className="text-xs text-muted">
                      {t('previousOwner', { name: r.previousOwner?.name ?? '—' })} · {humanize(r.reason)} · {f.relative(r.createdAt)}
                      {r.task && <> · {f.dateTime(r.task.dueAt)}</>}
                    </p>
                  </div>
                </div>
              ))}
             </StaggerList>
            </div>
          </div>
        )}
      </DataState>
    </>
  );
}

/* ---------------------------------------------------------------- duplicate review */
type TakeField = 'fullName' | 'email' | 'phone' | 'programId' | 'sourceId' | 'interestLevel';

export function DuplicatesPage() {
  return (
    <RequirePermission permission="leads:duplicates:review">
      <CrmFrame>
        <DuplicatesInner />
      </CrmFrame>
    </RequirePermission>
  );
}

function DuplicatesInner() {
  const t = useTranslations('crm.duplicates');
  const q = useDuplicates();
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <Alert tone="info" className="mb-4">{t('policy')}</Alert>
      <DataState q={q} isEmpty={(d) => d.length === 0} empty={{ title: t('emptyTitle'), description: t('emptyDescription') }}>
        {(rows) => (
          <StaggerList as="div" className="space-y-6">
            {rows.map((r) => (<DuplicateCompare key={r.id} row={r} />))}
          </StaggerList>
        )}
      </DataState>
    </>
  );
}

const fieldOf = (l: Lead, k: string): string => {
  switch (k) {
    case 'fullName': return l.fullName;
    case 'phone': return l.phone ?? '—';
    case 'email': return l.email ?? '—';
    case 'owner': return l.assignedTo?.name ?? '—';
    case 'stage': return l.status;
    case 'program': return l.program?.name ?? '—';
    case 'source': return l.source?.name ?? '—';
    case 'interest': return l.interestLevel ?? '—';
    case 'calls': return String(l.callAttemptCount ?? 0);
    case 'created': return l.createdAt.slice(0, 10);
    default: return '—';
  }
};

/** Side-by-side comparison with winner selection and field-level "take from the other lead". Never merges silently. */
export function DuplicateCompare({ row, onDone }: { row: DuplicateRow; onDone?: () => void }) {
  const t = useTranslations('crm.duplicates');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const merge = useMergeDuplicate();
  const dismiss = useDismissDuplicate();
  const [winner, setWinner] = React.useState<'A' | 'B'>('A');
  const [take, setTake] = React.useState<Set<TakeField>>(new Set());
  const [reason, setReason] = React.useState('');
  const [confirm, setConfirm] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const rowsDef: { key: string; take?: TakeField }[] = [
    { key: 'fullName', take: 'fullName' }, { key: 'phone', take: 'phone' }, { key: 'email', take: 'email' }, { key: 'owner' }, { key: 'stage' },
    { key: 'program', take: 'programId' }, { key: 'source', take: 'sourceId' }, { key: 'interest', take: 'interestLevel' }, { key: 'calls' }, { key: 'created' },
  ];
  const [a, b] = [row.leadA, row.leadB];
  const w = winner === 'A' ? a : b;
  const run = async (kind: 'merge' | 'dismiss') => {
    setError(null);
    try {
      if (kind === 'merge') await merge.mutateAsync({ id: row.id, winnerLeadId: w.id, takeFromLoser: [...take], reason: reason.trim() });
      else await dismiss.mutateAsync({ id: row.id, reason: reason.trim() });
      toast({ tone: 'success', title: kind === 'merge' ? t('merged') : t('dismissed') });
      setConfirm(false);
      onDone?.();
    } catch (e) {
      setError(apiErr(e).message);
      setConfirm(false);
    }
  };
  const reasonOk = reason.trim().length >= 3;
  return (
    <Panel title={<span className="flex flex-wrap items-center gap-2 break-words">{a.fullName} <span className="text-muted">/</span> {b.fullName}</span>} description={t(`match.${row.matchType}` as 'match.PHONE_EXACT')} data-duplicate-id={row.id}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <caption className="sr-only">{t('compare')}</caption>
          <thead>
            <tr className="text-left text-xs text-muted">
              <th scope="col" className="py-2 pr-3 font-medium">{t('field')}</th>
              {(['A', 'B'] as const).map((s) => (
                <th key={s} scope="col" className="px-3 py-2 font-medium">
                  <label className="flex cursor-pointer items-center gap-2 text-ink">
                    <input type="radio" name={`winner-${row.id}`} checked={winner === s} onChange={() => setWinner(s)} className="size-4" />
                    {t('keep', { side: s })}
                  </label>
                </th>
              ))}
              <th scope="col" className="py-2 pl-3 font-medium">{t('takeFromOther')}</th>
            </tr>
          </thead>
          <tbody>
            {rowsDef.map((d) => {
              const va = fieldOf(a, d.key);
              const vb = fieldOf(b, d.key);
              const diff = va !== vb;
              return (
                <tr key={d.key} className="border-t border-line align-top">
                  <th scope="row" className="py-2 pr-3 text-left font-medium text-ink-700">{t(`f.${d.key}` as 'f.fullName')}</th>
                  <td className={`px-3 py-2 ${diff ? 'bg-gold-50' : ''}`}>{va}</td>
                  <td className={`px-3 py-2 ${diff ? 'bg-gold-50' : ''}`}>{vb}</td>
                  <td className="py-2 pl-3">
                    {d.take && diff && (
                      <label className="flex items-center gap-2 text-xs">
                        <input type="checkbox" className="size-4" checked={take.has(d.take)} onChange={(e) => setTake((s) => { const n = new Set(s); if (e.target.checked) n.add(d.take!); else n.delete(d.take!); return n; })} />
                        {t('useOther')}
                      </label>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4 space-y-3">
        {error && <Alert tone="danger">{error}</Alert>}
        <FormField label={t('reason')} required hint={t('reasonHint')}>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        <div className="flex flex-wrap gap-2">
          <Button className="glow-gold" disabled={!reasonOk} leadingIcon={<GitMerge className="size-4" aria-hidden="true" />} onClick={() => setConfirm(true)}>{t('merge')}</Button>
          <Button variant="secondary" disabled={!reasonOk} loading={dismiss.isPending} onClick={() => void run('dismiss')}>{t('dismiss')}</Button>
        </div>
      </div>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        {confirm && (
          <DialogContent
            size="sm"
            title={t('confirmTitle')}
            description={t('confirmBody', { winner: w.fullName })}
            closeLabel={tc('close')}
            footer={
              <>
                <Button variant="secondary" onClick={() => setConfirm(false)}>{tc('cancel')}</Button>
                <Button variant="danger" loading={merge.isPending} onClick={() => void run('merge')}>{t('confirmMerge')}</Button>
              </>
            }
          >
            <p className="text-sm text-ink-700">{t('confirmConsequences')}</p>
          </DialogContent>
        )}
      </Dialog>
    </Panel>
  );
}

/* ---------------------------------------------------------------- reactivation */
export function ReactivationPage() {
  return (
    <RequirePermission permission="leads:reactivation:view">
      <CrmFrame>
        <ReactivationInner />
      </CrmFrame>
    </RequirePermission>
  );
}

function ReactivationInner() {
  const t = useTranslations('crm.reactivation');
  const tc = useTranslations('common');
  const f = useCrmFormat();
  const err = useApiErrorMessage();
  const q = useReactivation();
  const [target, setTarget] = React.useState<ReactivationRow | null>(null);
  const columns: Column<ReactivationRow>[] = [
    { id: 'lead', header: t('colLead'), primary: true, cell: (r) => (<Link href={`/crm/leads/${r.lead.id}`} className="link-underline font-medium">{r.lead.fullName}</Link>) },
    { id: 'reason', header: t('colReason'), cell: (r) => (r.lostReason ? humanize(r.lostReason) : '—') },
    { id: 'eligible', header: t('colEligible'), cell: (r) => (r.eligible ? <Badge tone="green">{t('eligibleNow')}</Badge> : <span className="text-muted">{t('eligibleOn', { date: f.dateTime(r.eligibleFrom) })}</span>) },
    { id: 'stage', header: t('colStage'), hideOnMobile: true, cell: (r) => <StageBadge lead={r.lead} /> },
    { id: 'attempts', header: t('colAttempts'), hideOnMobile: true, cell: (r) => r.attempts },
  ];
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <Alert tone="info" className="mb-4">{t('rules')}</Alert>
      <DataTable
        caption={t('title')}
        columns={columns}
        rows={q.data}
        getRowId={(r) => r.id}
        loading={q.isPending}
        loadingLabel={tc('loading')}
        error={q.isError ? { message: err(q.error).message, onRetry: () => void q.refetch() } : null}
        emptyTitle={t('emptyTitle')}
        emptyDescription={t('emptyDescription')}
        actionsHeader={tc('actions')}
        rowActions={(r) => (<Button size="sm" disabled={!r.eligible} onClick={() => setTarget(r)}>{t('reactivate')}</Button>)}
      />
      {target && <ReactivateDialog row={target} onClose={() => setTarget(null)} />}
    </>
  );
}

function ReactivateDialog({ row, onClose }: { row: ReactivationRow; onClose: () => void }) {
  const t = useTranslations('crm.reactivation');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const users = useAssignableUsers();
  const act = useReactivate();
  const [to, setTo] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        size="md"
        title={t('dialogTitle', { name: row.lead.fullName })}
        closeLabel={tc('close')}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>{tc('cancel')}</Button>
            <Button
              loading={act.isPending}
              disabled={reason.trim().length < 3}
              onClick={async () => {
                setError(null);
                try {
                  await act.mutateAsync({ id: row.id, toUserId: to ?? undefined, reason: reason.trim() });
                  toast({ tone: 'success', title: t('done', { name: row.lead.fullName }) });
                  onClose();
                } catch (e) {
                  setError(apiErr(e).message);
                }
              }}
            >
              {t('reactivate')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <FormField label={t('owner')} hint={t('ownerHint')}>
            <Combobox options={(users.data ?? []).map((u) => ({ value: u.id, label: u.name, description: u.email }))} value={to} onValueChange={setTo} loading={users.isPending} placeholder={t('ownerPlaceholder')} emptyText={tc('noMatches')} clearLabel={tc('clear')} />
          </FormField>
          <FormField label={t('reason')} required>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
        </div>
      </DialogContent>
    </Dialog>
  );
}
