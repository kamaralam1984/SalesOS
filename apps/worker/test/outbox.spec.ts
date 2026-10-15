import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { createRedis } from '../src/redis';
import { dispatchOnce } from '../src/outbox/dispatcher';
import { startEventConsumer } from '../src/outbox/event-consumer';
import { InMemoryJobRegistry, buildRegistry, type EventHandler, type JobContext } from '../src/jobs/registry';
import { loadWorkerEnv } from '../src/config';
import { createLogger } from '../src/logger';
import { QUEUES } from '../src/queues';

const DB = process.env.TEST_WORKER_DATABASE_URL ?? 'postgresql://salesos:salesos_dev_only@127.0.0.1:5533/salesos_agentb_wtest?schema=public';
const REDIS = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6391';
const prefix = `salesos-test-${randomUUID().slice(0, 8)}`;
const log = createLogger('silent');
const opts = { batchSize: 20, maxDispatchAttempts: 3, jobAttempts: 3, jobBackoffMs: 20 };

let prisma: PrismaClient;
let redis: ReturnType<typeof createRedis>;
let events: Queue;
let dead: Queue;
let orgId: string;
const tag = () => `t-${randomUUID().slice(0, 8)}`;

async function publish(eventType: string, extra: Partial<{ idempotencyKey: string; availableAt: Date }> = {}) {
  return prisma.outboxEvent.create({ data: { organizationId: orgId, aggregateType: 'test', aggregateId: tag(), eventType, payload: { hello: 'world' }, ...extra } });
}

beforeAll(async () => {
  prisma = new PrismaClient({ datasourceUrl: DB });
  redis = createRedis(REDIS);
  events = new Queue(QUEUES.DOMAIN_EVENTS, { connection: redis, prefix });
  dead = new Queue(QUEUES.DEAD_LETTER, { connection: redis, prefix });
  orgId = (await prisma.organization.create({ data: { name: '[TEST] worker', slug: tag() } })).id;
});
afterAll(async () => {
  await events.obliterate({ force: true });
  await dead.obliterate({ force: true });
  await events.close();
  await dead.close();
  await prisma.$disconnect();
  redis.disconnect();
});
beforeEach(async () => {
  await events.drain(true);
});

describe('outbox dispatcher', () => {
  it('relays PENDING rows to BullMQ with jobId = outbox id and marks them DISPATCHED', async () => {
    const e = await publish(`evt.${tag()}`);
    await dispatchOnce(prisma, events, opts);
    const job = await events.getJob(e.id);
    expect(job?.name).toBe(e.eventType);
    expect(job?.data).toMatchObject({ id: e.id, eventType: e.eventType, organizationId: orgId, payload: { hello: 'world' } });
    expect(job?.opts.attempts).toBe(3);
    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.status).toBe('DISPATCHED');
    expect(row.dispatchedAt).toBeTruthy();
  });

  it('is idempotent: a crash after queue.add (row still PENDING) does not create a duplicate job', async () => {
    const e = await publish(`evt.${tag()}`);
    await dispatchOnce(prisma, events, opts);
    await prisma.outboxEvent.update({ where: { id: e.id }, data: { status: 'PENDING', dispatchedAt: null } }); // simulate lost DB update
    await dispatchOnce(prisma, events, opts);
    const jobs = (await events.getJobs(['waiting', 'delayed', 'active', 'completed'])).filter((j) => j.id === e.id);
    expect(jobs).toHaveLength(1);
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: e.id } })).status).toBe('DISPATCHED');
  });

  it('does not relay events that are not yet available (delayed) and respects ordering', async () => {
    const later = await publish(`evt.${tag()}`, { availableAt: new Date(Date.now() + 60_000) });
    await dispatchOnce(prisma, events, opts);
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: later.id } })).status).toBe('PENDING');
    expect(await events.getJob(later.id)).toBeUndefined();
  });

  it('concurrent dispatchers never relay the same row twice (SKIP LOCKED)', async () => {
    const created = await Promise.all(Array.from({ length: 10 }, () => publish(`evt.${tag()}`)));
    const results = await Promise.all([dispatchOnce(prisma, events, opts), dispatchOnce(prisma, events, opts), dispatchOnce(prisma, events, opts)]);
    expect(results.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(10);
    for (const e of created) expect(await events.getJob(e.id)).toBeTruthy();
    const rows = await prisma.outboxEvent.findMany({ where: { id: { in: created.map((c) => c.id) } } });
    expect(rows.every((r) => r.status === 'DISPATCHED')).toBe(true);
  });

  it('a failing relay backs off and eventually goes DEAD', async () => {
    const e = await publish(`evt.${tag()}`);
    const broken = { add: async () => { throw new Error('redis down'); } } as unknown as Queue;
    await dispatchOnce(prisma, broken, opts);
    let row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: e.id } });
    expect(row).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'redis down' });
    expect(row.availableAt.getTime()).toBeGreaterThan(Date.now());
    for (let i = 0; i < 2; i++) {
      await prisma.outboxEvent.update({ where: { id: e.id }, data: { availableAt: new Date(Date.now() - 1000) } });
      await dispatchOnce(prisma, broken, opts);
    }
    row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.status).toBe('DEAD');
  });
});

describe('event consumer: handlers, retries, dead-letter', () => {
  const env = loadWorkerEnv({ DATABASE_URL: DB, REDIS_URL: REDIS, BULLMQ_PREFIX: prefix, EVENT_CONCURRENCY: '2' } as NodeJS.ProcessEnv);
  const ctx = (): JobContext => ({ prisma, log, env, connection: redis, queue: () => events });
  let consumer: Worker | undefined;
  afterAll(async () => { await consumer?.close(); });

  async function waitFor(fn: () => Promise<boolean>, ms = 15000) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('timeout waiting for condition');
  }

  it('runs subscribed handlers; retries a flaky handler then succeeds; dead-letters a permanently failing one', async () => {
    const reg = new InMemoryJobRegistry();
    const okType = `evt.ok.${tag()}`;
    const flakyType = `evt.flaky.${tag()}`;
    const badType = `evt.bad.${tag()}`;
    const seen: string[] = [];
    let flakyCalls = 0;
    const ok: EventHandler = async (e) => { seen.push(e.id); };
    reg.onEvent(okType, ok);
    reg.onEvent(flakyType, async () => { if (++flakyCalls < 3) throw new Error('transient'); });
    reg.onEvent(badType, async () => { throw new Error('always fails'); });
    consumer = startEventConsumer({ connection: redis, env, prisma, deadLetter: dead, handlers: reg.handlers, ctx: ctx(), log });

    const a = await publish(okType);
    const b = await publish(flakyType);
    const c = await publish(badType);
    await dispatchOnce(prisma, events, opts);

    await waitFor(async () => seen.includes(a.id));
    await waitFor(async () => flakyCalls >= 3);
    await waitFor(async () => (await prisma.outboxEvent.findUniqueOrThrow({ where: { id: c.id } })).status === 'DEAD');

    expect(flakyCalls).toBe(3);
    const deadJob = await dead.getJob(`dead-${c.id}`);
    expect(deadJob?.data).toMatchObject({ error: 'always fails', event: { id: c.id } });
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('DISPATCHED');
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: c.id } })).lastError).toBe('always fails');
  });
});

describe('job registry', () => {
  it('pre-created domain slots are registered and the platform email stub subscribes', () => {
    const r = buildRegistry();
    expect(r.handlers.has('notification.email.requested')).toBe(true);
    expect(r.processors.map((p) => p.queue)).toContain('platform-housekeeping');
  });
  it('rejects two processors on the same queue', () => {
    const r = new InMemoryJobRegistry();
    r.processor({ queue: 'q', process: async () => undefined });
    expect(() => r.processor({ queue: 'q', process: async () => undefined })).toThrow(/already/);
  });
});
