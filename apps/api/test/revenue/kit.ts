import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { TestingModuleBuilder } from '@nestjs/testing';
import type { Response } from 'supertest';
import { buildOrgFixture, createTestApp, loginAgent, uniq, type AuthedAgent, type OrgFixture, type TestApp } from '../helpers';
import { REVENUE_FAULT_INJECTOR, type FaultInjector } from '../../src/modules/revenue/revenue.support';

export interface RevenueKit {
  t: TestApp;
  prisma: PrismaClient;
  fx: OrgFixture;
  program: { id: string; name: string };
  program2: { id: string; name: string };
  agents: Record<'founder' | 'teamLead' | 'managerA' | 'managerB' | 'execA1' | 'execA2' | 'execB1' | 'finance' | 'admin' | 'hr', AuthedAgent>;
  fault: { current: FaultInjector };
  close: () => Promise<void>;
}

/** Boots the real app on the test DB with a revenue-ready org: standard hierarchy + 2 programs. */
export async function buildKit(): Promise<RevenueKit> {
  const fault = { current: (() => undefined) as FaultInjector };
  const t = await createTestApp({
    customize: (b: TestingModuleBuilder) => b.overrideProvider(REVENUE_FAULT_INJECTOR).useValue((step: Parameters<FaultInjector>[0]) => fault.current(step)),
  });
  const fx = await buildOrgFixture(t.prisma);
  const program = await t.prisma.program.create({ data: { organizationId: fx.org.id, code: uniq('P'), name: '[TEST] Program One' } });
  const program2 = await t.prisma.program.create({ data: { organizationId: fx.org.id, code: uniq('Q'), name: '[TEST] Program Two' } });
  const agents = {
    founder: await loginAgent(t.app, fx.founder),
    teamLead: await loginAgent(t.app, fx.teamLead),
    managerA: await loginAgent(t.app, fx.managerA),
    managerB: await loginAgent(t.app, fx.managerB),
    execA1: await loginAgent(t.app, fx.execA1),
    execA2: await loginAgent(t.app, fx.execA2),
    execB1: await loginAgent(t.app, fx.execB1),
    finance: await loginAgent(t.app, fx.finance),
    admin: await loginAgent(t.app, fx.admin),
    hr: await loginAgent(t.app, fx.hr),
  };
  return { t, prisma: t.prisma, fx, program, program2, agents, fault, close: t.close };
}

/** A lead owned by `ownerId` sitting in a stage from which it can close (PROPOSAL_NEGOTIATION by default). */
export async function makeLead(k: RevenueKit, ownerId: string, teamId: string | null, over: { status?: string; stageCategory?: 'OPEN' | 'WON' | 'LOST' | 'NURTURE'; programId?: string } = {}) {
  return k.prisma.lead.create({
    data: { organizationId: k.fx.org.id, fullName: `[TEST] Lead ${uniq('l')}`, assignedToId: ownerId, teamId, status: over.status ?? 'PROPOSAL_NEGOTIATION', stageCategory: over.stageCategory ?? 'OPEN', programId: over.programId ?? k.program.id, phoneRaw: '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0') },
  });
}

export const idem = () => `idem-${randomUUID()}`;

export async function createDeal(k: RevenueKit, agent: AuthedAgent, leadId: string, body: Record<string, unknown> = {}, key?: string): Promise<Response> {
  const req = agent.post(`/leads/${leadId}/deals`);
  if (key) req.set('Idempotency-Key', key);
  return req.send({ programId: k.program.id, amount: '50000.00', ...body });
}

export async function closeWon(agent: AuthedAgent, dealId: string, body: Record<string, unknown> = {}, key?: string): Promise<Response> {
  const req = agent.post(`/deals/${dealId}/close`);
  if (key) req.set('Idempotency-Key', key);
  return req.send({ outcome: 'WON', finalAmount: '50000.00', ...body });
}

/** lead + open deal + closed-won deal owned by execA1 (team A). Returns ids. */
export async function wonDeal(k: RevenueKit, over: { amount?: string; ownerKey?: 'execA1' | 'execA2' | 'execB1'; plan?: Array<{ amount: string; dueDate: string }> } = {}) {
  const owner = k.fx[over.ownerKey ?? 'execA1'];
  const agent = k.agents[over.ownerKey ?? 'execA1'];
  const teamId = (over.ownerKey ?? 'execA1') === 'execB1' ? k.fx.teamB.id : k.fx.teamA.id;
  const lead = await makeLead(k, owner.id, teamId);
  const d = await createDeal(k, agent, lead.id, { amount: over.amount ?? '50000.00' });
  if (d.status !== 201) throw new Error(`deal create failed ${d.status} ${JSON.stringify(d.body)}`);
  const c = await closeWon(agent, d.body.data.id, { finalAmount: over.amount ?? '50000.00', ...(over.plan ? { paymentPlan: over.plan } : {}) });
  if (c.status !== 200) throw new Error(`deal close failed ${c.status} ${JSON.stringify(c.body)}`);
  return { leadId: lead.id, dealId: d.body.data.id as string, ownerId: owner.id, agent };
}

export async function recordPayment(k: RevenueKit, agent: AuthedAgent, dealId: string, over: Record<string, unknown> = {}, key?: string): Promise<Response> {
  const req = agent.post('/collections');
  if (key) req.set('Idempotency-Key', key);
  return req.send({ dealId, amount: '50000.00', method: 'UPI', externalTransactionRef: `UTR-${randomUUID().slice(0, 12)}`, paidAt: new Date().toISOString(), ...over });
}

/** Records (as manager) and verifies (as finance) a payment. Returns the payment id. */
export async function collect(k: RevenueKit, dealId: string, amount = '50000.00') {
  const r = await recordPayment(k, k.agents.teamLead, dealId, { amount });
  if (r.status !== 201) throw new Error(`record failed ${r.status} ${JSON.stringify(r.body)}`);
  const v = await k.agents.finance.post(`/collections/${r.body.data.id}/verify`).send({});
  if (v.status !== 200) throw new Error(`verify failed ${v.status} ${JSON.stringify(v.body)}`);
  return r.body.data.id as string;
}
