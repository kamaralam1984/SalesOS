import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOrgFixture, createOrg, createTestApp, createUser, loginAgent, type AuthedAgent, type OrgFixture, type TestApp } from './helpers';

let t: TestApp;
let fx: OrgFixture;
let A: Record<'founder' | 'teamLead' | 'managerA' | 'managerB' | 'execA1' | 'execA2' | 'execB1' | 'admin' | 'hr' | 'finance', AuthedAgent>;
let docId: string;
let v1: string;
let v2: string;

beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  A = {
    founder: await loginAgent(t.app, fx.founder), teamLead: await loginAgent(t.app, fx.teamLead), managerA: await loginAgent(t.app, fx.managerA), managerB: await loginAgent(t.app, fx.managerB),
    execA1: await loginAgent(t.app, fx.execA1), execA2: await loginAgent(t.app, fx.execA2), execB1: await loginAgent(t.app, fx.execB1),
    admin: await loginAgent(t.app, fx.admin), hr: await loginAgent(t.app, fx.hr), finance: await loginAgent(t.app, fx.finance),
  };
});
afterAll(async () => { await t.close(); });

const body = { category: 'OBJECTION_HANDLING', title: '[TEST] Objection handling', body: '# Price objections\nAcknowledge, clarify, respond.', audienceRoles: ['SALES_EXECUTIVE'], tags: ['Price'], isMandatory: true };

describe('SOP versioning, approval and immutability', () => {
  it('only SOP authors can create; an executive cannot', async () => {
    expect((await A.execA1.post('/sop').send(body)).status).toBe(403);
    const res = await A.teamLead.post('/sop').send(body);
    expect(res.status).toBe(201);
    docId = res.body.data.id;
    v1 = res.body.data.versionId;
  });

  it('draft versions are invisible to readers without create/approve rights (IDOR-safe 404)', async () => {
    expect((await A.execA1.get(`/sop/${docId}`)).status).toBe(404);
    expect((await A.execA1.get(`/sop/versions/${v1}`)).status).toBe(404);
    const list = await A.execA1.get('/sop');
    expect(list.body.data.find((d: { id: string }) => d.id === docId)).toBeUndefined();
    const own = await A.teamLead.get(`/sop/${docId}`);
    expect(own.status).toBe(200);
    expect(own.body.data.versions[0].status).toBe('DRAFT');
  });

  it('enforces the approval workflow: submit -> approve, author cannot approve own work, only Founder/TL approve', async () => {
    expect((await A.teamLead.post(`/sop/versions/${v1}/approve`).send({})).status).toBe(409); // still DRAFT
    expect((await A.teamLead.post(`/sop/versions/${v1}/submit`).send({})).status).toBe(200);
    expect((await A.managerA.post(`/sop/versions/${v1}/approve`).send({})).status).toBe(403);
    const self = await A.teamLead.post(`/sop/versions/${v1}/approve`).send({});
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('FORBIDDEN');
    const ok = await A.founder.post(`/sop/versions/${v1}/approve`).send({});
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ status: 'APPROVED', remindersQueued: 4 });
  });

  it('writes audit entries for submit and approve and queues acknowledgement reminders through the outbox', async () => {
    const audit = await t.prisma.auditLog.findMany({ where: { organizationId: fx.org.id, entityId: v1 } });
    expect(audit.map((a) => a.action).sort()).toEqual(['sop.version_approved', 'sop.version_submitted']);
    expect(audit.find((a) => a.action === 'sop.version_approved')?.actorId).toBe(fx.founder.id);
    const reminders = await t.prisma.outboxEvent.findMany({ where: { organizationId: fx.org.id, eventType: 'sop.acknowledgement_reminder', aggregateId: v1 } });
    expect(reminders).toHaveLength(4);
    expect(new Set(reminders.map((r) => (r.payload as { userId: string }).userId))).toEqual(new Set([fx.execA1.id, fx.execA2.id, fx.execB1.id, fx.execB2.id]));
  });

  it('an approved version is immutable through the API and at the database level', async () => {
    const res = await A.teamLead.patch(`/sop/versions/${v1}`).send({ body: 'tampered' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SOP_VERSION_IMMUTABLE');
    await expect(t.prisma.sopVersion.update({ where: { id: v1 }, data: { body: 'tampered via db' } })).rejects.toThrow(/immutable/);
    await expect(t.prisma.sopVersion.delete({ where: { id: v1 } })).rejects.toThrow(/immutable/);
    await expect(t.prisma.sopVersion.update({ where: { id: v1 }, data: { status: 'DRAFT' } })).rejects.toThrow(/illegal SOP version status change|immutable/);
    const row = await t.prisma.sopVersion.findUniqueOrThrow({ where: { id: v1 } });
    expect(row.body).toContain('Price objections');
  });

  it('readers now see the effective version and can search it', async () => {
    const res = await A.execA1.get(`/sop/${docId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.effectiveVersion.versionNumber).toBe(1);
    expect(res.body.data.effectiveVersion.body).toContain('Acknowledge');
    expect(res.body.data.acknowledgedByMe).toBe(false);
    const byBody = await A.execA1.get('/sop?q=clarify');
    expect(byBody.body.data.map((d: { id: string }) => d.id)).toContain(docId);
    const byTag = await A.execA1.get('/sop?q=price');
    expect(byTag.body.data.map((d: { id: string }) => d.id)).toContain(docId);
    expect((await A.execA1.get('/sop?q=zzzznothing')).body.data).toEqual([]);
  });
});

describe('acknowledgements and adoption', () => {
  it('records an acknowledgement once per user per version (idempotent) with history', async () => {
    const first = await A.execA1.post(`/sop/versions/${v1}/acknowledge`).send({});
    expect(first.status).toBe(200);
    expect(first.body.data.alreadyAcknowledged).toBe(false);
    const again = await A.execA1.post(`/sop/versions/${v1}/acknowledge`).send({});
    expect(again.body.data.alreadyAcknowledged).toBe(true);
    expect(await t.prisma.sopAcknowledgement.count({ where: { versionId: v1, userId: fx.execA1.id } })).toBe(1);
    expect((await A.execA1.get(`/sop/${docId}`)).body.data.acknowledgedByMe).toBe(true);
    const hist = await A.teamLead.get(`/sop/${docId}/acknowledgements`);
    expect(hist.body.data).toHaveLength(1);
    expect(hist.body.data[0]).toMatchObject({ userId: fx.execA1.id, versionNumber: 1 });
  });

  it('refuses acknowledgements from users outside the audience and for unknown/draft versions', async () => {
    expect((await A.finance.post(`/sop/versions/${v1}/acknowledge`).send({})).status).toBe(403);
    expect((await A.execA1.post('/sop/versions/11111111-1111-4111-8111-111111111111/acknowledge').send({})).status).toBe(404);
  });

  it('adoption maths respect role scope (org / team / own) and never leak other teams', async () => {
    await A.execA2.post(`/sop/versions/${v1}/acknowledge`).send({});
    const org = (await A.teamLead.get('/sop/adoption')).body.data;
    expect(org.scope).toBe('org');
    expect(org.overall).toEqual({ required: 4, acknowledged: 2, ratePct: 50 });
    expect(org.byDocument[0].pending.map((p: { userId: string }) => p.userId).sort()).toEqual([fx.execB1.id, fx.execB2.id].sort());
    const team = (await A.managerA.get('/sop/adoption')).body.data;
    expect(team.scope).toBe('team');
    expect(team.overall).toEqual({ required: 2, acknowledged: 2, ratePct: 100 });
    const teamB = (await A.managerB.get('/sop/adoption')).body.data;
    expect(teamB.overall).toEqual({ required: 2, acknowledged: 0, ratePct: 0 });
    const own = (await A.execB1.get('/sop/adoption')).body.data;
    expect(own.scope).toBe('own');
    expect(own.byUser.map((u: { userId: string }) => u.userId)).toEqual([fx.execB1.id]);
    expect(own.overall).toEqual({ required: 1, acknowledged: 0, ratePct: 0 });
    expect((await A.finance.get('/sop/adoption')).status).toBe(403);
    expect((await A.admin.get('/sop/adoption')).status).toBe(403);
  });

  it('a manager cannot read acknowledgement history of other teams', async () => {
    const hist = (await A.managerB.get(`/sop/${docId}/acknowledgements`)).body.data;
    expect(hist).toEqual([]);
  });

  it('a new version supersedes the old one and resets adoption: acknowledgement is per version', async () => {
    const created = await A.teamLead.post(`/sop/${docId}/versions`).send({ body: '# v2\nNew approach to price objections.', changeSummary: 'Add value framing' });
    expect(created.status).toBe(201);
    v2 = created.body.data.id;
    expect(created.body.data.versionNumber).toBe(2);
    expect((await A.teamLead.post(`/sop/${docId}/versions`).send({ body: 'x', changeSummary: 'second open draft' })).status).toBe(409);
    await A.teamLead.post(`/sop/versions/${v2}/submit`).send({});
    expect((await A.founder.post(`/sop/versions/${v2}/approve`).send({})).status).toBe(200);
    const versions = (await A.teamLead.get(`/sop/${docId}/versions`)).body.data;
    expect(versions.map((v: { versionNumber: number; status: string }) => [v.versionNumber, v.status])).toEqual([[2, 'APPROVED'], [1, 'SUPERSEDED']]);
    // old acknowledgements are kept as history ...
    expect(await t.prisma.sopAcknowledgement.count({ where: { versionId: v1 } })).toBe(2);
    // ... but adoption now measures v2 only
    const org = (await A.teamLead.get('/sop/adoption')).body.data;
    expect(org.overall).toEqual({ required: 4, acknowledged: 0, ratePct: 0 });
    expect(org.byDocument[0].versionNumber).toBe(2);
    expect((await A.execA1.post(`/sop/versions/${v1}/acknowledge`).send({})).status).toBe(409); // superseded
    expect((await A.execA1.post(`/sop/versions/${v2}/acknowledge`).send({})).status).toBe(200);
    expect((await A.teamLead.get('/sop/adoption')).body.data.overall.ratePct).toBe(25);
  });

  it('acknowledgement reminders are queued once per user per day', async () => {
    const first = await A.teamLead.post(`/sop/versions/${v2}/remind`).send({});
    expect(first.body.data.queued).toBe(3);
    await A.teamLead.post(`/sop/versions/${v2}/remind`).send({});
    const manual = await t.prisma.outboxEvent.count({ where: { organizationId: fx.org.id, eventType: 'sop.acknowledgement_reminder', aggregateId: v2, idempotencyKey: { startsWith: 'sop-ack-reminder:manual' } } });
    expect(manual).toBe(3);
  });

  it('can reject a submitted version with a reason and requires the author to revise', async () => {
    const c = await A.teamLead.post(`/sop/${docId}/versions`).send({ body: '# v3', changeSummary: 'Experimental change' });
    const id = c.body.data.id;
    await A.teamLead.post(`/sop/versions/${id}/submit`).send({});
    expect((await A.founder.post(`/sop/versions/${id}/reject`).send({ reason: 'x' })).status).toBe(400);
    const rej = await A.founder.post(`/sop/versions/${id}/reject`).send({ reason: 'Needs example scripts' });
    expect(rej.body.data.status).toBe('REJECTED');
    const row = await t.prisma.sopVersion.findUniqueOrThrow({ where: { id } });
    expect(row.rejectionReason).toBe('Needs example scripts');
    const fix = await A.teamLead.patch(`/sop/versions/${id}`).send({ body: '# v3 with scripts' });
    expect(fix.body.data.status).toBe('DRAFT');
  });
});

describe('process-gap backlog and tenant isolation', () => {
  it('manages gaps with status + resolution; managers only see their own team items', async () => {
    const g = await A.managerA.post('/sop/gaps').send({ kind: 'AUTOMATION', title: 'Automate no-show follow-up', priority: 2 });
    expect(g.status).toBe(201);
    const other = await A.managerB.post('/sop/gaps').send({ title: 'B team gap' });
    expect((await A.managerA.get('/sop/gaps')).body.data.map((x: { id: string }) => x.id)).toEqual([g.body.data.id]);
    expect((await A.teamLead.get('/sop/gaps')).body.data).toHaveLength(2);
    expect((await A.managerA.patch(`/sop/gaps/${other.body.data.id}`).send({ status: 'IN_PROGRESS' })).status).toBe(404);
    expect((await A.managerA.patch(`/sop/gaps/${g.body.data.id}`).send({ status: 'RESOLVED' })).status).toBe(400);
    const done = await A.managerA.patch(`/sop/gaps/${g.body.data.id}`).send({ status: 'RESOLVED', resolution: 'Workflow rule added' });
    expect(done.body.data).toMatchObject({ status: 'RESOLVED', resolution: 'Workflow rule added' });
    expect(done.body.data.resolvedAt).toBeTruthy();
    expect((await A.execA1.get('/sop/gaps')).status).toBe(403);
  });

  it('other organizations cannot see or acknowledge these SOPs', async () => {
    const org2 = await createOrg(t.prisma);
    const stranger = await createUser(t.prisma, org2, { roles: ['SALES_EXECUTIVE'] });
    const s = await loginAgent(t.app, stranger);
    expect((await s.get(`/sop/${docId}`)).status).toBe(404);
    expect((await s.get(`/sop/versions/${v2}`)).status).toBe(404);
    expect((await s.post(`/sop/versions/${v2}/acknowledge`).send({})).status).toBe(404);
    expect((await s.get('/sop')).body.data).toEqual([]);
  });

  it('retiring a document retires its versions and hides it from readers', async () => {
    expect((await A.managerA.post(`/sop/${docId}/retire`).send({})).status).toBe(403);
    expect((await A.founder.post(`/sop/${docId}/retire`).send({})).status).toBe(200);
    expect((await A.execA1.get('/sop')).body.data.find((d: { id: string }) => d.id === docId)).toBeUndefined();
    expect((await t.prisma.sopVersion.findUniqueOrThrow({ where: { id: v2 } })).status).toBe('RETIRED');
  });
});
