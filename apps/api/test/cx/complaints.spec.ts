import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers';
import { buildCxFixture, buildOtherOrg, type CxFixture } from './helpers';

let t: TestApp;
let fx: CxFixture;
let otherAgent: Awaited<ReturnType<typeof buildOtherOrg>>['agent'];
beforeAll(async () => {
  t = await createTestApp();
  fx = await buildCxFixture(t);
  otherAgent = (await buildOtherOrg(t)).agent;
});
afterAll(async () => { await t.close(); });

const mk = async (agent = fx.agents.execA1, extra: Record<string, unknown> = {}) => {
  const res = await agent.post('/cx/complaints').send({ leadId: fx.leadA.id, title: 'Course access not working', description: 'Learner cannot open week 2 videos', category: 'DELIVERY_ACCESS', priority: 'P2', ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string; status: string; ownerId: string; sla: { firstResponseDueAt: string; resolutionDueAt: string }; version: number };
};

describe('complaints', () => {
  it('creates with SLA deadlines from the decision-log table, owner auto-assigned to the manager (flagged)', async () => {
    const c = await mk();
    expect(c.status).toBe('OPEN');
    expect(c.ownerId).toBe(fx.managerA.id);
    const body = (await fx.agents.execA1.get(`/cx/complaints/${c.id}`)).body.data;
    expect(body.autoAssigned).toBe(true);
    expect(body.learner.name).toContain('Learner');
    const frHours = (new Date(c.sla.firstResponseDueAt).getTime() - new Date(body.sla.startedAt).getTime()) / 3_600_000;
    expect(frHours).toBeGreaterThanOrEqual(8); // P2 = 8 business hours (>= 8 wall-clock hours)
    expect(new Date(c.sla.resolutionDueAt) > new Date(c.sla.firstResponseDueAt)).toBe(true);
    expect(body.history[0]).toMatchObject({ from: null, to: 'OPEN' });
  });

  it('runs the full happy path with mandatory fields and writes history, audit and outbox events', async () => {
    const c = await mk(fx.agents.managerA, { ownerId: fx.execA1.id, priority: 'P3' });
    expect(c.ownerId).toBe(fx.execA1.id);
    const post = (to: string, extra: Record<string, unknown> = {}, agent = fx.agents.execA1) => agent.post(`/cx/complaints/${c.id}/transition`).send({ to, ...extra });
    let r = await post('ACKNOWLEDGED', { note: 'Looking into it' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.status).toBe('ACKNOWLEDGED');
    expect(r.body.data.sla.firstResponseRemainingMs).toBeNull(); // first-response clock stopped
    r = await post('IN_PROGRESS', { note: 'Plan: re-issue access' });
    expect(r.status).toBe(200);
    r = await post('RESOLVED', { resolution: 'Access restored' }); // missing root cause
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('FIELDS_REQUIRED');
    r = await post('RESOLVED', { resolution: 'Access restored', rootCauseCategory: 'TECHNICAL_ISSUE' });
    expect(r.status).toBe(200);
    expect(r.body.data.resolvedWithinSla ?? r.body.data.sla.resolvedWithinSla).toBe(true);
    expect(r.body.data.rootCauseCategory).toBe('TECHNICAL_ISSUE');
    r = await post('CLOSED');
    expect(r.status).toBe(200);
    expect(r.body.data.closedAt).toBeTruthy();
    const hist = r.body.data.history.map((h: { to: string }) => h.to);
    expect(hist).toEqual(['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);
    const audits = await t.prisma.auditLog.findMany({ where: { entityType: 'complaint', entityId: c.id }, select: { action: true } });
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['complaint.created', 'complaint.acknowledged', 'complaint.resolved', 'complaint.closed']));
    const events = await t.prisma.outboxEvent.findMany({ where: { aggregateType: 'complaint', aggregateId: c.id } });
    expect(events.map((e) => e.eventType)).toEqual(expect.arrayContaining(['complaint.created', 'complaint.acknowledged', 'complaint.resolved', 'survey.requested']));
  });

  it('rejects illegal transitions with 409 ILLEGAL_TRANSITION and leaves state unchanged', async () => {
    const c = await mk(fx.agents.managerA, { ownerId: fx.execA1.id });
    for (const to of ['RESOLVED', 'IN_PROGRESS', 'ESCALATED', 'REOPENED', 'OPEN']) {
      const r = await fx.agents.execA1.post(`/cx/complaints/${c.id}/transition`).send({ to, resolution: 'x', rootCauseCategory: 'OTHER', note: 'x', reason: 'x', escalatedToId: fx.teamLead.id });
      expect(r.status, `OPEN->${to}`).toBe(409);
      expect(r.body.error.code).toBe('ILLEGAL_TRANSITION');
    }
    expect((await fx.agents.execA1.get(`/cx/complaints/${c.id}`)).body.data.status).toBe('OPEN');
    // terminal CLOSED cannot be reopened
    const closed = await fx.agents.managerA.post(`/cx/complaints/${c.id}/transition`).send({ to: 'CLOSED', reason: 'duplicate of #1' });
    expect(closed.status).toBe(200);
    expect(closed.body.data.closedAsInvalid).toBe(true);
    const re = await fx.agents.managerA.post(`/cx/complaints/${c.id}/transition`).send({ to: 'REOPENED', reason: 'again' });
    expect(re.status).toBe(409);
  });

  it('role rules: only the owner/manager acts; an exec cannot close an OPEN complaint as invalid; other execs cannot see it', async () => {
    const c = await mk(fx.agents.managerA, { ownerId: fx.execA1.id });
    const asExec = await fx.agents.execA1.post(`/cx/complaints/${c.id}/transition`).send({ to: 'CLOSED', reason: 'dup' });
    expect(asExec.status).toBe(403); // OPEN->CLOSED is a manager/TL step
    const peer = await fx.agents.execA2.get(`/cx/complaints/${c.id}`);
    expect(peer.status).toBe(404);
    const peerWrite = await fx.agents.execA2.post(`/cx/complaints/${c.id}/transition`).send({ to: 'ACKNOWLEDGED', note: 'x' });
    expect(peerWrite.status).toBe(404);
  });

  it('escalation needs reason + target, notifies TL/Founder, and only TL/Founder can send it back to IN_PROGRESS', async () => {
    const c = await mk(fx.agents.managerA, { ownerId: fx.execA1.id, priority: 'P1' });
    const t1 = (to: string, extra: Record<string, unknown> = {}, agent = fx.agents.execA1) => agent.post(`/cx/complaints/${c.id}/transition`).send({ to, ...extra });
    expect((await t1('ACKNOWLEDGED', { note: 'ack' })).status).toBe(200);
    expect((await t1('IN_PROGRESS', { note: 'wip' })).status).toBe(200);
    expect((await t1('ESCALATED', { reason: 'learner threatens chargeback' })).status).toBe(422);
    const esc = await t1('ESCALATED', { reason: 'learner threatens chargeback', escalatedToId: fx.teamLead.id });
    expect(esc.status).toBe(200);
    expect(esc.body.data.escalatedToName).toBeTruthy();
    const ev = await t.prisma.outboxEvent.findFirst({ where: { aggregateId: c.id, eventType: 'complaint.escalated' } });
    expect((ev!.payload as { notifyRoles: string[] }).notifyRoles).toEqual(expect.arrayContaining(['SALES_TEAM_LEAD', 'FOUNDER_CEO']));
    expect((await t1('IN_PROGRESS', { note: 'decision' }, fx.agents.managerA)).status).toBe(403);
    expect((await t1('IN_PROGRESS', { note: 'Offer a 1:1 session' }, fx.agents.teamLead)).status).toBe(200);
  });

  it('reopen restarts the SLA clock with a new clock and resets breach state', async () => {
    const c = await mk(fx.agents.managerA, { ownerId: fx.execA1.id, priority: 'P4' });
    const go = async (to: string, extra: Record<string, unknown> = {}) => (await fx.agents.execA1.post(`/cx/complaints/${c.id}/transition`).send({ to, ...extra }));
    await go('ACKNOWLEDGED', { note: 'a' }); await go('IN_PROGRESS', { note: 'b' });
    await go('RESOLVED', { resolution: 'fixed', rootCauseCategory: 'PROCESS_GAP' });
    // simulate an old, breached complaint
    await t.prisma.complaint.update({ where: { id: c.id }, data: { slaStartedAt: new Date(Date.now() - 20 * 86_400_000), resolutionDueAt: new Date(Date.now() - 5 * 86_400_000), resolutionBreachedAt: new Date(Date.now() - 5 * 86_400_000), breachLevel: 2 } });
    const r = await go('REOPENED', { reason: 'issue returned' });
    expect(r.status).toBe(200);
    expect(r.body.data.reopenCount).toBe(1);
    expect(r.body.data.sla.resolutionBreachedAt).toBeNull();
    expect(r.body.data.sla.breachLevel).toBe(0);
    expect(new Date(r.body.data.sla.resolutionDueAt).getTime()).toBeGreaterThan(Date.now());
    expect(r.body.data.resolvedAt).toBeNull();
  });

  it('scope and isolation: managers see their team only, Student Success sees all in org, other org sees nothing', async () => {
    const a = await mk(fx.agents.execA1);
    const b = await fx.agents.execB1.post('/cx/complaints').send({ leadId: fx.leadB.id, title: 'Refund delay', description: 'Waiting for refund', category: 'REFUND', priority: 'P1' });
    expect(b.status).toBe(201);
    const idsOf = async (agent: typeof fx.agents.execA1) => ((await agent.get('/cx/complaints?limit=100')).body.data as { id: string }[]).map((c) => c.id);
    expect(await idsOf(fx.agents.managerA)).toContain(a.id);
    expect(await idsOf(fx.agents.managerA)).not.toContain(b.body.data.id);
    expect(await idsOf(fx.agents.managerB)).toContain(b.body.data.id);
    expect(await idsOf(fx.agents.managerB)).not.toContain(a.id);
    expect(await idsOf(fx.agents.execA2)).not.toContain(a.id);
    const ssIds = await idsOf(fx.agents.ss);
    expect(ssIds).toEqual(expect.arrayContaining([a.id, b.body.data.id]));
    expect((await idsOf(fx.agents.founder))).toEqual(expect.arrayContaining([a.id, b.body.data.id]));
    expect((await otherAgent.get('/cx/complaints')).body.data).toEqual([]);
    expect((await otherAgent.get(`/cx/complaints/${a.id}`)).status).toBe(404);
    // exec cannot attach a complaint to a lead of another team
    const cross = await fx.agents.execA1.post('/cx/complaints').send({ leadId: fx.leadB.id, title: 'x y z', description: 'abc', category: 'OTHER', priority: 'P4' });
    expect(cross.status).toBe(404);
    // no marketing/ops access at all
    expect((await fx.agents.marketing.get('/cx/complaints')).status).toBe(403);
    expect((await fx.agents.ops.get('/cx/complaints')).status).toBe(403);
  });

  it('trend queries aggregate root causes, SLA adherence and buckets', async () => {
    const r = await fx.agents.founder.get('/cx/complaints/trends?bucket=month');
    expect(r.status).toBe(200);
    expect(r.body.data.totals.opened).toBeGreaterThan(0);
    expect(r.body.data.series.length).toBeGreaterThan(0);
    expect(r.body.data.byRootCause.some((x: { key: string }) => x.key === 'TECHNICAL_ISSUE')).toBe(true);
    expect(Array.isArray(r.body.data.byPriority)).toBe(true);
    const scoped = await fx.agents.managerB.get('/cx/complaints/trends');
    expect(scoped.body.data.totals.opened).toBeLessThan(r.body.data.totals.opened);
    expect((await fx.agents.founder.get('/cx/complaints/trends?from=2027-01-01&to=2026-01-01')).status).toBe(400);
  });

  it('validates input', async () => {
    expect((await fx.agents.execA1.post('/cx/complaints').send({ title: 'a', description: 'b' })).status).toBe(400);
    expect((await fx.agents.execA1.get('/cx/complaints?priority=P9')).status).toBe(400);
    expect((await fx.agents.execA1.post('/cx/complaints').send({ title: 'valid title', description: 'valid desc', category: 'OTHER', priority: 'P4', ownerId: fx.execB1.id })).status).toBe(404);
  });
});
