'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Bookmark, Trash2, UserPlus } from 'lucide-react';
import { Button, DataTable, FilterBar, FormField, Input, Pagination, Select, Sheet, SheetContent, useToast, type Column } from '@salesos/ui';
import { PageHeader } from './motion';
import { RequirePermission } from '@/features/auth/require-permission';
import { Can } from '@/features/auth/auth-provider';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useDeleteView, useLeadMeta, useLeads, useSaveView, useSavedViews, type Lead, type LeadsQuery } from '@/lib/api/hooks/crm';
import { CrmFrame, DueBadge, InterestBadge, StageBadge, useCrmFormat } from './common';
import { CreateLeadDialog } from './lead-dialogs';

const DEFAULTS: LeadsQuery = { sort: 'createdAt', dir: 'desc' };

export function LeadsPage() {
  return (
    <RequirePermission permission="leads:view">
      <CrmFrame>
        <LeadsInner />
      </CrmFrame>
    </RequirePermission>
  );
}

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = React.useState(v);
  React.useEffect(() => {
    const id = setTimeout(() => setD(v), ms);
    return () => clearTimeout(id);
  }, [v, ms]);
  return d;
}

function LeadsInner() {
  const t = useTranslations('crm.leads');
  const tc = useTranslations('common');
  const router = useRouter();
  const f = useCrmFormat();
  const err = useApiErrorMessage();
  const { toast } = useToast();
  const meta = useLeadMeta();
  const views = useSavedViews();
  const saveView = useSaveView();
  const delView = useDeleteView();
  const [filters, setFilters] = React.useState<LeadsQuery>(DEFAULTS);
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [sheet, setSheet] = React.useState(false);
  const [create, setCreate] = React.useState(false);
  const [viewName, setViewName] = React.useState('');
  const debounced = useDebounced(search);
  const query = { ...filters, q: debounced || undefined, page, limit: 25 };
  const q = useLeads(query);
  const patch = (p: Partial<LeadsQuery>) => {
    setFilters((s) => ({ ...s, ...p }));
    setPage(1);
  };
  const active = ['status', 'category', 'assignedToId', 'sourceId', 'programId', 'interestLevel', 'overdue', 'duplicate', 'mine', 'noActivityDays'].filter((k) => filters[k as keyof LeadsQuery] !== undefined && filters[k as keyof LeadsQuery] !== '').length;
  const summary = (q.data?.items ?? []).some((l) => l.summary);

  const columns: Column<Lead>[] = [
    { id: 'name', header: t('colName'), primary: true, cell: (l) => (<Link href={`/crm/leads/${l.id}`} className="link-underline font-medium text-ink">{l.fullName}{l.duplicateFlag ? ` · ${t('dup')}` : ''}</Link>) },
    { id: 'stage', header: t('colStage'), cell: (l) => <StageBadge lead={l} /> },
    ...(summary
      ? []
      : ([
          { id: 'interest', header: t('colInterest'), cell: (l: Lead) => <InterestBadge level={l.interestLevel} />, hideOnMobile: true },
          { id: 'owner', header: t('colOwner'), cell: (l: Lead) => l.assignedTo?.name ?? <span className="font-medium text-red-700">{t('unassigned')}</span> },
          { id: 'next', header: t('colNext'), cell: (l: Lead) => <DueBadge iso={l.nextActionAt} /> },
          { id: 'activity', header: t('colActivity'), cell: (l: Lead) => (l.lastActivityAt ? f.relative(l.lastActivityAt) : t('never')), hideOnMobile: true },
        ] as Column<Lead>[])),
    { id: 'source', header: t('colSource'), cell: (l) => l.source?.name ?? '—', hideOnMobile: true },
    { id: 'program', header: t('colProgram'), cell: (l) => l.program?.name ?? '—', hideOnMobile: true },
  ];

  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={<Can permission="leads:create"><Button className="glow-gold" leadingIcon={<UserPlus className="size-4" aria-hidden="true" />} onClick={() => setCreate(true)}>{t('new')}</Button></Can>}
      />
      <FilterBar
        search={search}
        onSearchChange={(v) => { setSearch(v); setPage(1); }}
        searchLabel={t('search')}
        searchPlaceholder={t('searchPlaceholder')}
        activeCount={active}
        clearLabel={tc('clearFilters')}
        onClear={() => { setFilters(DEFAULTS); setSearch(''); setPage(1); }}
      >
        <div className="flex flex-wrap items-end gap-2">
          <FormField label={t('stage')} hideLabel>
            <Select aria-label={t('stage')} value={filters.status ?? ''} onChange={(e) => patch({ status: e.target.value || undefined })}>
              <option value="">{t('allStages')}</option>
              {(meta.data?.stages ?? []).map((s) => (<option key={s.key} value={s.key}>{s.label}</option>))}
            </Select>
          </FormField>
          <FormField label={t('sort')} hideLabel>
            <Select aria-label={t('sort')} value={`${filters.sort}:${filters.dir}`} onChange={(e) => { const [sort, dir] = e.target.value.split(':'); patch({ sort, dir: dir as 'asc' | 'desc' }); }}>
              <option value="createdAt:desc">{t('sortNewest')}</option>
              <option value="nextActionAt:asc">{t('sortNextAction')}</option>
              <option value="lastActivityAt:asc">{t('sortStale')}</option>
              <option value="priority:asc">{t('sortPriority')}</option>
            </Select>
          </FormField>
          <Button variant="secondary" onClick={() => setSheet(true)}>{t('moreFilters')}{active ? ` (${active})` : ''}</Button>
        </div>
      </FilterBar>

      <div className="enter-fade mb-4 flex flex-wrap items-center gap-2" aria-label={t('savedViews')} role="group">
        <Bookmark className="size-4 text-muted" aria-hidden="true" />
        {(views.data ?? []).map((v) => (
          <span key={v.id} className="hover-lift inline-flex max-w-full items-center overflow-hidden rounded-full border border-line-strong bg-surface text-sm">
            <button type="button" className="min-h-9 px-3 hover:bg-ivory-200" onClick={() => { setFilters({ ...DEFAULTS, ...v.filters }); setSearch(v.filters.q ?? ''); setPage(1); }}>{v.name}</button>
            <button type="button" aria-label={t('deleteView', { name: v.name })} className="min-h-9 px-2 text-ink-500 hover:bg-ivory-200" onClick={() => delView.mutate(v.id)}><Trash2 className="size-3.5" /></button>
          </span>
        ))}
        <form
          className="flex w-full items-center gap-2 sm:w-auto"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!viewName.trim()) return;
            try {
              await saveView.mutateAsync({ name: viewName.trim(), filters: { ...filters, q: debounced || undefined } });
              toast({ tone: 'success', title: t('viewSaved', { name: viewName.trim() }) });
              setViewName('');
            } catch (er) {
              toast({ tone: 'danger', title: err(er).message });
            }
          }}
        >
          <Input aria-label={t('viewName')} placeholder={t('viewName')} className="h-9 min-w-0 flex-1 sm:w-40 sm:flex-none" value={viewName} onChange={(e) => setViewName(e.target.value)} />
          <Button type="submit" size="sm" variant="secondary" loading={saveView.isPending}>{t('saveView')}</Button>
        </form>
      </div>

      <DataTable
        caption={t('title')}
        columns={columns}
        rows={q.data?.items}
        getRowId={(l) => l.id}
        loading={q.isPending}
        loadingLabel={tc('loading')}
        error={q.isError ? { message: err(q.error).message, onRetry: () => void q.refetch() } : null}
        emptyTitle={active || debounced ? t('emptyFilteredTitle') : t('emptyTitle')}
        emptyDescription={active || debounced ? t('emptyFilteredDescription') : t('emptyDescription')}
        onRowClick={(l) => router.push(`/crm/leads/${l.id}`)}
      />
      <Pagination
        className="mt-4"
        hasPrev={page > 1}
        hasNext={Boolean(q.data?.pagination?.hasMore)}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => p + 1)}
        labels={{ nav: tc('pagination'), previous: tc('previous'), next: tc('next'), summary: () => '', page: () => '', pageOnly: (p) => tc('paginationPageOnly', { page: p }) }}
      />

      <Sheet open={sheet} onOpenChange={setSheet}>
        {sheet && (
          <SheetContent title={t('moreFilters')} closeLabel={tc('close')} footer={<Button onClick={() => setSheet(false)}>{t('apply')}</Button>}>
            <div className="space-y-4">
              <FormField label={t('owner')}>
                <Select value={filters.assignedToId ?? (filters.mine ? 'mine' : '')} onChange={(e) => { const v = e.target.value; patch({ assignedToId: v === 'unassigned' ? 'unassigned' : undefined, mine: v === 'mine' ? true : undefined }); }}>
                  <option value="">{t('anyOwner')}</option>
                  <option value="mine">{t('mine')}</option>
                  <option value="unassigned">{t('unassigned')}</option>
                </Select>
              </FormField>
              <FormField label={t('interest')}>
                <Select value={filters.interestLevel ?? ''} onChange={(e) => patch({ interestLevel: e.target.value || undefined })}>
                  <option value="">{t('any')}</option>
                  <option value="HIGH">{t('interestHIGH')}</option>
                  <option value="MEDIUM">{t('interestMEDIUM')}</option>
                  <option value="LOW">{t('interestLOW')}</option>
                </Select>
              </FormField>
              <FormField label={t('category')}>
                <Select value={filters.category ?? ''} onChange={(e) => patch({ category: e.target.value || undefined })}>
                  <option value="">{t('any')}</option>
                  <option value="OPEN">{t('catOPEN')}</option>
                  <option value="WON">{t('catWON')}</option>
                  <option value="LOST">{t('catLOST')}</option>
                  <option value="NURTURE">{t('catNURTURE')}</option>
                </Select>
              </FormField>
              <FormField label={t('source')}>
                <Select value={filters.sourceId ?? ''} onChange={(e) => patch({ sourceId: e.target.value || undefined })}>
                  <option value="">{t('any')}</option>
                  {(meta.data?.sources ?? []).map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                </Select>
              </FormField>
              <FormField label={t('program')}>
                <Select value={filters.programId ?? ''} onChange={(e) => patch({ programId: e.target.value || undefined })}>
                  <option value="">{t('any')}</option>
                  {(meta.data?.programs ?? []).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                </Select>
              </FormField>
              <FormField label={t('noActivity')}>
                <Select value={String(filters.noActivityDays ?? '')} onChange={(e) => patch({ noActivityDays: e.target.value ? Number(e.target.value) : undefined })}>
                  <option value="">{t('any')}</option>
                  <option value="3">{t('days3')}</option>
                  <option value="7">{t('days7')}</option>
                  <option value="14">{t('days14')}</option>
                </Select>
              </FormField>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={Boolean(filters.overdue)} onChange={(e) => patch({ overdue: e.target.checked || undefined })} />{t('overdueOnly')}</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={Boolean(filters.duplicate)} onChange={(e) => patch({ duplicate: e.target.checked || undefined })} />{t('duplicatesOnly')}</label>
            </div>
          </SheetContent>
        )}
      </Sheet>
      <CreateLeadDialog open={create} onOpenChange={setCreate} onCreated={() => undefined} />
    </>
  );
}
