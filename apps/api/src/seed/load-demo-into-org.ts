import { PrismaClient } from '@prisma/client';
import { ensureDbGuards } from '../common/prisma/db-guards';
import { syncCatalogue } from '../modules/identity/roles.service';
import { seedCrm } from './domains/crm';
import { seedRevenue } from './domains/revenue';
import { seedPeople } from './domains/people';
import { seedCx } from './domains/cx';
import { seedPlatform } from './domains/platform';
import type { SeedContext } from './domains/types';

/**
 * DEV ONLY. Loads the [DEMO] domain records into an EXISTING organisation (slug in LOAD_DEMO_ORG_SLUG) using its existing users,
 * instead of creating the separate [DEMO] organisation + public-password users that `seed.ts` creates. No users, roles or passwords
 * are created. Demo keys the org does not have (exec.a2.., manager.b) are mapped onto its first user of that role, so those records
 * all land on one person. Every record is labelled [DEMO]; re-runnable (the domain seeds are idempotent). Local database hosts only.
 * Take a backup first (pg_dump) - this writes into a working database.
 */
const ROLE_FOR: Record<string, string> = {
  founder: 'FOUNDER_CEO', teamlead: 'SALES_TEAM_LEAD', 'manager.a': 'SALES_MANAGER', 'manager.b': 'SALES_MANAGER', admin: 'ADMIN',
  finance: 'FINANCE', hr: 'HR', marketing: 'MARKETING', community: 'COMMUNITY', operations: 'OPERATIONS', studentsuccess: 'STUDENT_SUCCESS',
  ...Object.fromEntries(['a1', 'a2', 'a3', 'a4', 'a5', 'b1', 'b2', 'b3', 'b4'].map((s) => [`exec.${s}`, 'SALES_EXECUTIVE'])),
};

async function main() {
  const slug = process.env.LOAD_DEMO_ORG_SLUG;
  if (!slug) throw new Error('Set LOAD_DEMO_ORG_SLUG to the slug of the organisation to load demo records into');
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to load demo data in production');
  const host = new URL(process.env.DATABASE_URL ?? '').hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) throw new Error(`Refusing non-local database host "${host}"`);

  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.findUnique({ where: { slug } });
    if (!org) throw new Error(`No organisation with slug "${slug}"`);
    await ensureDbGuards(prisma);
    await syncCatalogue(prisma);

    const userIds = new Map<string, string>();
    for (const [local, role] of Object.entries(ROLE_FOR)) {
      const a = await prisma.userRoleAssignment.findFirst({
        where: { organizationId: org.id, role: { key: role }, user: { isActive: true } },
        orderBy: { user: { createdAt: 'asc' } },
        select: { userId: true },
      });
      if (!a) throw new Error(`Organisation "${slug}" has no active ${role} user (needed for demo key "${local}")`);
      userIds.set(local, a.userId);
    }

    const ctx: SeedContext = { prisma, organizationId: org.id, userIds };
    for (const [name, fn] of [['crm', seedCrm], ['revenue', seedRevenue], ['people', seedPeople], ['cx', seedCx], ['platform', seedPlatform]] as const) {
      await fn(ctx);
      console.log(`seeded ${name}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
