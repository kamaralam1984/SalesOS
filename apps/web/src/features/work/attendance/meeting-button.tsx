'use client';
import * as React from 'react';
import { Video } from 'lucide-react';
import { useMeetingJoin } from '@/lib/api/hooks/work-attendance';

/**
 * The "Join meeting" link. Pressing it is recorded (first press of the day, shown to HR and managers) and the link opens in a new tab either way:
 * a failed or slow record never blocks the meeting.
 */
export function MeetingButton({ href, label, className }: { href: string; label: string; className: string }) {
  const join = useMeetingJoin();
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className} onClick={() => join.mutate(undefined)}>
      <Video aria-hidden="true" className="size-4" />
      {label}
    </a>
  );
}
