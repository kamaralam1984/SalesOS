'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, LogIn, LogOut } from 'lucide-react';
import { Alert, Badge, Button, FormField, Input, PageHeader, Pagination, Panel, Select, Stat, Tabs, TabsContent, TabsList, TabsTrigger, useToast } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { MutationAlert, QueryState } from '@/features/people/hub/shared';
import { useTeamMemberOptions } from '@/features/people/common/api';
import {
  useAttendanceCorrections, useAttendanceMonth, useAttendanceToday, useCheckIn, useCheckOut, useTeamAttendanceSummary,
  type AttendanceDay, type AttendanceStatus,
} from '@/lib/api/hooks/work-attendance';
import { currentMonth, emptyDayReason, formatMinutes, shiftMonth, statusTone, today } from './attendance-logic';
import { CorrectAttendanceDialog } from './correct-dialog';
import { useWhen } from './format';

export function AttendancePage() {
  return (
    <RequirePermission permission="attendance:self">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('workAttendance');
  const { can } = useAuth();
  const people = can('attendance:view', 'team');
  const [tab, setTab] = React.useState('mine');
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <TodayCard />
      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <TabsList aria-label={t('tabs.label')}>
          <TabsTrigger value="mine">{t('tabs.mine')}</TabsTrigger>
          {people && <TabsTrigger value="people">{t('tabs.people')}</TabsTrigger>}
          <TabsTrigger value="corrections">{t('tabs.corrections')}</TabsTrigger>
        </TabsList>
        <TabsContent value="mine"><MonthView /></TabsContent>
        {people && <TabsContent value="people"><PeopleView /></TabsContent>}
        <TabsContent value="corrections"><CorrectionsView canPickPerson={people} /></TabsContent>
      </Tabs>
    </>
  );
}

/* ------------------------------------------------------------------ today */
function TodayCard() {
  const t = useTranslations('workAttendance');
  const w = useWhen();
  const { toast } = useToast();
  const q = useAttendanceToday();
  const checkIn = useCheckIn();
  const checkOut = useCheckOut();
  const [needsReview, setNeedsReview] = React.useState(false);
  return (
    <Panel title={t('today.title')} description={q.data ? w.day(q.data.date) : undefined} aria-live="polite">
      <QueryState query={q} isEmpty={!q.data} emptyTitle={t('today.title')}>
        {q.data && (() => {
          const d = q.data;
          const rec = d.record;
          return (
            <div className="space-y-4">
              {d.dayKind === 'HOLIDAY' && <Alert tone="info">{t('today.holiday', { name: d.holiday?.name ?? '' })}</Alert>}
              {d.dayKind === 'WEEKLY_OFF' && <Alert tone="info">{t('today.weeklyOff')}</Alert>}
              {!d.policy.selfCheckIn && <Alert tone="warning">{t('today.selfDisabled')}</Alert>}
              {rec ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Badge tone={statusTone(rec.status)}>{t(`status.${rec.status}` as never)}</Badge>
                  <span className="text-sm text-ink">
                    {rec.checkInAt ? t('today.checkedIn', { time: w.time(rec.checkInAt) }) : t('today.noTimes')}
                    {rec.checkOutAt ? ` · ${t('today.checkedOut', { time: w.time(rec.checkOutAt) })} · ${t('today.worked', { duration: formatMinutes(rec.workMinutes) })}` : ''}
                  </span>
                </div>
              ) : (
                d.dayKind === 'WORKING' && <p className="text-sm text-muted">{t('today.notCheckedIn', { time: d.policy.lateAfter })}</p>
              )}
              {needsReview && <Alert tone="warning">{t('today.needsReview')}</Alert>}
              <div className="flex flex-wrap gap-2">
                {d.can.checkIn && (
                  <>
                    <Button
                      leadingIcon={<LogIn aria-hidden="true" />}
                      loading={checkIn.isPending}
                      onClick={() => checkIn.mutate({ mode: 'OFFICE' }, { onSuccess: () => toast({ tone: 'success', title: t('today.checkedInToast') }) })}
                    >
                      {t('today.checkInOffice')}
                    </Button>
                    <Button variant="secondary" loading={checkIn.isPending} onClick={() => checkIn.mutate({ mode: 'WFH' }, { onSuccess: () => toast({ tone: 'success', title: t('today.checkedInToast') }) })}>
                      {t('today.checkInWfh')}
                    </Button>
                  </>
                )}
                {d.can.checkOut && (
                  <Button
                    variant="secondary"
                    leadingIcon={<LogOut aria-hidden="true" />}
                    loading={checkOut.isPending}
                    onClick={() => checkOut.mutate(undefined, { onSuccess: (r) => { setNeedsReview(Boolean(r.needsReview)); toast({ tone: 'success', title: t('today.checkedOutToast') }); } })}
                  >
                    {t('today.checkOut')}
                  </Button>
                )}
              </div>
              <MutationAlert error={checkIn.error ?? checkOut.error} />
            </div>
          );
        })()}
      </QueryState>
    </Panel>
  );
}

/* ------------------------------------------------------------------ month */
function MonthView({ userId, canCorrect }: { userId?: string; canCorrect?: boolean }) {
  const t = useTranslations('workAttendance');
  const w = useWhen();
  const [month, setMonth] = React.useState(currentMonth());
  const [fix, setFix] = React.useState<AttendanceDay | null>(null);
  const q = useAttendanceMonth(userId, month);
  const todayDay = today();
  const s = q.data?.summary;
  return (
    <div className="enter-up mt-4 space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Button variant="ghost" size="sm" aria-label={t('month.previous')} onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft aria-hidden="true" /></Button>
        <FormField label={t('month.label')} className="w-48"><Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></FormField>
        <Button variant="ghost" size="sm" aria-label={t('month.next')} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight aria-hidden="true" /></Button>
      </div>
      <section aria-label={t('month.summary')} className="stagger grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label={t('month.workingDays')} value={q.data?.workingDays ?? '—'} loading={q.isLoading} accent="blue" />
        <Stat label={t('status.PRESENT')} value={s ? s.PRESENT + s.WFH + s.LATE : '—'} loading={q.isLoading} accent="green" />
        <Stat label={t('status.HALF_DAY')} value={s?.HALF_DAY ?? '—'} loading={q.isLoading} accent="gold" />
        <Stat label={t('status.ABSENT')} value={s?.ABSENT ?? '—'} loading={q.isLoading} accent="red" />
        <Stat label={t('month.leaveDays')} value={s ? s.ON_LEAVE + s.UNPAID_LEAVE : '—'} loading={q.isLoading} accent="none" />
      </section>
      <QueryState query={q} isEmpty={(q.data?.days.length ?? 0) === 0} emptyTitle={t('month.empty')}>
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface" aria-label={t('month.days')}>
          {(q.data?.days ?? []).map((d) => {
            const rec = d.record;
            const reason = emptyDayReason(d.date, todayDay);
            return (
              <li key={d.date} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
                <span className="min-w-36">
                  <span className="font-medium text-ink">{w.day(d.date)}</span> <span className="text-sm text-muted">{w.weekday(d.date)}</span>
                  {d.dayKind !== 'WORKING' && <span className="block text-sm text-muted">{d.holiday ?? t(`dayKind.${d.dayKind}` as never)}</span>}
                </span>
                <span className="flex flex-1 flex-wrap items-center gap-2">
                  {rec ? (
                    <>
                      <Badge tone={statusTone(rec.status as AttendanceStatus)}>{t(`status.${rec.status}` as never)}</Badge>
                      <span className="text-sm text-muted">
                        {rec.checkInAt ? `${w.time(rec.checkInAt)} – ${rec.checkOutAt ? w.time(rec.checkOutAt) : '…'}` : ''}
                        {rec.workMinutes != null ? ` · ${formatMinutes(rec.workMinutes)}` : ''}
                        {` · ${t(`source.${rec.source}` as never)}`}
                      </span>
                    </>
                  ) : (
                    d.dayKind === 'WORKING' && <span className="text-sm text-muted">{t(`month.noRecord.${reason}` as never)}</span>
                  )}
                  {d.leave && <Badge tone="blue">{t('month.leaveBadge', { status: t(`leaveStatus.${d.leave.status}` as never) })}</Badge>}
                </span>
                {canCorrect && d.date <= todayDay && (
                  <Button size="sm" variant="ghost" onClick={() => setFix(d)}>{t('correct.open')}</Button>
                )}
              </li>
            );
          })}
        </ul>
      </QueryState>
      {fix && userId && q.data && <CorrectAttendanceDialog userId={userId} userName={q.data.userName} day={fix} open onOpenChange={(o) => !o && setFix(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ people / team */
function PeopleView() {
  const t = useTranslations('workAttendance');
  const w = useWhen();
  const { can, user } = useAuth();
  const options = useTeamMemberOptions(true);
  const [userId, setUserId] = React.useState('');
  const [date, setDate] = React.useState(today());
  const summary = useTeamAttendanceSummary(date);
  const s = summary.data;
  return (
    <div className="mt-4 space-y-5">
      <Panel title={t('people.summaryTitle')} description={s ? w.day(s.date) : undefined}>
        <FormField label={t('people.date')} className="mb-4 w-48"><Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></FormField>
        <QueryState query={summary} isEmpty={!s} emptyTitle={t('people.summaryTitle')}>
          {s && (
            <>
              {s.dayKind !== 'WORKING' && <Alert tone="info" className="mb-3">{t(`dayKind.${s.dayKind}` as never)}</Alert>}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Stat label={t('people.total')} value={s.total} accent="blue" />
                <Stat label={t('status.PRESENT')} value={(s.byStatus.PRESENT ?? 0) + (s.byStatus.LATE ?? 0) + (s.byStatus.WFH ?? 0)} accent="green" />
                <Stat label={t('status.HALF_DAY')} value={s.byStatus.HALF_DAY ?? 0} accent="gold" />
                <Stat label={t('people.onLeave')} value={(s.byStatus.ON_LEAVE ?? 0) + (s.byStatus.UNPAID_LEAVE ?? 0)} accent="none" />
                <Stat label={t('people.notMarked')} value={s.notMarked} hint={t('people.notMarkedHint')} accent="red" />
              </div>
            </>
          )}
        </QueryState>
      </Panel>
      <FormField label={t('people.select')} className="max-w-sm">
        <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">{t('people.selectPrompt')}</option>
          {(options.data ?? []).filter((p) => p.id !== user?.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </FormField>
      {userId ? <MonthView key={userId} userId={userId} canCorrect={can('attendance:correct')} /> : <p className="text-sm text-muted">{t('people.pick')}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ corrections history */
function CorrectionsView({ canPickPerson }: { canPickPerson: boolean }) {
  const t = useTranslations('workAttendance');
  const tc = useTranslations('common');
  const w = useWhen();
  const options = useTeamMemberOptions(canPickPerson);
  const [userId, setUserId] = React.useState('');
  const [page, setPage] = React.useState(1);
  const q = useAttendanceCorrections({ userId: userId || undefined, page, limit: 10 });
  return (
    <div className="enter-up mt-4 space-y-4">
      {canPickPerson && (
        <FormField label={t('people.select')} className="max-w-sm">
          <Select value={userId} onChange={(e) => { setUserId(e.target.value); setPage(1); }}>
            <option value="">{t('corrections.everyone')}</option>
            {(options.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </FormField>
      )}
      <QueryState query={q} isEmpty={(q.data?.items.length ?? 0) === 0} emptyTitle={t('corrections.empty')} emptyDescription={t('corrections.emptyBody')}>
        <ul className="stagger space-y-2" aria-label={t('corrections.title')}>
          {(q.data?.items ?? []).map((c) => (
            <li key={c.id} className="hover-lift rounded-lg border border-line bg-surface p-3.5">
              <p className="font-medium text-ink">{c.userName ?? '—'} · {w.day(c.date)}</p>
              <p className="mt-1 text-sm text-ink">
                {c.oldValue.status ? t(`status.${c.oldValue.status}` as never) : t('corrections.noneBefore')} → {t(`status.${c.newValue.status}` as never)}
              </p>
              <p className="mt-1 text-sm text-muted">{t('corrections.by', { name: c.correctedByName ?? '—', when: w.dateTime(c.createdAt) })}</p>
              <p className="mt-1 text-sm text-muted">{t('corrections.reason', { reason: c.reason })}</p>
            </li>
          ))}
        </ul>
        {(q.data?.hasMore || page > 1) && (
          <Pagination className="mt-4" page={page} hasNext={Boolean(q.data?.hasMore)} onPageChange={setPage} labels={{ nav: tc('pagination'), previous: tc('previous'), next: tc('next'), summary: () => '', page: () => '', pageOnly: (p) => tc('paginationPageOnly', { page: p }) }} />
        )}
      </QueryState>
    </div>
  );
}
