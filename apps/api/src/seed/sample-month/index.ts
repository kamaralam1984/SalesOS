import { PrismaClient } from '@prisma/client';
import { cleanup, setupPeople } from './setup';
import { loadCrmAndRevenue } from './crm-revenue';

/**
 * DEV ONLY. Loads one realistic sample period (1 Sep 2026 -> now) into an EXISTING organisation: 2 managers (Shaurav, Prachi), 4 executives
 * (Sushma, Anjali under Shaurav; Rajat, Simran under Prachi), leads, calls, tasks, deals, payments, refunds, targets, forecast, and the HR
 * performance data. Re-runnable: it first removes what an earlier run (or the earlier [DEMO] loader) created. Local database hosts only.
 *   LOAD_DEMO_ORG_SLUG=coacheasily SAMPLE_CRED_OUT=/path/creds.json SAMPLE_STAGES=1,2,3 tsx src/seed/sample-month/index.ts
 */
async function main() {
  const slug = process.env.LOAD_DEMO_ORG_SLUG;
  if (!slug) throw new Error('Set LOAD_DEMO_ORG_SLUG');
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to run in production');
  const host = new URL(process.env.DATABASE_URL ?? '').hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) throw new Error(`Refusing non-local database host "${host}"`);
  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.findUniqueOrThrow({ where: { slug } });
    await cleanup(prisma, org.id);
    console.log('cleanup done');
    const ctx = await setupPeople(prisma, org.id, process.env.SAMPLE_CRED_OUT);
    console.log('people/teams done');
    const res = await loadCrmAndRevenue(ctx);
    console.log(JSON.stringify(res.summary, null, 1));
    const stages = (process.env.SAMPLE_STAGES ?? '1').split(',');
    if (stages.includes('3')) {
      const { loadPeople } = await import('./people');
      console.log('people data', JSON.stringify(await loadPeople(ctx)));
    }
    if (stages.includes('4')) {
      const { loadCx } = await import('./cx');
      console.log('cx data', JSON.stringify(await loadCx(ctx)));
      const { loadExtras } = await import('./extras');
      console.log('extras', JSON.stringify(await loadExtras(ctx)));
      const { loadFill } = await import('./fill');
      console.log('fill', JSON.stringify(await loadFill(ctx)));
    }
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
