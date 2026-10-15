import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLead, createOrg, createTeam, createUser, crmKit, loginAgent, uniqPhone, future, type CrmKit } from './kit';

/**
 * Isolation matrix for the CRM domain: manager sibling, executive peer, cross-org, summary-only and no-permission roles.
 * Out-of-scope and missing records are indistinguishable (404) - IDOR safe.
 */
let k: CrmKit;
let alien: { lead: { id: string }; taskId: string; agent: Awaited<ReturnType<typeof loginAgent>>; callId: string };
let leadA1: { id: string }, leadB1: { id: string };
let taskA1: string, taskB1: string;

beforeAll(async () => {
  k = await crmKit();
  leadA1 = await createLead(k.a.execA1);
  leadB1 = await createLead(k.a.execB1);
  taskA1 = (await k.t.prisma.task.findFirstOrThrow({ where: { leadId: leadA1.id } })).id;
  taskB1 = (await k.t.prisma.task.findFirstOrThrow({ where: { leadId: leadB1.id } })).id;
  // a completely separate organization with its own manager + executive
  const org2 = await createOrg(k.t.prisma);
  const mgr2 = await createUser(k.t.prisma, org2, { roles: ['SALES_MANAGER'] });
  const ex2 = await createUser(k.t.prisma, org2, { roles: ['SALES_EXECUTIVE'], managerId: mgr2.id });
  await createTeam(k.t.prisma, org2, 'Alien team', [{ userId: mgr2.id, role: 'LEAD' }, { userId: ex2.id }], mgr2.id);
  const agent = await loginAgent(k.app, mgr2);
  const lead = await createLead(await loginAgent(k.app, ex2));
  const call = await (await loginAgent(k.app, ex2)).post(`/leads/${lead.id}/calls`).send({ outcome: 'NO_ANSWER' });
  alien = { lead, taskId: (await k.t.prisma.task.findFirstOrThrow({ where: { leadId: lead.id } })).id, agent, callId: call.body.data.call.id };
});
afterAll(async () => { await k.close(); });

const probes = (leadId: string, taskId: string) => [
  ['GET', `/leads/${leadId}`],
  ['PATCH', `/leads/${leadId}`, { isKeyProspect: true }],
  ['POST', `/leads/${leadId}/assign`, { toUserId: k.fx.execA1.id, reason: 'idor probe' }],
  ['POST', `/leads/${leadId}/status`, { status: 'CONTACT_ATTEMPTED' }],
  ['GET', `/leads/${leadId}/timeline`],
  ['GET', `/leads/${leadId}/calls`],
  ['POST', `/leads/${leadId}/calls`, { outcome: 'NO_ANSWER' }],
  ['POST', `/leads/${leadId}/notes`, { body: 'idor' }],
  ['POST', `/leads/${leadId}/tasks`, { title: 'idor', dueAt: future(60) }],
  ['PATCH', `/tasks/${taskId}`, { title: 'idor' }],
  ['POST', `/tasks/${taskId}/complete`, {}],
  ['POST', `/tasks/${taskId}/reassign`, { assignedToId: k.fx.execA1.id, reason: 'idor probe' }],
] as const;

async function fire(agent: typeof k.a.execA1, [method, path, body]: readonly [string, string, unknown?]) {
  const m = method.toLowerCase() as 'get' | 'post' | 'patch';
  const req = agent[m](path);
  return body === undefined ? req : req.send(body as object);
}

describe('record-level isolation (every lead/task endpoint)', () => {
  const cases: Array<[string, () => typeof k.a.execA1, () => { lead: string; task: string }]> = [
    ['executive peer (A2 -> A1\'s records)', () => k.a.execA2, () => ({ lead: leadA1.id, task: taskA1 })],
    ['executive on the other team (B1 -> A1\'s records)', () => k.a.execB1, () => ({ lead: leadA1.id, task: taskA1 })],
    ['sibling manager (B -> team A records)', () => k.a.managerB, () => ({ lead: leadA1.id, task: taskA1 })],
    ['sibling manager (A -> team B records)', () => k.a.managerA, () => ({ lead: leadB1.id, task: taskB1 })],
    ['cross-organization manager', () => alien.agent, () => ({ lead: leadA1.id, task: taskA1 })],
  ];
  for (const [name, who, ids] of cases) {
    it(`${name}: all endpoints answer 404 and nothing changes`, async () => {
      const { lead, task } = ids();
      const before = await k.t.prisma.lead.findUniqueOrThrow({ where: { id: lead } });
      for (const p of probes(lead, task)) {
        const res = await fire(who(), p);
        // executives hold neither leads:assign nor tasks:reassign: the permission layer answers first (403); everything else is a 404
        const needsManager = /\/assign$|\/reassign$/.test(p[1]) && who() !== k.a.managerA && who() !== k.a.managerB && who() !== alien.agent;
        expect(res.status, `${p[0]} ${p[1]} -> ${res.status} ${JSON.stringify(res.body)}`).toBe(needsManager ? 403 : 404);
        expect(res.body.data).toBeNull();
      }
      const after = await k.t.prisma.lead.findUniqueOrThrow({ where: { id: lead } });
      expect(after.version).toBe(before.version);
      expect(after.assignedToId).toBe(before.assignedToId);
      expect((await k.t.prisma.task.findUniqueOrThrow({ where: { id: task } })).status).toBe('OPEN');
    });
  }

  it('the cross-org probe in the other direction cannot see this org either', async () => {
    const a = await loginAgent(k.app, k.fx.founder);
    for (const p of probes(alien.lead.id, alien.taskId)) {
      const res = await fire(a, p);
      expect(res.status, `${p[0]} ${p[1]}`).toBe(404);
    }
  });

  it('lists only expose in-scope rows', async () => {
    const execList = await k.a.execA1.get('/leads?limit=100');
    expect(execList.body.data.every((l: { assignedTo: { id: string } | null }) => l.assignedTo?.id === k.fx.execA1.id)).toBe(true);
    expect(execList.body.data.some((l: { id: string }) => l.id === leadB1.id)).toBe(false);
    const mgr = await k.a.managerA.get('/leads?limit=100');
    expect(mgr.body.data.some((l: { id: string }) => l.id === leadA1.id)).toBe(true);
    expect(mgr.body.data.some((l: { id: string }) => l.id === leadB1.id)).toBe(false);
    expect(mgr.body.data.some((l: { id: string }) => l.id === alien.lead.id)).toBe(false);
    const founder = await k.a.founder.get('/leads?limit=100');
    expect(founder.body.data.some((l: { id: string }) => l.id === leadA1.id) && founder.body.data.some((l: { id: string }) => l.id === leadB1.id)).toBe(true);
    expect(founder.body.data.some((l: { id: string }) => l.id === alien.lead.id)).toBe(false);
    const tasks = await k.a.managerB.get('/tasks?limit=100&status=ALL');
    expect(tasks.body.data.some((t: { id: string }) => t.id === taskA1)).toBe(false);
    expect(tasks.body.data.some((t: { id: string }) => t.id === taskB1)).toBe(true);
    for (const path of ['/leads/workspace', '/leads/exceptions', '/leads/duplicates', '/leads/reactivation', '/reassignment-queue', '/leads/import']) {
      const r = await k.a.managerB.get(path);
      expect(JSON.stringify(r.body), path).not.toContain(leadA1.id);
      expect(JSON.stringify(r.body), path).not.toContain(alien.lead.id);
    }
  });

  it('assignment targets must be real, active, same-org sales users inside the actor\'s scope', async () => {
    const own = await createLead(k.a.execA1);
    const ex = await createUser(k.t.prisma, k.fx.org, { roles: ['SALES_EXECUTIVE'], managerId: k.fx.managerA.id, isActive: false });
    const fin = k.fx.finance;
    expect((await k.a.managerA.post(`/leads/${own.id}/assign`).send({ toUserId: ex.id, reason: 'inactive' })).body.error.code).toBe('TARGET_INACTIVE');
    expect((await k.a.founder.post(`/leads/${own.id}/assign`).send({ toUserId: fin.id, reason: 'not a sales user' })).body.error.code).toBe('TARGET_NOT_SALES');
    expect((await k.a.founder.post(`/leads/${own.id}/assign`).send({ toUserId: (await k.t.prisma.user.findFirstOrThrow({ where: { organizationId: { not: k.fx.org.id } } })).id, reason: 'other org' })).status).toBe(404);
    expect((await k.a.managerA.post(`/leads/${own.id}/assign`).send({ toUserId: k.fx.execB1.id, reason: 'outside team' })).status).toBe(404);
    expect((await k.a.founder.post(`/leads/${own.id}/assign`).send({ toUserId: k.fx.execB1.id, reason: 'org scope can' })).status).toBe(200);
    expect((await k.a.teamLead.post(`/leads/${own.id}/assign`).send({ toUserId: k.fx.execA1.id, reason: 'team lead is org scope' })).status).toBe(200);
  });

  it('organization/owner/role cannot be injected through request bodies (strict schemas) or headers', async () => {
    const r = await k.a.execA1.post('/leads').send({ fullName: 'inject', phone: uniqPhone(), organizationId: alien.lead.id, assignedToId: k.fx.execB1.id, teamId: k.fx.teamB.id });
    expect(r.status).toBe(400);
    const r2 = await k.a.execA1.post('/leads').set('x-organization-id', 'x').send({ fullName: 'inject', phone: uniqPhone() });
    expect(r2.status).toBe(201);
    expect((await k.t.prisma.lead.findUniqueOrThrow({ where: { id: r2.body.data.lead.id } })).organizationId).toBe(k.fx.org.id);
  });
});

describe('role matrix', () => {
  it('summary-scope roles (Marketing) see a minimum-data projection: no phone, email, owner, notes, calls or tasks', async () => {
    const list = await k.a.marketing.get('/leads?limit=100');
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);
    for (const l of list.body.data) {
      expect(Object.keys(l).sort()).toEqual(['createdAt', 'fullName', 'id', 'program', 'source', 'stageCategory', 'status', 'summary']);
    }
    const one = await k.a.marketing.get(`/leads/${leadA1.id}`);
    expect(one.status).toBe(200);
    expect(one.body.data.phone).toBeUndefined();
    expect(one.body.data.email).toBeUndefined();
    expect(one.body.data.assignedTo).toBeUndefined();
    for (const path of [`/leads/${leadA1.id}/timeline`, `/leads/${leadA1.id}/calls`, '/tasks', '/leads/workspace']) {
      const r = await k.a.marketing.get(path);
      expect([403, 200]).toContain(r.status);
      if (path.endsWith('/workspace')) expect(JSON.stringify(r.body.data.priorityLeads)).not.toContain('phone');
      else expect(r.status).toBe(403);
    }
    expect((await k.a.marketing.patch(`/leads/${leadA1.id}`).send({ isKeyProspect: true })).status).toBe(403);
  });

  it('finance/admin hold no lead permissions; admin can import and configure but not read leads', async () => {
    expect((await k.a.finance.get('/leads')).status).toBe(403);
    expect((await k.a.admin.get('/leads')).status).toBe(403);
    expect((await k.a.admin.get(`/leads/${leadA1.id}`)).status).toBe(403);
    expect((await k.a.admin.get('/lead-stages')).status).toBe(200);
    expect((await k.a.admin.get('/leads/import')).status).toBe(200);
  });

  it('private notes: only the author and holders of leads:notes:view-private (managers) can read them in the timeline', async () => {
    const l = await createLead(k.a.execA1);
    await k.a.execA1.post(`/leads/${l.id}/notes`).send({ body: 'private to a1', visibility: 'PRIVATE' });
    const own = await k.a.execA1.get(`/leads/${l.id}/timeline`);
    expect(own.body.data.some((i: { detail: string }) => i.detail === 'private to a1')).toBe(true);
    // hand the lead to a peer executive: the private note stays hidden from the new owner
    await k.a.managerA.post(`/leads/${l.id}/assign`).send({ toUserId: k.fx.execA2.id, reason: 'peer reads timeline' });
    const peer = await k.a.execA2.get(`/leads/${l.id}/timeline`);
    expect(peer.status).toBe(200);
    expect(peer.body.data.some((i: { detail: string }) => i.detail === 'private to a1')).toBe(false);
    const mgr = await k.a.managerA.get(`/leads/${l.id}/timeline`);
    expect(mgr.body.data.some((i: { detail: string }) => i.detail === 'private to a1')).toBe(true);
  });

  it('saved views are personal', async () => {
    const mk = await k.a.execA1.post('/leads/views').send({ name: 'My hot leads', filters: { interestLevel: 'HIGH' } });
    expect(mk.status).toBe(201);
    expect((await k.a.execA1.get('/leads/views')).body.data.map((v: { name: string }) => v.name)).toContain('My hot leads');
    expect((await k.a.execA2.get('/leads/views')).body.data.map((v: { name: string }) => v.name)).not.toContain('My hot leads');
    expect((await k.a.execA2.delete(`/leads/views/${mk.body.data.id}`)).status).toBe(404);
    expect((await k.a.execA1.delete(`/leads/views/${mk.body.data.id}`)).status).toBe(200);
  });

  it('dead-letter view is admin-only and org-scoped', async () => {
    const dead = await k.t.prisma.outboxEvent.create({ data: { organizationId: k.fx.org.id, aggregateType: 't', aggregateId: 'x', eventType: 'crm.test', payload: {}, status: 'DEAD', lastError: 'boom' } });
    const list = await k.a.admin.get('/jobs/dlq?limit=100');
    expect(list.body.data.some((e: { id: string }) => e.id === dead.id)).toBe(true);
    expect((await alien.agent.get('/jobs/dlq')).status).toBe(403);
    expect((await k.a.admin.post(`/jobs/dlq/${dead.id}/retry`).send({})).status).toBe(200);
    expect((await k.t.prisma.outboxEvent.findUniqueOrThrow({ where: { id: dead.id } })).status).toBe('PENDING');
    expect((await k.a.admin.post(`/jobs/dlq/${dead.id}/retry`).send({})).status).toBe(404);
    await k.t.prisma.outboxEvent.update({ where: { id: dead.id }, data: { status: 'DISPATCHED' } });
  });
});
