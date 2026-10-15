import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dateOnly } from './shared';

export const SAMPLE_TAG = '[sample data]';

export interface Person { key: string; id: string; name: string; email: string; role: string; join: string; skill: number; title?: string; leadRate?: number; partTime?: boolean }
export interface Ctx {
  prisma: PrismaClient;
  org: string;
  u: Record<string, Person>;
  team: { saurabh: string; prachi: string };
  execs: Person[];
  managerOf: (execKey: string) => Person;
}

/** Every record this sample loader or the earlier [DEMO] loader created is removed so a re-run starts clean. Real/user data is never touched. */
export async function cleanup(prisma: PrismaClient, org: string): Promise<void> {
  const leads = await prisma.lead.findMany({ where: { organizationId: org, OR: [{ createKey: { startsWith: 'sample-m1:' } }, { createKey: { startsWith: 'demo' } }, { fullName: { startsWith: '[DEMO]' } }] }, select: { id: true } });
  const leadIds = leads.map((l) => l.id);
  const deals = await prisma.deal.findMany({ where: { organizationId: org, leadId: { in: leadIds } }, select: { id: true } });
  const dealIds = deals.map((d) => d.id);
  const pays = await prisma.payment.findMany({ where: { dealId: { in: dealIds } }, select: { id: true } });
  const refunds = await prisma.refund.findMany({ where: { dealId: { in: dealIds } }, select: { id: true } });
  const recs = await prisma.salesRecord.findMany({ where: { dealId: { in: dealIds } }, select: { id: true } });

  // Append-only money/history tables block DELETE by design. Dev-only reset: the user approved pausing exactly these triggers INSIDE this one
  // transaction (DDL is transactional in Postgres, so a failure rolls the trigger state back too) and they are re-enabled before it commits.
  const GUARDED = ['deal_status_history', 'forecast_snapshots', 'payment_events', 'payments', 'pricing_proposal_events', 'refund_events', 'refunds', 'sales_credits', 'sales_records', 'target_revisions', 'targets'];
  await prisma.$transaction(async (tx) => {
    for (const t of GUARDED) await tx.$executeRawUnsafe(`ALTER TABLE ${t} DISABLE TRIGGER USER`);
    const hoIds = (await tx.handoverRecord.findMany({ where: { organizationId: org, OR: [{ dealId: { in: dealIds } }, { leadId: { in: leadIds } }] }, select: { id: true } })).map((h) => h.id);
    await tx.satisfactionResponse.deleteMany({ where: { organizationId: org, OR: [{ handoverId: { in: hoIds } }, { dealId: { in: dealIds } }] } });
    await tx.handoverRecord.deleteMany({ where: { organizationId: org, OR: [{ dealId: { in: dealIds } }, { leadId: { in: leadIds } }] } });
    await tx.complaint.deleteMany({ where: { organizationId: org, OR: [{ description: { contains: SAMPLE_TAG } }, { title: { startsWith: '[DEMO]' } }] } });
    await tx.relationshipEscalation.deleteMany({ where: { organizationId: org, OR: [{ title: { startsWith: '[DEMO]' } }, { context: { contains: SAMPLE_TAG } }] } });
    await tx.riskEntry.deleteMany({ where: { organizationId: org, OR: [{ title: { startsWith: '[DEMO]' } }, { description: { contains: SAMPLE_TAG } }] } });
    await tx.actionItem.deleteMany({ where: { organizationId: org, OR: [{ title: { startsWith: '[DEMO]' } }, { description: { contains: SAMPLE_TAG } }] } });
    await tx.xfTask.deleteMany({ where: { organizationId: org, OR: [{ title: { startsWith: '[DEMO]' } }, { description: { contains: SAMPLE_TAG } }] } });
    await tx.insight.deleteMany({ where: { organizationId: org, OR: [{ title: { startsWith: '[DEMO]' } }, { body: { contains: SAMPLE_TAG } }] } });
    await tx.paymentEvent.deleteMany({ where: { paymentId: { in: pays.map((p) => p.id) } } });
    await tx.payment.deleteMany({ where: { id: { in: pays.map((p) => p.id) } } });
    await tx.refundEvent.deleteMany({ where: { refundId: { in: refunds.map((r) => r.id) } } });
    await tx.refund.deleteMany({ where: { id: { in: refunds.map((r) => r.id) } } });
    await tx.dealBlocker.deleteMany({ where: { dealId: { in: dealIds } } });
    await tx.dealStatusHistory.deleteMany({ where: { dealId: { in: dealIds } } });
    await tx.salesCredit.deleteMany({ where: { salesRecordId: { in: recs.map((r) => r.id) } } });
    await tx.salesRecord.deleteMany({ where: { id: { in: recs.map((r) => r.id) } } });
    await tx.deal.deleteMany({ where: { id: { in: dealIds } } });
    await tx.eventAttendance.deleteMany({ where: { organizationId: org, OR: [{ leadId: { in: leadIds } }, { event: { OR: [{ title: { startsWith: '[DEMO]' } }, { location: 'sample-m1' }] } }] } });
    await tx.duplicateCandidate.deleteMany({ where: { organizationId: org, OR: [{ leadId: { in: leadIds } }, { otherLeadId: { in: leadIds } }] } });
    await tx.reactivationEntry.deleteMany({ where: { organizationId: org, leadId: { in: leadIds } } });
    await tx.reassignmentQueueEntry.deleteMany({ where: { organizationId: org, leadId: { in: leadIds } } });
    await tx.lead.deleteMany({ where: { id: { in: leadIds } } });
    await tx.crmEvent.deleteMany({ where: { organizationId: org, OR: [{ title: { startsWith: '[DEMO]' } }, { location: 'sample-m1' }] } });
    // planning tables: only the earlier demo loader wrote here
    await tx.strategyInitiative.deleteMany({ where: { organizationId: org } });
    await tx.strategyPlan.deleteMany({ where: { organizationId: org } });
    await tx.forecastSnapshot.deleteMany({ where: { organizationId: org } });
    await tx.forecast.deleteMany({ where: { organizationId: org } });
    await tx.targetRevision.deleteMany({ where: { organizationId: org } });
    await tx.target.updateMany({ where: { organizationId: org }, data: { parentId: null } });
    await tx.target.deleteMany({ where: { organizationId: org } });
    await tx.targetPeriod.deleteMany({ where: { organizationId: org } });
    await tx.pricingProposalEvent.deleteMany({ where: { organizationId: org } });
    await tx.feedbackEntry.deleteMany({ where: { organizationId: org, OR: [{ title: { startsWith: '[DEMO]' } }, { notes: { contains: SAMPLE_TAG } }] } });
    await tx.pricingProposal.deleteMany({ where: { organizationId: org, OR: [{ title: { startsWith: '[DEMO]' } }, { rationale: { contains: SAMPLE_TAG } }] } });
    await tx.growthOpportunity.deleteMany({ where: { organizationId: org, OR: [{ title: { startsWith: '[DEMO]' } }, { description: { contains: SAMPLE_TAG } }] } });
    await tx.processGap.deleteMany({ where: { organizationId: org, description: { contains: SAMPLE_TAG } } });
    await tx.pipCheckpoint.deleteMany({ where: { organizationId: org } });
    await tx.improvementPlan.deleteMany({ where: { organizationId: org, reason: { contains: SAMPLE_TAG } } });
    await tx.incentiveAdjustment.deleteMany({ where: { organizationId: org } });
    await tx.incentiveRecommendation.deleteMany({ where: { organizationId: org } });
    await tx.incentivePolicy.deleteMany({ where: { organizationId: org, name: { contains: 'sample data' } } });
    await tx.successionCandidate.deleteMany({ where: { organizationId: org } });
    await tx.successionPosition.deleteMany({ where: { organizationId: org } });
    await tx.resourceAssignment.deleteMany({ where: { organizationId: org } });
    await tx.notification.deleteMany({ where: { organizationId: org, OR: [{ title: { startsWith: '[DEMO]' } }, { dedupeKey: { startsWith: 'sample:' } }] } });
    // HR performance tables (the earlier loader wrote one session / one 1:1; nothing else lives here yet)
    await tx.coachingAction.deleteMany({ where: { organizationId: org } });
    await tx.coachingSession.deleteMany({ where: { organizationId: org } });
    await tx.oneOnOne.deleteMany({ where: { organizationId: org } });
    await tx.kpiAssignment.deleteMany({ where: { organizationId: org } });
    await tx.scorecard.deleteMany({ where: { organizationId: org } });
    await tx.performanceReview.deleteMany({ where: { organizationId: org } });
    await tx.recognition.deleteMany({ where: { organizationId: org } });
    await tx.probationReview.deleteMany({ where: { organizationId: org } });
    await tx.sopAcknowledgement.deleteMany({ where: { organizationId: org } });
    for (const t of GUARDED) await tx.$executeRawUnsafe(`ALTER TABLE ${t} ENABLE TRIGGER USER`);
  }, { timeout: 120_000 });
  const off = await prisma.$queryRawUnsafe<Array<{ relname: string; tgname: string }>>(
    `SELECT c.relname, t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal AND t.tgenabled <> 'O'`);
  if (off.length > 0) throw new Error(`Triggers not active after cleanup: ${off.map((o) => o.tgname).join(', ')}`);
}

const NEW_PEOPLE: Array<{ key: string; name: string; email: string; oldEmail?: string; role: string; join: string; skill: number; title: string; leadRate?: number; partTime?: boolean }> = [
  { key: 'saurabh', name: 'Saurabh Kumar', email: 'saurabh@coacheasily.local', oldEmail: 'shaurav@coacheasily.local', role: 'SALES_MANAGER', join: '2026-01-12', skill: 1.1, title: 'Manager - Sales' },
  { key: 'monica', name: 'Monica Shah', email: 'monica@coacheasily.local', role: 'SALES_EXECUTIVE', join: '2026-09-01', skill: 1.15, title: 'English Sales Executive & Webinar Host' },
  { key: 'sushma', name: 'Sushma Surve', email: 'sushma@coacheasily.local', role: 'SALES_EXECUTIVE', join: '2026-09-08', skill: 1.1, title: 'Sales Executive' },
  { key: 'sarika', name: 'Sarika', email: 'sarika@coacheasily.local', role: 'SALES_EXECUTIVE', join: '2026-06-15', skill: 0.85, title: 'Tele-caller (part-time)', leadRate: 0.5, partTime: true },
  { key: 'iyyanar', name: 'Iyyanar Elumalai Padiyachi', email: 'iyyanar@coacheasily.local', role: 'SALES_EXECUTIVE', join: '2026-09-15', skill: 0.9, title: 'Webinar Coordinator', leadRate: 0.5 },
  { key: 'simran', name: 'Simran Patil', email: 'simran@coacheasily.local', role: 'SALES_EXECUTIVE', join: '2026-08-17', skill: 0.9, title: 'Customer Experience Executive' },
  { key: 'founder', name: 'Purushottam Hambarde', email: 'purushottam@coacheasily.local', role: 'FOUNDER_CEO', join: '2025-11-03', skill: 1, title: 'Founder & CEO' },
  { key: 'supriya', name: 'Supriya Naik', email: 'supriya@coacheasily.local', role: 'HR', join: '2026-03-02', skill: 1, title: 'HR Executive' },
];
const JOIN: Record<string, string> = { founder: '2025-11-03', teamlead: '2025-12-01', prachi: '2026-01-19', rajat: '2026-05-04', admin: '2026-01-05', finance: '2026-01-05', hr: '2026-01-05', marketing: '2026-01-05', community: '2026-01-05', operations: '2026-01-05', studentsuccess: '2026-01-05' };
const TITLE: Record<string, string> = { prachi: 'Community People Manager', rajat: 'Customer Experience Executive', hr: 'People & Culture (HR)' };
const RENAME: Record<string, string> = { prachi: 'Prachi Waghmare', rajat: 'Rajat Dhore', hr: 'Shubhangi Swaraj' };
const BY_EMAIL: Record<string, string> = {
  'teamlead@coacheasily.local': 'teamlead', 'manager@coacheasily.local': 'prachi', 'executive@coacheasily.local': 'rajat',
  'admin@coacheasily.local': 'admin', 'finance@coacheasily.local': 'finance', 'hr@coacheasily.local': 'hr', 'marketing@coacheasily.local': 'marketing',
  'community@coacheasily.local': 'community', 'operations@coacheasily.local': 'operations', 'studentsuccess@coacheasily.local': 'studentsuccess',
};
const SKILL: Record<string, number> = { rajat: 1.0 };
const SAURABH_TEAM = ['monica', 'sushma', 'sarika', 'iyyanar'];

export async function setupPeople(prisma: PrismaClient, org: string, credOut?: string): Promise<Ctx> {
  const roles = new Map((await prisma.role.findMany()).map((r) => [r.key, r.id]));
  const u: Record<string, Person> = {};

  // existing users: friendly names (emails/passwords unchanged)
  for (const [email, key] of Object.entries(BY_EMAIL)) {
    const row = await prisma.user.findUnique({ where: { email }, include: { roleAssignments: { include: { role: true } } } });
    if (!row || row.organizationId !== org) throw new Error(`Expected existing user ${email} in organisation`);
    const name = RENAME[key] ?? row.name;
    if (name !== row.name) await prisma.user.update({ where: { id: row.id }, data: { name } });
    u[key] = { key, id: row.id, name, email, role: row.roleAssignments[0]?.role.key ?? '', join: JOIN[key] ?? '2026-01-05', skill: SKILL[key] ?? 1, title: TITLE[key] };
  }

  const creds: Array<{ name: string; email: string; role: string; password: string }> = [];
  // Anjali is not in the real team chart: remove her (all her sample records were deleted by cleanup)
  const anjali = await prisma.user.findUnique({ where: { email: 'anjali@coacheasily.local' } });
  if (anjali) {
    await prisma.teamMembership.deleteMany({ where: { userId: anjali.id } });
    await prisma.userRoleAssignment.deleteMany({ where: { userId: anjali.id } });
    await prisma.employeeProfile.deleteMany({ where: { userId: anjali.id } });
    await prisma.crmNotificationDelivery.deleteMany({ where: { recipientId: anjali.id } });
    await prisma.session.deleteMany({ where: { userId: anjali.id } });
    await prisma.notification.deleteMany({ where: { userId: anjali.id } });
    await prisma.user.delete({ where: { id: anjali.id } });
  }
  for (const p of NEW_PEOPLE) {
    const old = p.oldEmail ? await prisma.user.findUnique({ where: { email: p.oldEmail } }) : null;
    if (old) await prisma.user.update({ where: { id: old.id }, data: { email: p.email } });
    const existing = await prisma.user.findUnique({ where: { email: p.email } });
    let id = existing?.id;
    if (!id) {
      const password = `Ce@${randomBytes(6).toString('base64url')}#9`;
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
      id = (await prisma.user.create({ data: { organizationId: org, email: p.email, name: p.name, passwordHash, passwordChangedAt: new Date() } })).id;
      creds.push({ name: p.name, email: p.email, role: p.role, password });
    }
    await prisma.userRoleAssignment.upsert({ where: { userId_roleId: { userId: id, roleId: roles.get(p.role)! } }, update: {}, create: { organizationId: org, userId: id, roleId: roles.get(p.role)! } });
    if (existing && existing.name !== p.name) await prisma.user.update({ where: { id }, data: { name: p.name } });
    u[p.key] = { key: p.key, id, name: p.name, email: p.email, role: p.role, join: p.join, skill: p.skill, title: p.title, leadRate: p.leadRate, partTime: p.partTime };
  }
  if (credOut && creds.length) {
    // merge with what an earlier run wrote (passwords of existing users cannot be recovered from the database)
    let prior: typeof creds = [];
    try { prior = JSON.parse(readFileSync(credOut, 'utf8')); } catch { /* first run */ }
    const renamed = new Map(NEW_PEOPLE.filter((x) => x.oldEmail).map((x) => [x.oldEmail!, x] as const));
    const merged = new Map<string, (typeof creds)[number]>();
    for (const c of prior) {
      if (c.email === 'anjali@coacheasily.local') continue;
      const rn = renamed.get(c.email);
      merged.set(rn ? rn.email : c.email, rn ? { ...c, name: rn.name, email: rn.email } : c);
    }
    for (const c of creds) merged.set(c.email, c);
    writeFileSync(credOut, JSON.stringify([...merged.values()], null, 2), { mode: 0o600 });
  }

  // Kamar Alam: from Founder to AI Developer Engineer (system role ADMIN). Runs only after the new Founder account above exists, so the org is never without a Founder.
  const kamar = await prisma.user.findUnique({ where: { email: 'kamaralamjdu@gmail.com' } });
  if (kamar) {
    if (!u.founder) throw new Error('Founder account missing; refusing to demote the current Founder');
    await prisma.userRoleAssignment.deleteMany({ where: { userId: kamar.id, role: { key: 'FOUNDER_CEO' } } });
    await prisma.userRoleAssignment.upsert({ where: { userId_roleId: { userId: kamar.id, roleId: roles.get('ADMIN')! } }, update: {}, create: { organizationId: org, userId: kamar.id, roleId: roles.get('ADMIN')! } });
    u.kamar = { key: 'kamar', id: kamar.id, name: kamar.name, email: kamar.email, role: 'ADMIN', join: '2026-08-31', skill: 1, title: 'AI Developer Engineer - Tech Head' };
  }

  // hierarchy: Founder -> Team Lead -> Managers -> Executives
  const mgr: Record<string, string> = { kamar: 'founder', admin: 'founder', finance: 'founder', marketing: 'founder', community: 'founder', operations: 'founder', studentsuccess: 'founder', hr: 'founder', teamlead: 'founder', saurabh: 'teamlead', prachi: 'teamlead', monica: 'saurabh', sushma: 'saurabh', sarika: 'saurabh', iyyanar: 'saurabh', rajat: 'prachi', simran: 'prachi', supriya: 'hr' };
  for (const [k, m] of Object.entries(mgr)) await prisma.user.update({ where: { id: u[k]!.id }, data: { managerId: u[m]!.id } });
  // tenure: created_at / employee profile follow the join date (KPI rules exclude new joiners)
  for (const p of Object.values(u)) {
    await prisma.user.update({ where: { id: p.id }, data: { createdAt: dateOnly(p.join) } });
    const pos = p.title ?? ({ FOUNDER_CEO: 'Founder & CEO', SALES_TEAM_LEAD: 'Sales Team Lead', SALES_MANAGER: 'Sales Manager', SALES_EXECUTIVE: 'Sales Executive' } as Record<string, string>)[p.role] ?? p.name;
    const employmentType = p.partTime ? 'PART_TIME' : 'FULL_TIME';
    const probationEndDate = ['simran', 'monica', 'sushma', 'iyyanar'].includes(p.key) ? new Date(dateOnly(p.join).getTime() + 90 * 86_400_000) : null;
    await prisma.employeeProfile.upsert({ where: { userId: p.id }, update: { joinDate: dateOnly(p.join), probationEndDate, positionTitle: pos, employmentType }, create: { organizationId: org, userId: p.id, joinDate: dateOnly(p.join), probationEndDate, positionTitle: pos, employmentType } });
  }

  // teams (the existing team "Prachi" is kept)
  const teamFor = async (name: string, lead: Person, members: Person[]) => {
    const t = await prisma.team.upsert({ where: { organizationId_name: { organizationId: org, name } }, update: { leadUserId: lead.id }, create: { organizationId: org, name, leadUserId: lead.id } });
    await prisma.teamMembership.deleteMany({ where: { teamId: t.id } });
    await prisma.teamMembership.createMany({ data: [{ teamId: t.id, userId: lead.id, membershipRole: 'LEAD' }, ...members.map((m) => ({ teamId: t.id, userId: m.id, membershipRole: 'MEMBER' as const }))] });
    return t.id;
  };
  await prisma.team.updateMany({ where: { organizationId: org, name: 'Shaurav' }, data: { name: 'Saurabh' } });
  const prachi = await teamFor('Prachi', u.prachi!, [u.rajat!, u.simran!]);
  const saurabh = await teamFor('Saurabh', u.saurabh!, SAURABH_TEAM.map((k) => u[k]!));
  const execs = [...SAURABH_TEAM.map((k) => u[k]!), u.rajat!, u.simran!];
  const managerOf = (k: string) => (SAURABH_TEAM.includes(k) ? u.saurabh! : u.prachi!);
  return { prisma, org, u, team: { saurabh, prachi }, execs, managerOf };
}
