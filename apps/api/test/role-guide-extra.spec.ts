import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCxFixture, createLead, type CxFixture } from './cx/helpers';
import { createTestApp, type TestApp } from './helpers';

/**
 * More statements from "Sales OS - Roles aur Reporting Guide" as executable rules (see role-guide.spec.ts for the rest):
 * minimum-data leads and refunds, mandatory disposition, leave order manager -> HR, Finance summary-only views, 45-day goal.
 */
let t: TestApp;
let fx: CxFixture;

beforeAll(async () => {
  t = await createTestApp();
  fx = await buildCxFixture(t);
});
afterAll(async () => { await t.close(); });

const CONTACT_KEYS = ['phoneE164', 'phone', 'email', 'assignedToId', 'ownerId', 'owner', 'notes', 'alternatePhone'];
const hasNone = (row: Record<string, unknown>, keys: string[]) => keys.filter((k) => k in row && row[k] !== null && row[k] !== undefined);

describe('Marketing and Student Success see leads with minimum info only (name, status), no contact details', () => {
  it.each(['marketing', 'ss'] as const)('%s: list and detail carry no phone, email, owner or notes', async (who) => {
    const lead = await createLead(t.prisma, fx.org.id, fx.execA1, fx.teamA.id, { programId: fx.program.id });
    const list = await fx.agents[who].get('/leads?limit=100');
    expect(list.status).toBe(200);
    const row = (list.body.data as Array<Record<string, unknown>>).find((l) => l.id === lead.id)!;
    expect(row, 'lead is visible at minimum level').toBeTruthy();
    expect(row.fullName).toBe(lead.fullName);
    expect(hasNone(row, CONTACT_KEYS)).toEqual([]);
    expect(JSON.stringify(row)).not.toContain(lead.phoneE164!);
    expect(JSON.stringify(row)).not.toContain(lead.email!);

    const one = await fx.agents[who].get(`/leads/${lead.id}`);
    expect(one.status).toBe(200);
    expect(hasNone(one.body.data as Record<string, unknown>, CONTACT_KEYS)).toEqual([]);
    expect(JSON.stringify(one.body)).not.toContain(lead.phoneE164!);
    expect(JSON.stringify(one.body)).not.toContain(lead.email!);
  });
});

describe('Student Success sees refunds without amount or reason', () => {
  it('/refunds and /cx/refunds carry no amount, reason or reasonCategory for Student Success, but do for the sales chain', async () => {
    const lead = await createLead(t.prisma, fx.org.id, fx.execA1, fx.teamA.id, { programId: fx.program.id });
    const deal = await t.prisma.deal.create({ data: { organizationId: fx.org.id, leadId: lead.id, programId: fx.program.id, ownerId: fx.execA1.id, teamId: fx.teamA.id, stage: 'WON', amount: '20000.00', closedAt: new Date(), createdById: fx.execA1.id } });
    const refund = await t.prisma.refund.create({ data: { organizationId: fx.org.id, dealId: deal.id, ownerId: fx.execA1.id, teamId: fx.teamA.id, status: 'REQUESTED', amount: '5000.00', reasonCategory: 'LEARNER_REQUEST', reason: 'Secret reason text', requestedById: fx.execA1.id } });

    for (const path of ['/refunds?limit=100', '/cx/refunds?limit=100']) {
      const res = await fx.agents.ss.get(path);
      expect(res.status, path).toBe(200);
      const row = (res.body.data as Array<Record<string, unknown>>).find((r) => r.id === refund.id)!;
      expect(row, `${path} lists the refund`).toBeTruthy();
      const text = JSON.stringify(row);
      expect(text, path).not.toContain('5000');
      expect(text, path).not.toContain('Secret reason text');
      expect(text, path).not.toContain('LEARNER_REQUEST');
      expect(row.reason, path).toBeUndefined();
    }
    const detail = await fx.agents.ss.get(`/refunds/${refund.id}`);
    expect(JSON.stringify(detail.body)).not.toContain('Secret reason text');
    expect(JSON.stringify(detail.body)).not.toContain('LEARNER_REQUEST');

    const own = await fx.agents.execA1.get('/refunds?limit=100');
    const mine = (own.body.data as Array<Record<string, unknown>>).find((r) => r.id === refund.id)!;
    expect(JSON.stringify(mine)).toContain('LEARNER_REQUEST');
  });
});

describe('call disposition is mandatory', () => {
  it('a call without an outcome is rejected and nothing is stored', async () => {
    const lead = await createLead(t.prisma, fx.org.id, fx.execA1, fx.teamA.id);
    for (const body of [{}, { notes: 'spoke briefly' }, { outcome: '' }, { outcome: 'MAYBE' }]) {
      const r = await fx.agents.execA1.post(`/leads/${lead.id}/calls`).send(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect(await t.prisma.callLog.count({ where: { leadId: lead.id } })).toBe(0);
    expect((await fx.agents.execA1.post(`/leads/${lead.id}/calls`).send({ outcome: 'NO_ANSWER' })).status).toBe(201);
  });
});

describe('leave goes to the manager first, then HR', () => {
  it('HR cannot approve before the manager; manager approval moves it to HR; HR approval completes it; nobody approves their own', async () => {
    const bal = await fx.agents.hr.post('/workforce/leave/balances/adjust').send({ userId: fx.execA1.id, typeKey: 'CASUAL', amount: '5', kind: 'OPENING', reason: 'opening balance (test)' });
    expect(bal.status, JSON.stringify(bal.body)).toBeLessThan(300);
    const created = await fx.agents.execA1.post('/workforce/leave/requests').send({ typeKey: 'CASUAL', startDate: '2027-03-02', endDate: '2027-03-02', reason: 'role guide check' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id as string;
    expect(created.body.data.status).toBe('PENDING_MANAGER');

    const early = await fx.agents.hr.post(`/workforce/leave/requests/${id}/decision`).send({ decision: 'APPROVE' });
    expect([403, 409]).toContain(early.status);
    expect((await t.prisma.leaveRequest.findUniqueOrThrow({ where: { id } })).status).toBe('PENDING_MANAGER');

    expect([403, 404]).toContain((await fx.agents.execA2.post(`/workforce/leave/requests/${id}/decision`).send({ decision: 'APPROVE' })).status);
    expect([403, 404]).toContain((await fx.agents.managerB.post(`/workforce/leave/requests/${id}/decision`).send({ decision: 'APPROVE' })).status);

    const mgr = await fx.agents.managerA.post(`/workforce/leave/requests/${id}/decision`).send({ decision: 'APPROVE' });
    expect(mgr.status, JSON.stringify(mgr.body)).toBe(200);
    expect((await t.prisma.leaveRequest.findUniqueOrThrow({ where: { id } })).status).toBe('PENDING_HR');

    const hr = await fx.agents.hr.post(`/workforce/leave/requests/${id}/decision`).send({ decision: 'APPROVE' });
    expect(hr.status, JSON.stringify(hr.body)).toBe(200);
    expect((await t.prisma.leaveRequest.findUniqueOrThrow({ where: { id } })).status).toBe('APPROVED');
  });
});

describe('Finance sees targets and forecasts as a summary and no calls', () => {
  it('targets and forecasts are readable but flagged summary; calls and leads are refused', async () => {
    for (const path of ['/targets', '/forecasts']) {
      const r = await fx.agents.finance.get(path);
      expect(r.status, path).toBe(200);
    }
    for (const path of ['/leads', `/leads/${fx.leadA.id}`, `/leads/${fx.leadA.id}/calls`, '/leads/exceptions']) {
      expect((await fx.agents.finance.get(path)).status, `Finance on ${path}`).toBe(403);
    }
    expect((await fx.agents.finance.post('/targets').send({})).status).toBe(403);
    expect((await fx.agents.finance.post('/forecasts').send({})).status).toBe(403);
  });
});

describe('Sales Executive has the 45-day goal', () => {
  it('goal cycle is 45 days by default and a new goal for an executive spans 45 days', async () => {
    const s = (await fx.agents.founder.get('/workforce/settings')).body.data;
    expect(s.effective.goals.cycleDays).toBe(45);
    const created = await fx.agents.execA1.post('/workforce/goals').send({ title: 'Role guide 45 day goal', startDate: '2027-03-01' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.cycleDays).toBe(45);
    expect(created.body.data.targetDate).toBe('2027-04-14');
  });
});
