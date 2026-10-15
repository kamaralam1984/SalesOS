import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bumpOrgVersion, cachePrefix, closeAnalyticsRedis, KPI_INVALIDATING_EVENTS } from '../src/jobs/analytics/invalidate';
import { runAnalyticsMaintenance } from '../src/jobs/analytics/maintenance';
import { buildRegistry } from '../src/jobs/registry';

const DB = process.env.TEST_WORKER_DATABASE_URL ?? 'postgresql://salesos:salesos_dev_only@127.0.0.1:5533/salesos_agentb_wtest?schema=public';
const REDIS = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6391';
let prisma: PrismaClient;
let orgId: string;
let userId: string;

beforeAll(async () => {
  process.env.ANALYTICS_CACHE_PREFIX = `agenti-wtest:${randomUUID().slice(0, 6)}`;
  prisma = new PrismaClient({ datasourceUrl: DB });
  const org = await prisma.organization.create({ data: { name: '[TEST] analytics-worker', slug: `aw-${randomUUID().slice(0, 8)}` } });
  orgId = org.id;
  userId = (await prisma.user.create({ data: { organizationId: orgId, email: `aw-${randomUUID().slice(0, 6)}@test.local`, name: 'aw' } })).id;
});
afterAll(async () => {
  await closeAnalyticsRedis();
  await prisma.$disconnect();
});

describe('analytics worker registration', () => {
  it('subscribes to the KPI-changing events and owns the maintenance queue', () => {
    const reg = buildRegistry();
    for (const type of ['lead.created', 'call.logged', 'deal.closed', 'refund.processed', 'complaint.resolved', 'founder_report.published', 'user.deactivated']) expect(reg.handlers.get(type)?.length, type).toBeGreaterThanOrEqual(1);
    expect(KPI_INVALIDATING_EVENTS.length).toBeGreaterThan(40);
    expect(new Set(KPI_INVALIDATING_EVENTS).size).toBe(KPI_INVALIDATING_EVENTS.length);
    expect(reg.processors.some((p) => p.queue === 'analytics-maintenance')).toBe(true);
    expect(reg.repeatables.some((r) => r.queue === 'analytics-maintenance')).toBe(true);
  });
});

describe('cache invalidation by event', () => {
  it('bumps the per-organisation version the API puts in every KPI cache key', async () => {
    const r = new Redis(REDIS);
    try {
      const key = `${cachePrefix()}:ver:${orgId}`;
      await r.del(key);
      const reg = buildRegistry();
      const handler = reg.handlers.get('call.logged')![0]!;
      const ctx = { env: { REDIS_URL: REDIS } } as never;
      await handler({ id: randomUUID(), eventType: 'call.logged', aggregateType: 'call', aggregateId: 'x', organizationId: orgId, payload: {}, occurredAt: new Date().toISOString(), attempt: 1 }, ctx);
      expect(await r.get(key)).toBe('1');
      await bumpOrgVersion(REDIS, orgId);
      expect(await r.get(key)).toBe('2');
      // events without an organisation are ignored
      await handler({ id: randomUUID(), eventType: 'call.logged', aggregateType: 'call', aggregateId: 'x', organizationId: null, payload: {}, occurredAt: new Date().toISOString(), attempt: 1 }, ctx);
      expect(await r.get(key)).toBe('2');
      await r.del(key);
    } finally {
      r.disconnect();
    }
  });
});

describe('maintenance (real Postgres)', () => {
  it('expires files, re-queues crashed exports, prunes old rows; fresh exports are untouched', async () => {
    const base = { organizationId: orgId, requestedById: userId, report: 'funnel', format: 'CSV' as const, scopeLevel: 'org', rowCap: 10 };
    const hour = 3_600_000;
    const ready = await prisma.reportExport.create({ data: { ...base, status: 'READY', content: new Uint8Array([1, 2, 3]), expiresAt: new Date(Date.now() - hour) } });
    const fresh = await prisma.reportExport.create({ data: { ...base, status: 'READY', content: new Uint8Array([1]), expiresAt: new Date(Date.now() + hour) } });
    const crashed = await prisma.reportExport.create({ data: { ...base, status: 'RUNNING', attempts: 1, lockedUntil: new Date(Date.now() - hour), expiresAt: new Date(Date.now() + hour) } });
    const exhausted = await prisma.reportExport.create({ data: { ...base, status: 'RUNNING', attempts: 3, lockedUntil: new Date(Date.now() - hour), expiresAt: new Date(Date.now() + hour) } });
    const old = await prisma.reportExport.create({ data: { ...base, status: 'EXPIRED', requestedAt: new Date(Date.now() - 200 * 24 * hour), expiresAt: new Date(Date.now() - 190 * 24 * hour) } });
    await prisma.kpiSnapshot.create({ data: { organizationId: orgId, kpiId: 'KPI-X', periodStart: new Date('2020-01-01'), periodEnd: new Date('2020-01-31'), unit: 'COUNT' } });
    const out = await runAnalyticsMaintenance(prisma);
    expect(out.expiredExports).toBeGreaterThanOrEqual(1);
    expect(out.requeuedExports).toBeGreaterThanOrEqual(1);
    expect(out.deletedOldExports).toBeGreaterThanOrEqual(1);
    expect(out.deletedOldSnapshots).toBeGreaterThanOrEqual(1);
    const get = (id: string) => prisma.reportExport.findUnique({ where: { id } });
    expect(await get(ready.id)).toMatchObject({ status: 'EXPIRED', content: null });
    expect((await get(fresh.id))!.status).toBe('READY');
    expect((await get(fresh.id))!.content).not.toBeNull();
    expect((await get(crashed.id))!.status).toBe('QUEUED');
    expect((await get(exhausted.id))!.status).toBe('RUNNING'); // the API claim marks it FAILED after the retry budget
    expect(await get(old.id)).toBeNull();
    expect(await prisma.kpiSnapshot.count({ where: { organizationId: orgId, kpiId: 'KPI-X' } })).toBe(0);
    const again = await runAnalyticsMaintenance(prisma);
    expect(again.expiredExports).toBe(0); // idempotent
  });
});
