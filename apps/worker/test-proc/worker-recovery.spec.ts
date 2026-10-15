import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { createLeadTx, directDeps, type Tx } from '@salesos/crm-core';
import { CRM_EVENTS } from '@salesos/shared-types';
import { scanOverdue } from '../src/jobs/crm/scans';
import { createLogger } from '../src/logger';
import { WORKER_TEST_DB } from '../test/global-setup';

/**
 * Job recovery after a hard crash. A real worker process is started, killed (SIGKILL = no cleanup, like an OOM kill or a
 * pulled plug) while it holds a job, and a second worker must finish the work: nothing lost, nothing notified twice.
 */
const DB = process.env.TEST_WORKER_DATABASE_URL ?? WORKER_TEST_DB;
const REDIS = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6391';
const root = path.resolve(__dirname, '..');
const prefix = `salesos-proc-${randomUUID().slice(0, 8)}`;
const tag = () => randomUUID().slice(0, 8);
let prisma: PrismaClient;
let redis: Redis;
let orgId: string;
let execId: string;
const children = new Set<ChildProcess>();

interface Proc { child: ChildProcess; lines: string[]; waitFor(re: RegExp, ms?: number): Promise<string>; exit: Promise<number | null> }
function startWorker(extra: Record<string, string> = {}): Proc {
  const child = spawn('node', ['test-proc/fixture-worker.cjs'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: DB, REDIS_URL: REDIS, BULLMQ_PREFIX: prefix, LOG_LEVEL: 'silent', OUTBOX_POLL_MS: '100', WORKER_LOCK_DURATION_MS: '2000', EVENT_JOB_BACKOFF_MS: '100', WORKER_HEARTBEAT_MS: '500', FIXTURE_SLOW_EVENT: CRM_EVENTS.TASK_OVERDUE, ...extra },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  children.add(child);
  const lines: string[] = [];
  const waiters: Array<{ re: RegExp; res: (l: string) => void }> = [];
  let buf = '';
  child.stdout!.on('data', (d: Buffer) => {
    buf += d.toString();
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i); buf = buf.slice(i + 1); lines.push(l);
      for (const w of [...waiters]) if (w.re.test(l)) { waiters.splice(waiters.indexOf(w), 1); w.res(l); }
    }
  });
  const exit = new Promise<number | null>((r) => child.on('exit', (c) => { children.delete(child); r(c); }));
  return {
    child, lines, exit,
    waitFor: (re, ms = 30_000) => new Promise((res, rej) => {
      const hit = lines.find((l) => re.test(l));
      if (hit) return res(hit);
      const to = setTimeout(() => rej(new Error(`timeout waiting for ${re}; saw ${lines.join(' | ')}`)), ms);
      waiters.push({ re, res: (l) => { clearTimeout(to); res(l); } });
    }),
  };
}

async function makeOverdueTask() {
  const lead = (await prisma.$transaction((tx: Tx) => createLeadTx(tx, directDeps(), { userId: execId, organizationId: orgId }, { fullName: `[TEST] ${tag()}`, phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`, assignedToId: execId }))).lead;
  const task = await prisma.task.create({ data: { organizationId: orgId, leadId: lead.id, assignedToId: execId, type: 'CALL', title: `[TEST] t ${tag()}`, dueAt: new Date(Date.now() - 5 * 60_000) } });
  await scanOverdue({ prisma, log: createLogger('silent') });
  const ev = await prisma.outboxEvent.findFirstOrThrow({ where: { eventType: CRM_EVENTS.TASK_OVERDUE, aggregateId: task.id } });
  return { task, ev };
}
const notifications = (taskId: string) => prisma.notification.count({ where: { userId: execId, entityId: taskId } });
const eventually = async (fn: () => Promise<boolean>, ms = 40_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };

beforeAll(async () => {
  if (!existsSync(path.join(root, 'dist-l2/main.js'))) {
    execSync('pnpm exec tsc -p tsconfig.build.json --outDir dist-l2', { cwd: root, stdio: 'inherit' });
  }
  prisma = new PrismaClient({ datasourceUrl: DB });
  redis = new Redis(REDIS);
  orgId = (await prisma.organization.create({ data: { name: '[TEST] proc recovery', slug: `proc-${tag()}` } })).id;
  const role = await prisma.role.upsert({ where: { key: 'SALES_EXECUTIVE' }, update: {}, create: { key: 'SALES_EXECUTIVE', name: 'SALES_EXECUTIVE' } });
  execId = (await prisma.user.create({ data: { organizationId: orgId, email: `${tag()}@proc.local`, name: '[TEST] exec' } })).id;
  await prisma.userRoleAssignment.create({ data: { organizationId: orgId, userId: execId, roleId: role.id } });
  await prisma.automationRule.create({ data: { organizationId: orgId, scopeKey: 'ORG', ruleKey: 'WORKING_HOURS', config: { timezone: 'UTC', days: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '23:59', holidays: [] } } });
});
afterEach(() => { for (const c of children) c.kill('SIGKILL'); });
afterAll(async () => {
  for (const c of children) c.kill('SIGKILL');
  for (const q of ['domain-events', 'dead-letter']) { const x = new Queue(q, { connection: redis, prefix }); await x.obliterate({ force: true }).catch(() => undefined); await x.close(); }
  await prisma.$disconnect();
  redis.disconnect();
});

describe('kill -9 mid-job', () => {
  it('worker killed BEFORE its handler finished: the outbox event survives, a second worker takes over the stalled job, exactly one notification', async () => {
    const { task, ev } = await makeOverdueTask();
    const w1 = startWorker({ FIXTURE_SLOW_MODE: 'before', FIXTURE_SLOW_MS: '120000' });
    await w1.waitFor(new RegExp(`STARTED ${ev.id}`));
    w1.child.kill('SIGKILL');
    expect(await w1.exit).toBeNull(); // died from the signal, no cleanup ran
    expect(await notifications(task.id)).toBe(0);
    const w2 = startWorker();
    await w2.waitFor(/READY/);
    expect(await eventually(async () => (await notifications(task.id)) === 1)).toBe(true);
    const q = new Queue('domain-events', { connection: redis, prefix });
    expect(await eventually(async () => (await q.getJob(ev.id))?.finishedOn != null)).toBe(true);
    await q.close();
    await new Promise((r) => setTimeout(r, 2500)); // nothing re-runs
    expect(await notifications(task.id)).toBe(1);
    expect(await prisma.crmNotificationDelivery.count({ where: { entityId: task.id, recipientId: execId } })).toBe(1);
    expect(await eventually(async () => (await prisma.outboxEvent.findUniqueOrThrow({ where: { id: ev.id } })).status === 'DISPATCHED', 10_000)).toBe(true);
    w2.child.kill('SIGKILL');
  });

  it('worker killed AFTER the handler committed but BEFORE the job was acknowledged: redelivery is idempotent (still exactly one notification)', async () => {
    const { task, ev } = await makeOverdueTask();
    const w1 = startWorker({ FIXTURE_SLOW_MODE: 'after', FIXTURE_SLOW_MS: '120000' });
    await w1.waitFor(new RegExp(`HANDLED ${ev.id}`));
    expect(await notifications(task.id)).toBe(1);
    w1.child.kill('SIGKILL');
    await w1.exit;
    const w2 = startWorker();
    await w2.waitFor(/READY/);
    const q = new Queue('domain-events', { connection: redis, prefix });
    expect(await eventually(async () => (await q.getJob(ev.id))?.finishedOn != null)).toBe(true); // redelivered and completed
    await q.close();
    expect(await notifications(task.id)).toBe(1);
    expect(await prisma.crmNotificationDelivery.count({ where: { entityId: task.id, recipientId: execId } })).toBe(1);
    w2.child.kill('SIGKILL');
  });

  it('events written while NO worker is running are processed once a worker starts (outbox is the durable queue)', async () => {
    const { task } = await makeOverdueTask();
    await new Promise((r) => setTimeout(r, 1500));
    expect(await notifications(task.id)).toBe(0);
    const w = startWorker();
    await w.waitFor(/READY/);
    expect(await eventually(async () => (await notifications(task.id)) === 1)).toBe(true);
    w.child.kill('SIGKILL');
  });
});

describe('worker heartbeat', () => {
  it('writes a heartbeat key with a TTL while alive and it expires after kill -9 (so the API reports stale/unknown)', async () => {
    const w = startWorker();
    await w.waitFor(/READY/);
    const mine = async () => redis.keys(`${prefix}:worker:heartbeat:${w.child.pid}-*`);
    expect(await eventually(async () => (await mine()).length === 1, 10_000)).toBe(true);
    const [key] = await mine();
    expect(await redis.ttl(key!)).toBeGreaterThan(0);
    w.child.kill('SIGKILL');
    await w.exit;
    expect(await eventually(async () => (await mine()).length === 0, 40_000)).toBe(true); // TTL 30 s
  });
});

describe('graceful shutdown (SIGTERM)', () => {
  it('worker drains: the in-flight job finishes, the process exits 0 after DRAINED, the job is not re-run', async () => {
    const { task, ev } = await makeOverdueTask();
    const w = startWorker({ FIXTURE_SLOW_MODE: 'before', FIXTURE_SLOW_MS: '3000' });
    await w.waitFor(new RegExp(`STARTED ${ev.id}`));
    const t0 = Date.now();
    w.child.kill('SIGTERM');
    expect(await w.exit).toBe(0);
    expect(Date.now() - t0).toBeGreaterThan(1500); // waited for the job
    expect(w.lines.join('\n')).toContain('DRAINED');
    expect(await notifications(task.id)).toBe(1);
    const q = new Queue('domain-events', { connection: redis, prefix });
    expect((await q.getJob(ev.id))?.finishedOn).toBeTruthy();
    await q.close();
  });
});
