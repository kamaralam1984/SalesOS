import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import type { PrismaClient } from '@prisma/client';
import type { RoleKey } from '@salesos/shared-types';

export const TEST_PASSWORD = 'Test-Passw0rd-Strong!';
let cachedHash: Promise<string> | undefined;
/** One argon2id hash reused for all fixture users so suites stay fast. */
const fixtureHash = () => (cachedHash ??= argon2.hash(TEST_PASSWORD, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }));

export const uniq = (p = 'x') => `${p}-${randomUUID().slice(0, 8)}`;

export async function createOrg(prisma: PrismaClient, name = uniq('org')) {
  return prisma.organization.create({ data: { name: `[TEST] ${name}`, slug: uniq('slug') } });
}

export interface TestUser {
  id: string;
  email: string;
  name: string;
  organizationId: string;
  password: string;
  roles: RoleKey[];
}

export async function createUser(
  prisma: PrismaClient,
  org: { id: string },
  opts: { roles: RoleKey[]; managerId?: string | null; email?: string; name?: string; isActive?: boolean; password?: string | null } = { roles: ['SALES_EXECUTIVE'] },
): Promise<TestUser> {
  const email = (opts.email ?? `${uniq('u')}@test.salesos.local`).toLowerCase();
  const roleRows = await prisma.role.findMany({ where: { key: { in: opts.roles } } });
  if (roleRows.length !== opts.roles.length) throw new Error('Roles not seeded: boot the app once (IdentityModule syncs the catalogue)');
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      email,
      name: opts.name ?? `[TEST] ${email.split('@')[0]}`,
      managerId: opts.managerId ?? null,
      isActive: opts.isActive ?? true,
      passwordHash: opts.password === null ? null : await fixtureHash(),
      roleAssignments: { create: roleRows.map((r) => ({ organizationId: org.id, roleId: r.id })) },
    },
  });
  return { id: user.id, email, name: user.name, organizationId: org.id, password: TEST_PASSWORD, roles: opts.roles };
}

export async function createTeam(prisma: PrismaClient, org: { id: string }, name = uniq('team'), members: { userId: string; role?: 'LEAD' | 'MEMBER' }[] = [], leadUserId?: string) {
  const team = await prisma.team.create({ data: { organizationId: org.id, name, leadUserId: leadUserId ?? null } });
  if (members.length) {
    await prisma.teamMembership.createMany({ data: members.map((m) => ({ teamId: team.id, userId: m.userId, membershipRole: m.role ?? 'MEMBER' })) });
  }
  return team;
}

/**
 * Standard fixture: Founder -> TeamLead -> {ManagerA(execA1, execA2), ManagerB(execB1, execB2)},
 * plus Admin, HR, Finance. Returns every user (all share TEST_PASSWORD).
 */
export async function buildOrgFixture(prisma: PrismaClient) {
  const org = await createOrg(prisma);
  const founder = await createUser(prisma, org, { roles: ['FOUNDER_CEO'] });
  const teamLead = await createUser(prisma, org, { roles: ['SALES_TEAM_LEAD'], managerId: founder.id });
  const managerA = await createUser(prisma, org, { roles: ['SALES_MANAGER'], managerId: teamLead.id });
  const managerB = await createUser(prisma, org, { roles: ['SALES_MANAGER'], managerId: teamLead.id });
  const execA1 = await createUser(prisma, org, { roles: ['SALES_EXECUTIVE'], managerId: managerA.id });
  const execA2 = await createUser(prisma, org, { roles: ['SALES_EXECUTIVE'], managerId: managerA.id });
  const execB1 = await createUser(prisma, org, { roles: ['SALES_EXECUTIVE'], managerId: managerB.id });
  const execB2 = await createUser(prisma, org, { roles: ['SALES_EXECUTIVE'], managerId: managerB.id });
  const admin = await createUser(prisma, org, { roles: ['ADMIN'] });
  const hr = await createUser(prisma, org, { roles: ['HR'] });
  const finance = await createUser(prisma, org, { roles: ['FINANCE'] });
  const teamA = await createTeam(prisma, org, 'Team A', [{ userId: managerA.id, role: 'LEAD' }, { userId: execA1.id }, { userId: execA2.id }], managerA.id);
  const teamB = await createTeam(prisma, org, 'Team B', [{ userId: managerB.id, role: 'LEAD' }, { userId: execB1.id }, { userId: execB2.id }], managerB.id);
  return { org, founder, teamLead, managerA, managerB, execA1, execA2, execB1, execB2, admin, hr, finance, teamA, teamB };
}
export type OrgFixture = Awaited<ReturnType<typeof buildOrgFixture>>;
