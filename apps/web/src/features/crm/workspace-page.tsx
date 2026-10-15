'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CalendarClock, ClipboardPlus, Pin, UserPlus } from 'lucide-react';
import { Alert, Button, Panel, Stat, StatusBadge, useToast } from '@salesos/ui';
import { PageHeader, StaggerList } from './motion';
import { RequirePermission } from '@/features/auth/require-permission';
import { Can } from '@/features/auth/auth-provider';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useCompleteTask, useWorkspace, type Lead, type WorkspaceTask } from '@/lib/api/hooks/crm';
import { CallButton, CrmFrame, DataState, LeadCard, useCrmFormat } from './common';
import { DispositionDialog } from './disposition-dialog';
import { CreateLeadDialog, TaskDialog } from './lead-dialogs';

type LogTarget = { lead: { id: string; fullName: string; phone?: string | null }; taskId?: string };

export function WorkspacePage() {
  return (
    <RequirePermission permission="leads:view">
      <CrmFrame>
        <WorkspaceInner />
      </CrmFrame>
    </RequirePermission>
  );
}

function WorkspaceInner() {
  const t = useTranslations('crm.workspace');
  const q = useWorkspace();
  const [log, setLog] = React.useState<LogTarget | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [taskOpen, setTaskOpen] = React.useState(false);
  const openLog = (target: LogTarget) => setLog(target);

  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={
          <>
            <Can permission="leads:create">
              <Button leadingIcon={<UserPlus className="size-4" aria-hidden="true" />} onClick={() => setCreateOpen(true)}>{t('newLead')}</Button>
            </Can>
            <Can permission="tasks:create">
              <Button variant="secondary" leadingIcon={<ClipboardPlus className="size-4" aria-hidden="true" />} onClick={() => setTaskOpen(true)}>{t('newTask')}</Button>
            </Can>
          </>
        }
      />

      <DataState q={q} empty={{ title: t('emptyTitle'), description: t('emptyDescription') }} isEmpty={(d) => !d.priorityLeads.length && !d.tasksToday.length && !d.pinnedTasks.length}>
        {(d) => (
          <div className="space-y-6">
            <section aria-label={t('countsLabel')} className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="glow-blue rounded-lg"><Stat label={t('tasksToday')} value={d.counts.tasksToday} accent="blue" /></div>
              <Stat label={t('overdueTasks')} value={d.counts.overdueTasks} accent={d.counts.overdueTasks ? 'red' : 'none'} />
              <div className="glow-gold rounded-lg"><Stat label={t('pinned')} value={d.counts.pinned} accent="gold" /></div>
              <Stat label={t('unattended')} value={d.counts.unattended} accent={d.counts.unattended ? 'red' : 'none'} />
            </section>

            {d.pinnedTasks.length > 0 && (
              <Panel accent="gold" title={t('pinnedTitle')} description={t('pinnedDescription')} headingLevel={2}>
                <TaskList tasks={d.pinnedTasks} onLog={openLog} />
              </Panel>
            )}

            <Panel accent="blue" title={t('todayTitle')} description={t('todayDescription')} headingLevel={2}>
              {d.tasksToday.length ? <TaskList tasks={d.tasksToday} onLog={openLog} /> : <p className="text-sm text-muted">{t('noTasksToday')}</p>}
            </Panel>

            <section aria-labelledby="priority-heading">
              <h2 id="priority-heading" className="mb-3 font-display text-xl font-semibold text-ink">{t('priorityTitle')}</h2>
              {d.priorityLeads.length ? (
                <StaggerList as="div" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {d.priorityLeads.map((l: Lead) => (
                    <LeadCard
                      key={l.id}
                      lead={l}
                      actions={
                        <div className="flex shrink-0 flex-col gap-1.5">
                          <CallButton leadId={l.id} phone={l.phone} name={l.fullName} size="sm" />
                          <Button size="sm" variant="secondary" onClick={() => openLog({ lead: { id: l.id, fullName: l.fullName, phone: l.phone } })}>{t('logCall')}</Button>
                        </div>
                      }
                    />
                  ))}
                </StaggerList>
              ) : (
                <p className="text-sm text-muted">{t('noPriorityLeads')}</p>
              )}
            </section>

            {d.upcomingEvents.length > 0 && (
              <Panel title={t('eventsTitle')} headingLevel={2}>
                <ul className="divide-y divide-line">
                  {d.upcomingEvents.map((e) => (
                    <EventRow key={e.id} e={e} />
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        )}
      </DataState>

      {log && <DispositionDialog open onOpenChange={(o) => !o && setLog(null)} lead={log.lead} taskId={log.taskId} />}
      <CreateLeadDialog open={createOpen} onOpenChange={setCreateOpen} />
      <TaskDialog open={taskOpen} onOpenChange={setTaskOpen} />
    </>
  );
}

function EventRow({ e }: { e: { id: string; title: string; type: string; startsAt: string } }) {
  const f = useCrmFormat();
  const t = useTranslations('crm.common');
  return (
    <li className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <Link href={`/crm/events/${e.id}`} className="font-medium text-ink hover:underline">{e.title}</Link>
      <span className="text-muted">{t(`eventType.${e.type}` as 'eventType.WEBINAR')} · {f.dateTime(e.startsAt)}</span>
    </li>
  );
}

export function TaskList({ tasks, onLog }: { tasks: WorkspaceTask[]; onLog: (t: LogTarget) => void }) {
  const t = useTranslations('crm.workspace');
  const tTask = useTranslations('crm.taskType');
  const f = useCrmFormat();
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const complete = useCompleteTask();
  const [err, setErr] = React.useState<string | null>(null);
  return (
    <>
      {err && <Alert tone="danger" className="mb-3">{err}</Alert>}
      <StaggerList className="" itemClassName="border-t border-line first:border-t-0">
        {tasks.map((task) => {
          const target = task.lead ? { lead: { id: task.lead.id, fullName: task.lead.fullName, phone: task.lead.phone }, taskId: task.id } : null;
          return (
            <div key={task.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between" data-task-id={task.id}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                  {task.isPinned && <Pin className="size-3.5 text-gold-700" aria-label={t('pinnedIcon')} />}
                  <span className="truncate">{task.title}</span>
                  <StatusBadge status={task.overdue ? 'overdue' : 'neutral'}>{task.overdue ? t('overdueLabel', { when: f.relative(task.dueAt) }) : f.time(task.dueAt)}</StatusBadge>
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {tTask(task.type as 'CALL')}
                  {task.lead && (<> · <Link href={`/crm/leads/${task.lead.id}`} className="underline-offset-2 hover:underline">{task.lead.fullName}</Link></>)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {target && <CallButton leadId={task.lead!.id} phone={task.lead?.phone} name={task.lead!.fullName} size="sm" />}
                {target && <Button size="sm" variant="secondary" onClick={() => onLog(target)}>{t('logCall')}</Button>}
                <Button
                  size="sm"
                  variant="ghost"
                  leadingIcon={<CalendarClock className="size-4" aria-hidden="true" />}
                  loading={complete.isPending && complete.variables?.id === task.id}
                  onClick={async () => {
                    setErr(null);
                    try {
                      await complete.mutateAsync({ id: task.id });
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
          );
        })}
      </StaggerList>
    </>
  );
}
