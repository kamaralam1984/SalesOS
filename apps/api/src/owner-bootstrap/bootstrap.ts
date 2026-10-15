import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { DEFAULT_ORG_SETTINGS } from '@salesos/validation';
import { ensureDbGuards } from '../common/prisma/db-guards';
import { syncCatalogue } from '../modules/identity/roles.service';

/**
 * Production-safe bootstrap: creates ONLY the organisation, the owner (FOUNDER_CEO) and the role/permission catalogue.
 * No people, leads, deals or sample data. Idempotent. Credentials come from env (never hard-coded):
 * BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_PASSWORD (+ optional BOOTSTRAP_ORG_NAME, BOOTSTRAP_ORG_SLUG).
 * An existing owner's password is NOT overwritten unless BOOTSTRAP_RESET_PASSWORD=true.
 */
export interface BootstrapInput { email: string; name: string; password: string; orgName: string; orgSlug: string; resetPassword: boolean }

export function readBootstrapEnv(env: NodeJS.ProcessEnv = process.env): BootstrapInput {
  const missing = ['BOOTSTRAP_ADMIN_EMAIL', 'BOOTSTRAP_ADMIN_NAME', 'BOOTSTRAP_ADMIN_PASSWORD'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing required env: ${missing.join(', ')}`);
  const email = env.BOOTSTRAP_ADMIN_EMAIL!.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('BOOTSTRAP_ADMIN_EMAIL is not a valid email');
  const password = env.BOOTSTRAP_ADMIN_PASSWORD!;
  if (password.length < 10) throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 10 characters');
  return {
    email,
    name: env.BOOTSTRAP_ADMIN_NAME!.trim(),
    password,
    orgName: (env.BOOTSTRAP_ORG_NAME ?? 'CoachEasily').trim(),
    orgSlug: (env.BOOTSTRAP_ORG_SLUG ?? 'coacheasily').trim(),
    resetPassword: env.BOOTSTRAP_RESET_PASSWORD === 'true',
  };
}

export async function bootstrap(prisma: PrismaClient, input: BootstrapInput) {
  await ensureDbGuards(prisma);
  await syncCatalogue(prisma);
  const founderRole = await prisma.role.findFirstOrThrow({ where: { key: 'FOUNDER_CEO' } });
  const org = await prisma.organization.upsert({
    where: { slug: input.orgSlug },
    update: {},
    create: { name: input.orgName, slug: input.orgSlug, settings: DEFAULT_ORG_SETTINGS },
  });
  const hash = () => argon2.hash(input.password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  let userId: string;
  if (existing) {
    if (existing.organizationId !== org.id) throw new Error('A user with this email already exists in a different organisation');
    await prisma.user.update({ where: { id: existing.id }, data: { name: input.name, isActive: true, ...(input.resetPassword ? { passwordHash: await hash() } : {}) } });
    userId = existing.id;
  } else {
    userId = (await prisma.user.create({ data: { organizationId: org.id, email: input.email, name: input.name, passwordHash: await hash() } })).id;
  }
  await prisma.userRoleAssignment.upsert({
    where: { userId_roleId: { userId, roleId: founderRole.id } },
    update: {},
    create: { organizationId: org.id, userId, roleId: founderRole.id },
  });
  return { organizationId: org.id, userId, created: !existing };
}

async function main() {
  const input = readBootstrapEnv();
  const prisma = new PrismaClient();
  try {
    const r = await bootstrap(prisma, input);
    console.log(`Bootstrap complete: organisation ${r.organizationId}, owner ${input.email} (${r.created ? 'created' : 'already existed'}). No sample data created.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
