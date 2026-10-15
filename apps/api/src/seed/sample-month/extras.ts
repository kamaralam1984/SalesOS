import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { forecastBounds, stageWeightedForecast, FORECAST_METHOD } from '../../modules/revenue/calc';
import { addDaysStr, atIST, dateOnly, DAY, HOUR, istDay, istMidnight, MIN, rng } from './shared';
import { SAMPLE_TAG, type Ctx } from './setup';

/** Forecast history, learner satisfaction, closed action items and live notifications - every figure read from the tables written earlier. */
export async function loadExtras(ctx: Ctx): Promise<Record<string, number>> {
  const { prisma, org, u } = ctx;
  const r = rng(321);
  const NOW = new Date();
  const today = istDay(NOW);
  const out: Record<string, number> = {};
  const rupees = (n: number) => `Rs ${Math.round(n).toLocaleString('en-IN')}`;

  // ---- forecast history: period-start ESTIMATES vs the actual outcome (feeds forecast accuracy / weekly forecast KPIs) ----------------------------
  const actualBetween = async (fromDay: string, toDayExcl: string) => {
    const a = await prisma.salesRecord.aggregate({ where: { organizationId: org, closedAt: { gte: istMidnight(fromDay), lt: istMidnight(toDayExcl) } }, _sum: { saleValue: true } });
    return Number(a._sum.saleValue ?? 0);
  };
  const snap = async (type: 'WEEK' | 'MONTH', anchor: string, takenAt: Date, estimate: number, by: string) => {
    const b = forecastBounds(type, anchor);
    const exists = await prisma.forecast.findFirst({ where: { organizationId: org, periodType: type, periodStart: dateOnly(b.startsOn), scopeKey: 'ORG' } });
    const f = exists ?? (await prisma.forecast.create({ data: { organizationId: org, periodType: type, periodStart: dateOnly(b.startsOn), periodEnd: dateOnly(b.endsOn), scopeKey: 'ORG', method: FORECAST_METHOD, params: {}, createdById: by } }));
    await prisma.forecastSnapshot.create({ data: { organizationId: org, forecastId: f.id, kind: 'PERIOD_START', takenAt, takenById: by, total: Math.round(estimate), bookedToDate: 0, weightedPipeline: Math.round(estimate), unweightedPipeline: Math.round(estimate * 1.8), breakdown: { byStage: {}, byOwner: {}, unscheduled: 0, overdue: 0 } as unknown as Prisma.InputJsonValue, inputs: { method: FORECAST_METHOD, asOf: istDay(takenAt), sample: true } as unknown as Prisma.InputJsonValue } });
  };
  const sept = await actualBetween('2026-09-01', '2026-10-01');
  await snap('MONTH', '2026-09-01', atIST('2026-09-01', 9, 30), sept * 0.9, u.teamlead!.id);
  let weeklyN = 0;
  const thisWeek = forecastBounds('WEEK', today).startsOn;
  for (let w = '2026-09-07'; w < thisWeek; w = addDaysStr(w, 7)) {
    const act = await actualBetween(w, addDaysStr(w, 7));
    await snap('WEEK', w, atIST(w, 9, 30), act * (0.8 + r.next() * 0.35), u.teamlead!.id);
    weeklyN += 1;
  }
  // current week: stage-weighted estimate from the real open pipeline
  const openD = await prisma.deal.findMany({ where: { organizationId: org, stage: { in: ['OPEN', 'NEGOTIATION', 'PAYMENT_PENDING'] } }, include: { lead: { select: { status: true } } } });
  const fb = forecastBounds('WEEK', today);
  const booked = await prisma.salesRecord.aggregate({ where: { organizationId: org, closedAt: { gte: istMidnight(fb.startsOn) } }, _sum: { saleValue: true } });
  const fr = stageWeightedForecast({ periodStart: fb.startsOn, periodEnd: fb.endsOn, asOf: today, bookedToDate: booked._sum.saleValue ?? 0n, deals: openD.map((d) => ({ id: d.id, ownerId: d.ownerId, amount: d.amount, stage: d.stage, leadStatus: d.lead.status, expectedCloseOn: d.expectedCloseOn ? d.expectedCloseOn.toISOString().slice(0, 10) : null })) });
  const wk = await prisma.forecast.create({ data: { organizationId: org, periodType: 'WEEK', periodStart: dateOnly(fb.startsOn), periodEnd: dateOnly(fb.endsOn), scopeKey: 'ORG', method: FORECAST_METHOD, params: {}, createdById: u.teamlead!.id } });
  await prisma.forecastSnapshot.create({ data: { organizationId: org, forecastId: wk.id, kind: 'PERIOD_START', takenById: u.teamlead!.id, total: fr.total, bookedToDate: fr.bookedToDate, weightedPipeline: fr.weightedPipeline, unweightedPipeline: fr.unweightedPipeline, breakdown: { byStage: fr.byStage, byOwner: fr.byOwner, unscheduled: fr.unscheduled, overdue: fr.overdue } as unknown as Prisma.InputJsonValue, inputs: { method: FORECAST_METHOD, asOf: today, sample: true } as unknown as Prisma.InputJsonValue } });
  out.forecasts = weeklyN + 3;

  // ---- learner satisfaction on completed / acknowledged handovers --------------------------------------------------------------------------------
  const tpl = await prisma.surveyTemplate.upsert({
    where: { organizationId_key: { organizationId: org, key: 'csat-after-enrolment' } }, update: {},
    create: { organizationId: org, key: 'csat-after-enrolment', name: 'Satisfaction after enrolment', kind: 'CSAT', questions: [{ id: 'q1', text: 'How satisfied are you with your enrolment experience so far?', type: 'SCALE_5' }] as unknown as Prisma.InputJsonValue, createdById: u.studentsuccess!.id },
  });
  const hand = await prisma.handoverRecord.findMany({ where: { organizationId: org, status: { in: ['COMPLETED', 'ACKNOWLEDGED'] }, specialNotes: SAMPLE_TAG } });
  const resp: Prisma.SatisfactionResponseCreateManyInput[] = [];
  for (const h of hand) {
    if (!r.chance(0.7)) continue;
    const at = new Date(Math.min(NOW.getTime() - HOUR, (h.completedAt ?? h.acknowledgedAt ?? NOW).getTime() + r.int(1, 3) * DAY));
    resp.push({ organizationId: org, templateId: tpl.id, templateVersion: tpl.version, kind: 'CSAT', leadId: h.leadId, dealId: h.dealId, handoverId: h.id, programId: h.programId, respondentName: h.learnerName, score: r.weighted([[5, 45], [4, 35], [3, 12], [2, 6], [1, 2]] as const), answers: [] as unknown as Prisma.InputJsonValue, comment: r.chance(0.3) ? 'Smooth onboarding, thank you.' : null, consentGiven: true, consentAt: at, channel: 'MANUAL', respondedAt: at, capturedById: u.studentsuccess!.id, ownerId: h.ownerId });
  }
  await prisma.satisfactionResponse.createMany({ data: resp });
  out.satisfactionResponses = resp.length;

  // ---- action items closed in September (feeds the Founder completion KPI) ---------------------------------------------------------------------------
  const items: Array<[string, string, string, boolean]> = [
    ['Publish the September weekly sales review pack', '2026-09-12', '2026-09-11', true],
    ['Fix the Saturday webinar reminder flow with Marketing', '2026-09-19', '2026-09-22', false],
    ['Share the objection-handling playbook with all executives', '2026-09-26', '2026-09-25', true],
  ];
  await prisma.actionItem.createMany({ data: items.map(([title, due, done, onTime]) => ({ organizationId: org, title, description: `From the weekly Founder review. ${SAMPLE_TAG}`, ownerId: u.teamlead!.id, createdById: u.founder!.id, dueAt: atIST(due, 18, 0), status: 'COMPLETED' as const, completedAt: atIST(done, 16, 0), completionNote: 'Done and shared with the team.', completedOnTime: onTime, source: 'REVIEW' as const, createdAt: atIST(addDaysStr(due, -7), 11, 0) })) });
  out.actionItemsDone = items.length;

  // ---- live notifications from current state --------------------------------------------------------------------------------------------------
  const n: Prisma.NotificationCreateManyInput[] = [];
  const add = (userKey: string, type: string, severity: 'INFO' | 'WARNING' | 'CRITICAL', title: string, body: string, url: string, hoursAgo = r.int(1, 20)) => {
    const when = new Date(NOW.getTime() - hoursAgo * HOUR);
    n.push({ id: randomUUID(), organizationId: org, userId: u[userKey]!.id, type, severity, title, body, actionUrl: url, dedupeKey: `sample:${type}:${userKey}`, createdAt: when, lastRaisedAt: when });
  };
  for (const e of ctx.execs) {
    const overdue = await prisma.task.count({ where: { organizationId: org, assignedToId: e.id, status: 'OPEN', dueAt: { lt: NOW } } });
    const dueToday = await prisma.task.count({ where: { organizationId: org, assignedToId: e.id, status: 'OPEN', dueAt: { gte: NOW, lt: istMidnight(addDaysStr(today, 1)) } } });
    if (dueToday) add(e.key, 'follow_up.due', 'INFO', `${dueToday} follow-up${dueToday > 1 ? 's' : ''} due today`, 'Open your task list and clear them before 6 pm.', '/crm/tasks');
    if (overdue) add(e.key, 'follow_up.overdue', 'WARNING', `${overdue} follow-up${overdue > 1 ? 's are' : ' is'} overdue`, 'Call these leads first today.', '/crm/overdue');
  }
  for (const m of [u.saurabh!, u.prachi!]) {
    const ids = ctx.execs.filter((e) => ctx.managerOf(e.key).key === m.key).map((e) => e.id);
    const overdue = await prisma.task.count({ where: { organizationId: org, assignedToId: { in: ids }, status: 'OPEN', dueAt: { lt: NOW } } });
    if (overdue) add(m.key, 'follow_up.overdue', 'WARNING', `${overdue} overdue follow-up${overdue > 1 ? 's' : ''} in your team`, 'Review with the executives in the morning huddle.', '/crm/overdue');
  }
  const oct = istMidnight('2026-10-01');
  const teamRev: Record<string, number> = {};
  for (const m of [u.saurabh!, u.prachi!]) {
    const ids = ctx.execs.filter((e) => ctx.managerOf(e.key).key === m.key).map((e) => e.id);
    const c = await prisma.salesCredit.findMany({ where: { organizationId: org, userId: { in: ids }, salesRecord: { closedAt: { gte: oct } } }, select: { amount: true } });
    teamRev[m.key] = c.reduce((s, x) => s + Number(x.amount), 0);
  }
  const weak = teamRev.prachi! < teamRev.saurabh! ? u.prachi! : u.saurabh!;
  const weakTarget = Number((await prisma.target.findFirst({ where: { organizationId: org, ownerUserId: weak.id, metric: 'REVENUE', period: { startsOn: dateOnly('2026-10-01') } } }))?.amount ?? 0);
  const weakPct = weakTarget ? Math.round((teamRev[weak.key]! / weakTarget) * 100) : 0;
  add(weak.key, 'target.at_risk', 'WARNING', `Team ${weak.name.split(' ')[0]} is at ${weakPct}% of the October revenue target`, `${rupees(teamRev[weak.key]!)} booked of ${rupees(weakTarget)} at mid-month.`, '/revenue/targets');
  add('teamlead', 'target.at_risk', 'WARNING', `Team ${weak.name.split(' ')[0]} is at ${weakPct}% of the October revenue target`, 'Agree a recovery plan with the manager.', '/revenue/targets');
  add('founder', 'target.at_risk', 'WARNING', `Team ${weak.name.split(' ')[0]} is behind the October revenue target`, `${weakPct}% of target at mid-month.`, '/dashboard/founder');
  const pendingActions = await prisma.actionItem.count({ where: { organizationId: org, ownerId: u.founder!.id, status: { in: ['OPEN', 'IN_PROGRESS'] } } });
  if (pendingActions) add('founder', 'founder.action_item', 'WARNING', `${pendingActions} action item${pendingActions > 1 ? 's' : ''} awaiting your decision`, 'Requisition approval is waiting in your queue.', '/collaboration');
  const pendingReviews = await prisma.performanceReview.count({ where: { organizationId: org, status: 'SUBMITTED' } });
  if (pendingReviews) { add('teamlead', 'review.pending', 'INFO', `${pendingReviews} performance review${pendingReviews > 1 ? 's' : ''} awaiting your approval`, 'September reviews have been submitted.', '/people/reviews'); add('hr', 'review.pending', 'INFO', `${pendingReviews} September review${pendingReviews > 1 ? 's' : ''} not yet approved`, 'Follow up with the reviewers.', '/people/reviews'); }
  add('hr', 'probation.review_due', 'INFO', 'Simran Patil: day-60 probation review is due tomorrow', 'Schedule the review with Prachi.', '/people/probation', 3);
  const submitted = await prisma.handoverRecord.count({ where: { organizationId: org, status: { in: ['SUBMITTED', 'INFO_REQUESTED'] } } });
  if (submitted) add('studentsuccess', 'handover.pending', 'INFO', `${submitted} handover${submitted > 1 ? 's' : ''} waiting for acknowledgement`, 'Learners enrolled recently are waiting to be onboarded.', '/cx/handovers');
  const openComplaints = await prisma.complaint.count({ where: { organizationId: org, status: { in: ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'ESCALATED', 'REOPENED'] } } });
  if (openComplaints) add('studentsuccess', 'complaint.updated', 'WARNING', `${openComplaints} open complaint${openComplaints > 1 ? 's' : ''}`, 'Check the SLA clock on each.', '/cx/complaints');
  const overduePay = await prisma.payment.findMany({ where: { organizationId: org, status: 'EXPECTED', dueDate: { lt: dateOnly(today) } }, select: { amount: true } });
  if (overduePay.length) add('finance', 'collection.status_changed', 'WARNING', `${overduePay.length} instalment${overduePay.length > 1 ? 's' : ''} overdue (${rupees(overduePay.reduce((s, p) => s + Number(p.amount), 0))})`, 'Follow up with the owners and record payment once received.', '/revenue/collections');
  const refundsOpen = await prisma.refund.count({ where: { organizationId: org, status: { in: ['REQUESTED', 'APPROVED'] } } });
  if (refundsOpen) add('finance', 'refund.status_changed', 'INFO', `${refundsOpen} refund${refundsOpen > 1 ? 's' : ''} pending`, 'One awaits approval and one awaits processing.', '/revenue/refunds');
  await prisma.notification.createMany({ data: n, skipDuplicates: true });
  out.notifications = n.length;
  void MIN;
  return out;
}
