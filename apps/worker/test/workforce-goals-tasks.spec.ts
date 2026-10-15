import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { runGoalSweep } from '../src/jobs/workforce/goals';
import { runTaskSweep } from '../src/jobs/workforce/tasks';
import { buildRegistry } from '../src/jobs/registry';

/** Area B worker: goal risk sweep and work-task due/overdue sweep. Real Postgres, idempotent re-runs, restart safety. */
const DB = process.env.TEST_WORKER_DATABASE_URL ?? 'postgresql://salesos:salesos_dev_only@127.0.0.1:5533/salesos_agentb_wtest?schema=public';
let prisma: PrismaClient;
let orgId: string;
let owner: string;
let reviewer: string;
const NOW = new Date('2026-10-15T06:30:00.000Z'); // 12:00 in Asia/Kolkata
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

async function goal(over: Record<string, unknown> = {}) {
  return prisma.goal.create({
    data: { organizationId: orgId, ownerId: owner, reviewerId: reviewer, createdById: owner, title: 'Sweep goal', startDate: d('2026-10-01'), targetDate: d('2026-11-14'), cycleDays: 45, ...over },
  });
}
const events = (aggregateId: string, eventType?: string) => prisma.outboxEvent.findMany({ where: { aggregateId, ...(eventType ? { eventType } : {}) } });

beforeAll(async () => {
  prisma = new PrismaClient({ datasourceUrl: DB });
  const org = await prisma.organization.create({ data: { name: '[TEST] wf-b-worker', slug: `wfb-${randomUUID().slice(0, 8)}` } });
  orgId = org.id;
  const mk = (n: string) => prisma.user.create({ data: { organizationId: orgId, email: `${n}-${randomUUID().slice(0, 6)}@test.local`, name: n } });
  owner = (await mk('owner')).id;
  reviewer = (await mk('reviewer')).id;
});
afterAll(async () => { await prisma.$disconnect(); });

describe('runGoalSweep', () => {
  it('recomputes risk, raises ONE at-risk event + notification per goal per day, and is idempotent on re-run', async () => {
    const behind = await goal({ progressPct: 5 }); // day 15 of 45 = 33% elapsed, 5% done -> gap 28 > 20 -> AT_RISK
    const fine = await goal({ progressPct: 30, title: 'On track goal' });
    const overdue = await goal({ progressPct: 20, startDate: d('2026-08-01'), targetDate: d('2026-09-14'), title: 'Overdue goal' });
    const done = await goal({ progressPct: 100, startDate: d('2026-08-01'), targetDate: d('2026-09-14'), title: 'Finished, awaiting submit' });
    const r1 = await runGoalSweep(prisma, NOW);
    expect(r1.scanned).toBeGreaterThanOrEqual(4);
    const risk = async (id: string) => (await prisma.goal.findUniqueOrThrow({ where: { id } })).risk;
    expect(await risk(behind.id)).toBe('AT_RISK');
    expect(await risk(fine.id)).toBe('ON_TRACK');
    expect(await risk(overdue.id)).toBe('OVERDUE');
    expect(await risk(done.id)).toBe('ON_TRACK');
    expect((await prisma.goal.findUniqueOrThrow({ where: { id: behind.id } })).version).toBe(1); // derived data: no version bump

    const evs = await events(behind.id);
    expect(evs.map((e) => e.eventType).sort()).toEqual(['goal.at_risk', 'notification.requested']);
    const note = evs.find((e) => e.eventType === 'notification.requested')!;
    expect(note.payload).toMatchObject({ type: 'goal.at_risk', title: 'A goal is at risk' });
    expect((note.payload as { userIds: string[] }).userIds.sort()).toEqual([owner, reviewer].sort());
    expect(JSON.stringify(note.payload)).not.toContain('Sweep goal'); // generic title only
    expect(await events(fine.id)).toHaveLength(0);
    expect((await events(overdue.id, 'notification.requested'))[0]!.payload).toMatchObject({ title: 'A goal is overdue' });

    const total = (await prisma.outboxEvent.count({ where: { aggregateId: { in: [behind.id, fine.id, overdue.id, done.id] } } }));
    const r2 = await runGoalSweep(prisma, NOW); // restart / concurrent / hourly re-run on the same day
    const r3 = await runGoalSweep(prisma, new Date(NOW.getTime() + 3_600_000));
    expect(r2.queued + r3.queued).toBe(0);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: { in: [behind.id, fine.id, overdue.id, done.id] } } })).toBe(total);
    // the next business day raises a fresh daily reminder
    const next = await runGoalSweep(prisma, new Date(NOW.getTime() + 86_400_000));
    expect(next.queued).toBeGreaterThanOrEqual(2);
    expect(await events(behind.id, 'goal.at_risk')).toHaveLength(2);
  });

  it('sends target-date reminders at the configured offsets once, and not for finished or non-active goals', async () => {
    // default offsets [7, 3]: target in 7 days -> reminder to the owner
    const g7 = await goal({ progressPct: 90, startDate: d('2026-09-10'), targetDate: d('2026-10-22'), title: 'Due in a week' });
    const g5 = await goal({ progressPct: 90, startDate: d('2026-09-10'), targetDate: d('2026-10-20'), title: 'Due in five' });
    const pending = await goal({ progressPct: 10, status: 'PENDING_VERIFICATION', startDate: d('2026-09-10'), targetDate: d('2026-10-22'), title: 'Pending verification' });
    const cancelled = await goal({ progressPct: 10, status: 'CANCELLED', startDate: d('2026-09-10'), targetDate: d('2026-10-22'), title: 'Cancelled' });
    await runGoalSweep(prisma, NOW);
    await runGoalSweep(prisma, NOW);
    const r7 = await events(g7.id, 'notification.requested');
    expect(r7).toHaveLength(1);
    expect(r7[0]!.payload).toMatchObject({ type: 'goal.update', userIds: [owner], title: 'A goal target date is approaching' });
    expect(await events(g5.id)).toHaveLength(0);
    expect(await events(pending.id)).toHaveLength(0);
    expect(await events(cancelled.id)).toHaveLength(0);
    // 3 days later (target 22 Oct => 19 Oct) a second, distinct reminder
    await runGoalSweep(prisma, new Date(NOW.getTime() + 4 * 86_400_000));
    expect(await events(g7.id, 'notification.requested')).toHaveLength(2);
  });

  it('honours a per-organisation policy (atRiskGapPct)', async () => {
    const org2 = await prisma.organization.create({ data: { name: '[TEST] wf-b-worker-2', slug: `wfb2-${randomUUID().slice(0, 8)}` } });
    const u = await prisma.user.create({ data: { organizationId: org2.id, email: `p-${randomUUID().slice(0, 6)}@test.local`, name: 'p' } });
    await prisma.workforceSetting.create({ data: { organizationId: org2.id, config: { goals: { atRiskGapPct: 60 } } } });
    const g = await prisma.goal.create({ data: { organizationId: org2.id, ownerId: u.id, createdById: u.id, title: 'Lenient', startDate: d('2026-10-01'), targetDate: d('2026-11-14'), progressPct: 5 } });
    await runGoalSweep(prisma, NOW); // gap 28 < 60 -> ON_TRACK
    expect((await prisma.goal.findUniqueOrThrow({ where: { id: g.id } })).risk).toBe('ON_TRACK');
    expect(await events(g.id)).toHaveLength(0);
  });
});

describe('runTaskSweep', () => {
  const task = (over: Record<string, unknown> = {}) =>
    prisma.workTask.create({ data: { organizationId: orgId, title: 'Sweep task', assigneeId: owner, assignerId: reviewer, status: 'IN_PROGRESS', ...over } });

  it('queues one overdue event + notification per task and due instant, once only', async () => {
    const late = await task({ dueAt: new Date(NOW.getTime() - 3_600_000) });
    const soon = await task({ dueAt: new Date(NOW.getTime() + 3 * 3_600_000), title: 'Due soon' });
    const far = await task({ dueAt: new Date(NOW.getTime() + 3 * 86_400_000), title: 'Far away' });
    const noDue = await task({ title: 'No due date' });
    const done = await task({ dueAt: new Date(NOW.getTime() - 3_600_000), status: 'COMPLETED', title: 'Done' });
    const review = await task({ dueAt: new Date(NOW.getTime() - 3_600_000), status: 'REVIEW', title: 'Waiting on assigner' });
    await runTaskSweep(prisma, NOW);
    const lateNotes = await events(late.id, 'notification.requested');
    expect(lateNotes).toHaveLength(1);
    expect(lateNotes[0]!.payload).toMatchObject({ type: 'work_task.overdue', title: 'A task is overdue' });
    expect((lateNotes[0]!.payload as { userIds: string[] }).userIds.sort()).toEqual([owner, reviewer].sort());
    expect(await events(late.id, 'work_task.overdue')).toHaveLength(1);
    const soonNote = await events(soon.id);
    expect(soonNote).toHaveLength(1);
    expect(soonNote[0]!.payload).toMatchObject({ type: 'work_task.update', userIds: [owner], title: 'A task is due soon' });
    expect(await events(far.id)).toHaveLength(0);
    expect(await events(noDue.id)).toHaveLength(0);
    expect(await events(done.id)).toHaveLength(0);
    expect((await events(review.id, 'notification.requested'))[0]!.payload).toMatchObject({ userIds: [reviewer] }); // the assignee is not nagged while the assigner reviews

    const count = () => prisma.outboxEvent.count({ where: { aggregateId: { in: [late.id, soon.id, far.id, noDue.id, done.id, review.id] } } });
    const before = await count();
    const again = await Promise.all([runTaskSweep(prisma, NOW), runTaskSweep(prisma, new Date(NOW.getTime() + 60_000)), runTaskSweep(prisma, NOW)]);
    expect(again.reduce((n, r) => n + r.queued, 0)).toBe(0);
    expect(await count()).toBe(before);

    // moving the due date re-arms the reminder for the new date, and the old key is not reused
    await prisma.workTask.update({ where: { id: late.id }, data: { dueAt: new Date(NOW.getTime() - 1_800_000) } });
    await runTaskSweep(prisma, NOW);
    expect(await events(late.id, 'notification.requested')).toHaveLength(2);
  });
});

describe('registration', () => {
  it('registers both sweeps as repeatable jobs on their own queues', () => {
    const reg = buildRegistry();
    expect(reg.repeatables.filter((r) => r.name === 'workforce-goal-sweep' || r.name === 'workforce-task-sweep').map((r) => r.queue).sort()).toEqual(['workforce-goals', 'workforce-tasks']);
    expect(reg.processors.filter((p) => p.queue === 'workforce-goals' || p.queue === 'workforce-tasks')).toHaveLength(2);
  });
});
