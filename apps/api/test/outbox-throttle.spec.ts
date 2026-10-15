import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, createOrg, uniq, type TestApp } from './helpers';
import { OutboxService } from '../src/common/outbox/outbox.service';
import { AuditService } from '../src/common/audit/audit.service';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.close(); });

describe('transactional outbox (producer side)', () => {
  it('publishes atomically with the business change; rollback discards the event', async () => {
    const org = await createOrg(t.prisma);
    const outbox = t.app.get(OutboxService);
    const aggregateId = uniq('agg');
    await expect(
      t.prisma.$transaction(async (tx) => {
        await outbox.publish(tx, { eventType: 'test.rolled_back', aggregateType: 'test', aggregateId, organizationId: org.id, payload: { a: 1 } });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await t.prisma.outboxEvent.count({ where: { aggregateId } })).toBe(0);

    await t.prisma.$transaction(async (tx) => {
      await outbox.publish(tx, { eventType: 'test.committed', aggregateType: 'test', aggregateId, organizationId: org.id, payload: { a: 1 } });
    });
    const row = await t.prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId } });
    expect(row).toMatchObject({ status: 'PENDING', attempts: 0, eventType: 'test.committed' });
  });

  it('idempotency key de-duplicates repeated publishes', async () => {
    const outbox = t.app.get(OutboxService);
    const key = uniq('idem');
    const first = await outbox.publishStandalone({ eventType: 'test.idem', aggregateType: 'test', aggregateId: 'a', payload: {}, idempotencyKey: key });
    const second = await outbox.publishStandalone({ eventType: 'test.idem', aggregateType: 'test', aggregateId: 'a', payload: {}, idempotencyKey: key });
    expect(first).toBeTruthy();
    expect(second).toBeNull();
    expect(await t.prisma.outboxEvent.count({ where: { idempotencyKey: key } })).toBe(1);
  });

  it('audit.recordTx rolls back with the transaction; audit rows capture request context', async () => {
    const org = await createOrg(t.prisma);
    const audit = t.app.get(AuditService);
    await expect(
      t.prisma.$transaction(async (tx) => {
        await audit.recordTx(tx, { organizationId: org.id, action: 'test.rollback', entityType: 'test' });
        throw new Error('x');
      }),
    ).rejects.toThrow();
    expect(await t.prisma.auditLog.count({ where: { organizationId: org.id } })).toBe(0);
  });
});

describe('rate limiting', () => {
  it('returns 429 in the standard envelope once the per-route limit is exceeded', async () => {
    // Dedicated app instance with a tiny global limit (the default test limit is intentionally huge).
    const prev = process.env.THROTTLE_LIMIT;
    process.env.THROTTLE_LIMIT = '3';
    const small = await createTestApp();
    process.env.THROTTLE_LIMIT = prev;
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) statuses.push((await request(small.app.getHttpServer()).get('/api/v1/health')).status);
      expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
      expect(statuses.slice(3)).toContain(429);
      const limited = await request(small.app.getHttpServer()).get('/api/v1/health');
      expect(limited.body).toMatchObject({ data: null, error: { code: 'RATE_LIMITED' } });
    } finally {
      await small.close();
    }
  });
});
