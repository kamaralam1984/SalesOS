'use client';
import * as React from 'react';
import { useAuth } from '@/features/auth/auth-provider';
import { useIsCallTeam } from '../call-team';
import { FALLBACK_LAYOUT, useMyHomeLayout } from '@/lib/api/hooks/home-layout';
import { HomeHeader } from './home-header';
import { StatTiles } from './stat-tiles';
import { GoalCard } from './goal-card';
import { MeetingsCard } from './meetings-card';
import { OnboardingCard } from './onboarding-card';
import { PriorityFollowUps } from './priority-followups';
import { QuickActions } from './quick-actions';
import { WorkspaceTiles } from './workspace-tiles';
import { AttendanceCard } from '@/features/work/attendance/attendance-card';
import { useDayPhase } from '@/features/work/attendance/use-day-phase';
import { SIZE_ZOOM, workingOrder, type HomeWidgetId } from './widgets';

/**
 * `/m`: phone home for every role. The Founder or Developer sets, per role, which widgets show, their order and size
 * (Admin → Home layout). Each widget still renders only when the role may use it (UI hiding; the API enforces).
 */
export function MobileHome() {
  const { can } = useAuth();
  const callTeam = useIsCallTeam();
  const working = useDayPhase() === 'WORKING';
  const layout = useMyHomeLayout().data ?? FALLBACK_LAYOUT;
  const hasCrm = can(['leads:view', 'tasks:view', 'dashboard:salesperson:view']);
  const widgets = layout.source === 'DEFAULT' && working ? workingOrder(layout.widgets) : layout.widgets;
  const body: Record<HomeWidgetId, React.ReactNode> = {
    meetings: <MeetingsCard />,
    stats: <StatTiles />,
    attendance: <AttendanceCard variant="mobile" />,
    goal: can('goals:view') ? <GoalCard /> : null,
    onboarding: <OnboardingCard />,
    followups: callTeam && can('tasks:view') ? <PriorityFollowUps /> : null,
    quickActions: callTeam && can('tasks:view') ? <QuickActions /> : null,
    workspace: <WorkspaceTiles variant={hasCrm ? 'more' : 'full'} />,
  };
  return (
    <div className="stagger flex flex-col gap-5 pb-4">
      <HomeHeader />
      {widgets.filter((w) => w.visible).map((w) => (
        <div key={w.id} data-widget={w.id} data-size={w.size} style={w.size === 'M' ? undefined : { zoom: SIZE_ZOOM[w.size] }} className="empty:hidden">{body[w.id]}</div>
      ))}
    </div>
  );
}
