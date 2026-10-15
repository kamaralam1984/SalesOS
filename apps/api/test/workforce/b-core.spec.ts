import { describe, expect, it } from 'vitest';
import {
  computeGoalRisk, daysToTarget, elapsedSharePct, goalProgressPct, goalTargetDate, goalTaskPolicy, isTaskOverdue, transitionGoal, transitionTask,
  type GoalActorRole, type TaskActorRole, type TaskStatusKey,
} from '@salesos/workforce-core';

/** Area B pure engines: goal progress/risk/state machine and work-task state machine. */
const roles = <T extends string>(...r: T[]) => new Set<T>(r);

describe('goal dates and progress', () => {
  it('a 45-day cycle starting 1 Oct ends 14 Nov', () => {
    expect(goalTargetDate('2026-10-01', 45)).toBe('2026-11-14');
    expect(goalTargetDate('2026-10-01', 1)).toBe('2026-10-01');
  });
  it('progress is value/target when measurable, manual otherwise, capped 0..100', () => {
    expect(goalProgressPct({ currentValue: '15', targetValue: '30' })).toBe(50);
    expect(goalProgressPct({ currentValue: '45', targetValue: '30' })).toBe(100);
    expect(goalProgressPct({ currentValue: '1', targetValue: '3' })).toBe(33);
    expect(goalProgressPct({ targetValue: null, manualPct: 40 })).toBe(40);
    expect(goalProgressPct({ targetValue: '0', manualPct: 40 })).toBe(40);
    expect(goalProgressPct({ manualPct: 400 })).toBe(100);
    expect(goalProgressPct({ manualPct: -5 })).toBe(0);
    expect(goalProgressPct({})).toBe(0);
  });
  it('elapsed share and days to target', () => {
    expect(elapsedSharePct('2026-10-01', '2026-10-10', '2026-09-30')).toBe(0);
    expect(elapsedSharePct('2026-10-01', '2026-10-10', '2026-10-05')).toBe(50);
    expect(elapsedSharePct('2026-10-01', '2026-10-10', '2026-12-01')).toBe(100);
    expect(daysToTarget('2026-10-10', '2026-10-07')).toBe(3);
    expect(daysToTarget('2026-10-10', '2026-10-10')).toBe(0);
    expect(daysToTarget('2026-10-10', '2026-10-12')).toBe(-2);
  });
});

describe('computeGoalRisk', () => {
  const base = { startDay: '2026-10-01', targetDay: '2026-10-10', atRiskGapPct: 20 } as const;
  it('is ON_TRACK when within the gap, AT_RISK only when MORE than the gap behind (boundary)', () => {
    // day 5 of 10 = 50% elapsed
    expect(computeGoalRisk({ ...base, status: 'ACTIVE', progressPct: 30, today: '2026-10-05' })).toBe('ON_TRACK'); // gap exactly 20
    expect(computeGoalRisk({ ...base, status: 'ACTIVE', progressPct: 29, today: '2026-10-05' })).toBe('AT_RISK'); // gap 21
    expect(computeGoalRisk({ ...base, status: 'ACTIVE', progressPct: 90, today: '2026-10-05' })).toBe('ON_TRACK');
  });
  it('is OVERDUE after the target date unless already at 100%', () => {
    expect(computeGoalRisk({ ...base, status: 'ACTIVE', progressPct: 60, today: '2026-10-11' })).toBe('OVERDUE');
    expect(computeGoalRisk({ ...base, status: 'ACTIVE', progressPct: 60, today: '2026-10-10' })).not.toBe('OVERDUE');
    expect(computeGoalRisk({ ...base, status: 'ACTIVE', progressPct: 100, today: '2026-10-20' })).toBe('ON_TRACK');
  });
  it('is never AT_RISK before the start and never flags waiting-for-reviewer, completed or cancelled goals', () => {
    expect(computeGoalRisk({ ...base, status: 'ACTIVE', progressPct: 0, today: '2026-09-20' })).toBe('ON_TRACK');
    expect(computeGoalRisk({ ...base, status: 'PENDING_VERIFICATION', progressPct: 10, today: '2026-11-01' })).toBe('ON_TRACK');
    expect(computeGoalRisk({ ...base, status: 'COMPLETED', progressPct: 10, today: '2026-11-01' })).toBe('COMPLETED');
    expect(computeGoalRisk({ ...base, status: 'CANCELLED', progressPct: 10, today: '2026-11-01' })).toBe('ON_TRACK');
  });
});

describe('transitionGoal (the one goal transition function)', () => {
  const verify = { requireVerification: true };
  const direct = { requireVerification: false };
  const o = roles<GoalActorRole>('OWNER');
  const r = roles<GoalActorRole>('REVIEWER');
  it('owner submits, reviewer verifies or returns (note required)', () => {
    expect(transitionGoal('ACTIVE', 'SUBMIT', o, verify)).toEqual({ ok: true, to: 'PENDING_VERIFICATION', needsNote: false });
    expect(transitionGoal('PENDING_VERIFICATION', 'VERIFY', r, verify)).toEqual({ ok: true, to: 'COMPLETED', needsNote: false });
    expect(transitionGoal('PENDING_VERIFICATION', 'RETURN', r, verify)).toEqual({ ok: true, to: 'ACTIVE', needsNote: true });
  });
  it('the owner cannot verify or return their own goal; the reviewer cannot submit', () => {
    expect(transitionGoal('PENDING_VERIFICATION', 'VERIFY', o, verify)).toEqual({ ok: false, code: 'NOT_ALLOWED' });
    expect(transitionGoal('PENDING_VERIFICATION', 'RETURN', o, verify)).toEqual({ ok: false, code: 'NOT_ALLOWED' });
    expect(transitionGoal('ACTIVE', 'SUBMIT', r, verify)).toEqual({ ok: false, code: 'NOT_ALLOWED' });
  });
  it('illegal moves are rejected (terminal states, skipping verification)', () => {
    expect(transitionGoal('COMPLETED', 'CANCEL', roles<GoalActorRole>('OWNER', 'MANAGER_SIDE'), verify)).toEqual({ ok: false, code: 'ILLEGAL_TRANSITION' });
    expect(transitionGoal('CANCELLED', 'SUBMIT', o, verify)).toEqual({ ok: false, code: 'ILLEGAL_TRANSITION' });
    expect(transitionGoal('ACTIVE', 'VERIFY', r, verify)).toEqual({ ok: false, code: 'ILLEGAL_TRANSITION' });
    expect(transitionGoal('PENDING_VERIFICATION', 'SUBMIT', o, verify)).toEqual({ ok: false, code: 'ILLEGAL_TRANSITION' });
  });
  it('policy switch: direct completion only when verification is not required', () => {
    expect(transitionGoal('ACTIVE', 'COMPLETE_DIRECT', o, direct)).toMatchObject({ ok: true, to: 'COMPLETED' });
    expect(transitionGoal('ACTIVE', 'COMPLETE_DIRECT', o, verify)).toEqual({ ok: false, code: 'VERIFICATION_DISABLED' });
    expect(transitionGoal('ACTIVE', 'SUBMIT', o, direct)).toEqual({ ok: false, code: 'VERIFICATION_DISABLED' });
  });
  it('cancel is allowed to the owner-side or manager-side from ACTIVE and PENDING only', () => {
    const m = roles<GoalActorRole>('MANAGER_SIDE');
    expect(transitionGoal('ACTIVE', 'CANCEL', m, verify)).toMatchObject({ ok: true, to: 'CANCELLED' });
    expect(transitionGoal('PENDING_VERIFICATION', 'CANCEL', o, verify)).toMatchObject({ ok: true, to: 'CANCELLED' });
    expect(transitionGoal('ACTIVE', 'CANCEL', roles<GoalActorRole>(), verify)).toEqual({ ok: false, code: 'NOT_ALLOWED' });
  });
});

describe('transitionTask (the one task transition function)', () => {
  const asg = roles<TaskActorRole>('ASSIGNEE');
  const ser = roles<TaskActorRole>('ASSIGNER');
  const both = roles<TaskActorRole>('ASSIGNEE', 'ASSIGNER');
  const review = { requireReview: true };
  const noReview = { requireReview: false };
  it('walks the happy path: accept, start, review, complete by the assigner', () => {
    expect(transitionTask('ASSIGNED', 'ACCEPTED', asg, review).ok).toBe(true);
    expect(transitionTask('ACCEPTED', 'IN_PROGRESS', asg, review).ok).toBe(true);
    expect(transitionTask('IN_PROGRESS', 'REVIEW', asg, review).ok).toBe(true);
    expect(transitionTask('REVIEW', 'COMPLETED', ser, review).ok).toBe(true);
  });
  it('assignee cannot complete when review is required; can when it is not', () => {
    expect(transitionTask('IN_PROGRESS', 'COMPLETED', asg, review)).toEqual({ ok: false, code: 'NOT_ALLOWED' });
    expect(transitionTask('REVIEW', 'COMPLETED', asg, noReview)).toEqual({ ok: false, code: 'NOT_ALLOWED' });
    expect(transitionTask('IN_PROGRESS', 'COMPLETED', asg, noReview).ok).toBe(true);
  });
  it('self-assigned tasks hold both roles', () => {
    expect(transitionTask('IN_PROGRESS', 'REVIEW', both, review).ok).toBe(true);
    expect(transitionTask('REVIEW', 'COMPLETED', both, review).ok).toBe(true);
  });
  it('reject and send-back need a note; assigner reassigns a rejected task', () => {
    expect(transitionTask('ASSIGNED', 'REJECTED', asg, review)).toEqual({ ok: true, needsNote: true });
    expect(transitionTask('REVIEW', 'IN_PROGRESS', ser, review)).toEqual({ ok: true, needsNote: true });
    expect(transitionTask('REJECTED', 'ASSIGNED', ser, review).ok).toBe(true);
    expect(transitionTask('REJECTED', 'ASSIGNED', asg, review)).toEqual({ ok: false, code: 'NOT_ALLOWED' });
  });
  it('terminal and skipped transitions are illegal', () => {
    for (const from of ['COMPLETED', 'CANCELLED'] as TaskStatusKey[]) {
      expect(transitionTask(from, 'IN_PROGRESS', both, review)).toEqual({ ok: false, code: 'ILLEGAL_TRANSITION' });
      expect(transitionTask(from, 'CANCELLED', both, review)).toEqual({ ok: false, code: 'ILLEGAL_TRANSITION' });
    }
    expect(transitionTask('ASSIGNED', 'REVIEW', both, review)).toEqual({ ok: false, code: 'ILLEGAL_TRANSITION' });
    expect(transitionTask('ASSIGNED', 'COMPLETED', both, review)).toEqual({ ok: false, code: 'ILLEGAL_TRANSITION' });
  });
  it('only the assigner cancels', () => {
    expect(transitionTask('IN_PROGRESS', 'CANCELLED', asg, review)).toEqual({ ok: false, code: 'NOT_ALLOWED' });
    expect(transitionTask('IN_PROGRESS', 'CANCELLED', ser, review).ok).toBe(true);
  });
});

describe('isTaskOverdue and policy', () => {
  const now = new Date('2026-10-15T10:00:00Z');
  it('overdue = open and due instant passed; no due date never overdue', () => {
    expect(isTaskOverdue('IN_PROGRESS', new Date('2026-10-15T09:59:59Z'), now)).toBe(true);
    expect(isTaskOverdue('IN_PROGRESS', new Date('2026-10-15T10:00:01Z'), now)).toBe(false);
    expect(isTaskOverdue('REVIEW', new Date('2026-10-01T00:00:00Z'), now)).toBe(true);
    expect(isTaskOverdue('COMPLETED', new Date('2026-10-01T00:00:00Z'), now)).toBe(false);
    expect(isTaskOverdue('CANCELLED', new Date('2026-10-01T00:00:00Z'), now)).toBe(false);
    expect(isTaskOverdue('ASSIGNED', null, now)).toBe(false);
  });
  it('goalTaskPolicy fills defaults and honours stored overrides', () => {
    expect(goalTaskPolicy(undefined)).toMatchObject({ cycleDays: 45, atRiskGapPct: 20, requireVerification: true, requireReview: true, reminderHoursBeforeDue: 24 });
    expect(goalTaskPolicy({ goals: { atRiskGapPct: 10 }, tasks: { requireReview: false } })).toMatchObject({ atRiskGapPct: 10, cycleDays: 45, requireReview: false });
  });
});
