'use client';
import { useAuth } from '@/features/auth/auth-provider';
import { useIsCallTeam } from '../call-team';
import { HomeHeader } from './home-header';
import { StatTiles } from './stat-tiles';
import { GoalCard } from './goal-card';
import { PriorityFollowUps } from './priority-followups';
import { QuickActions } from './quick-actions';
import { WorkspaceTiles } from './workspace-tiles';
import { AttendanceCard } from '@/features/work/attendance/attendance-card';
import { useDayPhase } from '@/features/work/attendance/use-day-phase';

/** `/m`: phone home for every role. Each widget renders only when the role may use it (UI hiding; the API enforces). */
export function MobileHome() {
  const { can } = useAuth();
  const callTeam = useIsCallTeam();
  const working = useDayPhase() === 'WORKING';
  const hasCrm = can(['leads:view', 'tasks:view', 'dashboard:salesperson:view']);
  return (
    <div className="stagger flex flex-col gap-5 pb-4">
      <HomeHeader />
      <StatTiles />
      {/* working hours: calls and goals come first, attendance steps back; Zoom (after check-in) and Check-out (18:30) bring it to the front */}
      {!working && <AttendanceCard variant="mobile" />}
      {callTeam && can('tasks:view') && working && <PriorityFollowUps />}
      {callTeam && can('tasks:view') && working && <QuickActions />}
      {can('goals:view') && <GoalCard />}
      {working && <AttendanceCard variant="mobile" />}
      {callTeam && can('tasks:view') && !working && <PriorityFollowUps />}
      {callTeam && can('tasks:view') && !working && <QuickActions />}
      <WorkspaceTiles variant={hasCrm ? 'more' : 'full'} />
    </div>
  );
}
