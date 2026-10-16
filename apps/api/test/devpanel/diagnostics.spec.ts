import { Controller, Get, Param } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOrgFixture, createUser, createTestApp, loginAgent, type OrgFixture, type TestApp } from '../helpers';
import { sanitiseError } from '../../src/modules/devpanel/diagnostics/diagnostics.service';
import { ErrorBufferService } from '../../src/modules/devpanel/diagnostics/error-buffer.service';
import { RequirePermission } from '../../src/common/authz';

@Controller('diag-test')
class BoomController {
  @Get('boom/:id')
  @RequirePermission('auth:me:view')
  boom(@Param('id') _id: string): never {
    throw new Error('kaboom internal');
  }
}

let t: TestApp;
let fx: OrgFixture;
let dev: Awaited<ReturnType<typeof createUser>>;
const B = '/dev-panel/diagnostics';

beforeAll(async () => {
  t = await createTestApp({ extraControllers: [BoomController] });
  fx = await buildOrgFixture(t.prisma);
  dev = await createUser(t.prisma, fx.org, { roles: ['DEVELOPER'] });
});
afterAll(async () => { await t.close(); });

const mkDead = (i: number, over: Record<string, unknown> = {}) =>
  t.prisma.outboxEvent.create({
    data: { organizationId: fx.org.id, aggregateType: 'test', aggregateId: `agg-${i}`, eventType: 'diag.test', payload: {}, status: 'DEAD', attempts: 5, lastError: 'smtp failed for bob@example.com ?token=abc', ...over },
  });

describe('diagnostics authz', () => {
  it.each(['founder', 'admin'] as const)('%s gets 403 everywhere', async (who) => {
    const a = await loginAgent(t.app, fx[who]);
    for (const p of ['health', 'jobs', 'errors', 'migrations', 'build']) expect((await a.get(`${B}/${p}`)).status).toBe(403);
    expect((await a.post(`${B}/jobs/retry-all`).send({})).status).toBe(403);
  });
});

describe('diagnostics as DEVELOPER', () => {
  it('health has latency and verdicts', async () => {
    const a = await loginAgent(t.app, dev);
    const r = await a.get(`${B}/health`);
    expect(r.status).toBe(200);
    expect(r.body.data.database.verdict).toMatch(/^(ok|slow)$/);
    expect(typeof r.body.data.database.latencyMs).toBe('number');
    expect(['ok', 'slow', 'down']).toContain(r.body.data.redis.verdict);
    expect(r.body.data.worker.verdict).toBeDefined();
    expect(r.body.data.outbox.verdict).toBeDefined();
  });

  it('lists dead jobs sanitised, retries and discards with audit, and is not repeatable', async () => {
    const a = await loginAgent(t.app, dev);
    const j1 = await mkDead(1);
    const j2 = await mkDead(2);
    const list = await a.get(`${B}/jobs?limit=100`);
    expect(list.status).toBe(200);
    const row = list.body.data.find((x: { id: string }) => x.id === j1.id);
    expect(row.lastError).not.toContain('bob@example.com');
    expect(row.lastError).not.toContain('abc');
    expect(row.payload).toBeUndefined();

    expect((await a.post(`${B}/jobs/${j1.id}/retry`).send({})).status).toBe(200);
    const after = await t.prisma.outboxEvent.findUniqueOrThrow({ where: { id: j1.id } });
    expect(after.status).toBe('PENDING');
    expect(after.attempts).toBe(0);
    expect((await a.post(`${B}/jobs/${j1.id}/retry`).send({})).status).toBe(404); // no longer DEAD
    expect(await t.prisma.auditLog.count({ where: { action: 'devpanel.job_retried', entityId: j1.id } })).toBe(1);

    expect((await a.post(`${B}/jobs/${j2.id}/discard`).send({ reason: 'x' })).status).toBe(400);
    expect((await a.post(`${B}/jobs/${j2.id}/discard`).send({ reason: 'obsolete event' })).status).toBe(200);
    const d = await t.prisma.outboxEvent.findUniqueOrThrow({ where: { id: j2.id } });
    expect(d.status).toBe('DISPATCHED');
    expect(d.lastError).toContain('obsolete event');
    expect(await t.prisma.auditLog.count({ where: { action: 'devpanel.job_discarded', entityId: j2.id } })).toBe(1);
    expect((await a.post(`${B}/jobs/${j2.id}/discard`).send({ reason: 'again again' })).status).toBe(404);
  });

  it('retry-all is bounded and audited; cross-org jobs are untouched', async () => {
    const a = await loginAgent(t.app, dev);
    const mine = await mkDead(10);
    const other = await t.prisma.outboxEvent.create({ data: { organizationId: null, aggregateType: 'x', aggregateId: 'x', eventType: 'diag.other', payload: {}, status: 'DEAD', attempts: 5 } });
    const r = await a.post(`${B}/jobs/retry-all`).send({});
    expect(r.status).toBe(200);
    expect(r.body.data.requeued).toBeGreaterThanOrEqual(1);
    expect(r.body.data.cap).toBe(200);
    expect((await t.prisma.outboxEvent.findUniqueOrThrow({ where: { id: mine.id } })).status).toBe('PENDING');
    expect((await t.prisma.outboxEvent.findUniqueOrThrow({ where: { id: other.id } })).status).toBe('DEAD');
    expect(await t.prisma.auditLog.count({ where: { action: 'devpanel.jobs_retried_all', actorId: dev.id } })).toBeGreaterThanOrEqual(1);
    await t.prisma.outboxEvent.update({ where: { id: other.id }, data: { status: 'DISPATCHED' } });
  });

  it('migrations returns available:false for db-push databases or a coherent list', async () => {
    const a = await loginAgent(t.app, dev);
    const r = await a.get(`${B}/migrations`);
    expect(r.status).toBe(200);
    if (r.body.data.available) expect(Array.isArray(r.body.data.items)).toBe(true);
    else expect(typeof r.body.data.reason).toBe('string');
  });

  it('build info has no env dump', async () => {
    const a = await loginAgent(t.app, dev);
    const r = await a.get(`${B}/build`);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.data).sort()).toEqual(['buildTime', 'gitCommit', 'nodeEnv', 'nodeVersion', 'platform', 'uptimeSeconds', 'version']);
    expect(JSON.stringify(r.body)).not.toContain('SESSION_SECRET');
  });

  it('ring buffer captures a 5xx with route template only (no query string / body)', async () => {
    const a = await loginAgent(t.app, dev);
    const boom = await a.get('/diag-test/boom/abc123?secret=hunter2&email=a@b.co');
    expect(boom.status).toBe(500);
    const r = await a.get(`${B}/errors?kind=error&limit=50`);
    expect(r.status).toBe(200);
    expect(r.body.data.scope).toBe('process-memory');
    const hit = r.body.data.items.find((i: { route: string }) => i.route.includes('diag-test/boom'));
    expect(hit).toBeTruthy();
    expect(hit.route).toContain(':id');
    expect(hit.status).toBe(500);
    const raw = JSON.stringify(r.body);
    expect(raw).not.toContain('hunter2');
    expect(raw).not.toContain('abc123');
    expect(raw).not.toContain('kaboom');
    expect(Object.keys(hit).sort()).toEqual(['at', 'durationMs', 'kind', 'method', 'requestId', 'route', 'status']);
  });
});

describe('units', () => {
  it('sanitiseError redacts and truncates', () => {
    expect(sanitiseError('Bearer abcdef failed https://u:p@host/x?y=1')).not.toMatch(/abcdef|u:p/);
    expect(sanitiseError('x'.repeat(1000))!.length).toBeLessThanOrEqual(301);
    expect(sanitiseError(null)).toBeNull();
  });
  it('buffer is bounded and ignores fast 2xx', () => {
    const b = new ErrorBufferService();
    b.record({ method: 'GET', route: '/a', status: 200, durationMs: 5 });
    expect(b.size()).toBe(0);
    for (let i = 0; i < 250; i++) b.record({ method: 'GET', route: '/a?q=1', status: 500, durationMs: 5 });
    expect(b.size()).toBe(200);
    expect(b.list('all', 1)[0]!.route).toBe('/a');
    b.record({ method: 'GET', route: '/s', status: 200, durationMs: 5000 });
    expect(b.list('slow', 10)).toHaveLength(1);
  });
});
