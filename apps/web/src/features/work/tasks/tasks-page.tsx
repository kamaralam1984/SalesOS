'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { Badge, Button, FormField, PageHeader, Pagination, Select, Stat, Tabs, TabsContent, TabsList, TabsTrigger } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { QueryState } from '@/features/people/hub/shared';
import { TASK_STATUSES, useTaskSummary, useWorkTasks, type TaskListQuery, type WorkTask } from '@/lib/api/hooks/work-tasks';
import { useWorkDates } from '../common/shared';
import { CreateTaskDialog } from './task-forms';
import { priorityTone, taskStatusTone, taskViews } from './task-logic';

export function TasksPage() {
  return (
    <RequirePermission permission="work-tasks:view">
      <Inner />
    </RequirePermission>
  );
}

const PAGE_SIZE = 10;

function Inner() {
  const t = useTranslations('workTasks');
  const tc = useTranslations('common');
  const router = useRouter();
  const { can } = useAuth();
  const views = taskViews(can);
  const [view, setView] = React.useState<TaskListQuery['view']>('mine');
  const [status, setStatus] = React.useState('');
  const [due, setDue] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [open, setOpen] = React.useState(false);
  const list = useWorkTasks({ view, status: status || undefined, overdue: due === '' ? undefined : due === 'overdue', page, limit: PAGE_SIZE });
  const summary = useTaskSummary();
  const filtered = Boolean(status || due);
  const reset = () => setPage(1);
  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={can('work-tasks:create') ? <Button leadingIcon={<Plus aria-hidden="true" />} onClick={() => setOpen(true)}>{t('new')}</Button> : undefined}
      />
      <section aria-label={t('stats.title')} className="stagger mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('stats.open')} value={summary.data?.mine.open ?? '—'} loading={summary.isLoading} accent="blue" />
        <Stat label={t('stats.overdue')} value={summary.data?.mine.overdue ?? 0} loading={summary.isLoading} accent="red" />
        <Stat label={t('stats.dueSoon')} value={summary.data?.dueSoon ?? 0} loading={summary.isLoading} accent="gold" />
        <Stat label={t('stats.review')} value={summary.data?.awaitingMyReview ?? 0} loading={summary.isLoading} accent="green" />
      </section>
      <Tabs value={view} onValueChange={(v) => { setView(v as TaskListQuery['view']); reset(); }}>
        <TabsList aria-label={t('viewsLabel')}>
          {views.map((v) => <TabsTrigger key={v} value={v}>{t(`views.${v}` as never)}</TabsTrigger>)}
        </TabsList>
      <TabsContent value={view}>
        <div className="my-4 flex flex-wrap gap-3 [&>*]:w-full sm:[&>*]:w-56">
          <FormField label={t('filterStatus')} className="w-56">
            <Select value={status} onChange={(e) => { setStatus(e.target.value); reset(); }}>
              <option value="">{t('any')}</option>
              {TASK_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}` as never)}</option>)}
            </Select>
          </FormField>
          <FormField label={t('filterDue')} className="w-56">
            <Select value={due} onChange={(e) => { setDue(e.target.value); reset(); }}>
              <option value="">{t('any')}</option>
              <option value="overdue">{t('dueFilter.overdue')}</option>
              <option value="notOverdue">{t('dueFilter.notOverdue')}</option>
            </Select>
          </FormField>
        </div>
        <QueryState query={list} isEmpty={(list.data?.items.length ?? 0) === 0} emptyTitle={filtered ? t('emptyFiltered') : t('empty')} emptyDescription={filtered ? undefined : t('emptyBody')}>
          <ul className="stagger-fast space-y-2" aria-label={t('pageSummary')}>
            {(list.data?.items ?? []).map((task) => <TaskRow key={task.id} task={task} showPeople={view !== 'mine'} />)}
          </ul>
          {(list.data?.hasMore || page > 1) && (
            <Pagination
              className="mt-4"
              page={page}
              hasNext={Boolean(list.data?.hasMore)}
              onPageChange={setPage}
              labels={{ nav: tc('pagination'), previous: tc('previous'), next: tc('next'), summary: () => '', page: () => '', pageOnly: (p) => tc('paginationPageOnly', { page: p }) }}
            />
          )}
        </QueryState>
      </TabsContent>
      </Tabs>
      {open && <CreateTaskDialog open={open} onOpenChange={setOpen} onCreated={(id) => router.push(`/work/tasks/${id}`)} />}
    </>
  );
}

function TaskRow({ task: x, showPeople }: { task: WorkTask; showPeople: boolean }) {
  const t = useTranslations('workTasks');
  const d = useWorkDates();
  return (
    <li>
      <Link href={`/work/tasks/${x.id}`} className="hover-lift block rounded-lg border border-line bg-surface p-3.5 hover:border-gold-300 focus-visible:outline-2 focus-visible:outline-focus">
        <span className="flex flex-wrap items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block font-medium text-ink">{x.title}</span>
            <span className="text-sm text-muted">
              {showPeople ? `${x.assigneeName ?? '—'} · ` : ''}
              {x.dueAt ? t('due', { date: d.dateTime(x.dueAt) }) : t('noDue')}
              {x.goalTitle ? ` · ${t('linkedGoal', { title: x.goalTitle })}` : ''}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-2">
            {x.overdue && <Badge tone="red">{t('overdue')}</Badge>}
            <Badge tone={priorityTone(x.priority)}>{t(`priority.${x.priority}` as never)}</Badge>
            <Badge tone={taskStatusTone(x.status)}>{t(`status.${x.status}` as never)}</Badge>
          </span>
        </span>
      </Link>
    </li>
  );
}
