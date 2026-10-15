import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import type { DomainEvent } from '@salesos/shared-types';
import { complaintDeadlines, DEFAULT_CX_CONFIG, toWorkingHours } from '@salesos/cx-core';
import { createRedis } from '../src/redis';
import { dispatchOnce } from '../src/outbox/dispatcher';
import { startEventConsumer } from '../src/outbox/event-consumer';
import { buildRegistry, type JobContext } from '../src/jobs/registry';
import { loadWorkerEnv } from '../src/config';
import { createLogger } from '../src/logger';
import { QUEUES } from '../src/queues';
import { CX_SWEEP_QUEUE } from '../src/jobs/cx';

const DB = process.env.TEST_WORKER_DATABASE_URL ?? 'postgresql://salesos:salesos_dev_only@127.0.0.1:5533/salesos_agentb_wtest?schema=public';
const REDIS = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6391';
const prefix = `salesos-cx-test-${randomUUID().slice(0, 8)}`;
const log = createLogger('silent');
const tag = () => randomUUID().slice(0, 8);

let prisma: PrismaClient;
let orgId: string;
let ownerId: string;
let managerId: string;
let leadId: string;
const ev = (eventType: string, payload: unknown, id: string = randomUUID()): DomainEvent => ({ id, eventType, aggregateType: 'x', aggregateId: 'x', organizationId: orgId, payload, occurredAt: new Date().toISOString(), attempt: 0 });
const ctx = (): JobContext => ({ prisma, log, env: loadWorkerEnv({ DATABASE_URL: DB, REDIS_URL: REDIS, BULLMQ_PREFIX: prefix } as NodeJS.ProcessEnv), connection: { host: '127.0.0.1', port: 6391 }, queue: () => { throw new Error('unused'); } });
const waitFor = async (fn: () => Promise<boolean>, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error('timeout'); };

beforeAll(async () => {
  prisma = new PrismaClient({ datasourceUrl: DB });
  orgId = (await prisma.organization.create({ data: { name: '[TEST] worker cx', slug: `wcx-${tag()}` } })).id;
  const role = await prisma.role.upsert({ where: { key: 'SALES_MANAGER' }, update: {}, create: { key: 'SALES_MANAGER', name: 'SALES_MANAGER' } });
  managerId = (await prisma.user.create({ data: { organizationId: orgId, email: `${tag()}@wtest.local`, name: '[TEST] manager' } })).id;
  await prisma.userRoleAssignment.create({ data: { organizationId: orgId, userId: managerId, roleId: role.id } });
  ownerId = (await prisma.user.create({ data: { organizationId: orgId, email: `${tag()}@wtest.local`, name: '[TEST] owner', managerId } })).id;
  leadId = (await prisma.lead.create({ data: { organizationId: orgId, fullName: '[TEST] Asha', phoneE164: '+919800000099', status: 'WON', stageCategory: 'WON', assignedToId: ownerId, preferredLanguage: 'mr' } })).id;
});
afterAll(async () => {
  // leave no PENDING outbox rows behind: other worker suites dispatch the oldest rows of this shared test DB in small batches
  await prisma.outboxEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.$disconnect();
});

describe('cx job registration', () => {
  it('subscribes to lead.won / deal.closed / deal.won and owns the cx-sweeps queue (every 5 minutes)', () => {
    const r = buildRegistry();
    for (const t of ['lead.won', 'deal.closed', 'deal.won']) expect(r.handlers.get(t)?.length ?? 0, t).toBeGreaterThan(0);
    expect(r.processors.some((p) => p.queue === CX_SWEEP_QUEUE)).toBe(true);
    expect(r.repeatables.find((x) => x.queue === CX_SWEEP_QUEUE)?.everyMs).toBe(300_000);
  });
});

describe('handover creation from the sale-won events', () => {
  it('creates ONE draft handover per sale however often the events are redelivered, and ignores LOST closes', async () => {
    const r = buildRegistry();
    const dealId = randomUUID();
    const handler = r.handlers.get('lead.won')![0]!;
    const e1 = ev('lead.won', { leadId, assignedToId: ownerId, programId: null, value: '20000.00', currency: 'INR', wonAt: new Date().toISOString() });
    await handler(e1, ctx());
    await handler(e1, ctx()); // at-least-once redelivery
    expect(await prisma.handoverRecord.count({ where: { organizationId: orgId, leadId } })).toBe(1);
    const h = await prisma.handoverRecord.findFirstOrThrow({ where: { organizationId: orgId, leadId } });
    expect(h).toMatchObject({ status: 'DRAFT', ownerId, learnerName: '[TEST] Asha', languagePreference: 'MR' });
    // the revenue event for the same sale attaches its deal id instead of creating a second handover
    await r.handlers.get('deal.closed')![0]!(ev('deal.closed', { dealId, leadId, outcome: 'WON', ownerId }), ctx());
    expect(await prisma.handoverRecord.count({ where: { organizationId: orgId, leadId } })).toBe(1);
    expect((await prisma.handoverRecord.findUniqueOrThrow({ where: { id: h.id } })).dealId).toBe(dealId);
    const other = (await prisma.lead.create({ data: { organizationId: orgId, fullName: '[TEST] Lost', status: 'LOST', stageCategory: 'LOST', assignedToId: ownerId } })).id;
    await r.handlers.get('deal.closed')![0]!(ev('deal.closed', { dealId: randomUUID(), leadId: other, outcome: 'LOST', ownerId }), ctx());
    expect(await prisma.handoverRecord.count({ where: { organizationId: orgId, leadId: other } })).toBe(0);
  });

  it('flows end to end: outbox row -> dispatcher -> BullMQ -> event consumer -> handover', async () => {
    const redis = createRedis(REDIS);
    const events = new Queue(QUEUES.DOMAIN_EVENTS, { connection: redis, prefix });
    const dead = new Queue(QUEUES.DEAD_LETTER, { connection: redis, prefix });
    const c = ctx();
    const lead = (await prisma.lead.create({ data: { organizationId: orgId, fullName: '[TEST] E2E', status: 'WON', stageCategory: 'WON', assignedToId: ownerId } })).id;
    const dealId = randomUUID();
    const consumer = startEventConsumer({ connection: redis, env: c.env, prisma, deadLetter: dead, handlers: buildRegistry().handlers, ctx: c, log });
    try {
      await prisma.outboxEvent.create({ data: { organizationId: orgId, aggregateType: 'deal', aggregateId: dealId, eventType: 'deal.closed', payload: { dealId, leadId: lead, outcome: 'WON', ownerId, saleValue: '30000.00', currency: 'INR' } } });
      await dispatchOnce(prisma, events, { batchSize: 20, maxDispatchAttempts: 3, jobAttempts: 3, jobBackoffMs: 20 });
      await waitFor(async () => (await prisma.handoverRecord.count({ where: { dealId } })) === 1);
      const h = await prisma.handoverRecord.findFirstOrThrow({ where: { dealId } });
      expect(h.amountDue?.toString()).toBe('30000');
      expect(h.status).toBe('DRAFT');
    } finally {
      await consumer.close();
      await events.close(); await dead.close(); redis.disconnect();
    }
  });
});

describe('cx-sweeps processor', () => {
  it('detects complaint SLA breaches, handover overdue and overdue action items in one run, and is idempotent', async () => {
    const r = buildRegistry();
    const proc = r.processors.find((p) => p.queue === CX_SWEEP_QUEUE)!;
    const past = new Date(Date.now() - 3 * 86_400_000);
    const dl = complaintDeadlines('P1', past, DEFAULT_CX_CONFIG, toWorkingHours(DEFAULT_CX_CONFIG));
    const complaint = await prisma.complaint.create({ data: { organizationId: orgId, leadId, title: '[TEST] late', description: 'x', category: 'OTHER', priority: 'P1', ownerId, createdById: ownerId, slaStartedAt: past, firstResponseDueAt: dl.firstResponseDueAt, resolutionDueAt: dl.resolutionDueAt } });
    // one OPEN handover per learner is a database rule (handover_one_open_per_lead): this sweep uses its own lead
    const sweepLead = await prisma.lead.create({ data: { organizationId: orgId, fullName: '[TEST] sweep learner', status: 'WON', stageCategory: 'WON', assignedToId: ownerId } });
    const handover = await prisma.handoverRecord.create({ data: { organizationId: orgId, ownerId, leadId: sweepLead.id, status: 'SUBMITTED', submittedAt: past, ackDueAt: new Date(past.getTime() + 86_400_000) } });
    const item = await prisma.actionItem.create({ data: { organizationId: orgId, title: '[TEST] item', ownerId, createdById: managerId, dueAt: new Date(Date.now() - 3_600_000) } });
    const run = () => proc.process({ data: {} } as never, ctx());
    await run();
    const c = await prisma.complaint.findUniqueOrThrow({ where: { id: complaint.id } });
    expect(c.firstResponseBreachedAt).toBeTruthy();
    expect(c.resolutionBreachedAt).toBeTruthy();
    expect(c.breachLevel).toBe(3); // days late: owner, team lead and (P1) founder all alerted
    expect((await prisma.handoverRecord.findUniqueOrThrow({ where: { id: handover.id } })).status).toBe('OVERDUE');
    expect((await prisma.actionItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe('OVERDUE');
    const before = await prisma.outboxEvent.count({ where: { organizationId: orgId } });
    await run();
    await Promise.all([run(), run()]);
    expect(await prisma.outboxEvent.count({ where: { organizationId: orgId } })).toBe(before); // second/third/concurrent runs publish nothing new
    expect(await prisma.outboxEvent.count({ where: { aggregateId: complaint.id, eventType: 'complaint.sla_breached' } })).toBe(3);
  });
});
