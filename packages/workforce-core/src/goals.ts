import { resolveWorkforceConfig } from '@salesos/validation';
import { addDays, compareDays, daysBetweenInclusive, type Day } from './dates';

/**
 * Goals (45-day cycle) and work tasks: pure engines (DEC-048, docs/workforce-report.md s2 items 4-5).
 * No I/O here: the API and the worker both import these.
 */

export type GoalStatusKey = 'ACTIVE' | 'PENDING_VERIFICATION' | 'COMPLETED' | 'CANCELLED';
export type GoalRiskKey = 'ON_TRACK' | 'AT_RISK' | 'COMPLETED' | 'OVERDUE';
export type TaskStatusKey = 'ASSIGNED' | 'ACCEPTED' | 'IN_PROGRESS' | 'REVIEW' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';

// ------------------------------------------------------------------ progress and dates
const clampPct = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Progress %. With a measurable target (> 0): currentValue / targetValue; otherwise the manual percentage (0 when absent).
 * Values are decimal numbers or strings; result is an integer 0..100 (over-achievement is capped at 100).
 */
export function goalProgressPct(input: { currentValue?: number | string | null; targetValue?: number | string | null; manualPct?: number | null }): number {
  const target = input.targetValue == null ? NaN : Number(input.targetValue);
  if (Number.isFinite(target) && target > 0) {
    const cur = Number(input.currentValue ?? 0);
    return Number.isFinite(cur) ? clampPct((cur / target) * 100) : 0;
  }
  return clampPct(input.manualPct ?? 0);
}

/** Target date = start + cycleDays - 1 (a 45-day cycle starting 1 Oct ends 14 Nov). */
export function goalTargetDate(startDay: Day, cycleDays: number): Day {
  return addDays(startDay, Math.max(1, Math.floor(cycleDays)) - 1);
}

/** Share of the cycle elapsed as an integer % (0 before the start, 100 from the target date on). `today` is a business-timezone day. */
export function elapsedSharePct(startDay: Day, targetDay: Day, today: Day): number {
  if (compareDays(today, startDay) < 0) return 0;
  const total = Math.max(1, daysBetweenInclusive(startDay, targetDay));
  const elapsed = Math.min(total, daysBetweenInclusive(startDay, today));
  return clampPct((elapsed / total) * 100);
}

/** Days from `today` to the target date (negative = past). */
export function daysToTarget(targetDay: Day, today: Day): number {
  return compareDays(targetDay, today) === 0 ? 0 : compareDays(targetDay, today) > 0 ? daysBetweenInclusive(today, targetDay) - 1 : -(daysBetweenInclusive(targetDay, today) - 1);
}

export interface GoalRiskInput {
  status: GoalStatusKey;
  progressPct: number;
  startDay: Day;
  targetDay: Day;
  today: Day;
  /** goals.atRiskGapPct */
  atRiskGapPct: number;
}

/**
 * Risk of a goal.
 *  - COMPLETED: verified/completed goals.
 *  - PENDING_VERIFICATION: the owner has delivered; waiting on the reviewer, so never flagged against the owner (ON_TRACK).
 *  - ACTIVE: progress >= 100 -> ON_TRACK (needs submitting); past the target date -> OVERDUE;
 *    behind the elapsed share of the cycle by MORE than atRiskGapPct points -> AT_RISK; otherwise ON_TRACK.
 *  - CANCELLED: no risk applies; returns ON_TRACK (callers hide the badge for cancelled goals, see goalRiskApplies).
 */
export function computeGoalRisk(i: GoalRiskInput): GoalRiskKey {
  if (i.status === 'COMPLETED') return 'COMPLETED';
  if (i.status !== 'ACTIVE') return 'ON_TRACK';
  if (i.progressPct >= 100) return 'ON_TRACK';
  if (compareDays(i.today, i.targetDay) > 0) return 'OVERDUE';
  const gap = elapsedSharePct(i.startDay, i.targetDay, i.today) - i.progressPct;
  return gap > i.atRiskGapPct ? 'AT_RISK' : 'ON_TRACK';
}
export const goalRiskApplies = (status: GoalStatusKey): boolean => status !== 'CANCELLED';

// ------------------------------------------------------------------ goal state machine
export type GoalAction = 'SUBMIT' | 'COMPLETE_DIRECT' | 'VERIFY' | 'RETURN' | 'CANCEL';
export type GoalActorRole = 'OWNER' | 'REVIEWER' | 'MANAGER_SIDE';

interface GoalRule { from: GoalStatusKey; action: GoalAction; to: GoalStatusKey; by: GoalActorRole[]; needsNote?: boolean }
/** One table; `by`: OWNER = goal owner, REVIEWER = the reviewer or a user whose review scope covers the owner, MANAGER_SIDE = creator / review scope (cancel). */
export const GOAL_RULES: readonly GoalRule[] = [
  { from: 'ACTIVE', action: 'SUBMIT', to: 'PENDING_VERIFICATION', by: ['OWNER'] },
  { from: 'ACTIVE', action: 'COMPLETE_DIRECT', to: 'COMPLETED', by: ['OWNER'] },
  { from: 'PENDING_VERIFICATION', action: 'VERIFY', to: 'COMPLETED', by: ['REVIEWER'] },
  { from: 'PENDING_VERIFICATION', action: 'RETURN', to: 'ACTIVE', by: ['REVIEWER'], needsNote: true },
  { from: 'ACTIVE', action: 'CANCEL', to: 'CANCELLED', by: ['OWNER', 'MANAGER_SIDE'] },
  { from: 'PENDING_VERIFICATION', action: 'CANCEL', to: 'CANCELLED', by: ['OWNER', 'MANAGER_SIDE'] },
];
export const GOAL_TERMINAL: readonly GoalStatusKey[] = ['COMPLETED', 'CANCELLED'];

export type GoalTransitionResult =
  | { ok: true; to: GoalStatusKey; needsNote: boolean }
  | { ok: false; code: 'ILLEGAL_TRANSITION' | 'NOT_ALLOWED' | 'VERIFICATION_DISABLED' };

/** The single goal transition function. `requireVerification` = goals.requireVerification. */
export function transitionGoal(from: GoalStatusKey, action: GoalAction, roles: ReadonlySet<GoalActorRole>, opts: { requireVerification: boolean }): GoalTransitionResult {
  if (action === 'SUBMIT' && !opts.requireVerification) return { ok: false, code: 'VERIFICATION_DISABLED' };
  if (action === 'COMPLETE_DIRECT' && opts.requireVerification) return { ok: false, code: 'VERIFICATION_DISABLED' };
  const rule = GOAL_RULES.find((r) => r.from === from && r.action === action);
  if (!rule) return { ok: false, code: 'ILLEGAL_TRANSITION' };
  if (!rule.by.some((r) => roles.has(r))) return { ok: false, code: 'NOT_ALLOWED' };
  return { ok: true, to: rule.to, needsNote: !!rule.needsNote };
}

// ------------------------------------------------------------------ work task state machine
export type TaskActorRole = 'ASSIGNEE' | 'ASSIGNER';
interface TaskRule { from: TaskStatusKey; to: TaskStatusKey; by: TaskActorRole; needsNote?: boolean; /** assignee may do it only when tasks.requireReview=false */ assigneeWhenNoReview?: boolean }

export const TASK_OPEN: readonly TaskStatusKey[] = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'REVIEW'];
export const TASK_TERMINAL: readonly TaskStatusKey[] = ['COMPLETED', 'CANCELLED'];

export const TASK_RULES: readonly TaskRule[] = [
  { from: 'ASSIGNED', to: 'ACCEPTED', by: 'ASSIGNEE' },
  { from: 'ASSIGNED', to: 'IN_PROGRESS', by: 'ASSIGNEE' },
  { from: 'ASSIGNED', to: 'REJECTED', by: 'ASSIGNEE', needsNote: true },
  { from: 'ACCEPTED', to: 'IN_PROGRESS', by: 'ASSIGNEE' },
  { from: 'ACCEPTED', to: 'REJECTED', by: 'ASSIGNEE', needsNote: true },
  { from: 'IN_PROGRESS', to: 'REVIEW', by: 'ASSIGNEE' },
  { from: 'IN_PROGRESS', to: 'COMPLETED', by: 'ASSIGNEE', assigneeWhenNoReview: true },
  { from: 'IN_PROGRESS', to: 'COMPLETED', by: 'ASSIGNER' },
  { from: 'REVIEW', to: 'COMPLETED', by: 'ASSIGNER' },
  { from: 'REVIEW', to: 'IN_PROGRESS', by: 'ASSIGNER', needsNote: true },
  { from: 'REJECTED', to: 'ASSIGNED', by: 'ASSIGNER' },
  { from: 'ASSIGNED', to: 'CANCELLED', by: 'ASSIGNER' },
  { from: 'ACCEPTED', to: 'CANCELLED', by: 'ASSIGNER' },
  { from: 'IN_PROGRESS', to: 'CANCELLED', by: 'ASSIGNER' },
  { from: 'REVIEW', to: 'CANCELLED', by: 'ASSIGNER' },
  { from: 'REJECTED', to: 'CANCELLED', by: 'ASSIGNER' },
];

export type TaskTransitionResult =
  | { ok: true; needsNote: boolean }
  | { ok: false; code: 'ILLEGAL_TRANSITION' | 'NOT_ALLOWED' };

/** The single task transition function. A self-assigned task holds both roles (so it can be completed without a separate review). */
export function transitionTask(from: TaskStatusKey, to: TaskStatusKey, roles: ReadonlySet<TaskActorRole>, opts: { requireReview: boolean }): TaskTransitionResult {
  const candidates = TASK_RULES.filter((r) => r.from === from && r.to === to);
  if (candidates.length === 0) return { ok: false, code: 'ILLEGAL_TRANSITION' };
  const allowed = candidates.find((r) => roles.has(r.by) && (!r.assigneeWhenNoReview || !opts.requireReview));
  if (!allowed) return { ok: false, code: 'NOT_ALLOWED' };
  return { ok: true, needsNote: !!allowed.needsNote };
}

/** Overdue is computed, never stored: an open task whose due instant has passed. */
export function isTaskOverdue(status: TaskStatusKey, dueAt: Date | null | undefined, now: Date): boolean {
  return TASK_OPEN.includes(status) && !!dueAt && dueAt.getTime() < now.getTime();
}

// ------------------------------------------------------------------ policy helper (worker has no direct dependency on validation)
export interface GoalTaskPolicy {
  timezone: string;
  atRiskGapPct: number;
  cycleDays: number;
  requireVerification: boolean;
  reminderDaysBeforeTarget: number[];
  requireReview: boolean;
  reminderHoursBeforeDue: number;
}
/** Resolve the goals/tasks policy from a stored `workforce_settings.config` value (defaults fill the gaps). */
export function goalTaskPolicy(raw: unknown): GoalTaskPolicy {
  const c = resolveWorkforceConfig(raw);
  return {
    timezone: c.timezone, atRiskGapPct: c.goals.atRiskGapPct, cycleDays: c.goals.cycleDays, requireVerification: c.goals.requireVerification,
    reminderDaysBeforeTarget: c.goals.reminderDaysBeforeTarget, requireReview: c.tasks.requireReview, reminderHoursBeforeDue: c.tasks.reminderHoursBeforeDue,
  };
}
