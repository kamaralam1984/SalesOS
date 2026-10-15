import type { Goal, GoalRisk, GoalStatus } from '@/lib/api/hooks/work-goals';
import type { Tone } from '../common/shared';

export const riskTone = (r: GoalRisk): Tone => (r === 'OVERDUE' ? 'red' : r === 'AT_RISK' ? 'gold' : r === 'COMPLETED' ? 'green' : 'blue');
export const goalStatusTone = (s: GoalStatus): Tone => (s === 'COMPLETED' ? 'green' : s === 'PENDING_VERIFICATION' ? 'gold' : s === 'CANCELLED' ? 'neutral' : 'blue');

/** Which list views a viewer may open (server still scopes every list). */
export function goalViews(can: (k: string, min?: 'own' | 'team' | 'org') => boolean): Array<'mine' | 'team' | 'reviewing' | 'all'> {
  const v: Array<'mine' | 'team' | 'reviewing' | 'all'> = ['mine'];
  if (can('goals:view', 'team')) v.push('team');
  if (can('goals:review')) v.push('reviewing');
  if (can('goals:view', 'team')) v.push('all');
  return v;
}

/** Whether the risk badge is shown (cancelled goals have no risk). */
export const showRisk = (g: Pick<Goal, 'riskApplies' | 'status'>) => g.riskApplies && g.status !== 'PENDING_VERIFICATION';

/** The one primary action to highlight on a goal, or null. */
export function primaryGoalAction(g: Pick<Goal, 'can' | 'progressPct' | 'status'>): 'submit' | 'complete' | 'verify' | null {
  if (g.can.verify) return 'verify';
  if (g.can.submit && g.progressPct >= 100) return 'submit';
  if (g.can.completeDirect && g.progressPct >= 100) return 'complete';
  return null;
}
