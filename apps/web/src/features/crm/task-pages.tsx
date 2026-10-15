'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertTriangle, ChevronLeft, ChevronRight, ClipboardPlus, Pencil } from 'lucide-react';
import { Alert, Button, DataTable, Pagination, Panel, StatusBadge, Tabs, TabsContent, TabsList, TabsTrigger, cn, useToast, type Column } from '@salesos/ui';
import { PageHeader, StaggerList } from './motion';
import { RequirePermission } from '@/features/auth/require-permission';
import { Can } from '@/features/auth/auth-provider';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useCalendar, useCompleteTask, useTasks, type CrmTask } from '@/lib/api/hooks/crm';
import { CallButton, CrmFrame, DataState, useCrmFormat } from './common';
import { DispositionDialog } from './disposition-dialog';
import { EditTaskDialog, TaskDialog } from './lead-dialogs';
import { fromIstInput, toIstInput } from './lib';

type Target = { lead: { id: string; fullName: string; phone?: string | null }; taskId: string };

function useTaskColumns(onLog: (t: Target) => void) {
  const t = useTranslations('crm.tasks');
  const tTask = useTranslations('crm.taskType');
  const f = useCrmFormat();
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const complete = useCompleteTask();
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<CrmTask | null>(null);
  const editDialog = editing ? <EditTaskDialog open onOpenChange={(o) => !o && setEditing(null)} task={editing} /> : null;
  const columns: Column<CrmTask>[] = [
    { id: 'title', header: t('colTask'), primary: true, cell: (x) => (<span className="font-medium text-ink">{x.title}</span>) },
    { id: 'lead', header: t('colLead'), cell: (x) => (x.lead ? <Link href={`/crm/leads/${x.lead.id}`} className="underline-offset-2 hover:underline">{x.lead.fullName}</Link> : <span className="text-muted">—</span>) },
    { id: 'type', header: t('colType'), cell: (x) => tTask(x.type as 'CALL'), hideOnMobile: true },
    { id: 'due', header: t('colDue'), cell: (x) => (<StatusBadge status={x.status !== 'OPEN' ? 'success' : x.overdue ? 'overdue' : 'neutral'}>{x.status !== 'OPEN' ? t(`status${x.status}` as 'statusDONE') : x.overdue ? t('overdueBy', { when: f.relative(x.dueAt) }) : f.dateTime(x.dueAt)}</StatusBadge>) },
    { id: 'owner', header: t('colOwner'), cell: (x) => x.assignedTo.name ?? '—', hideOnMobile: true },
  ];
  const rowActions = (x: CrmTask) =>
    x.status === 'OPEN' ? (
      <span className="flex flex-wrap gap-2">
        {x.lead && <CallButton leadId={x.lead.id} phone={x.lead.phone} name={x.lead.fullName} size="sm" />}
        {x.lead && <Button size="sm" variant="secondary" onClick={() => onLog({ lead: x.lead!, taskId: x.id })}>{t('logCall')}</Button>}
        <Can permission="tasks:update">
          <Button size="sm" variant="ghost" leadingIcon={<Pencil className="size-4" aria-hidden="true" />} onClick={() => setEditing(x)}>{t('edit')}</Button>
        </Can>
        <Button
          size="sm"
          variant="ghost"
          loading={complete.isPending && complete.variables?.id === x.id}
          onClick={async () => {
            setError(null);
            try {
              await complete.mutateAsync({ id: x.id });
              toast({ tone: 'success', title: t('completed') });
            } catch (e) {
              setError(apiErr(e).message);
            }
          }}
        >
          {t('markDone')}
        </Button>
      </span>
    ) : null;
  return { columns, rowActions, error, editDialog };
}

export function TasksPage() {
  return (
    <RequirePermission permission="tasks:view">
      <CrmFrame>
        <TasksInner />
      </CrmFrame>
    </RequirePermission>
  );
}

function TasksInner() {
  const t = useTranslations('crm.tasks');
  const tc = useTranslations('common');
  const [status, setStatus] = React.useState<'OPEN' | 'DONE'>('OPEN');
  const [mine, setMine] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [log, setLog] = React.useState<Target | null>(null);
  const [create, setCreate] = React.useState(false);
  const q = useTasks({ status, mine: mine || undefined, page, limit: 25 });
  const { columns, rowActions, error, editDialog } = useTaskColumns(setLog);
  const err = useApiErrorMessage();
  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={<Can permission="tasks:create"><Button leadingIcon={<ClipboardPlus className="size-4" aria-hidden="true" />} onClick={() => setCreate(true)}>{t('new')}</Button></Can>}
      />
      <div className="enter-up mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <Tabs value={status} onValueChange={(v) => { setStatus(v as 'OPEN' | 'DONE'); setPage(1); }}>
          <TabsList aria-label={t('statusFilter')}>
            <TabsTrigger value="OPEN">{t('open')}</TabsTrigger>
            <TabsTrigger value="DONE">{t('done')}</TabsTrigger>
          </TabsList>
          <TabsContent value="OPEN" />
          <TabsContent value="DONE" />
        </Tabs>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" className="size-4 accent-gold-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600" checked={mine} onChange={(e) => { setMine(e.target.checked); setPage(1); }} />
          {t('mineOnly')}
        </label>
      </div>
      {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
      <DataTable
        caption={t('title')}
        columns={columns}
        rows={q.data?.items}
        getRowId={(x) => x.id}
        loading={q.isPending}
        loadingLabel={tc('loading')}
        error={q.isError ? { message: err(q.error).message, onRetry: () => void q.refetch() } : null}
        emptyTitle={t('emptyTitle')}
        emptyDescription={t('emptyDescription')}
        rowActions={rowActions}
        actionsHeader={tc('actions')}
      />
      <Pagination
        className="mt-4"
        hasPrev={page > 1}
        hasNext={Boolean(q.data?.pagination?.hasMore)}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => p + 1)}
        labels={{ nav: tc('pagination'), previous: tc('previous'), next: tc('next'), summary: () => '', page: () => '', pageOnly: (p) => tc('paginationPageOnly', { page: p }) }}
      />
      {editDialog}
      {log && <DispositionDialog open onOpenChange={(o) => !o && setLog(null)} lead={log.lead} taskId={log.taskId} />}
      <TaskDialog open={create} onOpenChange={setCreate} />
    </>
  );
}

/* ---------------------------------------------------------------- overdue queue */
export function OverduePage() {
  return (
    <RequirePermission permission="tasks:view">
      <CrmFrame>
        <OverdueInner />
      </CrmFrame>
    </RequirePermission>
  );
}

function OverdueInner() {
  const t = useTranslations('crm.overdue');
  const tc = useTranslations('common');
  const q = useTasks({ status: 'OPEN', overdue: true, limit: 100 });
  const [log, setLog] = React.useState<Target | null>(null);
  const { columns, rowActions, error, editDialog } = useTaskColumns(setLog);
  const err = useApiErrorMessage();
  const escalated = (q.data?.items ?? []).filter((x) => x.overdueLevel >= 3).length;
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      {escalated > 0 && <Alert tone="warning" className="enter-up mb-4"><span className="inline-flex items-center gap-2"><AlertTriangle className="size-4 shrink-0" aria-hidden="true" />{t('escalated', { count: escalated })}</span></Alert>}
      {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
      <DataTable
        caption={t('title')}
        columns={[...columns, { id: 'level', header: t('colEscalation'), hideOnMobile: true, cell: (x) => (x.overdueLevel >= 4 ? t('levelTeamLead') : x.overdueLevel === 3 ? t('levelManager') : x.overdueLevel >= 1 ? t('levelOwner') : '—') }]}
        rows={q.data?.items}
        getRowId={(x) => x.id}
        loading={q.isPending}
        loadingLabel={tc('loading')}
        error={q.isError ? { message: err(q.error).message, onRetry: () => void q.refetch() } : null}
        emptyTitle={t('emptyTitle')}
        emptyDescription={t('emptyDescription')}
        rowActions={rowActions}
        actionsHeader={tc('actions')}
      />
      {editDialog}
      {log && <DispositionDialog open onOpenChange={(o) => !o && setLog(null)} lead={log.lead} taskId={log.taskId} />}
    </>
  );
}

/* ---------------------------------------------------------------- follow-up calendar */
type View = 'month' | 'week' | 'agenda';
const ymd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
const parseYmd = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => ymd(new Date(parseYmd(s).getTime() + n * 86_400_000));
const istToday = () => toIstInput(new Date()).slice(0, 10);

/** Visible range [start, end] (IST dates) for the view around `anchor`. */
export function calendarRange(view: View, anchor: string): { start: string; end: string } {
  const d = parseYmd(anchor);
  if (view === 'month') {
    const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const startOffset = (first.getUTCDay() + 6) % 7; // Monday first
    const start = ymd(new Date(first.getTime() - startOffset * 86_400_000));
    return { start, end: addDays(start, 41) };
  }
  if (view === 'week') {
    const start = addDays(anchor, -((d.getUTCDay() + 6) % 7));
    return { start, end: addDays(start, 6) };
  }
  return { start: anchor, end: addDays(anchor, 13) };
}

export function CalendarPage() {
  return (
    <RequirePermission permission="tasks:view">
      <CrmFrame>
        <CalendarInner />
      </CrmFrame>
    </RequirePermission>
  );
}

function CalendarInner() {
  const t = useTranslations('crm.calendar');
  const f = useCrmFormat();
  const [view, setView] = React.useState<View>(() => (typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches ? 'month' : 'agenda'));
  const [anchor, setAnchor] = React.useState(istToday);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [log, setLog] = React.useState<Target | null>(null);
  const [editing, setEditing] = React.useState<CrmTask | null>(null);
  const [mine, setMine] = React.useState(true);
  // agenda is the default on phones; wide screens start with the month grid
  const { start, end } = calendarRange(view, anchor);
  const q = useCalendar(fromIstInput(`${start}T00:00`)!, fromIstInput(`${end}T23:59`)!, mine || undefined);
  const byDay = new Map((q.data?.days ?? []).map((d) => [d.date, d]));
  const step = view === 'month' ? 30 : 7;
  const label = view === 'month' ? new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(parseYmd(anchor)) : `${start} – ${end}`;
  const today = istToday();
  const dayTasks = (date: string) => byDay.get(date)?.tasks ?? [];
  const list = (tasks: CrmTask[]) => (
    <StaggerList itemClassName="border-t border-line first:border-t-0">
      {tasks.map((x) => (
        <div key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
          <span className="min-w-0">
            <span className="font-medium text-ink">{f.time(x.dueAt)}</span> · {x.title}
            {x.lead && (<> · <Link className="underline-offset-2 hover:underline" href={`/crm/leads/${x.lead.id}`}>{x.lead.fullName}</Link></>)}
          </span>
          <span className="flex flex-wrap gap-2">
            <Can permission="tasks:update"><Button size="sm" variant="ghost" leadingIcon={<Pencil className="size-4" aria-hidden="true" />} onClick={() => setEditing(x)}>{t('reschedule')}</Button></Can>
            {x.lead && <Button size="sm" variant="secondary" onClick={() => setLog({ lead: x.lead!, taskId: x.id })}>{t('logCall')}</Button>}
          </span>
        </div>
      ))}
    </StaggerList>
  );

  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <div className="enter-up mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1" role="group" aria-label={t('navigate')}>
          <Button size="icon" variant="secondary" aria-label={t('previous')} onClick={() => setAnchor((a) => addDays(a, -step))}><ChevronLeft className="size-4" /></Button>
          <Button size="sm" variant="secondary" onClick={() => setAnchor(istToday())}>{t('today')}</Button>
          <Button size="icon" variant="secondary" aria-label={t('next')} onClick={() => setAnchor((a) => addDays(a, step))}><ChevronRight className="size-4" /></Button>
        </div>
        <p className="font-display text-lg font-semibold text-ink" aria-live="polite">{label}</p>
        <Tabs value={view} onValueChange={(v) => setView(v as View)} className="ml-auto">
          <TabsList aria-label={t('view')}>
            <TabsTrigger value="agenda">{t('agenda')}</TabsTrigger>
            <TabsTrigger value="week">{t('week')}</TabsTrigger>
            <TabsTrigger value="month">{t('month')}</TabsTrigger>
          </TabsList>
          <TabsContent value="agenda" />
          <TabsContent value="week" />
          <TabsContent value="month" />
        </Tabs>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" className="size-4 accent-gold-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          {t('mineOnly')}
        </label>
      </div>

      <DataState q={q} empty={{ title: t('emptyTitle') }} isEmpty={() => false}>
        {(d) => (
          <div className="space-y-6">
            {d.overdue.length > 0 && (
              <Panel title={t('overdue')} description={t('overdueHint')} accent="red" headingLevel={2}>
                {list(d.overdue)}
              </Panel>
            )}
            {view === 'agenda' && (
              <div className="stagger space-y-4">
                {d.days.length === 0 ? <p className="text-sm text-muted">{t('nothingScheduled')}</p> : d.days.map((day) => (
                  <Panel key={day.date} title={f.day(`${day.date}T06:30:00Z`)} description={t('count', { count: day.count })} headingLevel={3}>{list(day.tasks)}</Panel>
                ))}
              </div>
            )}
            {view === 'week' && (
              <div className="stagger grid gap-3 md:grid-cols-7">
                {Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((date) => (
                  <section key={date} aria-label={date} className={cn('hover-lift min-w-0 rounded-lg border bg-surface p-3 transition-shadow duration-200 hover:shadow-sm', date === today ? 'glow-gold border-gold-500' : 'border-line')}>
                    <h3 className="mb-2 text-sm font-semibold text-ink">{f.day(`${date}T06:30:00Z`)}</h3>
                    {dayTasks(date).length ? <ul className="space-y-2 text-xs">{dayTasks(date).map((x) => (<li key={x.id} className="break-words"><span className="font-medium">{f.time(x.dueAt)}</span> {x.title}</li>))}</ul> : <p className="text-xs text-muted">—</p>}
                  </section>
                ))}
              </div>
            )}
            {view === 'month' && (
              <>
                <div className="stagger-fast grid grid-cols-7 gap-1" role="group" aria-label={label}>
                  {Array.from({ length: 42 }, (_, i) => addDays(start, i)).map((date) => {
                    const n = byDay.get(date)?.count ?? 0;
                    const inMonth = date.slice(0, 7) === anchor.slice(0, 7);
                    return (
                      <button
                        key={date}
                        type="button"
                        aria-label={`${date}: ${t('count', { count: n })}`}
                        aria-pressed={selected === date}
                        onClick={() => setSelected(date)}
                        className={cn('flex min-h-14 flex-col items-center justify-center rounded-md border text-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-gold-300 hover:shadow-sm motion-reduce:transform-none motion-reduce:transition-none', inMonth ? 'bg-surface' : 'bg-ivory-100 text-ink-600', date === today ? 'glow-gold border-gold-500' : 'border-line', selected === date && 'ring-2 ring-blue-600')}
                      >
                        <span>{Number(date.slice(8))}</span>
                        {n > 0 && <span className="tabular rounded-full bg-inverse px-1.5 text-[0.6875rem] text-on-inverse">{n}</span>}
                      </button>
                    );
                  })}
                </div>
                {selected && (
                  <Panel title={f.day(`${selected}T06:30:00Z`)} headingLevel={3}>
                    {dayTasks(selected).length ? list(dayTasks(selected)) : <p className="text-sm text-muted">{t('nothingScheduled')}</p>}
                  </Panel>
                )}
              </>
            )}
          </div>
        )}
      </DataState>
      {editing && <EditTaskDialog open onOpenChange={(o) => !o && setEditing(null)} task={editing} />}
      {log && <DispositionDialog open onOpenChange={(o) => !o && setLog(null)} lead={log.lead} taskId={log.taskId} />}
    </>
  );
}

