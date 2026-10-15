import { PrismaClient, type ProgramKind } from '@prisma/client';

/**
 * Production-safe starter catalogue: the programs, app and event named in the Job Description. It is a reference list, not sample data:
 * no prices, no leads, no people (pricing is DEC-016, entered later through Revenue > Pricing). Idempotent; never changes an existing
 * program (codes are unique per organisation), so edits made by the business are kept.
 */
export const STARTER_PROGRAMS: Array<{ code: string; name: string; kind: ProgramKind; sortOrder: number; description: string }> = [
  { code: 'AI_SPRINT', name: 'AI Sprint', kind: 'EVENT', sortOrder: 10, description: 'Free live AI Sprint where learners build their first coaching plan with AI.' },
  { code: 'CBAX', name: 'CBAX', kind: 'PROGRAM', sortOrder: 20, description: 'Structured program from first idea to a growing coaching business.' },
  { code: 'MCA_X', name: 'MCA X', kind: 'PROGRAM', sortOrder: 30, description: 'Structured program (MCA X).' },
  { code: 'MCA_ELITE_X', name: 'MCA Elite X', kind: 'PROGRAM', sortOrder: 40, description: 'Premium structured program (MCA Elite X).' },
  { code: 'COACHEASILY_X_APP', name: 'CoachEasily X app', kind: 'APP', sortOrder: 50, description: 'AI app that works with learners in their own language.' },
  { code: 'WEALTHY_COACH_SUMMIT', name: 'Wealthy Coach Summit', kind: 'EVENT', sortOrder: 60, description: 'Live event.' },
];

export async function ensureStarterPrograms(prisma: PrismaClient, orgSlug: string) {
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) throw new Error(`Organisation "${orgSlug}" not found. Run the bootstrap seed first.`);
  let created = 0;
  for (const p of STARTER_PROGRAMS) {
    const existing = await prisma.program.findUnique({ where: { organizationId_code: { organizationId: org.id, code: p.code } } });
    if (existing) continue;
    await prisma.program.create({ data: { organizationId: org.id, ...p } });
    created++;
  }
  return { organizationId: org.id, created, total: STARTER_PROGRAMS.length };
}

async function main() {
  const slug = (process.env.BOOTSTRAP_ORG_SLUG ?? 'coacheasily').trim();
  const prisma = new PrismaClient();
  try {
    const r = await ensureStarterPrograms(prisma, slug);
    console.log(`Starter programs: ${r.created} created, ${r.total - r.created} already present (organisation ${slug}). No prices, leads or people created.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
