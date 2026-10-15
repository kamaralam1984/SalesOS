'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Activity, ArrowRightLeft, CalendarPlus, ClipboardPlus, FileText, GitMerge, MessageSquare, Pencil, PhoneCall, Repeat, StickyNote, UserCog } from 'lucide-react';
import { Alert, Badge, Button, Panel, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, Timeline, useToast, type TimelineItem } from '@salesos/ui';
import { RequirePermission } from '@/features/auth/require-permission';
import { Can } from '@/features/auth/auth-provider';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useAddNote, useCompleteTask, useLead, useLinkEvent, useTimeline, type LeadDetail } from '@/lib/api/hooks/crm';
import { NEXT_ATTENDANCE, useEvents, type AttendanceStatus } from '@/lib/api/hooks/crm-admin';
import { CallButton, CrmFrame, DataState, DueBadge, InterestBadge, StageBadge, useCrmFormat } from './common';
import { DispositionDialog } from './disposition-dialog';
import { AssignDialog, EditLeadDialog, EditTaskDialog, StatusDialog, TaskDialog } from './lead-dialogs';
import { humanize, money } from './lib';
import { Reveal, StaggerList } from './motion';
import { Hint } from '@/features/hints/hint-views';

export function LeadDetailPage({ id }: { id: string }) {
  return (
    <RequirePermission permission="leads:view">
      <CrmFrame>
        <DetailInner id={id} />
      </CrmFrame>
    </RequirePermission>
  );
}

type Dlg = 'call' | 'status' | 'assign' | 'task' | 'edit' | null;

function DetailInner({ id }: { id: string }) {
  const t = useTranslations('crm.detail');
  const q = useLead(id);
  const [dlg, setDlg] = React.useState<Dlg>(null);
  const [taskId, setTaskId] = React.useState<string | undefined>();
  const openCall = (tid?: string) => {
    setTaskId(tid);
    setDlg('call');
  };
  return (
    <DataState q={q} empty={{ title: t('notFound') }}>
      {(lead) =>
        lead.summary ? (
          <SummaryView lead={lead} />
        ) : (
          <>
            <Header lead={lead} openCall={() => openCall()} setDlg={setDlg} />
            <Reveal delay={0.08}>
              <Body lead={lead} openCall={openCall} setDlg={setDlg} />
            </Reveal>
            {/* one-hand FAB: thumb zone, phones only; the header action is hidden by the layout below md */}
            <Button
              size="lg"
              className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 rounded-full shadow-lg glow-gold glow-pulse md:hidden"
              leadingIcon={<PhoneCall className="size-5" aria-hidden="true" />}
              onClick={() => openCall()}
              data-testid="fab-log-call"
            >
              {t('logCall')}
            </Button>
            {dlg === 'call' && <DispositionDialog open onOpenChange={(o) => !o && setDlg(null)} lead={{ id: lead.id, fullName: lead.fullName, phone: lead.phone }} taskId={taskId} />}
            {dlg === 'status' && <StatusDialog open onOpenChange={(o) => !o && setDlg(null)} lead={lead} />}
            {dlg === 'assign' && <AssignDialog open onOpenChange={(o) => !o && setDlg(null)} lead={lead} />}
            {dlg === 'edit' && <EditLeadDialog open onOpenChange={(o) => !o && setDlg(null)} lead={lead} />}
            {dlg === 'task' && <TaskDialog open onOpenChange={(o) => !o && setDlg(null)} leadId={lead.id} leadName={lead.fullName} />}
          </>
        )
      }
    </DataState>
  );
}

function SummaryView({ lead }: { lead: LeadDetail }) {
  const t = useTranslations('crm.detail');
  return (
    <Panel title={lead.fullName} description={t('summaryOnly')}>
      <div className="flex flex-wrap gap-2">
        <StageBadge lead={lead} />
        {lead.source?.name && <Badge>{lead.source.name}</Badge>}
        {lead.program?.name && <Badge tone="gold">{lead.program.name}</Badge>}
      </div>
    </Panel>
  );
}

function Header({ lead, openCall, setDlg }: { lead: LeadDetail; openCall: () => void; setDlg: (d: Dlg) => void }) {
  const t = useTranslations('crm.detail');
  const stages = lead.stages.filter((s) => s.category === 'OPEN').sort((a, b) => a.sortOrder - b.sortOrder);
  const current = stages.findIndex((s) => s.key === lead.status);
  return (
    <header className="enter-up mb-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-[0.14em] text-gold-700 uppercase">{t('eyebrow')}</p>
          <span aria-hidden="true" className="accent-line mb-2 block h-0.5 w-12" />
          <h1 className="font-display text-[1.75rem] leading-tight break-words font-semibold text-ink md:text-[2.125rem]">{lead.fullName}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <StageBadge lead={lead} />
            <InterestBadge level={lead.interestLevel} />
            {lead.isKeyProspect && <Badge tone="gold">{t('keyProspect')}</Badge>}
            {lead.duplicateFlag && (
              <Link href="/crm/duplicates" className="inline-flex"><Badge tone="red" icon={<GitMerge />}>{t('duplicateFlag', { count: lead.openDuplicateCount })}</Badge></Link>
            )}
            {lead.phoneValid === false && <Badge tone="red">{t('phoneUnverified')}</Badge>}
            <Badge>{t('consent', { status: humanize(lead.consent?.status ?? 'UNKNOWN') })}</Badge>
          </div>
          <p className="mt-2 text-sm break-all text-muted">
            {lead.phone ?? t('noPhone')} {lead.email ? `· ${lead.email}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CallButton leadId={lead.id} phone={lead.phone} name={lead.fullName} size="lg" />
          <Can permission="calls:create">
            <Button size="lg" variant="secondary" className="hidden md:inline-flex" leadingIcon={<PhoneCall className="size-4" aria-hidden="true" />} onClick={openCall}>{t('logCall')}</Button>
          </Can>
        </div>
      </div>
      {stages.length > 0 && (
        <ol tabIndex={0} aria-label={t('stepper')} className="mt-4 flex gap-1.5 overflow-x-auto px-0.5 pt-0.5 pb-1.5 [scrollbar-width:none]">
          {stages.map((s, i) => (
            <li
              key={s.key}
              aria-current={s.key === lead.status ? 'step' : undefined}
              className={`inline-flex min-h-8 shrink-0 items-center rounded-full border px-3 text-xs font-medium ${s.key === lead.status ? 'border-gold-500 bg-gold-50 text-ink shadow-[var(--tone-glow-gold)]' : i < current ? 'border-line bg-ivory-200 text-ink-600' : 'border-line bg-surface text-ink-500'}`}
            >
              {s.label}
            </li>
          ))}
        </ol>
      )}
      <div className="mt-4 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap [scrollbar-width:none] [&>*]:shrink-0">
        <Can permission="leads:status:change">
          <Button size="sm" variant="secondary" leadingIcon={<ArrowRightLeft className="size-4" aria-hidden="true" />} onClick={() => setDlg('status')}>{t('changeStatus')}</Button>
        </Can>
        <Can permission="leads:assign">
          <Button size="sm" variant="secondary" leadingIcon={<UserCog className="size-4" aria-hidden="true" />} onClick={() => setDlg('assign')}>{lead.assignedTo ? t('reassign') : t('assign')}</Button>
        </Can>
        <Can permission="tasks:create">
          <Button size="sm" variant="secondary" leadingIcon={<ClipboardPlus className="size-4" aria-hidden="true" />} onClick={() => setDlg('task')}>{t('addTask')}</Button>
        </Can>
        <Can permission="leads:update">
          <Button size="sm" variant="secondary" leadingIcon={<Pencil className="size-4" aria-hidden="true" />} onClick={() => setDlg('edit')}>{t('editDetails')}</Button>
        </Can>
      </div>
    </header>
  );
}

function Body({ lead, openCall, setDlg }: { lead: LeadDetail; openCall: (taskId?: string) => void; setDlg: (d: Dlg) => void }) {
  const t = useTranslations('crm.detail');
  void setDlg;
  return (
    <Tabs defaultValue="overview">
      <TabsList aria-label={t('tabs')} className="mb-4 max-w-full overflow-x-auto">
        <TabsTrigger value="overview">{t('tabOverview')}</TabsTrigger>
        <TabsTrigger value="timeline">{t('tabTimeline')}</TabsTrigger>
        <TabsTrigger value="calls">{t('tabCalls')}</TabsTrigger>
        <TabsTrigger value="tasks">{t('tabTasks')}</TabsTrigger>
        <TabsTrigger value="events">{t('tabEvents')}</TabsTrigger>
      </TabsList>
      <TabsContent value="overview"><Overview lead={lead} /></TabsContent>
      <TabsContent value="timeline"><TimelineTab id={lead.id} canNote={true} /></TabsContent>
      <TabsContent value="calls"><CallsTab lead={lead} /></TabsContent>
      <TabsContent value="tasks"><TasksTab lead={lead} openCall={openCall} /></TabsContent>
      <TabsContent value="events"><EventsTab lead={lead} /></TabsContent>
    </Tabs>
  );
}

function Fact({ label, children, info }: { label: string; children: React.ReactNode; info?: React.ReactNode }) {
  return (
    <div>
      <dt className="flex items-center gap-1 text-xs text-muted">
        {label}
        {info}
      </dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}

function Overview({ lead }: { lead: LeadDetail }) {
  const t = useTranslations('crm.detail');
  const tObj = useTranslations('crm.objection');
  const f = useCrmFormat();
  return (
    <div className="stagger grid gap-4 lg:grid-cols-3">
      <Panel accent="gold" title={t('keyFacts')} className="lg:col-span-2">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3">
          <Fact label={t('owner')} info={<Hint id="leadOwnerNextAction" />}>{lead.assignedTo?.name ?? <span className="font-medium text-red-700">{t('unassigned')}</span>}</Fact>
          <Fact label={t('nextAction')}><DueBadge iso={lead.nextActionAt} /></Fact>
          <Fact label={t('lastContact')}>{lead.lastContactAt ? f.dateTime(lead.lastContactAt) : t('never')}</Fact>
          <Fact label={t('lastObjection')}>{lead.lastCall?.objectionCategory ? tObj(lead.lastCall.objectionCategory as 'PRICE') : '—'}</Fact>
          <Fact label={t('program')}>{lead.program?.name ?? '—'}</Fact>
          <Fact label={t('source')}>{lead.source?.name ?? '—'}</Fact>
          <Fact label={t('estimatedValue')}>{money(lead.estimatedValue, lead.currency)}</Fact>
          <Fact label={t('ageing')}>{t('ageingValue', { created: lead.ageing?.sinceCreationDays ?? 0, activity: lead.ageing?.sinceActivityDays ?? 0 })}</Fact>
          <Fact label={t('attempts')}>{lead.callAttemptCount ?? 0}</Fact>
          {lead.stageCategory === 'LOST' && <Fact label={t('lostReason')}>{lead.lostReason ? humanize(lead.lostReason) : '—'}{lead.lostNote ? ` — ${lead.lostNote}` : ''}</Fact>}
          {lead.stageCategory === 'WON' && <Fact label={t('wonValue')}>{money(lead.wonValue, lead.currency)}</Fact>}
        </dl>
        {lead.exceptions && lead.exceptions.length > 0 && (
          <Alert tone="warning" className="mt-4" title={t('exceptionTitle')}>{lead.exceptions.map(humanize).join(', ')}</Alert>
        )}
      </Panel>
      <Panel accent="blue" title={t('ownership')}>
        {lead.assignments.length ? (
          <ol className="space-y-3 text-sm">
            {lead.assignments.map((a) => (
              <li key={a.id}>
                <p className="font-medium text-ink">{a.from?.name ? `${a.from.name} → ${a.to?.name ?? '—'}` : (a.to?.name ?? '—')}</p>
                <p className="text-xs text-muted">{f.dateTime(a.at)} · {humanize(a.method)}{a.changedBy?.name ? ` · ${a.changedBy.name}` : ''}</p>
                {a.reason && <p className="text-xs text-ink-600">{a.reason}</p>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted">{t('noAssignments')}</p>
        )}
      </Panel>
    </div>
  );
}

const ICONS: Record<string, React.ReactNode> = {
  call: <PhoneCall />, note: <StickyNote />, task: <ClipboardPlus />, status: <Activity />, assignment: <Repeat />, attendance: <CalendarPlus />, merge: <GitMerge />,
};

function TimelineTab({ id, canNote }: { id: string; canNote: boolean }) {
  const t = useTranslations('crm.detail');
  const f = useCrmFormat();
  const tl = useTimeline(id);
  const addNote = useAddNote();
  const { toast } = useToast();
  const apiErr = useApiErrorMessage();
  const [note, setNote] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const items: TimelineItem[] = (tl.data?.pages.flatMap((p) => p.items) ?? []).map((e, i) => ({
    id: `${e.type}-${e.at}-${i}`,
    title: (
      <>
        {e.title}
        {e.type === 'call' && <Badge className="ml-2" tone="neutral">{String(e.data.label ?? 'MANUAL')}</Badge>}
      </>
    ),
    description: e.detail ?? undefined,
    time: f.dateTime(e.at),
    dateTime: e.at,
    icon: ICONS[e.type] ?? <FileText />,
    tone: e.type === 'call' ? 'gold' : e.type === 'status' ? 'blue' : 'neutral',
    meta: e.actorName ? <span className="text-xs text-muted">{e.actorName}</span> : undefined,
  }));
  return (
    <div className="space-y-5">
      {canNote && (
        <Can permission="leads:notes:create">
          <form
            className="space-y-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!note.trim()) return;
              setErr(null);
              try {
                await addNote.mutateAsync({ leadId: id, body: note.trim() });
                setNote('');
                toast({ tone: 'success', title: t('noteAdded') });
              } catch (er) {
                setErr(apiErr(er).message);
              }
            }}
          >
            <label htmlFor="quick-note" className="text-sm font-medium text-ink">{t('quickNote')}</label>
            <Textarea id="quick-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('notePlaceholder')} />
            {err && <Alert tone="danger">{err}</Alert>}
            <Button type="submit" size="sm" variant="secondary" loading={addNote.isPending} leadingIcon={<MessageSquare className="size-4" aria-hidden="true" />} disabled={!note.trim()}>{t('addNote')}</Button>
          </form>
        </Can>
      )}
      <DataState q={tl} isEmpty={(d) => d.pages[0]?.items.length === 0} empty={{ title: t('timelineEmpty') }}>
        {() => (
          <>
            <Timeline items={items} label={t('tabTimeline')} />
            {tl.hasNextPage && (
              <Button variant="secondary" loading={tl.isFetchingNextPage} onClick={() => void tl.fetchNextPage()}>{t('loadMore')}</Button>
            )}
          </>
        )}
      </DataState>
    </div>
  );
}

function CallsTab({ lead }: { lead: LeadDetail }) {
  const t = useTranslations('crm.detail');
  const tOut = useTranslations('crm.outcome');
  const tObj = useTranslations('crm.objection');
  const f = useCrmFormat();
  if (!lead.recentCalls.length) return <p className="text-sm text-muted">{t('noCalls')}</p>;
  return (
    <StaggerList className="divide-y divide-line rounded-lg border border-line bg-surface">
      {lead.recentCalls.map((c) => (
        <div key={c.id} className="space-y-1 p-4 text-sm break-words">
          <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
            {tOut(c.outcome as 'CONNECTED')}
            <Badge tone="neutral">{c.source === 'MANUAL' ? 'MANUAL' : c.source}</Badge>
            <span className="text-xs font-normal text-muted">{f.dateTime(c.startedAt)}{c.userName ? ` · ${c.userName}` : ''}</span>
          </p>
          <p className="text-xs text-muted">{c.interestLevel ? t('interestIs', { level: humanize(c.interestLevel) }) : ''} {c.objectionCategory ? `· ${tObj(c.objectionCategory as 'PRICE')}` : ''}</p>
          {c.notes && <p className="text-ink-700">{c.notes}</p>}
        </div>
      ))}
    </StaggerList>
  );
}

function TasksTab({ lead, openCall }: { lead: LeadDetail; openCall: (taskId?: string) => void }) {
  const t = useTranslations('crm.detail');
  const tTask = useTranslations('crm.taskType');
  const f = useCrmFormat();
  const complete = useCompleteTask();
  const { toast } = useToast();
  const apiErr = useApiErrorMessage();
  const [err, setErr] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<LeadDetail['openTasks'][number] | null>(null);
  if (!lead.openTasks.length) return <p className="text-sm text-muted">{t('noTasks')}</p>;
  return (
    <>
      {err && <Alert tone="danger" className="mb-3">{err}</Alert>}
      <StaggerList className="divide-y divide-line rounded-lg border border-line bg-surface">
        {lead.openTasks.map((x) => (
          <div key={x.id} className="flex flex-col gap-3 p-4 text-sm sm:flex-row sm:items-center sm:justify-between" data-task-id={x.id}>
            <div>
              <p className="font-medium text-ink">{x.title}</p>
              <p className="text-xs text-muted">{tTask(x.type as 'CALL')} · {x.assignedToName ?? '—'} · {f.dateTime(x.dueAt)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <DueBadge iso={x.dueAt} />
              <Can permission="tasks:update">
                <Button size="sm" variant="ghost" leadingIcon={<Pencil className="size-4" aria-hidden="true" />} onClick={() => setEditing(x)}>{t('editTask')}</Button>
              </Can>
              <Button size="sm" variant="secondary" onClick={() => openCall(x.id)}>{t('logCall')}</Button>
              <Button
                size="sm"
                variant="ghost"
                loading={complete.isPending && complete.variables?.id === x.id}
                onClick={async () => {
                  setErr(null);
                  try {
                    await complete.mutateAsync({ id: x.id });
                    toast({ tone: 'success', title: t('taskDone') });
                  } catch (e) {
                    setErr(apiErr(e).message);
                  }
                }}
              >
                {t('markDone')}
              </Button>
            </div>
          </div>
        ))}
      </StaggerList>
      {editing && <EditTaskDialog open onOpenChange={(o) => !o && setEditing(null)} task={{ id: editing.id, title: editing.title, dueAt: editing.dueAt, priority: editing.priority, version: editing.version ?? 0, description: editing.description }} />}
    </>
  );
}

function EventsTab({ lead }: { lead: LeadDetail }) {
  const t = useTranslations('crm.detail');
  const tc = useTranslations('crm.common');
  const f = useCrmFormat();
  const events = useEvents({ upcoming: true });
  const link = useLinkEvent();
  const { toast } = useToast();
  const apiErr = useApiErrorMessage();
  const [err, setErr] = React.useState<string | null>(null);
  const [warn, setWarn] = React.useState<string[]>([]);
  const act = async (eventId: string, status: AttendanceStatus) => {
    setErr(null);
    setWarn([]);
    try {
      const r = await link.mutateAsync({ leadId: lead.id, eventId, status, reason: status === 'CANCELLED' ? 'Cancelled by executive' : undefined });
      setWarn(r.warnings);
      toast({ tone: 'success', title: t('attendanceUpdated') });
    } catch (e) {
      setErr(apiErr(e).message);
    }
  };
  const mine = new Set(lead.attendances.map((a) => a.event.id));
  return (
    <div className="space-y-4">
      {err && <Alert tone="danger">{err}</Alert>}
      {warn.map((w) => (<Alert key={w} tone="warning">{w}</Alert>))}
      <Panel title={t('attendance')}>
        {lead.attendances.length ? (
          <ul className="divide-y divide-line">
            {lead.attendances.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <div>
                  <p className="font-medium text-ink">{a.event.title}</p>
                  <p className="text-xs text-muted">{tc(`eventType.${a.event.type}` as 'eventType.WEBINAR')} · {f.dateTime(a.event.startsAt)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={a.status === 'ATTENDED' ? 'green' : 'neutral'}>{humanize(a.status)}</Badge>
                  {NEXT_ATTENDANCE[a.status as AttendanceStatus]?.filter((s) => s !== 'RESCHEDULED').map((s) => (
                    <Button key={s} size="sm" variant="secondary" onClick={() => void act(a.event.id, s)}>{t(`mark${s}` as 'markATTENDED')}</Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{t('noAttendance')}</p>
        )}
      </Panel>
      <Can permission="events:view">
        <Panel title={t('registerFor')}>
          <DataState q={events} isEmpty={(d) => d.filter((e) => !mine.has(e.id)).length === 0} empty={{ title: t('noUpcoming') }}>
            {(list) => (
              <ul className="divide-y divide-line">
                {list.filter((e) => !mine.has(e.id)).map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                    <span><span className="font-medium text-ink">{e.title}</span> <span className="text-muted">· {tc(`eventType.${e.type}` as 'eventType.WEBINAR')} · {f.dateTime(e.startsAt)}</span></span>
                    <Button size="sm" onClick={() => void act(e.id, 'REGISTERED')}>{t('register')}</Button>
                  </li>
                ))}
              </ul>
            )}
          </DataState>
        </Panel>
      </Can>
    </div>
  );
}
