'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { EyeOff, Plus } from 'lucide-react';
import {
  Alert, Badge, Button, DataTable, Dialog, DialogContent, FilterBar, FormField, Input, PageHeader, Pagination, Select, Tabs, TabsContent, TabsList, TabsTrigger, type Column,
} from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useTeamMemberOptions } from '../common/api';
import { QueryState, MutationAlert, toneFor, useFormatDate } from '../hub/shared';
import { COACHING_TOPICS, useCoachingActions, useSessions, useUpdateAction, type ActionStatus, type CoachingAction, type CoachingSession } from './api';
import { HoursCard } from './hours-card';
import { SessionForm } from './session-form';

export function CoachingPage() {
  return (
    <RequirePermission permission="coaching:view">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('coaching');
  const { can } = useAuth();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={
          can('coaching:create') ? (
            <Button leadingIcon={<Plus aria-hidden="true" />} onClick={() => setOpen(true)}>
              {t('record')}
            </Button>
          ) : undefined
        }
      />
      <div className="mb-6 enter-up">
        <HoursCard />
      </div>
      <Tabs defaultValue="sessions">
        <TabsList aria-label={t('title')}>
          <TabsTrigger value="sessions">{t('tabs.sessions')}</TabsTrigger>
          <TabsTrigger value="actions">{t('tabs.actions')}</TabsTrigger>
        </TabsList>
        <TabsContent value="sessions">
          <Sessions />
        </TabsContent>
        <TabsContent value="actions">
          <Actions />
        </TabsContent>
      </Tabs>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t('form.title')} description={t('form.description')} size="lg" closeLabel={t('form.cancel')}>
          {open && <SessionForm onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Sessions() {
  const t = useTranslations('coaching');
  const tc = useTranslations('common');
  const fmt = useFormatDate();
  const apiErr = useApiErrorMessage();
  const people = useTeamMemberOptions();
  const [page, setPage] = React.useState(1);
  const [topic, setTopic] = React.useState('');
  const [participantId, setParticipantId] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [selected, setSelected] = React.useState<CoachingSession | null>(null);
  const q = useSessions({
    page,
    limit: 10,
    topic: topic || undefined,
    participantId: participantId || undefined,
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
  });
  const active = [topic, participantId, from, to].filter(Boolean).length;
  const reset = () => {
    setTopic('');
    setParticipantId('');
    setFrom('');
    setTo('');
    setPage(1);
  };
  const cols: Column<CoachingSession>[] = [
    { id: 'date', header: t('cols.date'), primary: true, cell: (s) => fmt.dateTime(s.sessionDate) },
    { id: 'coach', header: t('cols.coach'), cell: (s) => s.coachName ?? '—' },
    { id: 'participants', header: t('cols.participants'), cell: (s) => s.participants.map((p) => p.name ?? '—').join(', ') },
    {
      id: 'topics',
      header: t('cols.topics'),
      hideOnMobile: true,
      cell: (s) => (
        <span className="flex flex-wrap gap-1">
          {s.topics.map((tp) => (
            <Badge key={tp}>{t(`topics.${tp}` as never)}</Badge>
          ))}
        </span>
      ),
    },
    { id: 'duration', header: t('cols.duration'), cell: (s) => t('minutes', { n: s.durationMin }) },
    {
      id: 'notes',
      header: t('cols.notes'),
      hideOnMobile: true,
      cell: (s) => (s.notesHidden ? <Badge icon={<EyeOff aria-hidden="true" className="size-3.5" />}>{t('notesHiddenShort')}</Badge> : s.notes ? t('notesYes') : t('notesNone')),
    },
  ];
  return (
    <div className="space-y-4">
      <FilterBar activeCount={active} onClear={reset} clearLabel={tc('clearFilters')}>
        <FormField label={t('filters.topic')} className="w-52">
          <Select value={topic} onChange={(e) => { setTopic(e.target.value); setPage(1); }}>
            <option value="">{t('filters.any')}</option>
            {COACHING_TOPICS.map((tp) => (
              <option key={tp} value={tp}>{t(`topics.${tp}` as never)}</option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('filters.participant')} className="w-52">
          <Select value={participantId} onChange={(e) => { setParticipantId(e.target.value); setPage(1); }}>
            <option value="">{t('filters.any')}</option>
            {(people.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('filters.from')} className="w-40">
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
        </FormField>
        <FormField label={t('filters.to')} className="w-40">
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        </FormField>
      </FilterBar>
      <DataTable
        caption={t('title')}
        columns={cols}
        rows={q.data?.items}
        getRowId={(s) => s.id}
        loading={q.isLoading}
        loadingLabel={tc('loading')}
        error={q.isError ? { message: apiErr(q.error).message, onRetry: () => void q.refetch() } : null}
        emptyTitle={active ? t('emptyFiltered') : t('empty')}
        emptyDescription={active ? undefined : t('emptyBody')}
        onRowClick={setSelected}
      />
      {q.data && (q.data.pagination?.hasMore || page > 1) && (
        <Pagination
          page={page}
          hasPrev={page > 1}
          hasNext={Boolean(q.data.pagination?.hasMore)}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => p + 1)}
          labels={{ nav: tc('pagination'), previous: tc('previous'), next: tc('next'), summary: () => '', page: () => '', pageOnly: (p) => tc('paginationPageOnly', { page: p }) }}
        />
      )}
      <Dialog open={Boolean(selected)} onOpenChange={(o) => !o && setSelected(null)}>
        {selected && <SessionDetail s={selected} />}
      </Dialog>
    </div>
  );
}

function SessionDetail({ s }: { s: CoachingSession }) {
  const t = useTranslations('coaching');
  const fmt = useFormatDate();
  return (
    <DialogContent title={t(`kinds.${s.kind}` as never)} description={`${fmt.dateTime(s.sessionDate)} · ${t('minutes', { n: s.durationMin })}`} size="lg" closeLabel={t('form.cancel')}>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted">{t('cols.coach')}</dt>
          <dd className="font-medium text-ink">{s.coachName ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted">{t('cols.participants')}</dt>
          <dd className="font-medium text-ink">{s.participants.map((p) => p.name ?? '—').join(', ')}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted">{t('cols.topics')}</dt>
          <dd className="mt-1 flex flex-wrap gap-1">
            {s.topics.map((tp) => (
              <Badge key={tp}>{t(`topics.${tp}` as never)}</Badge>
            ))}
          </dd>
        </div>
        {s.callRef && (
          <div>
            <dt className="text-muted">{t('form.callRef')}</dt>
            <dd className="font-medium text-ink">{s.callRef}</dd>
          </div>
        )}
      </dl>
      <h3 className="mt-5 mb-1 text-sm font-semibold text-ink">{t('form.notes')}</h3>
      {s.notesHidden ? (
        <Alert tone="info" title={t('notesHiddenTitle')}>
          {t('notesHiddenBody', { visibility: t(`visibility.${s.noteVisibility}` as never) })}
        </Alert>
      ) : s.notes ? (
        <p className="text-sm whitespace-pre-wrap text-ink">{s.notes}</p>
      ) : (
        <p className="text-sm text-muted">{t('notesNone')}</p>
      )}
      <p className="mt-1 text-xs text-muted">{t('visibilityLabel', { visibility: t(`visibility.${s.noteVisibility}` as never) })}</p>
      <h3 className="mt-5 mb-1 text-sm font-semibold text-ink">{t('tabs.actions')}</h3>
      {s.actions.length === 0 ? (
        <p className="text-sm text-muted">{t('actions.none')}</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {s.actions.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium text-ink">{a.title}</span>
                <span className="block text-muted">
                  {a.ownerName ?? '—'} · {t('actions.due')}: {fmt.date(a.dueDate)}
                </span>
              </span>
              <Badge tone={toneFor(a.status)}>{t(`status.${a.status}` as never)}</Badge>
            </li>
          ))}
        </ul>
      )}
    </DialogContent>
  );
}

const MUTABLE: ActionStatus[] = ['OPEN', 'IN_PROGRESS', 'DONE'];

function Actions() {
  const t = useTranslations('coaching');
  const tc = useTranslations('common');
  const fmt = useFormatDate();
  const { user } = useAuth();
  const [status, setStatus] = React.useState('');
  const [page, setPage] = React.useState(1);
  const q = useCoachingActions({ page, limit: 15, status: status || undefined });
  const update = useUpdateAction();
  return (
    <div className="space-y-4">
      <FormField label={t('filters.status')} className="w-52">
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">{t('filters.any')}</option>
          {(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const).map((s) => (
            <option key={s} value={s}>{t(`status.${s}` as never)}</option>
          ))}
        </Select>
      </FormField>
      <MutationAlert error={update.error} />
      <QueryState query={q} isEmpty={(q.data?.items.length ?? 0) === 0} emptyTitle={t('actions.empty')} emptyDescription={t('actions.emptyBody')}>
        <ul className="stagger space-y-2" aria-label={t('tabs.actions')}>
          {(q.data?.items ?? []).map((a: CoachingAction) => {
            const mine = a.ownerId === user?.id;
            return (
              <li key={a.id} className="hover-lift flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{a.title}</p>
                  <p className="text-sm text-muted">
                    {a.ownerName ?? '—'} · {t('actions.due')}: {fmt.date(a.dueDate)}
                  </p>
                </div>
                {mine && MUTABLE.includes(a.status) ? (
                  <FormField label={t('actions.myStatus')} hideLabel className="w-40">
                    <Select value={a.status} disabled={update.isPending} onChange={(e) => update.mutate({ id: a.id, status: e.target.value as ActionStatus })}>
                      {MUTABLE.map((s) => (
                        <option key={s} value={s}>{t(`status.${s}` as never)}</option>
                      ))}
                    </Select>
                  </FormField>
                ) : (
                  <Badge tone={toneFor(a.status)}>{t(`status.${a.status}` as never)}</Badge>
                )}
              </li>
            );
          })}
        </ul>
        {(q.data?.pagination?.hasMore || page > 1) && (
          <Pagination
            className="mt-4"
            page={page}
            hasPrev={page > 1}
            hasNext={Boolean(q.data?.pagination?.hasMore)}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => p + 1)}
            labels={{ nav: tc('pagination'), previous: tc('previous'), next: tc('next'), summary: () => '', page: () => '', pageOnly: (p) => tc('paginationPageOnly', { page: p }) }}
          />
        )}
      </QueryState>
    </div>
  );
}
