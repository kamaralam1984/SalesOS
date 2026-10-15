import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIVILEGED_BODY_KEYS, strippedPrivilegedKeys } from '../../src/common/http/zod.pipe';
import { createOrg, createUser } from '../helpers';
import { buildKit, closeWon, createDeal, makeLead, recordPayment, wonDeal, type RevenueKit } from '../revenue/kit';

/**
 * Mass assignment / privileged body fields. Two layers are proven:
 *   1. ZodPipe rejects (400 FORBIDDEN_FIELD) any body that carries a privileged key (organizationId, createdById, passwordHash ...) the schema does not consume.
 *   2. For fields the schema DOES know (ownerId, status, amounts, stage ...) the SERVICE must enforce scope / state machine: the DB row is checked after the call.
 */
let k: RevenueKit;
let otherOrgUserId: string;
beforeAll(async () => {
  k = await buildKit();
  const org2 = await createOrg(k.prisma);
  otherOrgUserId = (await createUser(k.prisma, org2, { roles: ['SALES_EXECUTIVE'] })).id;
});
afterAll(async () => { await k.close(); });

describe('strippedPrivilegedKeys (unit)', () => {
  it('finds privileged keys at any depth that the schema output dropped, ignores harmless ones', () => {
    expect(strippedPrivilegedKeys({ a: 1, organizationId: 'x' }, { a: 1 })).toEqual(['organizationId']);
    expect(strippedPrivilegedKeys({ items: [{ ok: 1, createdById: 'x' }] }, { items: [{ ok: 1 }] })).toEqual(['items[0].createdById']);
    expect(strippedPrivilegedKeys({ a: 1, unknownHarmless: 2 }, { a: 1 })).toEqual([]);
    expect(strippedPrivilegedKeys({ organizationId: 'x' }, { organizationId: 'x' })).toEqual([]); // consumed by the schema = the schema owns the decision
    expect(strippedPrivilegedKeys({ ORGANIZATIONID: 'x' }, {})).toEqual(['ORGANIZATIONID']);
    expect(PRIVILEGED_BODY_KEYS.has('organizationid')).toBe(true);
  });
});

describe('privileged keys are refused on representative create/update endpoints', () => {
  const evil = { organizationId: '00000000-0000-4000-8000-000000000000', createdById: '00000000-0000-4000-8000-000000000000' };
  it('lead create / update', async () => {
    const lead = await makeLead(k, k.fx.execA1.id, k.fx.teamA.id);
    const res = await k.agents.execA1.patch(`/leads/${lead.id}`).send({ fullName: 'x', ...evil });
    expect(res.status).toBe(400);
    const c = await k.agents.execA1.post('/leads').send({ fullName: 'y', phone: '9811100001', ...evil });
    expect(c.status).toBe(400);
  });
  it('user create / update / role set (Admin, Founder)', async () => {
    const f = k.agents.founder;
    const r1 = await f.post('/users').send({ email: `ma-${Date.now()}@test.salesos.local`, name: 'MA', roles: ['SALES_EXECUTIVE'], organizationId: k.fx.org.id, passwordHash: 'x' });
    expect(r1.status).toBe(400);
    const r2 = await f.patch(`/users/${k.fx.execA1.id}`).send({ name: 'z', organizationId: k.fx.org.id });
    expect(r2.status).toBe(400);
    const r3 = await f.post(`/users/${k.fx.execA1.id}/roles`).send({ roles: ['SALES_EXECUTIVE'], permissions: ['users:role:assign-sensitive'] });
    expect(r3.status).toBe(400);
  });
  it('complaint, deal, payment, refund bodies', async () => {
    const lead = await makeLead(k, k.fx.execA1.id, k.fx.teamA.id);
    expect((await createDeal(k, k.agents.execA1, lead.id, { createdById: k.fx.founder.id })).status).toBe(400);
    const d = await wonDeal(k);
    expect((await recordPayment(k, k.agents.teamLead, d.dealId, { verifiedById: k.fx.finance.id })).status).toBe(400);
    expect((await k.agents.execA1.post('/refunds').send({ dealId: d.dealId, amount: '10.00', reasonCategory: 'OTHER', reason: 'mass assignment probe', approvedById: k.fx.founder.id })).status).toBe(400);
    expect((await k.agents.managerA.post('/cx/complaints').send({ title: 'probe', description: 'probe', category: 'OTHER', priority: 'P3', organizationId: k.fx.org.id })).status).toBe(400);
  });
});

describe('known-but-privileged fields are enforced by the service (DB asserted)', () => {
  it('an executive cannot create a deal owned by someone outside their scope (other team / other organisation)', async () => {
    const lead = await makeLead(k, k.fx.execA1.id, k.fx.teamA.id);
    for (const ownerId of [k.fx.execB1.id, otherOrgUserId, k.fx.founder.id]) {
      const res = await createDeal(k, k.agents.execA1, lead.id, { ownerId });
      expect([400, 403, 404, 409, 422], `ownerId=${ownerId} -> ${res.status}`).toContain(res.status);
    }
    expect(await k.prisma.deal.count({ where: { leadId: lead.id } })).toBe(0);
  });

  it('a deal cannot be pushed to Closed-Won through PATCH (stage allow-list) and the amount cannot be changed after close', async () => {
    const lead = await makeLead(k, k.fx.execA1.id, k.fx.teamA.id);
    const d = await createDeal(k, k.agents.execA1, lead.id, {});
    expect(d.status).toBe(201);
    const id = d.body.data.id as string;
    for (const stage of ['WON', 'CLOSED_WON', 'LOST', 'CLOSED_LOST']) {
      const res = await k.agents.execA1.patch(`/deals/${id}`).send({ stage });
      expect(res.status, stage).toBe(400);
    }
    expect((await k.prisma.deal.findUniqueOrThrow({ where: { id } })).stage).toBe('OPEN');
    const closed = await closeWon(k.agents.execA1, id, {});
    expect(closed.status).toBe(200);
    const after = await k.agents.execA1.patch(`/deals/${id}`).send({ amount: '1.00' });
    expect(after.status).toBeGreaterThanOrEqual(400);
    expect(Number((await k.prisma.deal.findUniqueOrThrow({ where: { id } })).amount)).toBe(50000);
  });

  it('a payment cannot be recorded straight into VERIFIED, over-collect the deal, or reuse a transaction reference', async () => {
    const d = await wonDeal(k, { amount: '40000.00' });
    const pay = await recordPayment(k, k.agents.teamLead, d.dealId, { amount: '40000.00', status: 'VERIFIED', verifiedAt: new Date().toISOString() });
    expect(pay.status).toBe(201);
    expect(pay.body.data.status).toBe('RECORDED');
    // recording is only a claim; Finance's verification is where over-collection is stopped
    const over = await recordPayment(k, k.agents.teamLead, d.dealId, { amount: '9999999.00' });
    expect(over.status).toBe(201);
    const verify = await k.agents.finance.post(`/collections/${over.body.data.id}/verify`).send({});
    expect(verify.status).toBe(422);
    expect(verify.body.error.code).toBe('OVERPAYMENT');
    const ref = `UTR-DUP-${Date.now()}`;
    expect((await recordPayment(k, k.agents.teamLead, d.dealId, { amount: '100.00', externalTransactionRef: ref })).status).toBe(201);
    expect((await recordPayment(k, k.agents.teamLead, d.dealId, { amount: '100.00', externalTransactionRef: ref })).status).toBe(409);
  });

  it('refund requests cannot carry a status, an approved amount, or exceed the collected amount', async () => {
    const d = await wonDeal(k, { amount: '30000.00' });
    const r = await k.agents.managerA.post('/refunds').send({ dealId: d.dealId, amount: '5000.00', reasonCategory: 'OTHER', reason: 'mass assignment probe', status: 'APPROVED', approvedAmount: '5000.00' });
    if (r.status === 201) {
      expect(r.body.data.status).toBe('REQUESTED');
      const row = await k.prisma.refund.findUniqueOrThrow({ where: { id: r.body.data.id } });
      expect(row.status).toBe('REQUESTED');
      expect(row.approvedAmount).toBeNull();
    } else {
      expect(r.status).toBeGreaterThanOrEqual(400); // nothing collected yet, or unknown fields refused: either is safe
    }
    const huge = await k.agents.managerA.post('/refunds').send({ dealId: d.dealId, amount: '99999999.00', reasonCategory: 'OTHER', reason: 'mass assignment probe' });
    expect(huge.status).toBeGreaterThanOrEqual(400);
  });

  it('a user cannot grant themselves roles, re-activate themselves or change their own manager through any user endpoint', async () => {
    const e = k.agents.execA1;
    for (const [path, body] of [[`/users/${k.fx.execA1.id}/roles`, { roles: ['FOUNDER_CEO'] }], [`/users/${k.fx.execA1.id}/reactivate`, {}], [`/users/${k.fx.execA1.id}`, { managerId: k.fx.founder.id }]] as const) {
      const res = await (path.endsWith('roles') || path.endsWith('reactivate') ? e.post(path) : e.patch(path)).send(body as object);
      expect([401, 403, 404, 400], `${path} -> ${res.status}`).toContain(res.status);
    }
    const roles = await k.prisma.userRoleAssignment.findMany({ where: { userId: k.fx.execA1.id }, include: { role: true } });
    expect(roles.map((r) => r.role.key)).toEqual(['SALES_EXECUTIVE']);
    expect((await k.prisma.user.findUniqueOrThrow({ where: { id: k.fx.execA1.id } })).managerId).toBe(k.fx.managerA.id);
  });

  it('the organisation of a created record always comes from the session, never from a header or query', async () => {
    const res = await k.agents.execA1.post('/leads?organizationId=00000000-0000-4000-8000-000000000000').set('x-organization-id', '00000000-0000-4000-8000-000000000000').set('x-forwarded-for', '10.0.0.1').send({ fullName: 'org from session', phone: '9811100002' });
    expect(res.status).toBe(201);
    expect((await k.prisma.lead.findUniqueOrThrow({ where: { id: res.body.data.lead.id } })).organizationId).toBe(k.fx.org.id);
  });
});
