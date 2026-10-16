import type { NegativeCase } from './cases';

/**
 * Area B (goals + work tasks). `goals:view|create|update` and `work-tasks:*` are granted to every employee (own scope), so the
 * role-denied cases are the review routes only; scope (cross-team / cross-org IDOR) is proved in b-goals.spec.ts + b-tasks.spec.ts.
 * Every route is also rejected with 401 without a session by the central coverage test.
 */
export const B_CASES: NegativeCase[] = [
  { route: 'POST /workforce/goals', body: { title: 'negative goal' } },
  { route: 'GET /workforce/goals' },
  { route: 'GET /workforce/goals/summary' },
  { route: 'GET /workforce/goals/:id' },
  { route: 'GET /workforce/goals/:id/export' },
  { route: 'PATCH /workforce/goals/:id', body: { version: 1, title: 'negative goal' } },
  { route: 'POST /workforce/goals/:id/progress', body: { progressPct: 10 } },
  { route: 'POST /workforce/goals/:id/milestones', body: { title: 'negative milestone' } },
  { route: 'PATCH /workforce/goals/:id/milestones/:milestoneId', body: { done: true } },
  { route: 'POST /workforce/goals/:id/comment', body: { note: 'negative' } },
  { route: 'POST /workforce/goals/:id/submit', body: {} },
  { route: 'POST /workforce/goals/:id/verify', deniedUser: 'execA1', body: {} },
  { route: 'POST /workforce/goals/:id/return', deniedUser: 'execA1', body: { note: 'negative note' } },
  { route: 'POST /workforce/goals/:id/cancel', body: { reason: 'negative reason' } },
  { route: 'POST /workforce/tasks', body: { title: 'negative task' } },
  { route: 'GET /workforce/tasks' },
  { route: 'GET /workforce/tasks/summary' },
  { route: 'GET /workforce/tasks/:id' },
  { route: 'PATCH /workforce/tasks/:id', body: { version: 1, title: 'negative task' } },
  { route: 'POST /workforce/tasks/:id/transition', body: { to: 'ACCEPTED' } },
  { route: 'POST /workforce/tasks/:id/comment', body: { note: 'negative' } },
];
