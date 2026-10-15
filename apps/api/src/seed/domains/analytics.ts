import type { SeedContext } from './types';

/**
 * analytics demo prerequisites (Phase 5). KPI values are never seeded: they are always computed from the source tables.
 * The only thing needed is realistic tenure: KPI rules exclude new joiners (SOP adoption grace, productivity 7-day rule), and a freshly
 * seeded demo organisation would otherwise have every [DEMO] user "joined today". Idempotent; touches only users created in the last 7 days.
 */
export async function seedAnalytics(ctx: SeedContext): Promise<void> {
  const { prisma, organizationId } = ctx;
  const cutoff = new Date(Date.now() - 7 * 86_400_000);
  await prisma.user.updateMany({
    where: { organizationId, createdAt: { gt: cutoff }, email: { endsWith: '@demo.salesos.local' } },
    data: { createdAt: new Date(Date.now() - 45 * 86_400_000) },
  });
}
