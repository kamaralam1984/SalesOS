import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers';
import { buildCxFixture, buildOtherOrg, future, type CxFixture } from './helpers';

let t: TestApp;
let fx: CxFixture;
let other: Awaited<ReturnType<typeof buildOtherOrg>>;
beforeAll(async () => {
  t = await createTestApp();
  fx = await buildCxFixture(t);
  other = await buildOtherOrg(t);
});
afterAll(async () => { await t.close(); });

const mkTask = async (agent: typeof fx.agents.teamLead, body: Record<string, unknown>) => {
  const r = await agent.post('/xf-tasks').send({ title: 'Prepare reminder copy', department: 'MARKETING', ownerId: fx.marketing.id, dueAt: future(48), ...body });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as { id: string; status: string; version: number };
};
const ids = async (a: typeof fx.agents.teamLead, q = '') => ((await a.get(`/xf-tasks?limit=100${q}`)).body.data as { id: string }[]).map((x) => x.id);

describe('cross-functional tasks', () => {
  it('creates a controlled hand-off with owner, due date, dependencies and notifies the owner', async () => {
    const dep = await mkTask(fx.agents.managerA, { title: 'Approve webinar offer', department: 'FOUNDER', ownerId: fx.founder.id });
    const task = await mkTask(fx.agents.managerA, { title: 'Send webinar reminders', dependsOnIds: [dep.id], kind: 'HANDOFF', payload: { audienceSize: 120, program: 'AI Sprint' } });
    const got = (await fx.agents.marketing.get(`/xf-tasks/${task.id}`)).body.data;
    expect(got.ownerName).toBe(fx.marketing.name);
    expect(got.requesterName).toBe(fx.managerA.name);
    expect(got.dependencies.map((d: { id: string }) => d.id)).toEqual([dep.id]);
    expect(got.blockedBy).toBe(1);
    const ev = await t.prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: task.id, eventType: 'xf_task.created' } });
    expect((ev.payload as { notifyUserIds: string[] }).notifyUserIds).toEqual([fx.marketing.id]);
    expect(await t.prisma.outboxEvent.count({ where: { aggregateId: task.id, eventType: 'notification.requested' } })).toBe(1);
  });

  it('owner must belong to the target department; past due dates and foreign references are rejected', async () => {
    const bad = await fx.agents.teamLead.post('/xf-tasks').send({ title: 'wrong owner here', department: 'OPERATIONS', ownerId: fx.marketing.id, dueAt: future(5) });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('INVALID_OWNER');
    expect((await fx.agents.teamLead.post('/xf-tasks').send({ title: 'past due', department: 'OPERATIONS', ownerId: fx.ops.id, dueAt: new Date(Date.now() - 86_400_000).toISOString() })).status).toBe(422);
    expect((await fx.agents.teamLead.post('/xf-tasks').send({ title: 'missing owner', department: 'OPERATIONS', dueAt: future(5) })).status).toBe(422);
    expect((await fx.agents.teamLead.post('/xf-tasks').send({ title: 'foreign program', department: 'OPERATIONS', ownerId: fx.ops.id, dueAt: future(5), programId: other.other.org.id })).status).toBe(422);
    const assignees = await fx.agents.teamLead.get('/xf-tasks/assignees?department=OPERATIONS');
    expect(assignees.body.data).toEqual([{ id: fx.ops.id, name: fx.ops.name }]);
    expect((await fx.agents.ss.get('/xf-tasks/assignees?department=MARKETING')).status).toBe(200);
    expect((await fx.agents.execA1.get('/xf-tasks/assignees?department=MARKETING')).status).toBe(403);
  });

  it('department-scoped visibility: Marketing sees Marketing work, not Operations; execs see only their own; managers their team; leaders everything', async () => {
    const mk = await mkTask(fx.agents.teamLead, { title: 'Marketing only item', department: 'MARKETING', ownerId: fx.marketing.id });
    const op = await mkTask(fx.agents.teamLead, { title: 'Operations only item', department: 'OPERATIONS', ownerId: fx.ops.id });
    const ss = await mkTask(fx.agents.teamLead, { title: 'Student Success item', department: 'STUDENT_SUCCESS', ownerId: fx.ss.id });
    const bySales = await mkTask(fx.agents.managerA, { title: 'Requested by manager A', department: 'COMMUNITY', ownerId: fx.community.id });
    expect(await ids(fx.agents.marketing)).toEqual(expect.arrayContaining([mk.id]));
    expect(await ids(fx.agents.marketing)).not.toEqual(expect.arrayContaining([op.id]));
    expect(await ids(fx.agents.marketing)).not.toContain(ss.id);
    expect(await ids(fx.agents.ops)).toContain(op.id);
    expect(await ids(fx.agents.ops)).not.toContain(mk.id);
    expect(await ids(fx.agents.ss)).toContain(ss.id);
    expect(await ids(fx.agents.ss)).not.toContain(op.id);
    expect(await ids(fx.agents.community)).toContain(bySales.id);
    // direct GET of a task outside the department is a 404 (no existence leak)
    expect((await fx.agents.marketing.get(`/xf-tasks/${op.id}`)).status).toBe(404);
    expect((await fx.agents.ops.patch(`/xf-tasks/${mk.id}`).send({ status: 'IN_PROGRESS' })).status).toBe(404);
    // sales: exec own only; manager A sees tasks they requested, manager B does not; leaders see all
    expect(await ids(fx.agents.execA1)).not.toContain(bySales.id);
    expect(await ids(fx.agents.managerA)).toContain(bySales.id);
    expect(await ids(fx.agents.managerB)).not.toContain(bySales.id);
    expect(await ids(fx.agents.teamLead)).toEqual(expect.arrayContaining([mk.id, op.id, ss.id, bySales.id]));
    expect(await ids(fx.agents.founder)).toEqual(expect.arrayContaining([mk.id, op.id, ss.id, bySales.id]));
    // finance/hr/admin hold no xf permission; other org sees nothing
    for (const a of [fx.agents.finance, fx.agents.hr, fx.agents.admin]) expect((await a.get('/xf-tasks')).status).toBe(403);
    expect((await other.agent.get(`/xf-tasks/${mk.id}`)).status).toBe(404);
    expect((await other.agent.get('/xf-tasks')).body.data).toEqual([]);
    // minimum data: the "mine" filter only returns what the caller owns or requested
    const mineIds = await ids(fx.agents.marketing, '&mine=true');
    expect(mineIds).toContain(mk.id);
    expect(mineIds).not.toContain(op.id);
  });

  it('state machine: start -> complete (note required) -> requester confirms; illegal moves 409; system-only states 403', async () => {
    const task = await mkTask(fx.agents.managerA, { title: 'Design the referral landing page', department: 'MARKETING' });
    const patch = (body: Record<string, unknown>, agent = fx.agents.marketing) => agent.patch(`/xf-tasks/${task.id}`).send(body);
    expect((await patch({ status: 'ESCALATED' })).status).toBe(409);
    expect((await patch({ status: 'OVERDUE' })).status).toBe(403);
    expect((await patch({ status: 'COMPLETED' })).status).toBe(422);
    expect((await patch({ status: 'IN_PROGRESS' })).body.data.status).toBe('IN_PROGRESS');
    const done = await patch({ status: 'COMPLETED', completionNote: 'Page live at /referral' });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.data.confirmedAt).toBeNull();
    // only the requester (or a leader) confirms; the assignee cannot confirm their own work
    expect((await fx.agents.marketing.post(`/xf-tasks/${task.id}/confirm`).send({})).status).toBe(403);
    expect((await fx.agents.managerB.post(`/xf-tasks/${task.id}/confirm`).send({})).status).toBe(404);
    const conf = await fx.agents.managerA.post(`/xf-tasks/${task.id}/confirm`).send({});
    expect(conf.status, JSON.stringify(conf.body)).toBe(200);
    expect(conf.body.data.confirmedByName).toBe(fx.managerA.name);
    // terminal
    for (const status of ['OPEN', 'IN_PROGRESS', 'CANCELLED']) expect((await patch({ status, cancelReason: 'x' })).status, status).toBe(409);
    // confirm before completion is refused
    const open = await mkTask(fx.agents.managerA, { title: 'Not finished yet', department: 'MARKETING' });
    expect((await fx.agents.managerA.post(`/xf-tasks/${open.id}/confirm`).send({})).status).toBe(409);
    // the requester may cancel their own request with a reason
    expect((await fx.agents.managerA.patch(`/xf-tasks/${open.id}`).send({ status: 'CANCELLED' })).status).toBe(422);
    const cancelled = await fx.agents.managerA.patch(`/xf-tasks/${open.id}`).send({ status: 'CANCELLED', cancelReason: 'Campaign dropped' });
    expect(cancelled.body.data.status).toBe('CANCELLED');
  });

  it('dependencies block completion until the prerequisite is finished; cycles are refused', async () => {
    const a = await mkTask(fx.agents.teamLead, { title: 'Prerequisite A', department: 'OPERATIONS', ownerId: fx.ops.id });
    const b = await mkTask(fx.agents.teamLead, { title: 'Follow-up B', department: 'OPERATIONS', ownerId: fx.ops.id, dependsOnIds: [a.id] });
    const blocked = await fx.agents.ops.patch(`/xf-tasks/${b.id}`).send({ status: 'COMPLETED', completionNote: 'done' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('DEPENDENCIES_OPEN');
    const cyc = await fx.agents.teamLead.post(`/xf-tasks/${a.id}/dependencies`).send({ dependsOnId: b.id });
    expect(cyc.status).toBe(409);
    expect(cyc.body.error.code).toBe('DEPENDENCY_CYCLE');
    expect((await fx.agents.teamLead.post(`/xf-tasks/${a.id}/dependencies`).send({ dependsOnId: a.id })).status).toBe(422);
    expect((await fx.agents.ops.patch(`/xf-tasks/${a.id}`).send({ status: 'COMPLETED', completionNote: 'a done' })).status).toBe(200);
    expect((await fx.agents.ops.patch(`/xf-tasks/${b.id}`).send({ status: 'COMPLETED', completionNote: 'b done' })).status).toBe(200);
  });

  it('comments and manual escalation notify the right people and are audited', async () => {
    const task = await mkTask(fx.agents.managerA, { title: 'Order event swag', department: 'OPERATIONS', ownerId: fx.ops.id });
    const c = await fx.agents.ops.post(`/xf-tasks/${task.id}/comments`).send({ body: 'Vendor quote expected tomorrow' });
    expect(c.status).toBe(201);
    expect((await fx.agents.marketing.post(`/xf-tasks/${task.id}/comments`).send({ body: 'not mine' })).status).toBe(404);
    const esc = await fx.agents.managerA.post(`/xf-tasks/${task.id}/escalate`).send({ reason: 'Event is in 3 days, no vendor yet' });
    expect(esc.status, JSON.stringify(esc.body)).toBe(200);
    expect(esc.body.data.escalatedAt).toBeTruthy();
    const ev = await t.prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: task.id, eventType: 'xf_task.escalated' } });
    expect((ev.payload as { notifyRoles: string[] }).notifyRoles).toEqual(['SALES_TEAM_LEAD']);
    expect((await fx.agents.managerA.get(`/xf-tasks/${task.id}`)).body.data.comments).toHaveLength(1);
    expect((await fx.agents.marketing.post(`/xf-tasks/${task.id}/escalate`).send({ reason: 'x y z' })).status).toBe(404);
  });

  it('minimum-data rule: tasks to Marketing/Community/Operations cannot carry contact details or PII keys', async () => {
    const phone = await fx.agents.teamLead.post('/xf-tasks').send({ title: 'Call Asha on +91 98765 43210', department: 'MARKETING', ownerId: fx.marketing.id, dueAt: future(10) });
    expect(phone.status).toBe(422);
    expect(phone.body.error.code).toBe('PII_NOT_ALLOWED');
    const key = await fx.agents.teamLead.post('/xf-tasks').send({ title: 'Segment learners', department: 'COMMUNITY', ownerId: fx.community.id, dueAt: future(10), payload: { learnerName: 'Asha', count: 4 } });
    expect(key.status).toBe(422);
    const mail = await fx.agents.teamLead.post('/xf-tasks').send({ title: 'Note', description: 'mail asha@example.com', department: 'OPERATIONS', ownerId: fx.ops.id, dueAt: future(10) });
    expect(mail.status).toBe(422);
    const ok = await fx.agents.teamLead.post('/xf-tasks').send({ title: 'Segment learners by interest', department: 'COMMUNITY', ownerId: fx.community.id, dueAt: future(10), payload: { segmentSize: 4, theme: 'EMI questions' } });
    expect(ok.status).toBe(201);
    const c = await fx.agents.community.post(`/xf-tasks/${ok.body.data.id}/comments`).send({ body: 'ping me on 9876543210' });
    expect(c.status).toBe(422);
    // Sales-bound tasks may mention what they need
    expect((await fx.agents.ss.post('/xf-tasks').send({ title: 'Call learner back on +919876543210', department: 'SALES', ownerId: fx.managerA.id, dueAt: future(10) })).status).toBe(201);
  });
});

describe('campaign / webinar plan alignment', () => {
  it('links a webinar to a plan, shows planned vs actual lead intake as counts only, validates references', async () => {
    const ev = await t.prisma.crmEvent.create({ data: { organizationId: fx.org.id, type: 'WEBINAR', title: '[TEST] AI Sprint webinar', startsAt: new Date(Date.now() + 5 * 86_400_000), programId: fx.program.id } });
    const src = await t.prisma.leadSource.create({ data: { organizationId: fx.org.id, name: `[TEST] Instagram ${Date.now()}`, type: 'CAMPAIGN' } });
    await t.prisma.lead.update({ where: { id: fx.leadA.id }, data: { sourceId: src.id } });
    const start = new Date(Date.now() - 86_400_000).toISOString();
    const end = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const r = await fx.agents.marketing.post('/collaboration/plan-links').send({ kind: 'WEBINAR', title: 'AI Sprint webinar push', eventId: ev.id, programId: fx.program.id, sourceId: src.id, windowStart: start, windowEnd: end, plannedLeads: 200, salesPlanNote: 'Two callers on demo follow-up' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.event.title).toBe('[TEST] AI Sprint webinar');
    expect(r.body.data.actualLeads).toBe(1);
    expect(r.body.data.plannedLeads).toBe(200);
    expect(JSON.stringify(r.body.data)).not.toContain('@learner.test');
    const list = await fx.agents.execA1.get('/collaboration/plan-links');
    expect(list.status).toBe(200);
    expect(list.body.data.map((x: { id: string }) => x.id)).toContain(r.body.data.id);
    // webinar plan needs the event; end before start rejected; foreign refs rejected; execs cannot create
    expect((await fx.agents.marketing.post('/collaboration/plan-links').send({ kind: 'WEBINAR', title: 'No event linked', windowStart: start, windowEnd: end })).status).toBe(422);
    expect((await fx.agents.marketing.post('/collaboration/plan-links').send({ kind: 'LEAD_GEN', title: 'Bad window', windowStart: end, windowEnd: start })).status).toBe(422);
    expect((await fx.agents.marketing.post('/collaboration/plan-links').send({ kind: 'CAMPAIGN', title: 'Foreign campaign', campaignId: other.lead.id, windowStart: start, windowEnd: end })).status).toBe(422);
    expect((await fx.agents.execA1.post('/collaboration/plan-links').send({ kind: 'LEAD_GEN', title: 'Exec plan', windowStart: start, windowEnd: end })).status).toBe(403);
    expect((await other.agent.get('/collaboration/plan-links')).body.data).toEqual([]);
    // plan can be edited, moved through its states, and is final once closed
    const planId = r.body.data.id as string;
    const edit = await fx.agents.marketing.patch(`/collaboration/plan-links/${planId}`).send({ plannedLeads: 250, salesPlanNote: 'Three callers on demo follow-up', status: 'ACTIVE' });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(edit.body.data.plannedLeads).toBe(250);
    expect(edit.body.data.status).toBe('ACTIVE');
    expect((await fx.agents.marketing.patch(`/collaboration/plan-links/${planId}`).send({})).status).toBe(400);
    expect((await fx.agents.marketing.patch(`/collaboration/plan-links/${planId}`).send({ salesPlanNote: 'call 9876543210' })).status).toBe(422);
    expect((await fx.agents.marketing.patch(`/collaboration/plan-links/${planId}`).send({ campaignId: other.lead.id })).status).toBe(422);
    expect((await fx.agents.execA1.patch(`/collaboration/plan-links/${planId}`).send({ status: 'CANCELLED' })).status).toBe(403);
    expect((await other.agent.patch(`/collaboration/plan-links/${planId}`).send({ status: 'CANCELLED' })).status).toBe(404);
    expect((await fx.agents.marketing.patch(`/collaboration/plan-links/${planId}`).send({ status: 'PLANNED' })).status).toBe(409);
    // a task can be linked to the plan + event
    const task = await fx.agents.teamLead.post('/xf-tasks').send({ title: 'Webinar run-of-show', department: 'OPERATIONS', ownerId: fx.ops.id, dueAt: future(24), eventId: ev.id, planLinkId: r.body.data.id, kind: 'WEBINAR_PLANNING' });
    expect(task.status, JSON.stringify(task.body)).toBe(201);
    expect(task.body.data.eventId).toBe(ev.id);
  });
});

describe('insights sharing (minimum data)', () => {
  it('shares themes to chosen departments only, and rejects personal data', async () => {
    const r = await fx.agents.execA1.post('/cx/insights').send({ kind: 'OBJECTION', title: 'EMI is the top objection this week', body: 'Roughly one in three prospects asked about EMI options before enrolling.', audience: ['MARKETING', 'SALES'], tags: ['emi'] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const idsOf = async (a: typeof fx.agents.teamLead) => ((await a.get('/cx/insights')).body.data as { id: string }[]).map((x) => x.id);
    expect(await idsOf(fx.agents.marketing)).toContain(r.body.data.id);
    expect(await idsOf(fx.agents.ops)).not.toContain(r.body.data.id);
    expect(await idsOf(fx.agents.execA1)).toContain(r.body.data.id); // author
    expect(await idsOf(fx.agents.execA2)).toContain(r.body.data.id); // SALES audience
    expect(await idsOf(fx.agents.teamLead)).toContain(r.body.data.id);
    expect(await idsOf(fx.agents.finance).catch(() => null)).toBeNull();
    for (const body of ['Asha Verma (asha@example.com) wants a refund', 'Call 9876543210 about this']) {
      const bad = await fx.agents.execA1.post('/cx/insights').send({ title: 'Learner insight', body, audience: ['MARKETING'] });
      expect(bad.status).toBe(422);
      expect(bad.body.error.code).toBe('PII_NOT_ALLOWED');
    }
    expect((await other.agent.get('/cx/insights')).body.data).toEqual([]);
  });
});
