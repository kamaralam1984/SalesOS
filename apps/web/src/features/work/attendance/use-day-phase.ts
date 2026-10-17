'use client';
import * as React from 'react';
import { useAttendanceToday } from '@/lib/api/hooks/work-attendance';
import { dayPhase, safeMeetingLink, type DayPhase } from './attendance-logic';

/** Re-renders every 30 s so phase changes (Zoom gone 30 min after the press, Check-out at 18:30) happen without a reload. */
export function useDayPhase(): DayPhase | null {
  const q = useAttendanceToday();
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const d = q.data;
  if (!d) return null;
  return dayPhase({
    checkedIn: Boolean(d.record?.checkInAt), checkedOut: Boolean(d.record?.checkOutAt), canCheckOut: Boolean(d.can?.checkOut),
    hasMeeting: Boolean(safeMeetingLink(d.meeting?.url)), meetingJoinedAt: d.record?.meetingJoinedAt, checkOutFrom: d.policy?.checkOutFrom, day: d.date, now,
  });
}
