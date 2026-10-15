import { complaintDeadlines, DEFAULT_CX_CONFIG, toWorkingHours } from '@salesos/cx-core';
import type { SeedContext } from './types';

/**
 * cx demo data (Phase 7). Every record is labelled [DEMO]; idempotent (a second run creates nothing: each block checks for its
 * [DEMO] marker first). No survey scores, report numbers or refund figures are invented: only workflow records that show the
 * screens working (complaint with its SLA clock, an escalation, a risk with a proposed solution, an action item, a cross-team task,
 * an insight). Founder-report shells are created by the worker sweep, not here.
 */
export async function seedCx(ctx: SeedContext): Promise<void> {
  const { prisma, organizationId: org, userIds } = ctx;
  const u = (k: string) => userIds.get(k);
  const founder = u('founder');
  const teamlead = u('teamlead');
  const managerA = u('manager.a');
  const execA1 = u('exec.a1');
  const marketing = u('marketing');
  const ops = u('operations');
  if (!founder || !teamlead || !managerA || !execA1 || !marketing || !ops) return; // demo users missing: nothing to attach to

  const lead = await prisma.lead.findFirst({ where: { organizationId: org, assignedToId: execA1, mergedIntoId: null, fullName: { startsWith: '[DEMO]' } }, orderBy: { createdAt: 'asc' } })
    ?? (await prisma.lead.findFirst({ where: { organizationId: org, assignedToId: execA1, mergedIntoId: null }, orderBy: { createdAt: 'asc' } }));

  if (!(await prisma.complaint.findFirst({ where: { organizationId: org, title: { startsWith: '[DEMO]' } } }))) {
    const wh = toWorkingHours(DEFAULT_CX_CONFIG);
    const now = new Date();
    for (const c of [
      { title: '[DEMO] Recording link for week 2 not received', priority: 'P2' as const, category: 'DELIVERY_ACCESS', description: '[DEMO] Learner says the recording link for week 2 never arrived.' },
      { title: '[DEMO] Invoice shows the wrong amount', priority: 'P1' as const, category: 'PAYMENT_BILLING', description: '[DEMO] Invoice total does not match the amount agreed on the call.' },
    ]) {
      const dl = complaintDeadlines(c.priority, now, DEFAULT_CX_CONFIG, wh);
      await prisma.complaint.create({ data: { organizationId: org, leadId: lead?.id ?? null, ownerId: managerA, createdById: execA1, autoAssigned: true, slaStartedAt: now, firstResponseDueAt: dl.firstResponseDueAt, resolutionDueAt: dl.resolutionDueAt, ...c } });
    }
  }
  if (lead && !(await prisma.relationshipEscalation.findFirst({ where: { organizationId: org, title: { startsWith: '[DEMO]' } } }))) {
    await prisma.relationshipEscalation.create({ data: { organizationId: org, leadId: lead.id, type: 'HIGH_VALUE', title: '[DEMO] Corporate batch for 12 seats', context: '[DEMO] Prospect wants one invoice and an EMI plan for twelve participants.', blocker: '[DEMO] Needs a discount approval', requestedHelp: '[DEMO] Join the next call', ownerId: execA1, createdById: execA1, teamLeadId: managerA, founderInvolved: true } });
  }
  if (!(await prisma.riskEntry.findFirst({ where: { organizationId: org, title: { startsWith: '[DEMO]' } } }))) {
    await prisma.riskEntry.create({ data: { organizationId: org, title: '[DEMO] Demo no-shows rising on weekday evenings', description: '[DEMO] Attendance at 7pm demos looks lower than at noon demos.', severity: 3, earlyWarning: true, proposedSolution: '[DEMO] Add a reminder one hour before and test a noon slot', ownerId: teamlead, raisedById: teamlead } });
  }
  if (!(await prisma.actionItem.findFirst({ where: { organizationId: org, title: { startsWith: '[DEMO]' } } }))) {
    await prisma.actionItem.create({ data: { organizationId: org, title: '[DEMO] Publish the objection-handling SOP update', description: '[DEMO] From the last Founder review.', ownerId: teamlead, createdById: founder, dueAt: new Date(Date.now() + 5 * 86_400_000), source: 'REVIEW' } });
  }
  if (!(await prisma.xfTask.findFirst({ where: { organizationId: org, title: { startsWith: '[DEMO]' } } }))) {
    await prisma.xfTask.create({ data: { organizationId: org, title: '[DEMO] Draft reminder copy for the next webinar', description: '[DEMO] Three reminder messages in English and Hindi.', department: 'MARKETING', requesterDepartment: 'SALES', ownerId: marketing, requesterId: teamlead, dueAt: new Date(Date.now() + 3 * 86_400_000), kind: 'HANDOFF' } });
    await prisma.xfTask.create({ data: { organizationId: org, title: '[DEMO] Confirm venue and AV for the summit', department: 'OPERATIONS', requesterDepartment: 'SALES', ownerId: ops, requesterId: teamlead, dueAt: new Date(Date.now() + 7 * 86_400_000), kind: 'WEBINAR_PLANNING' } });
  }
  if (!(await prisma.insight.findFirst({ where: { organizationId: org, title: { startsWith: '[DEMO]' } } }))) {
    await prisma.insight.create({ data: { organizationId: org, authorId: teamlead, kind: 'OBJECTION', title: '[DEMO] EMI is the most common objection', body: '[DEMO] Roughly one in three prospects ask about EMI before enrolling. Suggest a clear EMI explainer.', audience: ['MARKETING', 'SALES'], tags: ['emi'] } });
  }
}
