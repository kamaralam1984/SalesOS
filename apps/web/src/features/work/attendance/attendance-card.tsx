'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertCircle, CalendarOff, CheckCircle2, CircleDashed, Clock, Home, LogIn, LogOut, Palmtree, Plane, XCircle } from 'lucide-react';
import { Badge, Button, Skeleton } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { ApiError } from '@/lib/api/client';
import { useAttendanceToday, useCheckIn, useCheckOut, type AttendanceStatus } from '@/lib/api/hooks/work-attendance';
import { formatMinutes, istTimeToIso, safeMeetingLink, statusTone } from './attendance-logic';
import { MeetingButton } from './meeting-button';
import { useWhen } from './format';
import { DayReportDialog, LateJoinDialog } from './day-dialogs';

type ChipKey = AttendanceStatus | 'NOT_CHECKED_IN';

const CHIP_ICON: Record<ChipKey, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>> = {
  NOT_CHECKED_IN: CircleDashed, PRESENT: CheckCircle2, LATE: Clock, WFH: Home, HALF_DAY: Clock, HOLIDAY: Palmtree,
  WEEKLY_OFF: CalendarOff, ON_LEAVE: Plane, ABSENT: XCircle, UNPAID_LEAVE: XCircle,
};

/** Compact "today" attendance for dashboards: status chip, check in/out, closed state and the Zoom link when HR configured one. */
export function AttendanceCard({ variant = 'dashboard' }: { variant?: 'dashboard' | 'mobile' }) {
  const { can } = useAuth();
  if (!can('attendance:self')) return null;
  return <Card variant={variant} />;
}

function Card({ variant }: { variant: 'dashboard' | 'mobile' }) {
  const t = useTranslations('dashAttendance');
  const w = useWhen();
  const q = useAttendanceToday();
  const checkIn = useCheckIn();
  const checkOut = useCheckOut();
  const [lateMode, setLateMode] = React.useState<'OFFICE' | 'WFH' | null>(null);
  const [reportOpen, setReportOpen] = React.useState(false);

  const shell = variant === 'mobile'
    ? 'enter-up rounded-2xl border border-line bg-surface p-4 shadow-sm'
    : 'enter-up rounded-lg border border-line bg-surface p-4 shadow-sm';

  if (q.isLoading) {
    return (
      <section aria-busy="true" aria-label={t('title')} className={shell}>
        <Skeleton className="mb-3 h-5 w-40" />
        <Skeleton className="mb-3 h-6 w-28" />
        <Skeleton className="h-11 w-full" />
      </section>
    );
  }
  if (q.isError || !q.data) {
    return (
      <section aria-label={t('title')} className={shell}>
        <h2 className="mb-2 text-base font-semibold text-ink">{t('title')}</h2>
        <p role="alert" className="mb-3 flex items-center gap-2 text-sm text-red-700"><AlertCircle aria-hidden="true" className="size-4 shrink-0" />{t('loadError')}</p>
        <Button variant="secondary" className="min-h-11" onClick={() => void q.refetch()}>{t('retry')}</Button>
      </section>
    );
  }

  const d = q.data;
  const rec = d.record;
  const chip: ChipKey = rec ? rec.status : d.dayKind === 'HOLIDAY' ? 'HOLIDAY' : d.dayKind === 'WEEKLY_OFF' ? 'WEEKLY_OFF' : 'NOT_CHECKED_IN';
  const Icon = CHIP_ICON[chip];
  const tone = chip === 'NOT_CHECKED_IN' || chip === 'HOLIDAY' || chip === 'WEEKLY_OFF' ? 'neutral' : statusTone(chip);
  const cutoff = d.policy.checkInCutoff;
  const cutoffTime = cutoff ? w.time(istTimeToIso(d.date, cutoff)) : null;
  const lateAttempt = checkIn.error instanceof ApiError && checkIn.error.code === 'CHECK_IN_CLOSED';
  const closed = Boolean(d.checkInClosed) || lateAttempt;
  const meeting = safeMeetingLink(d.meeting?.url);
  const actionFailed = (checkIn.isError && !lateAttempt) || checkOut.isError;
  const showCheckIn = d.can.checkIn && !closed;
  const startCheckIn = (mode: 'OFFICE' | 'WFH') => (d.lateJoin ? setLateMode(mode) : checkIn.mutate({ mode }));

  return (
    <section aria-label={t('title')} aria-live="polite" className={shell}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">{t('title')}</h2>
          <p className="text-sm text-muted">{w.day(d.date)}</p>
        </div>
        <Badge tone={tone}>
          <span className="inline-flex items-center gap-1"><Icon aria-hidden="true" className="size-3.5" />{t(`status.${chip}` as never)}</span>
        </Badge>
      </div>

      {rec?.checkInAt && (
        <p className="mt-3 text-sm text-ink">
          {t('checkedInAt', { time: w.time(rec.checkInAt) })}
          {rec.checkOutAt ? ` · ${t('checkedOutAt', { time: w.time(rec.checkOutAt) })}` : ''}
        </p>
      )}
      {!rec && (d.lateByMinutes ?? 0) > 0 && d.dayKind === 'WORKING' && (
        <p role="status" className="mt-3 text-sm font-medium text-red-700">{t('lateNow', { duration: formatMinutes(d.lateByMinutes), time: d.policy.lateAfter })}</p>
      )}
      {rec && (rec.lateMinutes ?? 0) > 0 && <p className="mt-1 text-sm font-medium text-red-700">{t('lateAt', { duration: formatMinutes(rec.lateMinutes) })}</p>}
      {rec && rec.checkOutAt && (rec.overtimeMinutes ?? 0) > 0 && <p className="mt-1 text-sm font-medium text-green-700">{t('overtime', { duration: formatMinutes(rec.overtimeMinutes), time: d.policy.workdayEnd ?? '19:00' })}</p>}
      {rec?.meetingJoinedAt && <p className="mt-1 text-sm text-muted">{t('meetingJoinedAt', { time: w.time(rec.meetingJoinedAt) })}</p>}
      {!d.policy.selfCheckIn && !rec && <p className="mt-3 text-sm text-muted">{t('selfDisabled')}</p>}
      {showCheckIn && !d.lateJoin && cutoffTime && <p className="mt-3 text-sm text-muted">{t('checkInCloses', { time: cutoffTime })}</p>}
      {showCheckIn && d.lateJoin && <p role="status" className="mt-3 text-sm text-ink">{t('lateJoinNote', { time: cutoffTime ?? '—' })}</p>}
      {rec?.lateJoin && <p className="mt-1 text-sm text-muted">{t('lateJoinRecorded')}</p>}
      {closed && !rec && (
        <div role="status" className="mt-3 flex items-start gap-2 rounded-lg border border-gold-300 bg-gold-50 p-3 text-sm text-ink">
          <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-gold-700" />
          <p>{t('checkInClosed', { time: cutoffTime ?? '—' })}</p>
        </div>
      )}

      {meeting && (
        <div className="enter-up mt-3">
          <MeetingButton
            href={meeting.href}
            label={t('joinMeeting')}
            className="sheen glow-green hover-lift inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-green-700 bg-(image:--green-gradient) px-5 py-2.5 text-sm font-semibold text-white shadow-green hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          />
          <p className="mt-1 text-xs text-muted">{t('meetingHost', { host: meeting.host })}</p>
        </div>
      )}

      {(showCheckIn || d.can.checkOut) && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {showCheckIn && (
            <>
              <Button
                className="glow-gold min-h-11"
                leadingIcon={<LogIn aria-hidden="true" />}
                loading={checkIn.isPending}
                onClick={() => startCheckIn('OFFICE')}
              >
                {t('checkInOffice')}
              </Button>
              <Button variant="secondary" className="min-h-11" leadingIcon={<Home aria-hidden="true" />} loading={checkIn.isPending} onClick={() => startCheckIn('WFH')}>
                {t('checkInWfh')}
              </Button>
            </>
          )}
          {d.can.checkOut && (
            <Button className="col-span-2 min-h-11" variant="secondary" leadingIcon={<LogOut aria-hidden="true" />} loading={checkOut.isPending} onClick={() => (d.policy.requireDayReport ? setReportOpen(true) : checkOut.mutate())}>
              {t('checkOut')}
            </Button>
          )}
        </div>
      )}
      {actionFailed && <p role="alert" className="mt-2 text-sm text-red-700">{t('actionError')}</p>}

      {lateMode && (
        <LateJoinDialog open onOpenChange={(o) => !o && setLateMode(null)} pending={checkIn.isPending} error={checkIn.error} lateBy={d.lateByMinutes ? formatMinutes(d.lateByMinutes) : undefined}
          onSubmit={(reason) => checkIn.mutate({ mode: lateMode, reason }, { onSuccess: () => setLateMode(null) })} />
      )}
      {reportOpen && (
        <DayReportDialog open onOpenChange={(o) => !o && setReportOpen(false)} pending={checkOut.isPending} error={checkOut.error}
          onSubmit={(v) => checkOut.mutate(v, { onSuccess: () => setReportOpen(false) })} />
      )}

      <Link href="/work/attendance" className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
        {t('open')}
      </Link>
    </section>
  );
}
