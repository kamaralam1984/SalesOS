'use client';
import { AttendanceCard } from '@/features/work/attendance/attendance-card';
import { useDayPhase } from '@/features/work/attendance/use-day-phase';
import { MeetingsCard } from '@/features/mobile/home/meetings-card';
import { OnboardingCard } from '@/features/mobile/home/onboarding-card';
import { GoalCard } from '@/features/mobile/home/goal-card';

/**
 * Today's attendance and the current 45-day goal at the top of every desktop dashboard. Each card hides itself without its permission.
 * While the person is working (Zoom gone, before check-out) the goal comes first; at check-out time attendance returns to the front.
 */
export function TodayRow() {
  const phase = useDayPhase();
  const goalFirst = phase === 'WORKING';
  return (
    <div className="mb-6 grid max-w-4xl gap-4 md:grid-cols-2">
      <div className={goalFirst ? 'md:order-2' : undefined}><AttendanceCard variant="dashboard" /></div>
      <div className={goalFirst ? 'md:order-1' : undefined}><GoalCard href="/work/goals" /></div>
      <div className="md:col-span-2 md:order-first empty:hidden"><MeetingsCard /></div>
      <div className="md:col-span-2 md:order-3 empty:hidden"><OnboardingCard /></div>
    </div>
  );
}
