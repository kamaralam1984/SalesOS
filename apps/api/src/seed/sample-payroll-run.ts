import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import type { RoleKey } from '@salesos/shared-types';
import { AppModule } from '../app.module';
import type { Principal } from '../common/authz';
import { PermissionResolver } from '../common/authz/principal.loader';
import { PayrollRunsService } from '../modules/workforce/payroll/runs.service';

/**
 * DEV ONLY. Creates payroll runs for CLOSED months through the real PayrollRunsService (same rules, audit and outbox as the API): Finance creates and
 * calculates, the Founder approves (separation of duties), Finance records the payout. The LAST month is only calculated, so approval and payout
 * can be tried by hand. Run from the compiled build (decorator metadata): node dist/seed/sample-payroll-run.js
 *   LOAD_DEMO_ORG_SLUG=coacheasily PAYROLL_FROM=2025-11 PAYROLL_TO=2026-09 node dist/seed/sample-payroll-run.js   (DATABASE_URL must be local)
 */
async function main() {
  const slug = process.env.LOAD_DEMO_ORG_SLUG;
  const from = process.env.PAYROLL_FROM;
  const to = process.env.PAYROLL_TO;
  if (!slug || !from || !to) throw new Error('Set LOAD_DEMO_ORG_SLUG, PAYROLL_FROM and PAYROLL_TO (YYYY-MM)');
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to run in production');
  const host = new URL(process.env.DATABASE_URL ?? '').hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) throw new Error(`Refusing non-local database host "${host}"`);
  const prisma = new PrismaClient();
  const org = await prisma.organization.findUniqueOrThrow({ where: { slug } });
  const find = (key: string) => prisma.user.findFirstOrThrow({
    where: { organizationId: org.id, isActive: true, roleAssignments: { some: { role: { key: key as RoleKey } } } },
    select: { id: true, email: true, name: true, managerId: true, roleAssignments: { select: { role: { select: { key: true } } } } },
  });
  const fin = await find('FINANCE');
  const boss = await find('FOUNDER_CEO');
  await prisma.$disconnect();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const resolver = app.get(PermissionResolver, { strict: false });
    const principal = (u: typeof fin): Principal => {
      const roles = u.roleAssignments.map((a) => a.role.key as RoleKey);
      return { userId: u.id, organizationId: org.id, email: u.email, name: u.name, managerId: u.managerId, roles, permissions: resolver.effective(roles), sessionId: 'dev-sample-payroll', sessionFamilyId: 'dev-sample-payroll' };
    };
    const finance = principal(fin);
    const founder = principal(boss);
    const runs = app.get(PayrollRunsService, { strict: false });
    const months: string[] = [];
    for (let [y, m] = from.split('-').map(Number) as [number, number]; `${y}-${String(m).padStart(2, '0')}` <= to; m === 12 ? ((y += 1), (m = 1)) : (m += 1)) months.push(`${y}-${String(m).padStart(2, '0')}`);
    for (const month of months) {
      const run = (await runs.create(finance, { month, note: 'Simulated run [sample data]' })) as { id: string };
      await runs.calculate(finance, run.id);
      if (month !== to) {
        await runs.approve(founder, run.id);
        await runs.markPaid(finance, run.id, { reference: `SAMPLE-UTR-${month}` });
      }
      console.log(`${month}: ${month === to ? 'CALCULATED' : 'PAID'}`);
    }
  } finally {
    await app.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
