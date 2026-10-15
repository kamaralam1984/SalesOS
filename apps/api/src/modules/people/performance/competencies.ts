/** Competency framework taken from the JD "Key Competencies" list. Org-configurable after first load. */
export const DEFAULT_COMPETENCIES: Array<{ key: string; name: string; description: string; indicators: Record<string, string> }> = [
  { key: 'ownership', name: 'Ownership mindset and accountability', description: 'Takes end-to-end responsibility for outcomes and commitments.', indicators: { '1': 'Needs reminders; deflects blame', '3': 'Delivers commitments and flags risks', '5': 'Owns outcomes beyond own remit; others rely on them' } },
  { key: 'strategic_thinking', name: 'Strategic thinking', description: 'Connects daily work to revenue and growth goals; plans ahead.', indicators: { '1': 'Reactive; task focus only', '3': 'Plans the quarter and adjusts to data', '5': 'Shapes strategy, anticipates market shifts' } },
  { key: 'results_orientation', name: 'Results orientation', description: 'Drives toward targets with urgency and follow-through.', indicators: { '1': 'Misses targets without a recovery plan', '3': 'Meets targets consistently', '5': 'Exceeds targets and lifts the team' } },
  { key: 'proactive', name: 'Proactive and solution-oriented', description: 'Raises issues early with proposed solutions.', indicators: { '1': 'Raises problems late, no proposals', '3': 'Raises issues with options', '5': 'Prevents issues and fixes root causes' } },
  { key: 'customer_first', name: 'Customer-first approach and relationship building', description: 'Puts learner success first and builds trust.', indicators: { '1': 'Transactional; ignores learner context', '3': 'Consultative; builds rapport', '5': 'Long-term trusted advisor; learners advocate for the team' } },
  { key: 'data_driven', name: 'Data-driven decision making', description: 'Uses dashboards, CRM data and funnel metrics to decide.', indicators: { '1': 'Decides by gut; CRM incomplete', '3': 'Reviews KPIs and acts on trends', '5': 'Designs metrics and experiments that change outcomes' } },
  { key: 'communication', name: 'Communication skills', description: 'Clear written and verbal communication with learners and stakeholders.', indicators: { '1': 'Unclear or inconsistent', '3': 'Clear and timely', '5': 'Persuasive, concise, adapts to audience' } },
  { key: 'coaching_ability', name: 'Coaching ability', description: 'Develops others through feedback, observation and practice.', indicators: { '1': 'Tells rather than coaches', '3': 'Regular structured coaching', '5': 'Builds capability and successors' } },
  { key: 'collaboration', name: 'Collaboration', description: 'Works across Sales, Marketing, Operations and Student Success.', indicators: { '1': 'Works in silos', '3': 'Cooperates and shares information', '5': 'Aligns functions around learner outcomes' } },
  { key: 'growth_mindset', name: 'Growth mindset and adaptability', description: 'Learns quickly, welcomes feedback, adapts to change.', indicators: { '1': 'Resists feedback', '3': 'Applies feedback', '5': 'Seeks challenge and teaches others' } },
];

import type { PrismaService } from '../../../common/prisma';

/** Materialises the default framework for an organization on first use and returns its competency keys. */
export async function ensureCompetencies(prisma: PrismaService, organizationId: string): Promise<Set<string>> {
  let rows = await prisma.reviewRubric.findMany({ where: { organizationId }, select: { key: true } });
  if (rows.length === 0) {
    await prisma.reviewRubric.createMany({
      data: DEFAULT_COMPETENCIES.map((c, i) => ({ organizationId, key: c.key, name: c.name, description: c.description, indicators: c.indicators, sortOrder: i })),
      skipDuplicates: true,
    });
    rows = await prisma.reviewRubric.findMany({ where: { organizationId }, select: { key: true } });
  }
  return new Set(rows.map((r) => r.key));
}
