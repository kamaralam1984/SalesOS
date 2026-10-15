'use client';
import { useTranslations } from 'next-intl';
import { PermissionDenied } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { HomeHeader } from './home-header';
import { StatTiles } from './stat-tiles';
import { GoalCard } from './goal-card';
import { PriorityFollowUps } from './priority-followups';
import { QuickActions } from './quick-actions';

/** `/m`: Sales Executive home. Users without CRM access get a calm permission-denied state. */
export function MobileHome() {
  const t = useTranslations('mobileShell');
  const { can } = useAuth();
  if (!can(['leads:view', 'tasks:view'])) {
    return (
      <PermissionDenied
        headingLevel={1}
        title={t('denied.title')}
        description={t('denied.description')}
      />
    );
  }
  return (
    <div className="stagger flex flex-col gap-5 pb-4">
      <HomeHeader />
      <StatTiles />
      <GoalCard />
      <PriorityFollowUps />
      <QuickActions />
    </div>
  );
}
