'use client';
import { AttendanceCard } from '@/features/work/attendance/attendance-card';
import { GoalCard } from '@/features/mobile/home/goal-card';

/** Today's attendance and the current 45-day goal, side by side at the top of every desktop dashboard. Each card hides itself without its permission. */
export function TodayRow() {
  return (
    <div className="mb-6 grid max-w-4xl gap-4 md:grid-cols-2">
      <AttendanceCard variant="dashboard" />
      <GoalCard href="/work/goals" />
    </div>
  );
}
