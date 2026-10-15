import type { Prisma } from '@prisma/client';
import { addDaysStr, atIST, dateOnly, DAY, HOUR, istDay, rng } from './shared';
import { SAMPLE_TAG, type Ctx } from './setup';

/** The remaining pages (growth, feedback, pricing, strategy, PIP, incentives, succession, learning, CRM queues, escalations, cross-team work). Sample data only. */
export async function loadFill(ctx: Ctx): Promise<Record<string, number>> {
  const { prisma, org, u, execs } = ctx;
  const r = rng(555);
  const NOW = new Date();
  const today = istDay(NOW);
  const out: Record<string, number> = {};
  const T = SAMPLE_TAG;
  const progs = await prisma.program.findMany({ where: { organizationId: org } });
  const prog = (code: string) => progs.find((p) => p.code === code);

  // ---- growth, feedback, pricing -----------------------------------------------------------------------------------------------------------------
  await prisma.growthOpportunity.createMany({ data: [
    { organizationId: org, type: 'CHANNEL', title: 'WhatsApp learner communities', description: `Seed referral communities after each cohort. ${T}`, estimatedValue: '500000.00', ownerId: u.saurabh!.id, teamId: ctx.team.saurabh, status: 'EVALUATING', createdById: u.saurabh!.id, createdAt: atIST('2026-09-10', 12, 0) },
    { organizationId: org, type: 'SEGMENT', title: 'Working women re-skilling', description: `A segment to test through a targeted weekend webinar. ${T}`, ownerId: u.prachi!.id, teamId: ctx.team.prachi, status: 'IDEA', createdById: u.prachi!.id, createdAt: atIST('2026-09-18', 12, 0) },
    { organizationId: org, type: 'CHANNEL', title: 'Webinar replays as lead magnets', description: `Gate the replay behind a short form to capture warm leads. ${T}`, estimatedValue: '250000.00', ownerId: u.monica!.id, teamId: ctx.team.saurabh, status: 'PILOT', createdById: u.monica!.id, createdAt: atIST('2026-09-25', 12, 0) },
    { organizationId: org, type: 'OTHER', title: 'Corporate batches for coaching firms', description: `One invoice and an EMI plan for 10+ seats. ${T}`, estimatedValue: '1200000.00', ownerId: u.teamlead!.id, status: 'EVALUATING', createdById: u.teamlead!.id, createdAt: atIST('2026-10-02', 12, 0) },
  ] });
  const cbax = prog('CBAX');
  const proposal = await prisma.pricingProposal.create({ data: { organizationId: org, type: 'OFFER', programId: cbax?.id ?? null, title: 'Diwali early-bird offer on CBAX', rationale: `Competitor discounts were reported on several calls this month. ${T}`, currentAmount: '49999.00', proposedAmount: '44999.00', status: 'SUBMITTED', createdById: u.teamlead!.id, submittedAt: atIST('2026-10-12', 11, 0), createdAt: atIST('2026-10-10', 11, 0) } });
  await prisma.pricingProposalEvent.createMany({ data: [
    { organizationId: org, proposalId: proposal.id, fromStatus: null, toStatus: 'DRAFT', actorId: u.teamlead!.id, actorRole: 'SALES_TEAM_LEAD', note: 'Created', createdAt: atIST('2026-10-10', 11, 0) },
    { organizationId: org, proposalId: proposal.id, fromStatus: 'DRAFT', toStatus: 'SUBMITTED', actorId: u.teamlead!.id, actorRole: 'SALES_TEAM_LEAD', note: 'Submitted for Founder review', createdAt: atIST('2026-10-12', 11, 0) },
  ] });
  const emi = await prisma.pricingProposal.create({ data: { organizationId: org, type: 'BUNDLE', programId: prog('MCA_X')?.id ?? null, title: 'Two-instalment plan on MCA X', rationale: `EMI is the most common objection; a 50/50 plan converts more calls. ${T}`, currentAmount: '149999.00', proposedAmount: '149999.00', status: 'APPROVED', createdById: u.teamlead!.id, submittedAt: atIST('2026-09-08', 11, 0), decidedById: u.founder!.id, decidedAt: atIST('2026-09-10', 16, 0), decisionNote: 'Approved for all executives.', createdAt: atIST('2026-09-06', 11, 0) } });
  await prisma.pricingProposalEvent.createMany({ data: [
    { organizationId: org, proposalId: emi.id, fromStatus: null, toStatus: 'DRAFT', actorId: u.teamlead!.id, actorRole: 'SALES_TEAM_LEAD', note: 'Created', createdAt: atIST('2026-09-06', 11, 0) },
    { organizationId: org, proposalId: emi.id, fromStatus: 'DRAFT', toStatus: 'SUBMITTED', actorId: u.teamlead!.id, actorRole: 'SALES_TEAM_LEAD', note: 'Submitted', createdAt: atIST('2026-09-08', 11, 0) },
    { organizationId: org, proposalId: emi.id, fromStatus: 'SUBMITTED', toStatus: 'APPROVED', actorId: u.founder!.id, actorRole: 'FOUNDER_CEO', note: 'Approved', createdAt: atIST('2026-09-10', 16, 0) },
  ] });
  await prisma.feedbackEntry.createMany({ data: [
    { organizationId: org, kind: 'COMPETITOR', category: 'Pricing', source: 'Sales call', title: 'Competitor runs a festive discount', notes: `Prospects mention a 30% festive discount elsewhere. ${T}`, competitor: 'Competitor X', createdById: u.sarika!.id, teamId: ctx.team.saurabh, proposalId: proposal.id, createdAt: atIST('2026-10-08', 15, 0) },
    { organizationId: org, kind: 'MARKET', category: 'Demand', source: 'Webinar Q&A', title: 'Weekend batches requested', notes: `Working professionals ask for weekend-only cohorts. ${T}`, createdById: u.monica!.id, teamId: ctx.team.saurabh, status: 'REVIEWED', createdAt: atIST('2026-09-27', 18, 0) },
    { organizationId: org, kind: 'LEARNER', category: 'Experience', source: 'Survey', title: 'Learners love the mentor sessions', notes: `Recurring praise for live mentor feedback. ${T}`, createdById: u.studentsuccess!.id, status: 'ACTIONED', createdAt: atIST('2026-10-05', 12, 0) },
    { organizationId: org, kind: 'MARKET', category: 'Language', source: 'Sales call', title: 'Marathi-speaking prospects want Marathi sessions', notes: `Three calls this week asked for a Marathi cohort. ${T}`, createdById: u.simran!.id, teamId: ctx.team.prachi, createdAt: atIST('2026-10-09', 14, 0) },
    { organizationId: org, kind: 'COMPETITOR', category: 'Product', source: 'Prospect', title: 'Rival offers a job-assistance promise', notes: `A prospect compared our programme with a rival job-assistance package. ${T}`, competitor: 'Competitor Y', createdById: u.rajat!.id, teamId: ctx.team.prachi, createdAt: atIST('2026-10-11', 16, 0) },
  ] });
  out.growthFeedbackPricing = 4 + 2 + 5;

  // ---- strategy plans -----------------------------------------------------------------------------------------------------------------------------
  const periods = await prisma.targetPeriod.findMany({ where: { organizationId: org, type: 'MONTH' } });
  const sept = periods.find((p) => p.startsOn.toISOString().startsWith('2026-09'));
  const oct = periods.find((p) => p.startsOn.toISOString().startsWith('2026-10'));
  const octPlan = await prisma.strategyPlan.create({ data: { organizationId: org, periodId: oct?.id ?? null, title: 'October plan: convert webinar attendees', summary: `Focus on demo-to-sale conversion and on collections follow-up. ${T}`, status: 'ACTIVE', ownerId: u.teamlead!.id, createdAt: atIST('2026-09-29', 11, 0) } });
  await prisma.strategyInitiative.createMany({ data: [
    { organizationId: org, planId: octPlan.id, title: 'Daily demo follow-up huddle', ownerId: u.saurabh!.id, status: 'IN_PROGRESS', dueOn: dateOnly('2026-10-31') },
    { organizationId: org, planId: octPlan.id, title: 'Collection chase list every Monday', ownerId: u.prachi!.id, status: 'IN_PROGRESS', dueOn: dateOnly('2026-10-31') },
    { organizationId: org, planId: octPlan.id, title: 'Weekend demo slot for working professionals', ownerId: u.monica!.id, status: 'PLANNED', dueOn: dateOnly('2026-10-25') },
  ] });
  const septPlan = await prisma.strategyPlan.create({ data: { organizationId: org, periodId: sept?.id ?? null, title: 'September plan: build the new team', summary: `Onboard the new executives and stabilise the follow-up process. ${T}`, status: 'CLOSED', ownerId: u.teamlead!.id, createdAt: atIST('2026-08-28', 11, 0) } });
  await prisma.strategyInitiative.createMany({ data: [
    { organizationId: org, planId: septPlan.id, title: 'Onboard Monica, Sushma and Iyyanar', ownerId: u.saurabh!.id, status: 'DONE', dueOn: dateOnly('2026-09-30') },
    { organizationId: org, planId: septPlan.id, title: 'Roll out the follow-up SOP', ownerId: u.teamlead!.id, status: 'DONE', dueOn: dateOnly('2026-09-20') },
  ] });
  out.strategy = 2;

  // ---- PIP: attached to a fictitious employee so no real person carries a negative HR record --------------------------------------------------------------------
  out.pip = await loadPip(prisma, org, u.teamlead!.id, u.founder!.id);

  // ---- incentives: illustrative structure + recommendations for FICTIONAL employees only -----------------------------------------------------------------------
  out.incentives = await loadIncentives(prisma, org, u.teamlead!.id, u.founder!.id);

  // ---- succession, learning, expectations --------------------------------------------------------------------------------------------------------------
  await prisma.successionCandidate.deleteMany({ where: { organizationId: org } });
  await prisma.successionPosition.deleteMany({ where: { organizationId: org } });
  const posTL = await prisma.successionPosition.create({ data: { organizationId: org, title: 'Sales Team Lead', roleKey: 'SALES_TEAM_LEAD', incumbentId: u.teamlead!.id, notes: `Cover for the Team Lead. ${T}`, createdById: u.hr!.id } });
  const posSM = await prisma.successionPosition.create({ data: { organizationId: org, title: 'Sales Manager', roleKey: 'SALES_MANAGER', incumbentId: u.saurabh!.id, notes: `Second-line leaders. ${T}`, createdById: u.hr!.id } });
  await prisma.successionCandidate.createMany({ data: [
    { organizationId: org, positionId: posTL.id, userId: u.saurabh!.id, readiness: 'READY_LATER', developmentActions: [{ title: 'Run the weekly forecast review', dueDate: '2026-11-30', status: 'IN_PROGRESS' }] as unknown as Prisma.InputJsonValue, notes: 'Strong with the team; needs forecasting depth.', addedById: u.hr!.id },
    { organizationId: org, positionId: posSM.id, userId: u.monica!.id, readiness: 'READY_LATER', developmentActions: [{ title: 'Lead two demo sessions a week', dueDate: '2026-12-15', status: 'IN_PROGRESS' }] as unknown as Prisma.InputJsonValue, notes: 'Top converter this month.', addedById: u.hr!.id },
  ] });
  const resources = await prisma.resource.findMany({ where: { organizationId: org }, take: 6, orderBy: { createdAt: 'asc' } });
  const asg: Prisma.ResourceAssignmentCreateManyInput[] = [];
  execs.forEach((e, i) => { const res = resources[i % Math.max(resources.length, 1)]; if (res) asg.push({ organizationId: org, resourceId: res.id, userId: e.id, assignedById: ctx.managerOf(e.key).id, dueDate: dateOnly(addDaysStr(today, 7 + i)), status: i % 3 === 0 ? 'COMPLETED' : i % 3 === 1 ? 'IN_PROGRESS' : 'ASSIGNED', completedAt: i % 3 === 0 ? atIST(addDaysStr(today, -2), 15, 0) : null }); });
  await prisma.resourceAssignment.createMany({ data: asg, skipDuplicates: true });
  out.succession = 2; out.resourceAssignments = asg.length;

  // ---- CRM queues: duplicates, reactivation, reassignment, escalations ---------------------------------------------------------------------------------------
  const owner = u.monica!;
  const teamId = ctx.team.saurabh;
  const src = (await prisma.leadSource.findFirst({ where: { organizationId: org } }))!;
  const mkLead = (key: string, name: string, phone: string, createdAt: Date) => prisma.lead.create({ data: { organizationId: org, fullName: name, phoneE164: `+91${phone}`, phoneRaw: phone, sourceId: src.id, assignedToId: owner.id, teamId, status: 'NEW', stageCategory: 'OPEN', createKey: key, createdById: u.saurabh!.id, createdAt, assignedAt: createdAt, lastActivityAt: createdAt } });
  const d1 = await mkLead('sample-m1:dup-1', 'Priya Verma', '9811100002', atIST(addDaysStr(today, -3), 11, 0));
  const d2 = await mkLead('sample-m1:dup-2', 'Priya Verma', '9811100002', atIST(addDaysStr(today, -1), 15, 0));
  const d3 = await mkLead('sample-m1:dup-3', 'Rakesh Nene', '9811100003', atIST(addDaysStr(today, -6), 12, 0));
  const d4 = await mkLead('sample-m1:dup-4', 'Rakesh Nene', '9811100003', atIST(addDaysStr(today, -5), 12, 0));
  await prisma.duplicateCandidate.createMany({ data: [
    { organizationId: org, leadId: d2.id, otherLeadId: d1.id, matchType: 'PHONE_EXACT', status: 'OPEN' },
    { organizationId: org, leadId: d4.id, otherLeadId: d3.id, matchType: 'PHONE_EXACT', status: 'DISMISSED', reviewedById: u.saurabh!.id, reviewedAt: atIST(addDaysStr(today, -4), 12, 0) },
  ] });
  for (const l of [d1, d2, d3, d4]) await prisma.task.create({ data: { organizationId: org, leadId: l.id, assignedToId: owner.id, createdById: u.saurabh!.id, teamId, type: 'CALL', title: 'First contact', dueAt: new Date(NOW.getTime() + 3 * HOUR), priority: 'NORMAL', createdAt: l.createdAt } });

  const lost = await prisma.lead.findMany({ where: { organizationId: org, stageCategory: 'LOST', createKey: { startsWith: 'sample-m1:' } }, take: 6, orderBy: { lostAt: 'asc' } });
  await prisma.reactivationEntry.createMany({ data: lost.map((l, i) => ({ organizationId: org, leadId: l.id, teamId: l.teamId, lostReason: l.lostReason, eligibleFrom: new Date((l.lostAt ?? NOW).getTime() + 14 * DAY), attempts: 0, status: (l.lostAt ?? NOW).getTime() + 14 * DAY < NOW.getTime() ? ('ELIGIBLE' as const) : ('PENDING' as const), openKey: l.id, assignedToId: i < 2 ? l.assignedToId : null })) });

  const stuck = await prisma.lead.findMany({ where: { organizationId: org, stageCategory: 'OPEN', noAnswerCount: { gte: 3 }, createKey: { startsWith: 'sample-m1:' } }, take: 3, orderBy: { noAnswerCount: 'desc' } });
  const nextTask = async (leadId: string) => (await prisma.task.findFirst({ where: { leadId, status: 'OPEN' }, select: { id: true } }))?.id ?? null;
  for (const l of stuck) await prisma.reassignmentQueueEntry.create({ data: { organizationId: org, leadId: l.id, taskId: await nextTask(l.id), reason: 'MANAGER_REVIEW', previousOwnerId: l.assignedToId, teamId: l.teamId, status: 'OPEN', openKey: l.id } });

  const big = await prisma.lead.findFirst({ where: { organizationId: org, stageCategory: 'OPEN', createKey: { startsWith: 'sample-m1:' }, estimatedValue: { gte: 400000 } } });
  const hot = await prisma.lead.findFirst({ where: { organizationId: org, stageCategory: 'OPEN', status: 'PROPOSAL_NEGOTIATION', createKey: { startsWith: 'sample-m1:' } } });
  const escs: Prisma.RelationshipEscalationCreateManyInput[] = [];
  if (big) escs.push({ organizationId: org, leadId: big.id, type: 'HIGH_VALUE', title: 'Elite programme enquiry, Rs 4,99,999', context: `Prospect wants an EMI plan and a written outcomes guarantee. ${T}`, blocker: 'Needs Founder approval on the payment plan', requestedHelp: 'Join the next call', status: 'IN_REVIEW', ownerId: u.teamlead!.id, createdById: big.assignedToId!, teamId: big.teamId, teamLeadId: u.teamlead!.id, founderInvolved: true, createdAt: atIST(addDaysStr(today, -2), 12, 0) });
  if (hot) escs.push({ organizationId: org, leadId: hot.id, type: 'COMPLEX_CONVERSATION', title: 'Corporate buyer asking for 12 seats', context: `Wants one invoice and a group discount. ${T}`, blocker: 'Group pricing is not defined', requestedHelp: 'Manager on the call', status: 'OPEN', ownerId: ctx.managerOf(execs.find((e) => e.id === hot.assignedToId)!.key).id, createdById: hot.assignedToId!, teamId: hot.teamId, founderInvolved: false, createdAt: atIST(addDaysStr(today, -1), 16, 0) });
  await prisma.relationshipEscalation.createMany({ data: escs });
  out.crmQueues = 4 + lost.length + stuck.length + escs.length;

  // ---- cross-team work, process gaps, insights, manager action items -----------------------------------------------------------------------------------------
  const due = (d: number) => new Date(NOW.getTime() + d * DAY);
  await prisma.xfTask.createMany({ data: [
    { organizationId: org, title: 'Webinar creatives for the Saturday AI Sprint', description: `Two banners and a reminder reel. ${T}`, kind: 'WEBINAR_PLANNING', department: 'MARKETING', requesterDepartment: 'SALES', ownerId: u.marketing!.id, requesterId: u.saurabh!.id, teamId: ctx.team.saurabh, priority: 2, dueAt: due(2), status: 'IN_PROGRESS' },
    { organizationId: org, title: 'Welcome kit for the new enrolments', description: `Send within 24 hours of payment. ${T}`, kind: 'HANDOFF', department: 'STUDENT_SUCCESS', requesterDepartment: 'SALES', ownerId: u.studentsuccess!.id, requesterId: u.prachi!.id, teamId: ctx.team.prachi, priority: 3, dueAt: due(1), status: 'OPEN' },
    { organizationId: org, title: 'Community invite links for the October cohort', description: `Share the invite links with Student Success. ${T}`, kind: 'TASK', department: 'COMMUNITY', requesterDepartment: 'SALES', ownerId: u.community!.id, requesterId: u.saurabh!.id, priority: 3, dueAt: due(-1), status: 'COMPLETED', completedAt: new Date(NOW.getTime() - 20 * HOUR), completionNote: 'Links shared.' },
    { organizationId: org, title: 'Which objections came up most this month?', description: `Pull the top objections from the CRM for the marketing script. ${T}`, kind: 'INSIGHT_REQUEST', department: 'SALES', requesterDepartment: 'MARKETING', ownerId: u.saurabh!.id, requesterId: u.marketing!.id, priority: 3, dueAt: due(4), status: 'OPEN' },
  ] });
  await prisma.processGap.createMany({ data: [
    { organizationId: org, kind: 'PROCESS_GAP', title: 'No standard reply for EMI questions', description: `Executives answer EMI questions differently. ${T}`, ownerId: u.saurabh!.id, reportedById: u.monica!.id, priority: 2, createdAt: atIST('2026-10-06', 12, 0) },
    { organizationId: org, kind: 'AUTOMATION', title: 'Auto-remind learners one hour before the demo', description: `Reminders are sent by hand today. ${T}`, ownerId: u.prachi!.id, reportedById: u.rajat!.id, priority: 3, createdAt: atIST('2026-10-09', 12, 0) },
  ] });
  await prisma.insight.createMany({ data: [
    { organizationId: org, authorId: u.saurabh!.id, kind: 'OBJECTION', title: 'Evening slots convert better than noon demos', body: `Demos at 6 pm had more attendees than noon demos this month. ${T}`, audience: ['MARKETING', 'SALES'], tags: ['demo', 'timing'] },
    { organizationId: org, authorId: u.prachi!.id, kind: 'OBJECTION', title: 'Learners ask for Marathi material', body: `Several enquiries came from Marathi-speaking learners. ${T}`, audience: ['MARKETING', 'COMMUNITY'], tags: ['language'] },
  ] });
  await prisma.actionItem.createMany({ data: [
    { organizationId: org, title: 'Share the weekly demo attendance report', description: `Send before Monday's huddle. ${T}`, ownerId: u.saurabh!.id, createdById: u.teamlead!.id, teamId: ctx.team.saurabh, dueAt: due(3), source: 'MANUAL' },
    { organizationId: org, title: 'Clear the overdue collection with the learner', description: `One instalment is past due. ${T}`, ownerId: u.prachi!.id, createdById: u.teamlead!.id, teamId: ctx.team.prachi, dueAt: due(2), source: 'MANUAL' },
  ] });
  out.crossTeam = 4 + 2 + 2 + 2;
  void r;
  return out;
}

/** One improvement plan for a fictitious employee (no login, Marketing role: not counted in any sales KPI). Re-runnable. */
async function fictionalEmployee(prisma: Ctx['prisma'], org: string, n: number, managerId: string) {
  const role = await prisma.role.findFirstOrThrow({ where: { key: 'MARKETING' } });
  const email = n === 1 ? 'sample.employee@coacheasily.local' : `sample.employee${n}@coacheasily.local`;
  const name = n === 1 ? 'Sample Employee (fictional)' : `Sample Employee ${n} (fictional)`;
  const joined = '2026-03-02';
  const emp = await prisma.user.upsert({ where: { email }, update: { name, managerId, isActive: true }, create: { organizationId: org, email, name, passwordHash: null, managerId, createdAt: dateOnly(joined) } });
  await prisma.userRoleAssignment.upsert({ where: { userId_roleId: { userId: emp.id, roleId: role.id } }, update: {}, create: { organizationId: org, userId: emp.id, roleId: role.id } });
  await prisma.employeeProfile.upsert({ where: { userId: emp.id }, update: {}, create: { organizationId: org, userId: emp.id, joinDate: dateOnly(joined), positionTitle: 'Marketing Executive (fictional)', employmentType: 'FULL_TIME' } });
  return emp;
}

export async function loadPip(prisma: Ctx['prisma'], org: string, teamleadId: string, founderId: string): Promise<number> {
  const T = SAMPLE_TAG;
  const emp = await fictionalEmployee(prisma, org, 1, teamleadId);
  await prisma.pipCheckpoint.deleteMany({ where: { organizationId: org } });
  await prisma.improvementPlan.deleteMany({ where: { organizationId: org, reason: { contains: T } } });
  const start = '2026-10-05';
  const pip = await prisma.improvementPlan.create({ data: {
    organizationId: org, employeeId: emp.id, createdById: teamleadId, status: 'ACTIVE', reason: `Weekly task completion and report quality were below the agreed level in September. ${T}`,
    kpiGaps: [{ key: 'task-completion', name: 'Weekly tasks completed on time', target: 90, actual: 62, unit: '%' }, { key: 'report-quality', name: 'Report completeness', target: 95, actual: 70, unit: '%' }] as unknown as Prisma.InputJsonValue,
    evidence: 'Illustrative figures for a fictional employee.',
    goals: [{ title: 'Complete 90% of weekly tasks on time', dueOn: '2026-11-04' }, { title: 'Reach 95% report completeness', dueOn: '2026-11-04' }] as unknown as Prisma.InputJsonValue,
    measures: [{ key: 'task-completion', target: 90, unit: '%' }, { key: 'report-quality', target: 95, unit: '%' }] as unknown as Prisma.InputJsonValue,
    durationDays: 30, startDate: dateOnly(start), endDate: dateOnly(addDaysStr(start, 30)), approvedById: founderId, approvedAt: atIST('2026-10-04', 17, 0), employeeAcknowledgedAt: atIST('2026-10-05', 11, 0), createdAt: atIST('2026-10-03', 15, 0),
  } });
  await prisma.pipCheckpoint.createMany({ data: [7, 14, 21, 30].map((d, i) => ({ organizationId: org, pipId: pip.id, dueDate: dateOnly(addDaysStr(start, d)), title: `Week ${i + 1} check-in`, status: i === 0 ? ('DONE' as const) : ('PENDING' as const), notes: i === 0 ? 'Improved on task completion; report quality still to improve.' : null, completedAt: i === 0 ? atIST(addDaysStr(start, 7), 12, 0) : null })) });
  return 1;
}

/** Illustrative incentive structure (DRAFT, never approved) and September recommendations for four fictional employees. Re-runnable. */
export async function loadIncentives(prisma: Ctx['prisma'], org: string, teamleadId: string, founderId: string): Promise<number> {
  const T = SAMPLE_TAG;
  await prisma.incentiveAdjustment.deleteMany({ where: { organizationId: org } });
  await prisma.incentiveRecommendation.deleteMany({ where: { organizationId: org } });
  await prisma.incentivePolicy.deleteMany({ where: { organizationId: org, name: { contains: 'sample data' } } });
  const versionNumber = ((await prisma.incentivePolicy.aggregate({ where: { organizationId: org }, _max: { versionNumber: true } }))._max.versionNumber ?? 0) + 1;
  const policy = await prisma.incentivePolicy.create({ data: {
    organizationId: org, versionNumber, name: 'Illustrative incentive structure (sample data, NOT approved, not real rates)', status: 'DRAFT', createdById: founderId,
    notes: `Illustration only so the incentive pages can be exercised. The Founder must supply and approve real rates (DEC-015). ${T}`,
    structure: { basis: 'COLLECTION', periodType: 'MONTH', slabMode: 'FLAT_ON_TOTAL', netOfRefunds: true, slabs: [{ minPct: 0, maxPct: 80, ratePct: 0 }, { minPct: 80, maxPct: 100, ratePct: 1 }, { minPct: 100, maxPct: null, ratePct: 2 }], gates: [], cap: null, clawbackWindowDays: 30, currency: 'INR' } as unknown as Prisma.InputJsonValue,
  } });
  const target = 400000;
  const collected = [520000, 410000, 330000, 250000];
  const statuses = ['APPROVED', 'SUBMITTED', 'SUBMITTED', 'CALCULATED'] as const;
  for (let i = 0; i < collected.length; i++) {
    const emp = await fictionalEmployee(prisma, org, i + 2, teamleadId);
    const pct = (collected[i]! / target) * 100;
    const rate = pct >= 100 ? 2 : pct >= 80 ? 1 : 0;
    const amount = Math.round((collected[i]! * rate) / 100);
    const status = statuses[i]!;
    await prisma.incentiveRecommendation.create({ data: {
      organizationId: org, policyId: policy.id, employeeId: emp.id, periodStart: dateOnly('2026-09-01'), periodEnd: dateOnly('2026-09-30'), status,
      inputs: { collected: collected[i], target, achievementPct: Math.round(pct * 10) / 10, note: 'Fictional figures' } as unknown as Prisma.InputJsonValue, inputSource: 'MANUAL',
      breakdown: { ratePct: rate, basis: 'COLLECTION', note: 'Illustrative slab' } as unknown as Prisma.InputJsonValue, computedAmount: amount, approvedAmount: status === 'APPROVED' ? amount : null,
      recommendedById: teamleadId, submittedAt: status === 'CALCULATED' ? null : atIST('2026-10-06', 12, 0), decidedById: status === 'APPROVED' ? founderId : null, decidedAt: status === 'APPROVED' ? atIST('2026-10-08', 15, 0) : null, createdAt: atIST('2026-10-05', 12, 0),
    } });
  }
  return collected.length;
}
