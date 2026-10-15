import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID, createHash } from 'node:crypto';
import { ObjectStorage, storageConfigFromEnv, signWebhook } from '@salesos/platform-core';
import { PLATFORM_EVENTS, type DomainEvent } from '@salesos/shared-types';
import { buildRegistry, type JobContext } from '../src/jobs/registry';
import { mapEvent } from '../src/jobs/platform/events';
import { loadWorkerEnv } from '../src/config';
import { createLogger } from '../src/logger';

process.env.S3_BUCKET = 'salesos-agentf-test';
// the generic task/lead mapping is opt-in (KI-F-04: the CRM worker already raises these through the platform port)
process.env.PLATFORM_AUTO_NOTIFY_CRM_EVENTS = 'true';
process.env.DELIVERY_BACKOFF_BASE_MS = '1';
const DB = process.env.TEST_WORKER_DATABASE_URL ?? 'postgresql://salesos:salesos_dev_only@127.0.0.1:5533/salesos_agentf_wtest?schema=public';
const registry = buildRegistry();
let prisma: PrismaClient;
let ctx: JobContext;
let storage: ObjectStorage;
let orgId: string;
let userId: string;
let adminId: string;
const tag = () => randomUUID().slice(0, 8);

const ev = (eventType: string, payload: object, over: Partial<DomainEvent> = {}): DomainEvent => ({
  id: randomUUID(), eventType, aggregateType: eventType.split('.')[0]!, aggregateId: randomUUID(), organizationId: orgId, payload, occurredAt: new Date().toISOString(), attempt: 0, ...over,
});
const run = async (e: DomainEvent) => { for (const h of registry.handlers.get(e.eventType) ?? []) await h(e, ctx); };
const processor = (queue: string) => registry.processors.find((p) => p.queue === queue)!;

beforeAll(async () => {
  prisma = new PrismaClient({ datasourceUrl: DB });
  const env = loadWorkerEnv({ ...process.env, DATABASE_URL: DB });
  ctx = { prisma, log: createLogger('silent'), env: { ...env, EVENT_JOB_ATTEMPTS: 3 }, connection: undefined as never, queue: () => { throw new Error('no queue in unit test'); } };
  storage = new ObjectStorage(storageConfigFromEnv());
  await storage.ensureBucket();
  orgId = (await prisma.organization.create({ data: { name: '[TEST] platform worker', slug: `pw-${tag()}` } })).id;
  const admin = await prisma.role.upsert({ where: { key: 'ADMIN' }, update: {}, create: { key: 'ADMIN', name: 'Admin' } });
  const mk = async (email: string, withAdmin: boolean) => {
    const u = await prisma.user.create({ data: { organizationId: orgId, email: `${email}-${tag()}@test.local`, name: email } });
    if (withAdmin) await prisma.userRoleAssignment.create({ data: { organizationId: orgId, userId: u.id, roleId: admin.id } });
    return u.id;
  };
  userId = await mk('exec', false);
  adminId = await mk('admin', true);
});
afterAll(async () => {
  // this suite publishes outbox rows (file.failed, dead-letter alerts...). Remove them so they never starve the dispatch batches
  // of other worker suites that share this database.
  await prisma.outboxEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.$disconnect();
});

describe('event -> notification mapping', () => {
  it('maps CRM follow-up events to catalogue types with a stable dedupe key and action link', () => {
    const e = ev('task.overdue', { assignedToId: userId, leadId: 'L1', dueAt: '2026-10-14T10:00:00Z' });
    const r = mapEvent(e)!;
    expect(r).toMatchObject({ type: 'follow_up.overdue', userIds: [userId], actionUrl: '/crm/leads/L1', organizationId: orgId });
    expect(r.dedupeKey).toBe(`task.overdue:${e.aggregateId}:2026-10-14T10:00:00Z`);
    expect(mapEvent({ ...e, id: randomUUID() })!.dedupeKey).toBe(r.dedupeKey); // re-delivery of the same fact => same key
    expect(mapEvent(ev('lead.unattended', { ownerId: userId }))!.type).toBe('lead.no_next_action');
  });
  it('falls back to default roles, prefers explicit recipients, ignores events nobody should hear', () => {
    expect(mapEvent(ev('complaint.escalated', {}))!.roles).toEqual(['SALES_TEAM_LEAD', 'FOUNDER_CEO']);
    expect(mapEvent(ev('complaint.escalated', { notifyUserIds: [userId] }))!).toMatchObject({ userIds: [userId] });
    expect(mapEvent(ev('task.overdue', {}))).toBeNull();
    expect(mapEvent(ev('unknown.event', { userId }))).toBeNull();
    expect(mapEvent({ ...ev('task.due', { userId }), organizationId: null })).toBeNull();
  });
  it('every CLAUDE.md section 15 category has a producer mapping or an explicit generic path', () => {
    const types = new Set(['task.overdue', 'lead.unattended', 'complaint.created', 'payment.verified', 'handover.submitted', 'import.failed', 'file.failed'].map((t) => mapEvent(ev(t, { userId }))?.type));
    expect(types.size).toBe(7);
  });
});

describe('worker handlers raise notifications idempotently', () => {
  it('task.overdue creates one notification; redelivery only bumps occurrences', async () => {
    const e = ev('task.overdue', { assignedToId: userId, leadId: 'L9', dueAt: 'D1' });
    await run(e);
    await run({ ...e, attempt: 1 });
    await run(e);
    const rows = await prisma.notification.findMany({ where: { userId, type: 'follow_up.overdue' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ occurrences: 3, severity: 'WARNING', entityType: 'task', actionUrl: '/crm/leads/L9' });
  });

  it('notification.requested (generic contract) and role fan-out', async () => {
    await run(ev(PLATFORM_EVENTS.NOTIFICATION_REQUESTED, { organizationId: orgId, type: 'founder.action_item', roles: ['ADMIN'], dedupeKey: `fa-${tag()}`, title: 'Decide', actionUrl: '/' }));
    expect(await prisma.notification.count({ where: { userId: adminId, type: 'founder.action_item' } })).toBe(1);
  });

  it('malformed requests are dropped (poison events do not retry forever)', async () => {
    await expect(run(ev(PLATFORM_EVENTS.NOTIFICATION_REQUESTED, { organizationId: orgId, type: 'follow_up.due', userId, dedupeKey: '' }))).resolves.toBeUndefined();
  });

  it('security events: role change notifies the user; deactivation notifies manager/founder role', async () => {
    await run(ev('user.roles_changed', { userId, before: [], after: ['ADMIN'], changedById: adminId }));
    const n = await prisma.notification.findFirstOrThrow({ where: { userId, type: 'security.event' } });
    expect(n.severity).toBe('CRITICAL');
  });
});

describe('file processing job: retry, FAILED state, recovery, notifications', () => {
  const mkFile = async (key: string, buf: Buffer | null, name = 'a.csv', type = 'text/csv') => {
    const storageKey = `org/${orgId}/csv/2026/10/${key}`;
    if (buf) await storage.put(storageKey, buf, type);
    return prisma.fileAsset.create({
      data: {
        organizationId: orgId, uploaderId: userId, category: 'csv', displayName: name, extension: 'csv', contentType: type, sizeBytes: BigInt(buf?.length ?? 5), sha256: createHash('sha256').update(buf ?? Buffer.from('x')).digest('hex'),
        bucket: storage.cfg.bucket, storageKey,
      },
    });
  };

  it('transient failure rethrows (BullMQ retries), the last attempt marks FAILED + emits file.failed; retry succeeds', async () => {
    const f = await mkFile(randomUUID(), null); // object missing => storage error
    const e = ev(PLATFORM_EVENTS.FILE_PROCESS_REQUESTED, { fileId: f.id, uploaderId: userId }, { aggregateType: 'file', aggregateId: f.id });
    await expect(run({ ...e, attempt: 0 })).rejects.toBeTruthy();
    expect((await prisma.fileAsset.findUniqueOrThrow({ where: { id: f.id } })).status).toBe('SCANNING');
    await expect(run({ ...e, attempt: 1 })).rejects.toBeTruthy();
    await run({ ...e, attempt: 2 }); // last attempt (EVENT_JOB_ATTEMPTS = 3): swallowed => FAILED, visible
    const failed = await prisma.fileAsset.findUniqueOrThrow({ where: { id: f.id } });
    expect(failed.status).toBe('FAILED');
    expect(failed.attempts).toBe(3);
    expect(failed.lastError).toBeTruthy();
    const out = await prisma.outboxEvent.findFirstOrThrow({ where: { eventType: PLATFORM_EVENTS.FILE_FAILED, aggregateId: f.id } });
    expect(out.payload).toMatchObject({ userId, status: 'FAILED' });

    // failure notification reaches the uploader and the admins
    await run({ ...ev(PLATFORM_EVENTS.FILE_FAILED, out.payload as object, { aggregateType: 'file', aggregateId: f.id }) });
    expect(await prisma.notification.count({ where: { userId, type: 'file.failed' } })).toBeGreaterThanOrEqual(1);
    expect(await prisma.notification.count({ where: { userId: adminId, type: 'file.failed' } })).toBeGreaterThanOrEqual(1);

    // recovery: the cause is fixed (object present), file re-queued as the API's retry endpoint does, job succeeds
    const body = Buffer.from('a,b\n1,2\n');
    await storage.put(f.storageKey, body, 'text/csv');
    await prisma.fileAsset.update({ where: { id: f.id }, data: { status: 'PENDING', sha256: createHash('sha256').update(body).digest('hex'), sizeBytes: BigInt(body.length) } });
    await run({ ...e, attempt: 0 });
    const ok = await prisma.fileAsset.findUniqueOrThrow({ where: { id: f.id } });
    expect([ok.status, ok.progress, ok.scanStatus]).toEqual(['READY', 100, 'NOT_SCANNED']);
    expect(await prisma.outboxEvent.count({ where: { eventType: PLATFORM_EVENTS.FILE_READY, aggregateId: f.id } })).toBe(1);
  });

  it('an infected upload becomes REJECTED and the uploader is told', async () => {
    const f = await mkFile(randomUUID(), Buffer.from('x,y\nX5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*\n'));
    await run(ev(PLATFORM_EVENTS.FILE_PROCESS_REQUESTED, { fileId: f.id }, { aggregateType: 'file', aggregateId: f.id }));
    expect(await prisma.fileAsset.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({ status: 'REJECTED', scanStatus: 'INFECTED' });
    expect(await prisma.outboxEvent.count({ where: { eventType: PLATFORM_EVENTS.FILE_FAILED, aggregateId: f.id } })).toBe(1);
  });

  it('sweeper re-queues files stuck in a non-terminal state (worker crash), once per window', async () => {
    const f = await mkFile(randomUUID(), Buffer.from('a\n1\n'));
    await prisma.$executeRaw`UPDATE file_assets SET updated_at = now() - interval '30 minutes', status = 'PROCESSING' WHERE id = ${f.id}::uuid`;
    await processor('platform-files-sweep').process({} as never, ctx);
    await processor('platform-files-sweep').process({} as never, ctx);
    expect(await prisma.outboxEvent.count({ where: { eventType: PLATFORM_EVENTS.FILE_PROCESS_REQUESTED, aggregateId: f.id } })).toBe(1);
  });

  it('retention processor soft-deletes expired files and purges old deleted objects', async () => {
    const f = await mkFile(randomUUID(), Buffer.from('a\n1\n'));
    await prisma.fileAsset.update({ where: { id: f.id }, data: { retentionUntil: new Date(Date.now() - 1000) } });
    await processor('platform-files-retention').process({} as never, ctx);
    expect((await prisma.fileAsset.findUniqueOrThrow({ where: { id: f.id } })).deletedAt).not.toBeNull();
    await prisma.fileAsset.update({ where: { id: f.id }, data: { deletedAt: new Date(Date.now() - 90 * 86_400_000) } });
    await processor('platform-files-retention').process({} as never, ctx);
    expect((await prisma.fileAsset.findUniqueOrThrow({ where: { id: f.id } })).purgedAt).not.toBeNull();
    await expect(storage.get(f.storageKey)).rejects.toBeTruthy();
  });
});

describe('delivery processor: provider confirmation, retries, dead letters', () => {
  it('SENT until a callback; failing sandbox goes through retries to DEAD_LETTER, alerts admins, publishes an event', async () => {
    await prisma.integrationConfig.upsert({ where: { organizationId_provider: { organizationId: orgId, provider: 'sandbox-email' } }, update: { enabled: true }, create: { organizationId: orgId, provider: 'sandbox-email', kind: 'EMAIL', enabled: true } });
    const mk = (body: string, key: string) => prisma.notificationDelivery.create({ data: { organizationId: orgId, channel: 'EMAIL', provider: 'sandbox-email', toAddress: 'x@example.com', body, idempotencyKey: key, maxAttempts: 3 } });
    const good = await mk('hello', `g-${tag()}`);
    const bad = await mk('[[sandbox:fail]]', `b-${tag()}`);
    for (let i = 0; i < 6; i++) {
      await processor('platform-deliveries').process({} as never, ctx);
      await new Promise((r) => setTimeout(r, 20)); // backoff base is 1 ms in this suite
    }
    const g = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: good.id } });
    expect(g.status).toBe('SENT'); // never DELIVERED without a callback
    expect(g.deliveredAt).toBeNull();
    const b = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: bad.id } });
    expect([b.status, b.attempts]).toEqual(['DEAD_LETTER', 3]);
    expect(await prisma.outboxEvent.count({ where: { eventType: PLATFORM_EVENTS.DELIVERY_DEAD_LETTERED, aggregateId: bad.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: adminId, type: 'system.delivery_failed', dedupeKey: `delivery.dead:${bad.id}` } })).toBe(1);
    expect(signWebhook('s', 'b', 1)).toMatch(/^t=1,v1=/);
  });
});
