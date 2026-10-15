import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { CRM_EVENTS, IDENTITY_EVENTS, type DomainEvent } from '@salesos/shared-types';
import { createLeadTx, directDeps, processImportJob, type Tx } from '@salesos/crm-core';
import { createRedis } from '../src/redis';
import { dispatchOnce } from '../src/outbox/dispatcher';
import { startEventConsumer } from '../src/outbox/event-consumer';
import { buildRegistry, type JobContext } from '../src/jobs/registry';
import { loadWorkerEnv } from '../src/config';
import { createLogger } from '../src/logger';
import { QUEUES } from '../src/queues';
import { makeHandlers } from '../src/jobs/crm/handlers';
import { MAX_DELIVERY_ATTEMPTS, enqueueNotification, retryDeliveries } from '../src/jobs/crm/notifications';
import { CRM_SCAN_QUEUE, SCAN_JOBS, runScan } from '../src/jobs/crm';
import { scanDueReminders, scanOverdue, scanReactivation, scanUnattended } from '../src/jobs/crm/scans';

const DB = process.env.TEST_WORKER_DATABASE_URL ?? 'postgresql://salesos:salesos_dev_only@127.0.0.1:5533/salesos_agentb_wtest?schema=public';
const REDIS = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6391';
const prefix = `salesos-crm-test-${randomUUID().slice(0, 8)}`;
const log = createLogger('silent');
const deps = directDeps();
const tag = () => randomUUID().slice(0, 8);

let prisma: PrismaClient;
let orgId: string;
let managerId: string;
let teamLeadId: string;
let ownerId: string;
const notifier = () => makeHandlers(prisma);

async function mkUser(role: string, managerOf?: string) {
  const r = await prisma.role.upsert({ where: { key: role }, update: {}, create: { key: role, name: role } });
  const u = await prisma.user.create({ data: { organizationId: orgId, email: `${tag()}@wtest.local`, name: `[TEST] ${role}`, managerId: managerOf ?? null } });
  await prisma.userRoleAssignment.create({ data: { organizationId: orgId, userId: u.id, roleId: r.id } });
  return u;
}
/** 24x7 working hours so elapsed-working-time maths is deterministic whatever day the suite runs on */
async function always24x7() {
  await prisma.automationRule.upsert({
    where: { organizationId_scopeKey_ruleKey: { organizationId: orgId, scopeKey: 'ORG', ruleKey: 'WORKING_HOURS' } },
    update: { config: { timezone: 'UTC', days: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '23:59', holidays: [] } },
    create: { organizationId: orgId, scopeKey: 'ORG', ruleKey: 'WORKING_HOURS', config: { timezone: 'UTC', days: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '23:59', holidays: [] } },
  });
}
async function mkLead(owner: string | null, name = `[TEST] ${tag()}`) {
  return prisma.$transaction((tx: Tx) => createLeadTx(tx, deps, { userId: owner, organizationId: orgId }, { fullName: name, phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`, assignedToId: owner }));
}
async function mkTask(owner: string, leadId: string | null, dueAt: Date, extra: Record<string, unknown> = {}) {
  return prisma.task.create({ data: { organizationId: orgId, leadId, assignedToId: owner, type: 'CALL', title: `[TEST] task ${tag()}`, dueAt, ...extra } });
}
const ev = (eventType: string, payload: unknown, id: string = randomUUID()): DomainEvent => ({ id, eventType, aggregateType: 'x', aggregateId: 'x', organizationId: orgId, payload, occurredAt: new Date().toISOString(), attempt: 0 });
const events = (eventType: string, aggregateId: string) => prisma.outboxEvent.findMany({ where: { eventType, aggregateId } });

beforeAll(async () => {
  prisma = new PrismaClient({ datasourceUrl: DB });
  // leftovers of earlier runs must not crowd other suites' relay batches (the outbox spec relays the oldest PENDING rows)
  await prisma.outboxEvent.deleteMany({ where: { status: 'PENDING', organization: { name: '[TEST] worker crm' } } });
  orgId = (await prisma.organization.create({ data: { name: '[TEST] worker crm', slug: `wcrm-${tag()}` } })).id;
  teamLeadId = (await mkUser('SALES_TEAM_LEAD')).id;
  managerId = (await mkUser('SALES_MANAGER', teamLeadId)).id;
  ownerId = (await mkUser('SALES_EXECUTIVE', managerId)).id;
  await always24x7();
});
afterAll(async () => {
  await prisma.outboxEvent.deleteMany({ where: { organizationId: orgId, status: 'PENDING' } }); // keep the shared test DB tidy for the outbox suite
  await prisma.$disconnect();
});

describe('due reminders: idempotent, atomic claim, survive restart', () => {
  it('publishes task.due once per (task, due time) however often the scan runs, and the handler stores exactly one in-app notification', async () => {
    const lead = (await mkLead(ownerId)).lead;
    const task = await mkTask(ownerId, lead.id, new Date(Date.now() - 60_000));
    for (let i = 0; i < 3; i++) await scanDueReminders({ prisma, log, workerId: `w${i}` });
    const published = await events(CRM_EVENTS.TASK_DUE, task.id);
    expect(published).toHaveLength(1);
    const e = ev(CRM_EVENTS.TASK_DUE, published[0]!.payload, published[0]!.id);
    await notifier()[CRM_EVENTS.TASK_DUE](e);
    await notifier()[CRM_EVENTS.TASK_DUE](e); // at-least-once redelivery
    await notifier()[CRM_EVENTS.TASK_DUE]({ ...e, id: randomUUID() }); // different event, same window
    const rows = await prisma.crmNotificationDelivery.findMany({ where: { entityId: task.id, kind: 'task.due' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.recipientId).toBe(ownerId);
    expect(rows[0]!.status).toBe('DELIVERED'); // the platform notifier stored it in the user's inbox (KI-F-04); external channels would stay QUEUED/SENT
  });

  it('a worker that crashes after claiming loses nothing: the claim expires, the next scan finishes the job once', async () => {
    const task = await mkTask(ownerId, null, new Date(Date.now() - 30_000));
    await expect(scanDueReminders({ prisma, log, workerId: 'crash', afterClaim: (ts) => { if (ts.some((t) => t.id === task.id)) throw new Error('worker crashed'); } })).rejects.toThrow('worker crashed');
    // the crashing run's finally released the lock; simulate a hard kill (no finally) by re-locking with a live lease
    await prisma.task.update({ where: { id: task.id }, data: { lockedBy: 'dead-worker', lockedUntil: new Date(Date.now() + 60_000) } });
    const during = await scanDueReminders({ prisma, log, workerId: 'other' });
    expect(during.claimed).toBe(0); // atomic lock: nobody else may take a live claim
    expect(await events(CRM_EVENTS.TASK_DUE, task.id)).toHaveLength(0);
    await prisma.task.update({ where: { id: task.id }, data: { lockedUntil: new Date(Date.now() - 1000) } }); // lease expired
    await scanDueReminders({ prisma, log, workerId: 'restarted' });
    await scanDueReminders({ prisma, log, workerId: 'restarted-again' });
    expect(await events(CRM_EVENTS.TASK_DUE, task.id)).toHaveLength(1);
  });

  it('concurrent workers never double-process: N tasks, N events', async () => {
    const tasks = await Promise.all(Array.from({ length: 12 }, () => mkTask(ownerId, null, new Date(Date.now() - 20_000))));
    await Promise.all([1, 2, 3, 4].map((i) => scanDueReminders({ prisma, log, workerId: `par${i}` })));
    const counts = await Promise.all(tasks.map(async (t) => (await events(CRM_EVENTS.TASK_DUE, t.id)).length));
    expect(counts.every((c) => c === 1)).toBe(true);
  });

  it('CALLBACK tasks get a reminder N minutes before due and a due event at due time; completed/rescheduled tasks stay silent', async () => {
    const t = await mkTask(ownerId, null, new Date(Date.now() + 10 * 60_000), { type: 'CALLBACK', isPinned: true });
    await scanDueReminders({ prisma, log });
    expect(await events(CRM_EVENTS.TASK_REMINDER, t.id)).toHaveLength(1);
    expect(await events(CRM_EVENTS.TASK_DUE, t.id)).toHaveLength(0);
    const rem = (await events(CRM_EVENTS.TASK_REMINDER, t.id))[0]!;
    await prisma.task.update({ where: { id: t.id }, data: { status: 'DONE' } });
    await notifier()[CRM_EVENTS.TASK_REMINDER](ev(CRM_EVENTS.TASK_REMINDER, rem.payload, rem.id));
    expect(await prisma.crmNotificationDelivery.count({ where: { entityId: t.id } })).toBe(0);
  });
});

describe('overdue escalation (owner at T0, repeat +4h, manager +1 working day, team lead +3 working days)', () => {
  const run = async (ageMs: number) => {
    const lead = (await mkLead(ownerId)).lead;
    const t = await mkTask(ownerId, lead.id, new Date(Date.now() - ageMs));
    await scanOverdue({ prisma, log });
    await scanOverdue({ prisma, log }); // idempotent
    const od = [...(await events(CRM_EVENTS.TASK_OVERDUE, t.id)), ...(await events(CRM_EVENTS.TASK_ESCALATED, t.id))];
    for (const e of od) {
      const type = e.eventType as typeof CRM_EVENTS.TASK_OVERDUE;
      await notifier()[type](ev(e.eventType, e.payload, e.id));
    }
    const notes = await prisma.crmNotificationDelivery.findMany({ where: { entityId: t.id }, orderBy: { createdAt: 'asc' } });
    return { t, od, notes, row: await prisma.task.findUniqueOrThrow({ where: { id: t.id } }) };
  };
  const min = 60_000;

  it('just overdue: owner notified once', async () => {
    const r = await run(5 * min);
    expect(r.row.overdueLevel).toBe(1);
    expect(r.notes.map((n) => n.recipientId)).toEqual([ownerId]);
  });
  it('after 5h: owner notified again (repeat), still no escalation', async () => {
    const r = await run(5 * 60 * min);
    expect(r.row.overdueLevel).toBe(2);
    expect(r.notes.map((n) => n.recipientId)).toEqual([ownerId, ownerId]);
  });
  it('after 1 working day: escalated to the manager', async () => {
    const r = await run(30 * 60 * min);
    expect(r.row.overdueLevel).toBe(3);
    expect(r.notes.map((n) => n.recipientId)).toEqual([ownerId, ownerId, managerId]);
    expect(r.notes.at(-1)!.kind).toBe('task.escalated');
    expect(r.notes.at(-1)!.severity).toBe('critical');
  });
  it('after 3 working days: escalated to the team lead', async () => {
    const r = await run(4 * 24 * 60 * min);
    expect(r.row.overdueLevel).toBe(4);
    expect(r.notes.map((n) => n.recipientId)).toEqual([ownerId, ownerId, managerId, teamLeadId]);
  });
  it('rescheduling restarts the clock (new due time => new idempotency window)', async () => {
    const r = await run(5 * min);
    await prisma.task.update({ where: { id: r.t.id }, data: { dueAt: new Date(Date.now() - 2 * min), overdueLevel: 0, remindedAt: null } });
    await scanOverdue({ prisma, log });
    expect(await events(CRM_EVENTS.TASK_OVERDUE, r.t.id)).toHaveLength(2);
  });
});

describe('unattended-lead detection', () => {
  it('raises one UNATTENDED exception + one event per quiet period and notifies owner and manager once', async () => {
    const lead = (await mkLead(ownerId)).lead;
    await prisma.lead.update({ where: { id: lead.id }, data: { lastActivityAt: new Date(Date.now() - 5 * 86_400_000) } });
    const r1 = await scanUnattended({ prisma, log });
    const r2 = await scanUnattended({ prisma, log });
    expect(r1.raised).toBeGreaterThanOrEqual(1);
    expect(r2.raised).toBe(0);
    expect(await prisma.leadException.count({ where: { leadId: lead.id, kind: 'UNATTENDED', resolvedAt: null } })).toBe(1);
    const evs = await events(CRM_EVENTS.LEAD_UNATTENDED, lead.id);
    expect(evs).toHaveLength(1);
    const e = ev(CRM_EVENTS.LEAD_UNATTENDED, evs[0]!.payload, evs[0]!.id);
    await notifier()[CRM_EVENTS.LEAD_UNATTENDED](e);
    await notifier()[CRM_EVENTS.LEAD_UNATTENDED](e);
    const notes = await prisma.crmNotificationDelivery.findMany({ where: { entityId: lead.id, kind: 'lead.unattended' } });
    expect(notes.map((n) => n.recipientId).sort()).toEqual([ownerId, managerId].sort());
  });
  it('recent activity or terminal leads are not flagged', async () => {
    const fresh = (await mkLead(ownerId)).lead;
    await prisma.lead.update({ where: { id: fresh.id }, data: { lastActivityAt: new Date() } });
    const lost = (await mkLead(ownerId)).lead;
    await prisma.lead.update({ where: { id: lost.id }, data: { stageCategory: 'LOST', status: 'LOST', lastActivityAt: new Date(Date.now() - 9 * 86_400_000) } });
    await scanUnattended({ prisma, log });
    expect(await prisma.leadException.count({ where: { leadId: { in: [fresh.id, lost.id] }, kind: 'UNATTENDED' } })).toBe(0);
  });
});

describe('user.deactivated -> reassignment queue (idempotent)', () => {
  it('creates one entry for every open lead and open task of the deactivated owner, flags the leads, notifies the manager once', async () => {
    const owner = await mkUser('SALES_EXECUTIVE', managerId);
    const l1 = (await mkLead(owner.id)).lead;
    const l2 = (await mkLead(owner.id)).lead;
    const lostLead = (await mkLead(owner.id)).lead;
    await prisma.lead.update({ where: { id: lostLead.id }, data: { stageCategory: 'LOST', status: 'LOST' } });
    await mkTask(owner.id, null, new Date(Date.now() + 3600_000));
    const openTaskCount = await prisma.task.count({ where: { assignedToId: owner.id, status: 'OPEN' } });
    await prisma.user.update({ where: { id: owner.id }, data: { isActive: false, deactivatedAt: new Date() } });
    const payload = { userId: owner.id, organizationId: orgId, managerId, deactivatedById: managerId, reason: 'left' };
    const event = ev(IDENTITY_EVENTS.USER_DEACTIVATED, payload);
    await notifier()[IDENTITY_EVENTS.USER_DEACTIVATED](event);
    await notifier()[IDENTITY_EVENTS.USER_DEACTIVATED](event); // redelivery
    await notifier()[IDENTITY_EVENTS.USER_DEACTIVATED](ev(IDENTITY_EVENTS.USER_DEACTIVATED, payload)); // duplicate event, other id
    const entries = await prisma.reassignmentQueueEntry.findMany({ where: { previousOwnerId: owner.id } });
    expect(entries.filter((e) => e.leadId && !e.taskId).map((e) => e.leadId).sort()).toEqual([l1.id, l2.id].sort());
    expect(entries.filter((e) => e.taskId)).toHaveLength(openTaskCount);
    expect(entries.every((e) => e.reason === 'OWNER_DEACTIVATED' && e.status === 'OPEN')).toBe(true);
    expect(await prisma.leadException.count({ where: { leadId: { in: [l1.id, l2.id] }, kind: 'OWNER_DEACTIVATED', resolvedAt: null } })).toBe(2);
    const notes = await prisma.crmNotificationDelivery.findMany({ where: { kind: 'reassignment.created', recipientId: managerId, entityId: owner.id } });
    expect(notes).toHaveLength(1);
  });
});

describe('import worker: resumable + idempotent', () => {
  it('a crash mid-file leaves the job resumable and the re-run creates every row exactly once', async () => {
    const csv = ['name,phone,email', ...Array.from({ length: 8 }, (_, i) => `[TEST] Imp ${tag()} ${i},9${810000000 + Math.floor(Math.random() * 9000000)},,`)].join('\n');
    const creator = await mkUser('SALES_MANAGER', teamLeadId);
    const job = await prisma.importJob.create({ data: { organizationId: orgId, createdById: creator.id, idempotencyKey: `k-${tag()}`, fileName: 'w.csv', rawCsv: csv, options: {} } });
    await expect(processImportJob(prisma, deps, job.id, { progressEvery: 2, beforeRow: (i) => { if (i === 5) throw new Error('worker died'); } })).rejects.toThrow('worker died');
    const mid = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(mid.status).toBe('RUNNING');
    expect(mid.processedRows).toBe(4);
    const again = await processImportJob(prisma, deps, job.id, { progressEvery: 2 });
    expect(again.status).toBe('COMPLETED');
    expect(await prisma.lead.count({ where: { importJobId: job.id } })).toBe(8);
    const after = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.processedRows).toBe(8);
    expect(after.createdRows).toBe(8);
    // processing a completed job again is a no-op
    expect((await processImportJob(prisma, deps, job.id)).status).toBe('SKIPPED');
    expect(await prisma.lead.count({ where: { importJobId: job.id } })).toBe(8);
  });
});

describe('lost-lead reactivation scan', () => {
  it('moves eligible LOST leads to NURTURE (system) and excludes consent-withdrawn ones', async () => {
    const mk = async (consent: 'GRANTED' | 'WITHDRAWN') => {
      const lead = (await mkLead(ownerId)).lead;
      await prisma.lead.update({ where: { id: lead.id }, data: { status: 'LOST', stageCategory: 'LOST', lostReason: 'BAD_TIMING', consentStatus: consent } });
      await prisma.reactivationEntry.create({ data: { organizationId: orgId, leadId: lead.id, eligibleFrom: new Date(Date.now() - 1000), openKey: `lead:${lead.id}`, lostReason: 'BAD_TIMING' } });
      return lead;
    };
    const ok = await mk('GRANTED');
    const blocked = await mk('WITHDRAWN');
    await scanReactivation({ prisma, log });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: ok.id } })).status).toBe('NURTURE');
    expect((await prisma.reactivationEntry.findFirstOrThrow({ where: { leadId: ok.id } })).status).toBe('ELIGIBLE');
    expect((await prisma.reactivationEntry.findFirstOrThrow({ where: { leadId: blocked.id } })).status).toBe('EXCLUDED');
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: blocked.id } })).status).toBe('LOST');
  });
});

describe('notification delivery tracking', () => {
  const key = () => `k-${tag()}`;
  const base = () => ({ organizationId: orgId, recipientId: ownerId, kind: 'task.due', channel: 'IN_APP' as const, title: 't', idempotencyKey: key() });
  it('failed deliveries are retried with backoff, bounded, and never reported as delivered', async () => {
    const failing = { send: async () => ({ status: 'FAILED' as const, errorCode: 'PROVIDER_DOWN' }) };
    const r = await enqueueNotification(prisma, base(), failing);
    expect(r.status).toBe('FAILED');
    const row = await prisma.crmNotificationDelivery.findUniqueOrThrow({ where: { id: r.id! } });
    expect(row.providerErrorCode).toBe('PROVIDER_DOWN');
    expect(row.nextAttemptAt).toBeTruthy();
    expect(row.deliveredAt).toBeNull();
    let n = 0;
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS + 2; i++) n += await retryDeliveries(prisma, new Date(Date.now() + (i + 1) * 4 * 3600_000), failing);
    const final = await prisma.crmNotificationDelivery.findUniqueOrThrow({ where: { id: r.id! } });
    expect(final.attempts).toBe(MAX_DELIVERY_ATTEMPTS);
    expect(final.status).toBe('FAILED');
    expect(final.nextAttemptAt).toBeNull();
    expect(n).toBeGreaterThanOrEqual(MAX_DELIVERY_ATTEMPTS - 1);
    // recovery when the provider comes back
    const b = base();
    const r2 = await enqueueNotification(prisma, b, failing);
    const healthy = { send: async () => ({ status: 'SENT' as const, providerReference: 'prov-1' }) };
    await retryDeliveries(prisma, new Date(Date.now() + 4 * 3600_000), healthy);
    expect((await prisma.crmNotificationDelivery.findUniqueOrThrow({ where: { id: r2.id! } })).status).toBe('SENT');
  });
  it('the same idempotency key is delivered once even when enqueued concurrently', async () => {
    const b = base();
    const sends: string[] = [];
    const port = { send: async (n: { idempotencyKey: string }) => { sends.push(n.idempotencyKey); return { status: 'SENT' as const }; } };
    await Promise.all(Array.from({ length: 5 }, () => enqueueNotification(prisma, b, port)));
    expect(sends).toHaveLength(1);
    expect(await prisma.crmNotificationDelivery.count({ where: { organizationId: orgId, idempotencyKey: b.idempotencyKey } })).toBe(1);
  });
});

describe('BullMQ integration: registry wiring, outbox -> consumer, scan processor, scheduler idempotency', () => {
  let redis: ReturnType<typeof createRedis>;
  let eventsQ: Queue;
  let dead: Queue;
  let scanQ: Queue;
  beforeAll(() => {
    redis = createRedis(REDIS);
    eventsQ = new Queue(QUEUES.DOMAIN_EVENTS, { connection: redis, prefix });
    dead = new Queue(QUEUES.DEAD_LETTER, { connection: redis, prefix });
    scanQ = new Queue(CRM_SCAN_QUEUE, { connection: redis, prefix });
  });
  afterAll(async () => {
    for (const q of [eventsQ, dead, scanQ]) {
      await q.obliterate({ force: true });
      await q.close();
    }
    redis.disconnect();
  });

  it('registers every scan as a repeatable on the crm queue and the scheduler upsert is idempotent', async () => {
    const reg = buildRegistry();
    const mine = reg.repeatables.filter((r) => r.queue === CRM_SCAN_QUEUE);
    expect(mine.map((r) => r.name).sort()).toEqual(SCAN_JOBS.map((s) => s.name).sort());
    for (let pass = 0; pass < 2; pass++) for (const r of mine) await scanQ.upsertJobScheduler(`${r.queue}:${r.name}`, { every: r.everyMs! }, { name: r.name, data: {} });
    expect((await scanQ.getJobSchedulers()).length).toBe(SCAN_JOBS.length);
    for (const s of await scanQ.getJobSchedulers()) await scanQ.removeJobScheduler(s.key);
  });

  it('a user.deactivated outbox event travels dispatcher -> BullMQ -> CRM handler -> reassignment queue; a restarted worker does not duplicate', async () => {
    const owner = await mkUser('SALES_EXECUTIVE', managerId);
    const lead = (await mkLead(owner.id)).lead;
    const outbox = await prisma.outboxEvent.create({ data: { organizationId: orgId, aggregateType: 'user', aggregateId: owner.id, eventType: IDENTITY_EVENTS.USER_DEACTIVATED, payload: { userId: owner.id, organizationId: orgId, managerId, deactivatedById: managerId, reason: null }, idempotencyKey: `ud:${owner.id}` } });
    const env = loadWorkerEnv({ ...process.env, DATABASE_URL: DB, REDIS_URL: REDIS, BULLMQ_PREFIX: prefix, EVENT_JOB_BACKOFF_MS: '50' } as NodeJS.ProcessEnv);
    const registry = buildRegistry();
    const ctx: JobContext = { prisma, log, env, connection: redis, queue: () => eventsQ };
    const waitFor = async (fn: () => Promise<boolean>, ms = 15000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await fn()) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      const row = await prisma.outboxEvent.findUnique({ where: { id: outbox.id } });
      throw new Error(`timeout; outbox=${row?.status} err=${row?.lastError} counts=${JSON.stringify(await eventsQ.getJobCounts())}`);
    };
    // earlier tests left PENDING outbox rows: relay until ours is dispatched
    for (let i = 0; i < 20 && (await prisma.outboxEvent.findUniqueOrThrow({ where: { id: outbox.id } })).status === 'PENDING'; i++) await dispatchOnce(prisma, eventsQ, { batchSize: 50, maxDispatchAttempts: 3, jobAttempts: 3, jobBackoffMs: 50 });
    // first worker handles the job, then "crashes" (closed)
    const w1 = startEventConsumer({ connection: redis, env, prisma, deadLetter: dead, handlers: registry.handlers, ctx, log });
    await waitFor(async () => (await prisma.reassignmentQueueEntry.count({ where: { leadId: lead.id, taskId: null } })) === 1);
    await w1.close();
    // restart: redelivering the same event (e.g. relay after crash) must not duplicate
    const w2 = startEventConsumer({ connection: redis, env, prisma, deadLetter: dead, handlers: registry.handlers, ctx, log });
    await eventsQ.add(IDENTITY_EVENTS.USER_DEACTIVATED, { id: outbox.id, eventType: IDENTITY_EVENTS.USER_DEACTIVATED, aggregateType: 'user', aggregateId: owner.id, organizationId: orgId, payload: outbox.payload, occurredAt: new Date().toISOString(), attempt: 0 }, { jobId: `replay-${randomUUID()}` });
    await new Promise((r) => setTimeout(r, 1500));
    await w2.close();
    expect(await prisma.reassignmentQueueEntry.count({ where: { leadId: lead.id, taskId: null } })).toBe(1);
    expect(await prisma.reassignmentQueueEntry.count({ where: { leadId: lead.id, taskId: { not: null } } })).toBe(1); // its open first-contact task
    expect(await prisma.crmNotificationDelivery.count({ where: { entityId: owner.id, kind: 'reassignment.created' } })).toBe(1);
  });

  it('the scan processor registered with the registry runs real BullMQ jobs: reminders survive a worker restart', async () => {
    const reg = buildRegistry();
    const spec = reg.processors.find((p) => p.queue === CRM_SCAN_QUEUE)!;
    const env = loadWorkerEnv({ ...process.env, DATABASE_URL: DB, REDIS_URL: REDIS, BULLMQ_PREFIX: prefix } as NodeJS.ProcessEnv);
    const ctx: JobContext = { prisma, log, env, connection: redis, queue: () => scanQ };
    const task = await mkTask(ownerId, null, new Date(Date.now() - 45_000));
    // job enqueued while no worker is running (worker is down / restarting)
    await scanQ.add('due-reminders', {}, { removeOnComplete: true });
    expect(await events(CRM_EVENTS.TASK_DUE, task.id)).toHaveLength(0);
    const w = new Worker(CRM_SCAN_QUEUE, (job) => spec.process(job, ctx), { connection: redis, prefix });
    const end = Date.now() + 15000;
    while (Date.now() < end && (await events(CRM_EVENTS.TASK_DUE, task.id)).length === 0) await new Promise((r) => setTimeout(r, 100));
    await w.close();
    expect(await events(CRM_EVENTS.TASK_DUE, task.id)).toHaveLength(1);
    // a second worker incarnation runs the same scan again: still one event
    await runScan('due-reminders', ctx, 'second-incarnation');
    expect(await events(CRM_EVENTS.TASK_DUE, task.id)).toHaveLength(1);
  });
});
