import type { INestApplication } from '@nestjs/common';
import type { TestingModuleBuilder } from '@nestjs/testing';
import { buildOrgFixture, createOrg, createTeam, createTestApp, createUser, loginAgent, uniq, type AuthedAgent, type OrgFixture, type TestApp } from '../helpers';

export interface CrmKit {
  t: TestApp;
  app: INestApplication;
  fx: OrgFixture;
  a: Record<'founder' | 'teamLead' | 'managerA' | 'managerB' | 'execA1' | 'execA2' | 'execB1' | 'execB2' | 'admin' | 'finance' | 'marketing', AuthedAgent>;
  marketingId: string;
  close: () => Promise<void>;
}

/** Standard CRM fixture: Founder -> TeamLead -> ManagerA(execA1, execA2) / ManagerB(execB1, execB2) + Admin/Finance/Marketing. */
export async function crmKit(opts: { customize?: (b: TestingModuleBuilder) => TestingModuleBuilder } = {}): Promise<CrmKit> {
  const t = await createTestApp({ customize: opts.customize });
  const fx = await buildOrgFixture(t.prisma);
  const marketing = await createUser(t.prisma, fx.org, { roles: ['MARKETING'] });
  const a = {
    founder: await loginAgent(t.app, fx.founder),
    teamLead: await loginAgent(t.app, fx.teamLead),
    managerA: await loginAgent(t.app, fx.managerA),
    managerB: await loginAgent(t.app, fx.managerB),
    execA1: await loginAgent(t.app, fx.execA1),
    execA2: await loginAgent(t.app, fx.execA2),
    execB1: await loginAgent(t.app, fx.execB1),
    execB2: await loginAgent(t.app, fx.execB2),
    admin: await loginAgent(t.app, fx.admin),
    finance: await loginAgent(t.app, fx.finance),
    marketing: await loginAgent(t.app, marketing),
  };
  return { t, app: t.app, fx, a, marketingId: marketing.id, close: t.close };
}

let phoneSeq = Math.floor(Math.random() * 1_000_000);
/** Unique valid Indian mobile number (+91 9xxxxxxxxx) per call. */
export const uniqPhone = () => `9${String(800_000_000 + ((phoneSeq += 7) % 199_999_999)).padStart(9, '0')}`;

export async function createLead(agent: AuthedAgent, body: Record<string, unknown> = {}) {
  const res = await agent.post('/leads').send({ fullName: `[TEST] ${uniq('Lead')}`, phone: uniqPhone(), ...body });
  if (res.status !== 201 && res.status !== 200) throw new Error(`createLead failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.lead as { id: string; assignedTo: { id: string } | null; status: string; version: number; fullName: string };
}

export const future = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

export { createOrg, createTeam, createUser, loginAgent, uniq };
