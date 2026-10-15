import { complaintDeadlines, DEFAULT_CX_CONFIG, toWorkingHours } from '@salesos/cx-core';
import { dateOnly, DAY, HOUR, istDay, istMidnight, MIN, rng } from './shared';
import { SAMPLE_TAG, type Ctx } from './setup';

/** CX data derived from the same deals/payments/calls as everything else: handovers for won deals, complaints, risks and insights from real numbers. */
export async function loadCx(ctx: Ctx): Promise<Record<string, number>> {
  const { prisma, org, u } = ctx;
  const r = rng(99);
  const NOW = new Date();
  const out: Record<string, number> = {};

  // ---- handover for every won deal (Sales -> Student Success) ---------------------------------------------------------------------------------------
  const won = await prisma.deal.findMany({ where: { organizationId: org, stage: 'WON', createKey: { startsWith: 'sample-m1:' } }, include: { lead: true, program: true, payments: { select: { amount: true, status: true } } }, orderBy: { closedAt: 'asc' } });
  const handovers = won.map((d, i) => {
    const paid = d.payments.filter((p) => p.status === 'VERIFIED' || p.status === 'RECONCILED').reduce((s, p) => s + Number(p.amount), 0);
    const total = Number(d.amount);
    const closed = d.closedAt!;
    const ageDays = (NOW.getTime() - closed.getTime()) / DAY;
    const submittedAt = new Date(closed.getTime() + 3 * HOUR);
    const ackDueAt = new Date(submittedAt.getTime() + 24 * HOUR);
    const status = ageDays > 5 ? 'COMPLETED' : ageDays > 2 ? 'ACKNOWLEDGED' : i % 4 === 0 && ageDays > 1 ? 'INFO_REQUESTED' : 'SUBMITTED';
    const acknowledgedAt = status === 'COMPLETED' || status === 'ACKNOWLEDGED' ? new Date(submittedAt.getTime() + r.int(2, 20) * HOUR) : null;
    return {
      organizationId: org, dealId: d.id, leadId: d.leadId, programId: d.programId, programName: d.program.name, status: status as 'COMPLETED' | 'ACKNOWLEDGED' | 'INFO_REQUESTED' | 'SUBMITTED', ownerId: d.ownerId, teamId: d.teamId, createdById: d.ownerId, receivingOwnerId: u.studentsuccess!.id,
      learnerName: d.lead.fullName, learnerContact: d.lead.phoneE164, languagePreference: d.lead.preferredLanguage, amountPaid: paid.toFixed(2), amountDue: Math.max(0, total - paid).toFixed(2), paymentVerified: paid > 0,
      promisesMade: 'Weekend batch access and recording links within 24 hours.', goals: 'Start a coaching practice within six months.', objections: 'Asked about EMI; resolved with the instalment plan.', specialNotes: SAMPLE_TAG,
      submittedAt, ackDueAt, acknowledgedAt, completedAt: status === 'COMPLETED' ? new Date(acknowledgedAt!.getTime() + 2 * DAY) : null, completionNote: status === 'COMPLETED' ? 'Learner onboarded to the batch and community.' : null,
      infoRequest: status === 'INFO_REQUESTED' ? 'Please confirm the learner preferred batch timing.' : null, infoRequestedAt: status === 'INFO_REQUESTED' ? new Date(submittedAt.getTime() + 6 * HOUR) : null, createdAt: closed,
    };
  });
  await prisma.handoverRecord.createMany({ data: handovers });
  out.handovers = handovers.length;

  // ---- complaints (with the SLA clock) ------------------------------------------------------------------------------------------------------------
  const wh = toWorkingHours(DEFAULT_CX_CONFIG);
  const usedDeals = new Set<string>();
  const plans: Array<{ title: string; priority: 'P1' | 'P2' | 'P3'; category: string; description: string; status: 'RESOLVED' | 'IN_PROGRESS' | 'ESCALATED' | 'OPEN'; ageDays: number }> = [
    { title: 'Recording link for week 2 not received', priority: 'P2', category: 'DELIVERY_ACCESS', description: 'Learner says the recording link for week 2 never arrived.', status: 'RESOLVED', ageDays: 9 },
    { title: 'Invoice shows the wrong amount', priority: 'P1', category: 'PAYMENT_BILLING', description: 'Invoice total does not match the amount agreed on the call.', status: 'ESCALATED', ageDays: 3 },
    { title: 'Batch timing changed without notice', priority: 'P3', category: 'DELIVERY_ACCESS', description: 'Learner was not told that the weekend batch moved by one hour.', status: 'IN_PROGRESS', ageDays: 2 },
    { title: 'Call-back promised but not received', priority: 'P2', category: 'SALES_CONDUCT', description: 'Prospect says nobody called back after the demo.', status: 'OPEN', ageDays: 1 },
    { title: 'Certificate name spelled wrongly', priority: 'P3', category: 'DELIVERY_ACCESS', description: 'Learner asked for a corrected certificate.', status: 'RESOLVED', ageDays: 19 },
    { title: 'Charged twice for one instalment', priority: 'P1', category: 'PAYMENT_BILLING', description: 'Learner reports a duplicate debit; Finance checked the statement.', status: 'RESOLVED', ageDays: 14 },
  ];
  for (const c of plans) {
    const d = won.find((x) => !usedDeals.has(x.id) && x.closedAt! < new Date(NOW.getTime() - (c.ageDays + 1) * DAY));
    if (!d) continue;
    usedDeals.add(d.id);
    const start = new Date(NOW.getTime() - c.ageDays * DAY);
    const dl = complaintDeadlines(c.priority, start, DEFAULT_CX_CONFIG, wh);
    const owner = ctx.managerOf(ctx.execs.find((e) => e.id === d.ownerId)!.key);
    const resolvedAt = c.status === 'RESOLVED' ? new Date(start.getTime() + 2 * DAY) : null;
    await prisma.complaint.create({
      data: {
        organizationId: org, leadId: d.leadId, dealId: d.id, title: c.title, description: `${c.description} ${SAMPLE_TAG}`, category: c.category, priority: c.priority, status: c.status, ownerId: owner.id, createdById: u.studentsuccess!.id, teamId: d.teamId, autoAssigned: true,
        slaStartedAt: start, firstResponseDueAt: dl.firstResponseDueAt, resolutionDueAt: dl.resolutionDueAt, acknowledgedAt: c.status === 'OPEN' ? null : new Date(start.getTime() + 2 * HOUR), firstResponseNote: c.status === 'OPEN' ? null : 'Acknowledged and looking into it.',
        escalatedAt: c.status === 'ESCALATED' ? new Date(start.getTime() + DAY) : null, escalatedToId: c.status === 'ESCALATED' ? u.teamlead!.id : null, escalationReason: c.status === 'ESCALATED' ? 'Billing amount needs a Finance check' : null,
        resolvedAt, resolution: resolvedAt ? 'Link re-sent and access confirmed with the learner.' : null, rootCauseCategory: resolvedAt ? 'PROCESS' : null, resolvedWithinSla: resolvedAt ? resolvedAt <= dl.resolutionDueAt : null, createdAt: start,
      },
    });
  }
  out.complaints = usedDeals.size;

  // ---- risk, action items, insight: built from the real numbers ------------------------------------------------------------------------------------
  const octStart = istMidnight(istDay(NOW).slice(0, 7) + '-01');
  const teams: Array<[string, string, string]> = [['saurabh', ctx.team.saurabh, u.saurabh!.id], ['prachi', ctx.team.prachi, u.prachi!.id]];
  const teamAchv: Record<string, number> = {};
  for (const [name, , mgrId] of teams) {
    const t = await prisma.target.findFirst({ where: { organizationId: org, ownerUserId: mgrId, metric: 'REVENUE', period: { startsOn: dateOnly(istDay(octStart)) } } });
    const members = ctx.execs.filter((e) => ctx.managerOf(e.key).key === name).map((e) => e.id);
    const credits = await prisma.salesCredit.findMany({ where: { organizationId: org, userId: { in: members }, salesRecord: { closedAt: { gte: octStart } } }, select: { amount: true } });
    teamAchv[name] = t ? credits.reduce((s, c) => s + Number(c.amount), 0) / Number(t.amount) : 0;
  }
  const behind = Object.entries(teamAchv).sort((a, b) => a[1] - b[1])[0]!;
  const behindMgr = behind[0] === 'saurabh' ? u.saurabh! : u.prachi!;
  const behindName = behindMgr.name.split(' ')[0]!;
  await prisma.riskEntry.create({ data: { organizationId: org, title: `Team ${behindName} is at ${Math.round(behind[1] * 100)}% of the October revenue target at mid-month`, description: `Pipeline coverage needs a review with the manager. ${SAMPLE_TAG}`, severity: behind[1] < 0.4 ? 4 : 3, earlyWarning: true, proposedSolution: 'Daily pipeline review, two extra demo slots this week and focused coaching on closing.', ownerId: u.teamlead!.id, raisedById: behindMgr.id } });
  await prisma.actionItem.createMany({ data: [
    { organizationId: org, title: `Agree a recovery plan for Team ${behindName}'s October target`, description: `From the weekly Founder review. ${SAMPLE_TAG}`, ownerId: u.teamlead!.id, createdById: u.founder!.id, dueAt: new Date(NOW.getTime() + 4 * DAY), source: 'REVIEW' },
    { organizationId: org, title: 'Approve the Sales Executive requisition for Team Prachi', description: `HR has shortlisted candidates. ${SAMPLE_TAG}`, ownerId: u.founder!.id, createdById: u.hr!.id, dueAt: new Date(NOW.getTime() + 6 * DAY), source: 'REVIEW' },
  ] });
  const obj = await prisma.callLog.groupBy({ by: ['objectionCategory'], where: { organizationId: org, objectionCategory: { not: null }, startedAt: { gte: istMidnight('2026-09-01') } }, _count: true, orderBy: { _count: { objectionCategory: 'desc' } }, take: 1 });
  if (obj[0]) await prisma.insight.create({ data: { organizationId: org, authorId: u.teamlead!.id, kind: 'OBJECTION', title: `${String(obj[0].objectionCategory).replace('_', ' ').toLowerCase()} is the most common objection since 1 September`, body: `Recorded on ${obj[0]._count} calls by the executives. Suggest a clear explainer for the website and demos. ${SAMPLE_TAG}`, audience: ['MARKETING', 'SALES'], tags: [String(obj[0].objectionCategory).toLowerCase()] } });
  await prisma.xfTask.createMany({ data: [
    { organizationId: org, title: 'Draft reminder copy for the next webinar', description: `Three reminder messages in English and Hindi. ${SAMPLE_TAG}`, department: 'MARKETING', requesterDepartment: 'SALES', ownerId: u.marketing!.id, requesterId: u.teamlead!.id, dueAt: new Date(NOW.getTime() + 3 * DAY), kind: 'HANDOFF' },
    { organizationId: org, title: 'Confirm venue and AV for the summit', description: `Needed before the next demo cycle. ${SAMPLE_TAG}`, department: 'OPERATIONS', requesterDepartment: 'SALES', ownerId: u.operations!.id, requesterId: u.teamlead!.id, dueAt: new Date(NOW.getTime() + 7 * DAY), kind: 'WEBINAR_PLANNING' },
  ] });
  void MIN;
  out.riskActionsTasks = 6;
  return out;
}
