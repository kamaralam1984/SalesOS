import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { buildOrgFixture, createTeam, createUser, loginAgent, uniq, type AuthedAgent, type OrgFixture, type TestApp } from '../helpers';

export interface CxFixture extends OrgFixture {
  ss: Awaited<ReturnType<typeof createUser>>;
  marketing: Awaited<ReturnType<typeof createUser>>;
  ops: Awaited<ReturnType<typeof createUser>>;
  community: Awaited<ReturnType<typeof createUser>>;
  program: { id: string; name: string };
  /** leads owned by execA1 (team A) / execB1 (team B) */
  leadA: { id: string };
  leadB: { id: string };
  agents: Record<'founder' | 'teamLead' | 'managerA' | 'managerB' | 'execA1' | 'execA2' | 'execB1' | 'ss' | 'marketing' | 'ops' | 'community' | 'admin' | 'finance' | 'hr', AuthedAgent>;
}

export async function createLead(prisma: PrismaClient, orgId: string, owner: { id: string }, teamId: string | null, extra: Record<string, unknown> = {}) {
  return prisma.lead.create({
    data: { organizationId: orgId, fullName: `[TEST] Learner ${uniq('l')}`, phoneE164: `+9198${Math.floor(10000000 + Math.random() * 89999999)}`, email: `${uniq('e')}@learner.test`, status: 'NEW', stageCategory: 'OPEN', assignedToId: owner.id, teamId, ...extra },
  });
}

export async function buildCxFixture(t: TestApp): Promise<CxFixture> {
  const fx = await buildOrgFixture(t.prisma);
  const ss = await createUser(t.prisma, fx.org, { roles: ['STUDENT_SUCCESS'] });
  const marketing = await createUser(t.prisma, fx.org, { roles: ['MARKETING'] });
  const ops = await createUser(t.prisma, fx.org, { roles: ['OPERATIONS'] });
  const community = await createUser(t.prisma, fx.org, { roles: ['COMMUNITY'] });
  const program = await t.prisma.program.create({ data: { organizationId: fx.org.id, code: uniq('P'), name: '[TEST] AI Sprint' } });
  const leadA = await createLead(t.prisma, fx.org.id, fx.execA1, fx.teamA.id, { programId: program.id });
  const leadB = await createLead(t.prisma, fx.org.id, fx.execB1, fx.teamB.id, { programId: program.id });
  const agents = {
    founder: await loginAgent(t.app, fx.founder),
    teamLead: await loginAgent(t.app, fx.teamLead),
    managerA: await loginAgent(t.app, fx.managerA),
    managerB: await loginAgent(t.app, fx.managerB),
    execA1: await loginAgent(t.app, fx.execA1),
    execA2: await loginAgent(t.app, fx.execA2),
    execB1: await loginAgent(t.app, fx.execB1),
    ss: await loginAgent(t.app, ss),
    marketing: await loginAgent(t.app, marketing),
    ops: await loginAgent(t.app, ops),
    community: await loginAgent(t.app, community),
    admin: await loginAgent(t.app, fx.admin),
    finance: await loginAgent(t.app, fx.finance),
    hr: await loginAgent(t.app, fx.hr),
  };
  return { ...fx, ss, marketing, ops, community, program: { id: program.id, name: program.name }, leadA: { id: leadA.id }, leadB: { id: leadB.id }, agents };
}

/** A second organisation with a founder + exec + lead, for cross-org (IDOR) assertions. */
export async function buildOtherOrg(t: TestApp) {
  const other = await buildOrgFixture(t.prisma);
  const lead = await createLead(t.prisma, other.org.id, other.execA1, other.teamA.id);
  const agent = await loginAgent(t.app, other.founder);
  return { other, lead, agent };
}

export const future = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
export const uuid = () => randomUUID();

export { createTeam, createUser, uniq };

export const FULL_HANDOVER = {
  learnerName: 'Asha Verma',
  learnerContact: '+919800000001',
  languagePreference: 'HI' as const,
  programName: 'AI Sprint',
  amountPaid: 5000,
  amountDue: 15000,
  paymentVerified: true,
  promisesMade: 'Weekly mentor call',
  goals: 'Launch first coaching offer in 90 days',
  objections: 'None raised',
  specialNotes: 'Prefers evening calls',
  consents: { dataSharing: true, contact: true },
};
