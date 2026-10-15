import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { createLeadTx, directDeps, type Tx } from '@salesos/crm-core';
import { CRM_EVENTS, PEOPLE_EVENTS, SOP_EVENTS, type DomainEvent } from '@salesos/shared-types';
import { buildRegistry, type JobContext } from '../src/jobs/registry';
import { scanOverdue } from '../src/jobs/crm/scans';
import { loadWorkerEnv } from '../src/config';
import { createLogger } from '../src/logger';
import { WORKER_TEST_DB } from './global-setup';

/**
 * KI-F-04 (resolved): the CRM routes its notifications through the platform notifier, the generic CRM mapping is OFF by
 * default, so one fact produces exactly one in-app notification. Also: the other domains' events reach the notifier.
 */
delete process.env.PLATFORM_AUTO_NOTIFY_CRM_EVENTS;
const DB = process.env.TEST_WORKER_DATABASE_URL ?? WORKER_TEST_DB;
const tag = () => randomUUID().slice(0, 8);
const log = createLogger('silent');
const registry = buildRegistry();
let prisma: PrismaClient;
let ctx: JobContext;
let orgId: string;
const users: Record<string, string> = {};

const ev = (eventType: string, payload: object, aggregateId: string = randomUUID(), id: string = randomUUID()): DomainEvent => ({ id, eventType, aggregateType: eventType.split('.')[0]!, aggregateId, organizationId: orgId, payload, occurredAt: new Date().toISOString(), attempt: 0 });
const run = async (e: DomainEvent) => { for (const h of registry.handlers.get(e.eventType) ?? []) await h(e, ctx); };
async function mk(role: string, managerId?: string) {
  const r = await prisma.role.upsert({ where: { key: role }, update: {}, create: { key: role, name: role } });
  const u = await prisma.user.create({ data: { organizationId: orgId, email: `${tag()}@unified.local`, name: `[TEST] ${role}`, managerId: managerId ?? null } });
  await prisma.userRoleAssignment.create({ data: { organizationId: orgId, userId: u.id, roleId: r.id } });
  return u.id;
}
const mine = (userId: string, type: string) => prisma.notification.findMany({ where: { userId, type } });

beforeAll(async () => {
  prisma = new PrismaClient({ datasourceUrl: DB });
  ctx = { prisma, log, env: { ...loadWorkerEnv({ ...process.env, DATABASE_URL: DB }), EVENT_JOB_ATTEMPTS: 3 }, connection: undefined as never, queue: () => { throw new Error('no queue'); } };
  orgId = (await prisma.organization.create({ data: { name: '[TEST] unified notifications', slug: `un-${tag()}` } })).id;
  users.teamLead = await mk('SALES_TEAM_LEAD');
  users.manager = await mk('SALES_MANAGER', users.teamLead);
  users.exec = await mk('SALES_EXECUTIVE', users.manager);
  users.hr = await mk('HR');
  users.founder = await mk('FOUNDER_CEO');
  users.finance = await mk('FINANCE');
  await prisma.automationRule.create({ data: { organizationId: orgId, scopeKey: 'ORG', ruleKey: 'WORKING_HOURS', config: { timezone: 'UTC', days: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '23:59', holidays: [] } } });
});
afterAll(async () => {
  await prisma.outboxEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.$disconnect();
});

describe('CRM + platform: one fact, one notification', () => {
  it('a task.overdue goes through the real pipeline (scan -> outbox row -> every registered handler, redelivered) and yields exactly ONE in-app notification', async () => {
    const lead = (await prisma.$transaction((tx: Tx) => createLeadTx(tx, directDeps(), { userId: users.exec!, organizationId: orgId }, { fullName: `[TEST] ${tag()}`, phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`, assignedToId: users.exec }))).lead;
    const task = await prisma.task.create({ data: { organizationId: orgId, leadId: lead.id, assignedToId: users.exec!, type: 'CALL', title: `[TEST] t ${tag()}`, dueAt: new Date(Date.now() - 5 * 60_000) } });
    await scanOverdue({ prisma, log });
    await scanOverdue({ prisma, log });
    const rows = await prisma.outboxEvent.findMany({ where: { eventType: CRM_EVENTS.TASK_OVERDUE, aggregateId: task.id } });
    expect(rows).toHaveLength(1);
    const e = ev(CRM_EVENTS.TASK_OVERDUE, rows[0]!.payload as object, task.id, rows[0]!.id);
    await run(e);
    await run({ ...e, attempt: 1 }); // at-least-once redelivery
    const inApp = await prisma.notification.findMany({ where: { userId: users.exec!, entityId: task.id } });
    expect(inApp).toHaveLength(1);
    expect(inApp[0]).toMatchObject({ type: 'follow_up.overdue', status: 'UNREAD' });
    expect(inApp[0]!.actionUrl).toBe(`/crm/leads/${lead.id}`);
    // the CRM ledger keeps one row mirroring the platform result; it is not a second inbox
    const ledger = await prisma.crmNotificationDelivery.findMany({ where: { entityId: task.id, recipientId: users.exec! } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.status).toBe('DELIVERED');
    // and nothing else was raised for anyone else at level 1
    expect(await prisma.notification.count({ where: { entityId: task.id } })).toBe(1);
  });

  it('the generic CRM event mapping is off by default; opting in adds exactly one more handler per CRM event (the documented switch)', () => {
    const count = (t: string) => buildRegistry().handlers.get(t)?.length ?? 0;
    const types = [CRM_EVENTS.TASK_DUE, CRM_EVENTS.TASK_REMINDER, CRM_EVENTS.TASK_OVERDUE, CRM_EVENTS.TASK_ESCALATED, CRM_EVENTS.LEAD_UNATTENDED, CRM_EVENTS.LEAD_EXCEPTION_RAISED];
    const off = types.map(count);
    process.env.PLATFORM_AUTO_NOTIFY_CRM_EVENTS = 'true';
    try {
      expect(types.map(count)).toEqual(off.map((n) => n + 1));
    } finally {
      delete process.env.PLATFORM_AUTO_NOTIFY_CRM_EVENTS;
    }
  });
});

describe('other domains reach the platform notifier', () => {
  it('people: review submitted -> approvers; review approved -> employee; coaching action -> owner; PIP -> employee / approvers; recognition, resource, probation', async () => {
    await run(ev(PEOPLE_EVENTS.REVIEW_SUBMITTED, { reviewId: randomUUID(), to: 'SUBMITTED', actorId: users.manager, employeeId: users.exec }));
    expect((await mine(users.teamLead!, 'review.pending')).length).toBe(1);
    expect((await mine(users.hr!, 'review.pending')).length).toBe(1);
    expect((await mine(users.exec!, 'review.pending')).length).toBe(0); // the employee is not told about a submitted review
    await run(ev(PEOPLE_EVENTS.REVIEW_APPROVED, { reviewId: randomUUID(), to: 'APPROVED', actorId: users.teamLead, employeeId: users.exec }));
    expect((await mine(users.exec!, 'review.pending')).length).toBe(1);

    await run(ev(PEOPLE_EVENTS.COACHING_ACTION_ASSIGNED, { actionId: randomUUID(), ownerId: users.exec, dueDate: null }));
    expect((await mine(users.exec!, 'coaching.action_pending')).length).toBe(1);

    await run(ev(PEOPLE_EVENTS.PIP_SUBMITTED, { pipId: randomUUID(), employeeId: users.exec, from: 'DRAFT', to: 'PENDING_APPROVAL', actorId: users.teamLead }));
    expect((await mine(users.founder!, 'pip.update')).length).toBe(1);
    expect((await mine(users.hr!, 'pip.update')).length).toBe(1);
    expect((await mine(users.exec!, 'pip.update')).length).toBe(0); // approvers only until the plan is active
    await run(ev(PEOPLE_EVENTS.PIP_ACTIVATED, { pipId: randomUUID(), employeeId: users.exec, from: 'PENDING_APPROVAL', to: 'ACTIVE', actorId: users.hr }));
    expect((await mine(users.exec!, 'pip.update')).length).toBe(1);

    await run(ev(PEOPLE_EVENTS.RECOGNITION_GRANTED, { recognitionId: randomUUID(), recipientId: users.exec, programName: 'Star' }));
    await run(ev(PEOPLE_EVENTS.RESOURCE_ASSIGNED, { resourceId: randomUUID(), resourceTitle: 'x', userId: users.exec }));
    expect((await mine(users.exec!, 'recognition.received')).length).toBe(1);
    expect((await mine(users.exec!, 'resource.assigned')).length).toBe(1);

    await run(ev(PEOPLE_EVENTS.PROBATION_DUE, { probationReviewId: randomUUID(), employeeId: users.exec, checkpointDay: 30, dueDate: '2026-11-01' }));
    expect((await mine(users.hr!, 'probation.review_due')).length).toBe(1);
    expect((await mine(users.exec!, 'probation.review_due')).length).toBe(0);

    await run(ev(PEOPLE_EVENTS.INCENTIVE_SUBMITTED, { recommendationId: randomUUID(), employeeId: users.exec, from: 'DRAFT', to: 'SUBMITTED', actorId: users.hr }));
    expect((await mine(users.founder!, 'incentive.update')).length).toBe(1);
    expect((await mine(users.exec!, 'incentive.update')).length).toBe(0);
    await run(ev(PEOPLE_EVENTS.INCENTIVE_PAID, { recommendationId: randomUUID(), employeeId: users.exec, from: 'APPROVED', to: 'PAID', actorId: users.finance }));
    expect((await mine(users.exec!, 'incentive.update')).length).toBe(1);
  });

  it('sop: submitted -> approvers; rejected -> author; acknowledgement reminder -> the user (idempotent per event)', async () => {
    await run(ev(SOP_EVENTS.VERSION_SUBMITTED, { versionId: randomUUID(), documentId: randomUUID(), submittedById: users.manager }));
    expect((await mine(users.teamLead!, 'sop.approval_pending')).length).toBe(1);
    expect((await mine(users.founder!, 'sop.approval_pending')).length).toBe(1);
    await run(ev(SOP_EVENTS.VERSION_REJECTED, { versionId: randomUUID(), authorId: users.manager, reason: 'unclear' }));
    expect((await mine(users.manager!, 'sop.update')).length).toBe(1);
    const reminder = ev(SOP_EVENTS.ACK_REMINDER, { versionId: randomUUID(), documentId: randomUUID(), documentTitle: 't', userId: users.exec });
    await run(reminder);
    await run(reminder);
    expect((await mine(users.exec!, 'sop.ack_due')).length).toBe(1);
  });

  it('revenue and cx publish through the same notifier (payment, refund, complaint, handover)', async () => {
    await run(ev('payment.verified', { organizationId: orgId, ownerId: users.exec, paymentId: randomUUID() }));
    expect((await mine(users.exec!, 'collection.status_changed')).length).toBe(1);
    await run(ev('refund.requested', { organizationId: orgId, refundId: randomUUID() }));
    expect((await mine(users.finance!, 'refund.status_changed')).length).toBe(1);
    await run(ev('complaint.created', { organizationId: orgId, complaintId: randomUUID(), ownerId: users.manager }));
    expect((await mine(users.manager!, 'complaint.created')).length).toBe(1);
    const ss = await mk('STUDENT_SUCCESS');
    await run(ev('handover.submitted', { organizationId: orgId, handoverId: randomUUID() }));
    expect((await mine(ss, 'handover.pending')).length).toBe(1);
  });
});
