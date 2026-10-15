import { PrismaClient } from '@prisma/client';
import { loadIncentives, loadPip } from './fill';

/** One-off: replace the PIP with the fictitious-employee version without re-running the whole loader. LOAD_DEMO_ORG_SLUG=<slug> */
async function main() {
  const host = new URL(process.env.DATABASE_URL ?? '').hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) throw new Error('Refusing non-local database host');
  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.findUniqueOrThrow({ where: { slug: process.env.LOAD_DEMO_ORG_SLUG ?? '' } });
    const byEmail = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    const tl = await byEmail('teamlead@coacheasily.local');
    const fo = await byEmail('purushottam@coacheasily.local');
    console.log('pip', await loadPip(prisma, org.id, tl, fo), 'incentives', await loadIncentives(prisma, org.id, tl, fo));
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
