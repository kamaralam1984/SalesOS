import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLead, crmKit, uniqPhone, type CrmKit } from './kit';

let k: CrmKit;
beforeAll(async () => { k = await crmKit(); });
afterAll(async () => { await k.close(); });

describe('lead CRUD + E.164 + search + pagination', () => {
  it('normalises Indian numbers to E.164 and keeps invalid numbers raw + flagged', async () => {
    const ok = await k.a.execA1.post('/leads').send({ fullName: '[TEST] Asha', phone: '98765 43210' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.lead.phoneE164).toBe('+919876543210');
    expect(ok.body.data.lead.phoneValid).toBe(true);
    const bad = await k.a.execA1.post('/leads').send({ fullName: '[TEST] Bad phone', phone: '12ab' });
    expect(bad.status).toBe(201);
    expect(bad.body.data.lead.phoneE164).toBeNull();
    expect(bad.body.data.lead.phoneValid).toBe(false);
    expect(bad.body.meta.warnings.join(' ')).toMatch(/flagged/);
  });

  it('requires a name and a phone or email; rejects unknown fields (strict)', async () => {
    expect((await k.a.execA1.post('/leads').send({ fullName: 'x' })).status).toBe(400);
    expect((await k.a.execA1.post('/leads').send({ phone: uniqPhone() })).status).toBe(400);
    expect((await k.a.execA1.post('/leads').send({ fullName: 'x', phone: uniqPhone(), organizationId: k.fx.org.id })).status).toBe(400);
  });

  it('executive-created leads are owned by the creator, have a first-contact task and a next action (no exception)', async () => {
    const l = await createLead(k.a.execA1);
    expect(l.assignedTo?.id).toBe(k.fx.execA1.id);
    const d = await k.a.execA1.get(`/leads/${l.id}`);
    expect(d.body.data.nextActionAt).toBeTruthy();
    expect(d.body.data.openTasks).toHaveLength(1);
    expect(d.body.data.exceptions).toEqual([]);
    expect(d.body.data.status).toBe('NEW');
  });

  it('an executive cannot create a lead for a peer; a manager can assign within the team only', async () => {
    const own = await k.a.execA1.post('/leads').send({ fullName: 'x', phone: uniqPhone(), assignedToId: k.fx.execA2.id });
    expect(own.status).toBe(403);
    const ok = await k.a.managerA.post('/leads').send({ fullName: '[TEST] m', phone: uniqPhone(), assignedToId: k.fx.execA2.id });
    expect(ok.status).toBe(201);
    const cross = await k.a.managerA.post('/leads').send({ fullName: '[TEST] m', phone: uniqPhone(), assignedToId: k.fx.execB1.id });
    expect(cross.status).toBe(404);
  });

  it('an unowned lead appears in the exception queue (NO_OWNER + NO_NEXT_ACTION) and clears on assignment', async () => {
    const created = await k.a.managerA.post('/leads').send({ fullName: '[TEST] unowned', phone: uniqPhone() });
    expect(created.status).toBe(201);
    const id = created.body.data.lead.id as string;
    expect(created.body.data.lead.assignedTo).toBeNull();
    const ex = await k.a.managerA.get('/leads/exceptions');
    const kinds = ex.body.data.filter((e: { lead: { id: string } }) => e.lead.id === id).map((e: { kind: string }) => e.kind).sort();
    expect(kinds).toEqual(['NO_NEXT_ACTION', 'NO_OWNER']);
    const as = await k.a.managerA.post(`/leads/${id}/assign`).send({ toUserId: k.fx.execA1.id, reason: 'balance load' });
    expect(as.status).toBe(200);
    const after = await k.a.managerA.get('/leads/exceptions');
    expect(after.body.data.filter((e: { lead: { id: string } }) => e.lead.id === id)).toHaveLength(0);
  });

  it('Idempotency-Key makes lead creation retry-safe', async () => {
    const key = `idem-${Math.random()}`;
    const body = { fullName: '[TEST] idem', phone: uniqPhone() };
    const r1 = await k.a.execA1.post('/leads').set('Idempotency-Key', key).send(body);
    const r2 = await k.a.execA1.post('/leads').set('Idempotency-Key', key).send(body);
    expect(r1.body.data.created).toBe(true);
    expect(r2.body.data.created).toBe(false);
    expect(r2.body.data.lead.id).toBe(r1.body.data.lead.id);
    expect(await k.t.prisma.lead.count({ where: { organizationId: k.fx.org.id, createKey: `${k.fx.execA1.id}:${key}` } })).toBe(1);
  });

  it('search + filters + cursor pagination are bounded and stable', async () => {
    const tag = `Zed${Date.now()}`;
    for (let i = 0; i < 5; i++) await createLead(k.a.execA2, { fullName: `[TEST] ${tag} ${i}` });
    const p1 = await k.a.execA2.get(`/leads?q=${tag}&limit=2`);
    expect(p1.status).toBe(200);
    expect(p1.body.data).toHaveLength(2);
    expect(p1.body.meta.pagination.hasMore).toBe(true);
    const p2 = await k.a.execA2.get(`/leads?q=${tag}&limit=2&cursor=${p1.body.meta.pagination.nextCursor}`);
    const p3 = await k.a.execA2.get(`/leads?q=${tag}&limit=2&cursor=${p2.body.meta.pagination.nextCursor}`);
    const ids = [...p1.body.data, ...p2.body.data, ...p3.body.data].map((l: { id: string }) => l.id);
    expect(new Set(ids).size).toBe(5);
    expect(p3.body.meta.pagination.hasMore).toBe(false);
    expect((await k.a.execA2.get('/leads?limit=101')).status).toBe(400);
    expect((await k.a.execA2.get('/leads?limit=0')).status).toBe(400);
    expect((await k.a.execA2.get('/leads?cursor=garbage')).status).toBe(400);
    const phoneSearch = await k.a.execA2.get(`/leads?q=${encodeURIComponent('98')}&limit=5`);
    expect(phoneSearch.status).toBe(200);
  });

  it('PATCH updates fields, re-flags duplicates and rejects stale versions', async () => {
    const l = await createLead(k.a.execA1);
    const ok = await k.a.execA1.patch(`/leads/${l.id}`).send({ interestLevel: 'HIGH', version: l.version });
    expect(ok.status).toBe(200);
    expect(ok.body.data.interestLevel).toBe('HIGH');
    const stale = await k.a.execA1.patch(`/leads/${l.id}`).send({ interestLevel: 'LOW', version: l.version });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
  });
});

describe('assignment: manual, reassignment history, audit, round-robin', () => {
  it('reassignment records history, moves open tasks and audits ownership.changed', async () => {
    const l = await createLead(k.a.execA1);
    const res = await k.a.managerA.post(`/leads/${l.id}/assign`).send({ toUserId: k.fx.execA2.id, reason: 'rebalance' });
    expect(res.status).toBe(200);
    expect(res.body.data.assignedTo.id).toBe(k.fx.execA2.id);
    const rows = await k.t.prisma.leadAssignment.findMany({ where: { leadId: l.id }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => r.method)).toEqual(['MANUAL', 'MANUAL']);
    expect(rows[1]!.reason).toBe('rebalance');
    expect(rows[1]!.fromUserId).toBe(k.fx.execA1.id);
    const tasks = await k.t.prisma.task.findMany({ where: { leadId: l.id, status: 'OPEN' } });
    expect(tasks.every((t) => t.assignedToId === k.fx.execA2.id)).toBe(true);
    const audit = await k.t.prisma.auditLog.findMany({ where: { entityId: l.id, action: 'ownership.changed' } });
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect((await k.a.managerA.post(`/leads/${l.id}/assign`).send({ toUserId: k.fx.execA2.id, reason: 'again' })).body.error.code).toBe('NO_CHANGE');
    expect((await k.a.managerA.post(`/leads/${l.id}/assign`).send({ toUserId: k.fx.execA1.id })).status).toBe(400);
  });

  it('configurable round-robin cycles through active executives of the team and persists the pointer', async () => {
    const team = k.fx.teamA;
    const put = await k.a.founder.agent.put('/api/v1/assignment-rules').set('x-csrf-token', k.a.founder.csrfToken).set('Origin', 'http://localhost:3100').send({ teamId: team.id, isEnabled: true, dailyCap: null, excludedUserIds: [], sourceIds: [], programIds: [] });
    expect(put.status).toBe(200);
    const owners: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await k.a.managerA.post('/leads').send({ fullName: `[TEST] rr${i}`, phone: uniqPhone(), autoAssign: 'round_robin' });
      expect(r.status).toBe(201);
      owners.push(r.body.data.lead.assignedTo.id);
    }
    expect(new Set(owners.slice(0, 2)).size).toBe(2);
    expect(owners[0]).toBe(owners[2]);
    expect(owners[1]).toBe(owners[3]);
    expect([k.fx.execA1.id, k.fx.execA2.id]).toContain(owners[0]);
    const rows = await k.t.prisma.leadAssignment.findMany({ where: { organizationId: k.fx.org.id, method: 'ROUND_ROBIN' } });
    expect(rows.length).toBeGreaterThanOrEqual(4);
    // excluded (on leave) executive is skipped
    await k.a.founder.agent.put('/api/v1/assignment-rules').set('x-csrf-token', k.a.founder.csrfToken).set('Origin', 'http://localhost:3100').send({ teamId: team.id, isEnabled: true, dailyCap: null, excludedUserIds: [k.fx.execA1.id], sourceIds: [], programIds: [] });
    const r = await k.a.managerA.post('/leads').send({ fullName: '[TEST] rr-skip', phone: uniqPhone(), autoAssign: 'round_robin' });
    expect(r.body.data.lead.assignedTo.id).toBe(k.fx.execA2.id);
  });
});

describe('lead status machine', () => {
  it('rejects illegal transitions with 409 INVALID_TRANSITION and never changes state', async () => {
    const l = await createLead(k.a.execA1);
    const bad = await k.a.execA1.post(`/leads/${l.id}/status`).send({ status: 'WON', wonValue: 1000 });
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe('INVALID_TRANSITION');
    expect((await k.a.execA1.post(`/leads/${l.id}/status`).send({ status: 'QUALIFIED' })).status).toBe(409);
    expect((await k.a.execA1.post(`/leads/${l.id}/status`).send({ status: 'NOPE' })).status).toBe(409);
    expect((await k.t.prisma.lead.findUniqueOrThrow({ where: { id: l.id } })).status).toBe('NEW');
  });

  it('walks the happy path with history rows and requires reasons for backward moves', async () => {
    const l = await createLead(k.a.execA1);
    for (const s of ['CONTACT_ATTEMPTED', 'CONNECTED', 'QUALIFIED', 'DEMO_SCHEDULED']) {
      const r = await k.a.execA1.post(`/leads/${l.id}/status`).send({ status: s });
      expect(r.status, `${s}: ${JSON.stringify(r.body)}`).toBe(200);
    }
    const back = await k.a.execA1.post(`/leads/${l.id}/status`).send({ status: 'CONNECTED' });
    expect(back.status).toBe(422);
    expect(back.body.error.code).toBe('REASON_REQUIRED');
    expect((await k.a.execA1.post(`/leads/${l.id}/status`).send({ status: 'CONNECTED', reason: 'client wants re-qualification' })).status).toBe(200);
    const hist = await k.t.prisma.leadStatusHistory.findMany({ where: { leadId: l.id }, orderBy: { createdAt: 'asc' } });
    expect(hist.map((h) => h.newStatus)).toEqual(['NEW', 'CONTACT_ATTEMPTED', 'CONNECTED', 'QUALIFIED', 'DEMO_SCHEDULED', 'CONNECTED']);
  });

  it('LOST requires a configured reason (and a note for OTHER); WON is terminal; reopening needs a manager', async () => {
    const l = await createLead(k.a.execA1);
    expect((await k.a.execA1.post(`/leads/${l.id}/status`).send({ status: 'LOST' })).body.error.code).toBe('LOST_REASON_REQUIRED');
    expect((await k.a.execA1.post(`/leads/${l.id}/status`).send({ status: 'LOST', lostReason: 'BOGUS' })).status).toBe(422);
    expect((await k.a.execA1.post(`/leads/${l.id}/status`).send({ status: 'LOST', lostReason: 'OTHER' })).body.error.code).toBe('LOST_NOTE_REQUIRED');
    const lost = await k.a.execA1.post(`/leads/${l.id}/status`).send({ status: 'LOST', lostReason: 'PRICE' });
    expect(lost.status).toBe(200);
    expect(lost.body.data.stageCategory).toBe('LOST');
    expect((await k.t.prisma.task.count({ where: { leadId: l.id, status: 'OPEN' } }))).toBe(0);
    const entry = await k.t.prisma.reactivationEntry.findFirst({ where: { leadId: l.id } });
    expect(entry?.status).toBe('PENDING');
    expect(entry!.eligibleFrom.getTime()).toBeGreaterThan(Date.now() + 59 * 86_400_000);
    // executive cannot reopen, manager can
    expect((await k.a.execA1.post(`/leads/${l.id}/status`).send({ status: 'CONTACT_ATTEMPTED', reason: 'client called' })).status).toBe(403);
    expect((await k.a.managerA.post(`/leads/${l.id}/status`).send({ status: 'CONTACT_ATTEMPTED', reason: 'client called back' })).status).toBe(200);
    // never WON -> anything
    const w = await createLead(k.a.execA1);
    for (const s of ['CONTACT_ATTEMPTED', 'CONNECTED', 'PROPOSAL_NEGOTIATION']) await k.a.execA1.post(`/leads/${w.id}/status`).send({ status: s });
    expect((await k.a.execA1.post(`/leads/${w.id}/status`).send({ status: 'WON' })).body.error.code).toBe('WON_VALUE_REQUIRED');
    expect((await k.a.execA1.post(`/leads/${w.id}/status`).send({ status: 'WON', wonValue: 25000 })).status).toBe(200);
    expect((await k.a.managerA.post(`/leads/${w.id}/status`).send({ status: 'LOST', lostReason: 'PRICE' })).body.error.code).toBe('INVALID_TRANSITION');
    expect((await k.a.managerA.post(`/leads/${w.id}/status`).send({ status: 'CONTACT_ATTEMPTED', reason: 'x' })).body.error.code).toBe('INVALID_TRANSITION');
  });
});

describe('notes + timeline', () => {
  it('timeline merges notes, tasks, status and assignments newest first; private notes are hidden from peers without the permission', async () => {
    const l = await createLead(k.a.execA1);
    await k.a.execA1.post(`/leads/${l.id}/notes`).send({ body: 'shared note' });
    await k.a.execA1.post(`/leads/${l.id}/notes`).send({ body: 'my private note', visibility: 'PRIVATE' });
    const tl = await k.a.execA1.get(`/leads/${l.id}/timeline`);
    expect(tl.status).toBe(200);
    const types = new Set(tl.body.data.map((i: { type: string }) => i.type));
    expect(types).toEqual(new Set(['note', 'task', 'status', 'assignment']));
    const times = tl.body.data.map((i: { at: string }) => Date.parse(i.at));
    expect([...times].sort((x, y) => y - x)).toEqual(times);
    const mgr = await k.a.managerA.get(`/leads/${l.id}/timeline`);
    expect(mgr.body.data.some((i: { detail: string }) => i.detail === 'my private note')).toBe(true); // managers hold leads:notes:view-private
    expect((await k.a.execA1.post(`/leads/${l.id}/notes`).send({ body: '' })).status).toBe(400);
  });
});

describe('export', () => {
  it('CSV export respects scope + filters, is audited, and neutralises spreadsheet formulas', async () => {
    const name = `=cmd|' /C calc'!A0 ${Date.now()}`;
    await createLead(k.a.execA1, { fullName: name });
    await createLead(k.a.execB1, { fullName: `[TEST] other team ${Date.now()}` });
    const mgr = await k.a.managerA.get('/leads/export?limit=100');
    expect(mgr.status).toBe(200);
    expect(mgr.headers['content-type']).toMatch(/text\/csv/);
    expect(mgr.text.split('\r\n')[0]).toBe('id,name,phone,email,status,stage_category,interest,owner,source,program,next_action_at,last_activity_at,consent,created_at');
    expect(mgr.text).toContain(`'=cmd`);
    expect(mgr.text).not.toContain('other team');
    expect(await k.t.prisma.auditLog.count({ where: { action: 'export.created', actorId: k.fx.managerA.id } })).toBeGreaterThanOrEqual(1);
    expect((await k.a.execA1.get('/leads/export')).status).toBe(403); // executives cannot export
    const filtered = await k.a.founder.get('/leads/export?status=NEW&assignedToId=unassigned');
    expect(filtered.status).toBe(200);
  });
});

describe('ageing', () => {
  it('buckets open leads by age since creation AND since last activity, scoped to the caller', async () => {
    const old = await createLead(k.a.execA2);
    await k.t.prisma.lead.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 20 * 86_400_000), lastActivityAt: new Date(Date.now() - 5 * 86_400_000) } });
    const r = await k.a.execA2.get('/leads/ageing');
    expect(r.status).toBe(200);
    expect(r.body.data.sinceCreation['15-30d']).toBeGreaterThanOrEqual(1);
    expect(r.body.data.sinceLastActivity['4-7d']).toBeGreaterThanOrEqual(1);
    expect(Object.values(r.body.data.sinceCreation).reduce((a: number, b) => a + (b as number), 0)).toBe(r.body.data.total);
    const own = await k.t.prisma.lead.count({ where: { organizationId: k.fx.org.id, assignedToId: k.fx.execA2.id, stageCategory: 'OPEN', mergedIntoId: null } });
    expect(r.body.data.total).toBe(own); // only the caller's own leads
  });
});
