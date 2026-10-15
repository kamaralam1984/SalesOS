import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import type { RoleKey } from '@salesos/shared-types';
import { DEFAULT_ORG_SETTINGS } from '@salesos/validation';
import { ensureDbGuards } from '../common/prisma/db-guards';
import { syncCatalogue } from '../modules/identity/roles.service';
import { seedCrm } from './domains/crm';
import { seedRevenue } from './domains/revenue';
import { seedPeople } from './domains/people';
import { seedCx } from './domains/cx';
import { seedPlatform } from './domains/platform';
import { seedAnalytics } from './domains/analytics';
import type { SeedContext } from './domains/types';

/**
 * DEV/DEMO ONLY. Every record is labelled [DEMO]. Passwords are deterministic: `Demo!<local-part>#2026`
 * (documented in README as dev-only). Refuses to run in production.
 */
export const DEMO_DOMAIN = 'demo.salesos.local';
export const demoPassword = (localPart: string) => `Demo!${localPart.replace(/\./g, '')}#2026`;

interface DemoUser { local: string; name: string; roles: RoleKey[]; manager?: string }

const execs = (prefix: string, manager: string, n: number): DemoUser[] =>
  Array.from({ length: n }, (_, i) => ({ local: `exec.${prefix}${i + 1}`, name: `[DEMO] Executive ${prefix.toUpperCase()}${i + 1}`, roles: ['SALES_EXECUTIVE'], manager }));

export const DEMO_USERS: DemoUser[] = [
  { local: 'founder', name: '[DEMO] Founder CEO', roles: ['FOUNDER_CEO'] },
  { local: 'teamlead', name: '[DEMO] Sales Team Lead', roles: ['SALES_TEAM_LEAD'], manager: 'founder' },
  { local: 'manager.a', name: '[DEMO] Manager A', roles: ['SALES_MANAGER'], manager: 'teamlead' },
  { local: 'manager.b', name: '[DEMO] Manager B', roles: ['SALES_MANAGER'], manager: 'teamlead' },
  ...execs('a', 'manager.a', 5),
  ...execs('b', 'manager.b', 4),
  { local: 'admin', name: '[DEMO] Admin', roles: ['ADMIN'] },
  { local: 'finance', name: '[DEMO] Finance', roles: ['FINANCE'] },
  { local: 'hr', name: '[DEMO] HR', roles: ['HR'] },
  { local: 'marketing', name: '[DEMO] Marketing', roles: ['MARKETING'] },
  { local: 'community', name: '[DEMO] Community', roles: ['COMMUNITY'] },
  { local: 'operations', name: '[DEMO] Operations', roles: ['OPERATIONS'] },
  { local: 'studentsuccess', name: '[DEMO] Student Success', roles: ['STUDENT_SUCCESS'] },
];

/** Refuses anything that looks like a real deployment: production env, a non-local database host, or a database holding real (non-[DEMO]/[TEST]) organisations. */
export async function assertSeedAllowed(prisma: PrismaClient, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  let host = '';
  try { host = new URL(env.DATABASE_URL ?? '').hostname; } catch { /* PrismaClient will fail on its own */ }
  if (host && !['localhost', '127.0.0.1', '::1', '[::1]', 'postgres', 'salesos-postgres'].includes(host) && env.ALLOW_REMOTE_DEMO_SEED !== 'true') {
    throw new Error(`Refusing to seed demo data into non-local database host "${host}" (set ALLOW_REMOTE_DEMO_SEED=true only for a throw-away environment)`);
  }
  const real = await prisma.organization.count({ where: { NOT: [{ name: { startsWith: '[DEMO]' } }, { name: { startsWith: '[TEST]' } }] } });
  if (real > 0) throw new Error('Refusing to seed demo data: this database already contains non-demo organisations (demo users have publicly documented passwords)');
}

export async function seed(prisma: PrismaClient) {
  await assertSeedAllowed(prisma);
  await ensureDbGuards(prisma);
  await syncCatalogue(prisma);
  const roles = new Map((await prisma.role.findMany()).map((r) => [r.key, r.id]));

  const org = await prisma.organization.upsert({
    where: { slug: 'demo' },
    update: {},
    create: { name: '[DEMO] CoachEasily', slug: 'demo', settings: DEFAULT_ORG_SETTINGS },
  });

  const byLocal = new Map<string, string>();
  for (const u of DEMO_USERS) {
    const email = `${u.local}@${DEMO_DOMAIN}`;
    const passwordHash = await argon2.hash(demoPassword(u.local), { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const row = await prisma.user.upsert({
      where: { email },
      update: { name: u.name, passwordHash, isActive: true },
      create: { organizationId: org.id, email, name: u.name, passwordHash },
    });
    byLocal.set(u.local, row.id);
    for (const r of u.roles) {
      await prisma.userRoleAssignment.upsert({
        where: { userId_roleId: { userId: row.id, roleId: roles.get(r)! } },
        update: {},
        create: { organizationId: org.id, userId: row.id, roleId: roles.get(r)! },
      });
    }
  }
  for (const u of DEMO_USERS) {
    if (u.manager) await prisma.user.update({ where: { id: byLocal.get(u.local)! }, data: { managerId: byLocal.get(u.manager)! } });
  }

  for (const [name, lead, prefix] of [['[DEMO] Team A', 'manager.a', 'exec.a'], ['[DEMO] Team B', 'manager.b', 'exec.b']] as const) {
    const team = await prisma.team.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      update: { leadUserId: byLocal.get(lead)! },
      create: { organizationId: org.id, name, leadUserId: byLocal.get(lead)! },
    });
    const members = [{ local: lead, role: 'LEAD' as const }, ...DEMO_USERS.filter((u) => u.local.startsWith(prefix)).map((u) => ({ local: u.local, role: 'MEMBER' as const }))];
    for (const m of members) {
      await prisma.teamMembership.upsert({
        where: { teamId_userId: { teamId: team.id, userId: byLocal.get(m.local)! } },
        update: { membershipRole: m.role },
        create: { teamId: team.id, userId: byLocal.get(m.local)!, membershipRole: m.role },
      });
    }
  }

  const ctx: SeedContext = { prisma, organizationId: org.id, userIds: byLocal };
  // Domain seed hooks (each agent fills only its own file under seed/domains/).
  await seedCrm(ctx);
  await seedRevenue(ctx);
  await seedPeople(ctx);
  await seedCx(ctx);
  await seedPlatform(ctx);
  await seedAnalytics(ctx);
  return { organizationId: org.id, users: DEMO_USERS.length };
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  const prisma = new PrismaClient();
  try {
    const r = await seed(prisma);
    console.log(`[DEMO] seed complete: org ${r.organizationId}, ${r.users} users. See README for dev-only credentials.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
