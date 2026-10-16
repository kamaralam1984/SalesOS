'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Panel, Stat } from '@salesos/ui';
import { QueryState } from '@/features/people/hub/shared';
import { useDaySheet, type DaySheetItem } from '@/lib/api/hooks/work-attendance';
import { formatMinutes, statusTone } from './attendance-logic';
import { useWhen } from './format';

/**
 * Who came when: for HR and managers (their scope). One card per person with status, check-in time, minutes late, whether the meeting button
 * was pressed (and when), check-out and overtime after the end of the working day.
 */
export function DaySheetPanel({ date }: { date: string }) {
  const t = useTranslations('workAttendance');
  const w = useWhen();
  const q = useDaySheet(date);
  const d = q.data;
  return (
    <Panel title={t('daySheet.title')} description={d ? t('daySheet.description', { late: d.policy.lateAfter, end: d.policy.workdayEnd }) : undefined}>
      <QueryState query={q} isEmpty={!d || d.items.length === 0} emptyTitle={t('daySheet.empty')}>
        {d && (
          <div className="space-y-4">
            <section aria-label={t('daySheet.totals')} className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <Stat label={t('daySheet.lateCount')} value={d.totals.late} hint={d.totals.late ? t('daySheet.lateTotalHint', { duration: formatMinutes(d.totals.lateMinutes) }) : undefined} accent="red" />
              <Stat label={t('daySheet.meetingCount')} value={d.policy.meetingConfigured ? `${d.totals.meetingJoined} / ${d.totals.marked}` : '—'} hint={d.policy.meetingConfigured ? undefined : t('daySheet.noMeeting')} accent="blue" />
              <Stat label={t('daySheet.overtimeTotal')} value={formatMinutes(d.totals.overtimeMinutes)} accent="green" />
              <Stat label={t('people.notMarked')} value={d.totals.notMarked} accent="gold" />
              <Stat label={t('daySheet.lateJoins')} value={d.totals.lateJoins} hint={t('daySheet.lateJoinsHint', { time: d.policy.checkInCutoff })} accent="red" />
              <Stat label={t('daySheet.reports')} value={`${d.totals.reportsFilled} / ${d.totals.marked}`} hint={t('daySheet.reportsHint')} accent="blue" />
            </section>
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface" aria-label={t('daySheet.list')}>
              {d.items.map((i) => <Row key={i.userId} item={i} meetingConfigured={d.policy.meetingConfigured} when={w} />)}
            </ul>
          </div>
        )}
      </QueryState>
    </Panel>
  );
}

function Row({ item: i, meetingConfigured, when: w }: { item: DaySheetItem; meetingConfigured: boolean; when: ReturnType<typeof useWhen> }) {
  const t = useTranslations('workAttendance');
  return (
    <li className="grid gap-2 px-3.5 py-3 sm:grid-cols-[minmax(10rem,1.2fr)_1fr_1fr_1fr] sm:items-center">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="truncate font-medium text-ink">{i.name}</span>
        {i.status ? <Badge tone={statusTone(i.status)}>{t(`status.${i.status}` as never)}</Badge> : <Badge tone="neutral">{t('people.notMarked')}</Badge>}
      </div>
      <p className="text-sm text-ink">
        <span className="text-muted sm:hidden">{t('daySheet.checkIn')}: </span>
        {i.checkInAt ? w.time(i.checkInAt) : '—'}
        {(i.lateMinutes ?? 0) > 0 && <span className="ml-2 font-medium text-red-700">{t('daySheet.late', { duration: formatMinutes(i.lateMinutes) })}</span>}
        {i.checkInAt && i.lateMinutes === 0 && <span className="ml-2 text-green-700">{t('daySheet.onTime')}</span>}
      </p>
      <p className="text-sm text-ink">
        <span className="text-muted sm:hidden">{t('daySheet.meeting')}: </span>
        {!i.status || !meetingConfigured ? '—' : i.meetingJoinedAt ? <span className="text-blue-700">{t('daySheet.joined', { time: w.time(i.meetingJoinedAt) })}</span> : <span className="text-muted">{t('daySheet.notJoined')}</span>}
      </p>
      <p className="text-sm text-ink">
        <span className="text-muted sm:hidden">{t('daySheet.checkOut')}: </span>
        {i.checkOutAt ? w.time(i.checkOutAt) : '—'}
        {(i.overtimeMinutes ?? 0) > 0 && <span className="ml-2 font-medium text-green-700">{t('daySheet.overtime', { duration: formatMinutes(i.overtimeMinutes) })}</span>}
      </p>
      {(i.lateJoin || i.dayReportPct !== null) && (
        <div className="space-y-0.5 text-sm sm:col-span-full">
          {i.lateJoin && <p className="text-red-700">{t('daySheet.lateJoinReason', { reason: i.lateJoinReason ?? '—' })}</p>}
          {i.dayReportPct !== null && (
            <p className="text-ink">
              {t('daySheet.dayReport', { pct: i.dayReportPct })}
              {i.tasksDone !== null && <span className="ml-2 text-muted">{t('daySheet.taskSnapshot', { done: i.tasksDone, open: i.tasksOpen ?? 0 })}</span>}
              {i.dayReportNote && <span className="ml-2 text-muted">“{i.dayReportNote}”</span>}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
