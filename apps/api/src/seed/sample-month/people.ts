import type { Prisma } from '@prisma/client';
import { addDaysStr, atIST, dateOnly, DAY, HOUR, istDay, istDow, istMidnight, MIN, rng } from './shared';
import { SAMPLE_TAG, type Ctx, type Person } from './setup';

/**
 * HR / performance data. Every number is read back from the CRM + revenue tables written by crm-revenue.ts (never invented), so the
 * scorecards, reviews, KRA assignments and coaching shown to HR line up with what managers and the Founder see on their dashboards.
 */
const WEEK_TARGET = { calls: 100, followUps: 90, onTimePct: 90, enrolments: 1 };

interface Act { calls: number; connected: number; followUps: number; onTimePct: number; leads: number; enrolments: number; revenue: number }

export async function loadPeople(ctx: Ctx): Promise<Record<string, number>> {
  const { prisma, org, u, execs } = ctx;
  const r = rng(77);
  const NOW = new Date();
  const today = istDay(NOW);
  const founder = u.founder!;
  const teamlead = u.teamlead!;
  const out: Record<string, number> = {};

  // plain names for the reference rows the earlier loader prefixed with [DEMO]
  for (const k of await prisma.kpiDefinition.findMany({ where: { organizationId: org, name: { startsWith: '[DEMO] ' } } })) await prisma.kpiDefinition.update({ where: { id: k.id }, data: { name: k.name.slice(7) } });
  for (const k of await prisma.recognitionProgram.findMany({ where: { organizationId: org, name: { startsWith: '[DEMO] ' } } })) await prisma.recognitionProgram.update({ where: { id: k.id }, data: { name: k.name.slice(7) } });
  const kdef = new Map((await prisma.kpiDefinition.findMany({ where: { organizationId: org } })).map((k) => [k.key, k]));

  // ---- actuals from the CRM ---------------------------------------------------------------------------------------------------
  const actuals = async (userIds: string[], fromDay: string, toDayExcl: string): Promise<Act> => {
    const from = istMidnight(fromDay);
    const to = istMidnight(toDayExcl);
    const [calls, connected, done, leads, credits] = await Promise.all([
      prisma.callLog.count({ where: { organizationId: org, userId: { in: userIds }, startedAt: { gte: from, lt: to } } }),
      prisma.callLog.count({ where: { organizationId: org, userId: { in: userIds }, startedAt: { gte: from, lt: to }, outcome: { in: ['CONNECTED', 'CALLBACK', 'WON', 'LOST'] } } }),
      prisma.task.findMany({ where: { organizationId: org, assignedToId: { in: userIds }, status: 'DONE', type: { in: ['FOLLOW_UP', 'CALLBACK'] }, completedAt: { gte: from, lt: to } }, select: { dueAt: true, completedAt: true } }),
      prisma.lead.count({ where: { organizationId: org, assignedToId: { in: userIds }, createdAt: { gte: from, lt: to }, createKey: { startsWith: 'sample-m1:' } } }),
      prisma.salesCredit.findMany({ where: { organizationId: org, userId: { in: userIds }, salesRecord: { closedAt: { gte: from, lt: to } } }, select: { amount: true } }),
    ]);
    const onTime = done.filter((t) => t.completedAt! <= t.dueAt).length;
    return { calls, connected, followUps: done.length, onTimePct: done.length ? Math.round((onTime / done.length) * 100) : 0, leads, enrolments: credits.length, revenue: credits.reduce((s, c) => s + Number(c.amount), 0) };
  };
  const targetFor = async (userId: string, metric: 'REVENUE' | 'ENROLMENT', month: string) => {
    const t = await prisma.target.findFirst({ where: { organizationId: org, ownerUserId: userId, metric, period: { startsOn: dateOnly(month) } } });
    return t ? Number(t.amount) : 0;
  };
  const team = (m: Person) => execs.filter((e) => ctx.managerOf(e.key).key === m.key);
  const rupees = (n: number) => `Rs ${Math.round(n).toLocaleString('en-IN')}`;

  // ---- weeks (Mon..Sun) from the first Monday on/before 1 Sep ----------------------------------------------------------------------
  const weeks: string[] = [];
  for (let d = '2026-08-31'; d <= today; d = addDaysStr(d, 7)) weeks.push(d);
  const everyone = [...execs, u.saurabh!, u.prachi!];

  // ---- KRA / KPI assignments (weekly) + scorecards ----------------------------------------------------------------------------------
  const KPI_ITEMS = (monthlyRevTarget: number) => [
    { definitionId: kdef.get('calls-completed')?.id, key: 'calls-completed', name: 'Calls completed', kind: 'KPI', target: WEEK_TARGET.calls, unit: 'count' },
    { definitionId: kdef.get('followups-completed')?.id, key: 'followups-completed', name: 'Follow-ups completed', kind: 'KPI', target: WEEK_TARGET.followUps, unit: 'count' },
    { definitionId: kdef.get('crm-compliance')?.id, key: 'crm-compliance', name: 'Follow-ups on time', kind: 'KPI', target: WEEK_TARGET.onTimePct, unit: '%' },
    { definitionId: kdef.get('revenue-achievement')?.id, key: 'revenue-achievement', name: 'Weekly revenue', kind: 'KPI', target: Math.round(monthlyRevTarget / 4.3), unit: 'INR' },
    { definitionId: kdef.get('pipeline-hygiene')?.id, key: 'pipeline-hygiene', name: 'Keep every lead attended and ageing monitored', kind: 'KRA', unit: '', notes: 'No lead without an owner and next action' },
  ];
  const MGR_ITEMS = (monthlyRevTarget: number) => [
    { definitionId: kdef.get('revenue-achievement')?.id, key: 'revenue-achievement', name: 'Team weekly revenue', kind: 'KPI', target: Math.round(monthlyRevTarget / 4.3), unit: 'INR' },
    { definitionId: kdef.get('coaching-hours')?.id, key: 'coaching-hours', name: 'Coaching hours conducted', kind: 'KPI', target: 4, unit: 'hours' },
    { definitionId: kdef.get('sop-adoption')?.id, key: 'sop-adoption', name: 'SOP adoption in the team', kind: 'KPI', target: 95, unit: '%' },
    { definitionId: kdef.get('team-development')?.id, key: 'team-development', name: 'Develop executives through weekly coaching and 1:1s', kind: 'KRA', unit: '' },
  ];
  const assignments: Prisma.KpiAssignmentCreateManyInput[] = [];
  const scorecards: Prisma.ScorecardCreateManyInput[] = [];
  const weekly: Record<string, Act[]> = {};
  for (const p of everyone) {
    const isMgr = p.role === 'SALES_MANAGER';
    const ids = isMgr ? team(p).map((e) => e.id) : [p.id];
    const setBy = isMgr ? teamlead : ctx.managerOf(p.key);
    weekly[p.key] = [];
    for (const w of weeks) {
      if (p.join > addDaysStr(w, 6)) continue; // not employed yet that week
      const month = w.slice(0, 7) + '-01';
      const monthStart = w < '2026-10-01' ? '2026-09-01' : '2026-10-01';
      const monthTarget = await targetFor(p.id, 'REVENUE', monthStart);
      void month;
      assignments.push({ organizationId: org, assigneeId: p.id, weekStart: dateOnly(w), items: (isMgr ? MGR_ITEMS(monthTarget) : KPI_ITEMS(monthTarget)) as unknown as Prisma.InputJsonValue, setById: setBy.id, createdAt: atIST(w, 9, 30) });
      const end = addDaysStr(w, 7);
      const a = await actuals(ids, w, end);
      weekly[p.key]!.push(a);
      if (end <= addDaysStr(today, 1)) {
        const wkTarget = Math.round(monthTarget / 4.3);
        const inputs = isMgr
          ? [
              { key: 'revenue-achievement', name: 'Team weekly revenue', target: wkTarget, actual: Math.round(a.revenue), unit: 'INR', source: 'MANUAL' },
              { key: 'calls-completed', name: 'Team calls completed', target: WEEK_TARGET.calls * ids.length, actual: a.calls, unit: 'count', source: 'MANUAL' },
              { key: 'crm-compliance', name: 'Team follow-ups on time', target: WEEK_TARGET.onTimePct, actual: a.onTimePct, unit: '%', source: 'MANUAL' },
            ]
          : [
              { key: 'calls-completed', name: 'Calls completed', target: WEEK_TARGET.calls, actual: a.calls, unit: 'count', source: 'MANUAL' },
              { key: 'followups-completed', name: 'Follow-ups completed', target: WEEK_TARGET.followUps, actual: a.followUps, unit: 'count', source: 'MANUAL' },
              { key: 'crm-compliance', name: 'Follow-ups on time', target: WEEK_TARGET.onTimePct, actual: a.onTimePct, unit: '%', source: 'MANUAL' },
              { key: 'revenue-achievement', name: 'Weekly revenue', target: wkTarget, actual: Math.round(a.revenue), unit: 'INR', source: 'MANUAL' },
            ];
        scorecards.push({ organizationId: org, subjectId: p.id, periodType: 'WEEK', periodStart: dateOnly(w), periodEnd: dateOnly(addDaysStr(w, 6)), inputs: inputs as unknown as Prisma.InputJsonValue, comments: `${a.enrolments} enrolment(s), ${a.leads} new lead(s) this week. ${SAMPLE_TAG}`, createdById: setBy.id, createdAt: atIST(end, 10, 0) });
      }
    }
  }
  await prisma.kpiAssignment.createMany({ data: assignments });
  out.kpiAssignments = assignments.length;

  // ---- September monthly review (+ October drafts) ----------------------------------------------------------------------------------
  const rubric = await prisma.reviewRubric.findMany({ where: { organizationId: org }, orderBy: { sortOrder: 'asc' } });
  const sept = { from: '2026-09-01', to: '2026-10-01' };
  const reviewRows: Prisma.PerformanceReviewCreateManyInput[] = [];
  const monthly: Record<string, { act: Act; revTarget: number; enrolTarget: number; achievement: number; rating: number }> = {};
  for (const p of everyone) {
    const isMgr = p.role === 'SALES_MANAGER';
    const ids = isMgr ? team(p).map((e) => e.id) : [p.id];
    const act = await actuals(ids, sept.from, sept.to);
    const revTarget = await targetFor(p.id, 'REVENUE', sept.from);
    const enrolTarget = await targetFor(p.id, 'ENROLMENT', sept.from);
    const achievement = revTarget ? act.revenue / revTarget : 0;
    const perf = 0.6 * Math.min(achievement, 1.2) / 1.2 + 0.4 * (act.onTimePct / 100);
    const rating = Math.max(1, Math.min(5, Math.round(1 + 4 * perf)));
    monthly[p.key] = { act, revTarget, enrolTarget, achievement, rating };
    const scores: Record<string, number> = {};
    for (const c of rubric) scores[c.key] = Math.max(1, Math.min(5, rating + r.int(-1, 1) + (c.key === 'coaching_ability' && isMgr ? 0 : 0)));
    const status = ({ monica: 'ACKNOWLEDGED', sushma: 'APPROVED', sarika: 'ACKNOWLEDGED', iyyanar: 'SUBMITTED', rajat: 'APPROVED', simran: 'SUBMITTED', saurabh: 'APPROVED', prachi: 'SUBMITTED' } as Record<string, 'ACKNOWLEDGED' | 'APPROVED' | 'SUBMITTED'>)[p.key]!;
    const reviewer = isMgr ? teamlead : ctx.managerOf(p.key);
    const approver = isMgr ? founder : teamlead;
    const pct = Math.round(achievement * 100);
    const strengths = act.onTimePct >= 85 ? `Disciplined follow-ups: ${act.onTimePct}% completed on time.` : `Consistent daily calling: ${act.calls} calls in the month.`;
    const improvements = achievement >= 1 ? 'Keep the pipeline full for October and share what worked with the team.' : pct >= 50 ? 'Convert more qualified leads at the proposal stage; practise price-objection handling.' : 'Needs focused coaching on objection handling and closing; weekly call reviews agreed.';
    reviewRows.push({
      organizationId: org, employeeId: p.id, reviewerId: reviewer.id, periodType: 'MONTH', periodStart: dateOnly(sept.from), periodEnd: dateOnly('2026-09-30'), status,
      kpiSummary: [
        { key: 'revenue-achievement', name: isMgr ? 'Team revenue vs target' : 'Revenue vs target', target: revTarget, actual: Math.round(act.revenue), unit: 'INR', note: `${pct}% of target` },
        { key: 'enrolments', name: 'Enrolments', target: enrolTarget, actual: act.enrolments, unit: 'count' },
        { key: 'calls-completed', name: 'Calls completed', actual: act.calls, unit: 'count' },
        { key: 'crm-compliance', name: 'Follow-ups on time', target: 90, actual: act.onTimePct, unit: '%' },
      ] as unknown as Prisma.InputJsonValue,
      competencyScores: scores as unknown as Prisma.InputJsonValue, rating, strengths, improvements,
      goals: achievement >= 1 ? `Reach ${rupees(revTarget * 1.25)} in October and coach a peer.` : `Reach ${rupees(revTarget * 1.25)} in October with weekly coaching support.`,
      employeeComment: status === 'ACKNOWLEDGED' ? 'Thanks, I agree with the review and will work on the goals.' : null,
      approvedById: status === 'SUBMITTED' ? null : approver.id, approvedAt: status === 'SUBMITTED' ? null : atIST('2026-10-05', 15, 0), acknowledgedAt: status === 'ACKNOWLEDGED' ? atIST('2026-10-07', 11, 30) : null, createdAt: atIST('2026-10-03', 12, 0),
    });
    // monthly scorecard mirrors the review inputs
    scorecards.push({ organizationId: org, subjectId: p.id, periodType: 'MONTH', periodStart: dateOnly(sept.from), periodEnd: dateOnly('2026-09-30'), inputs: [{ key: 'revenue-achievement', name: 'Revenue', target: revTarget, actual: Math.round(act.revenue), unit: 'INR', source: 'MANUAL' }, { key: 'enrolments', name: 'Enrolments', target: enrolTarget, actual: act.enrolments, unit: 'count', source: 'MANUAL' }, { key: 'crm-compliance', name: 'Follow-ups on time', target: 90, actual: act.onTimePct, unit: '%', source: 'MANUAL' }] as unknown as Prisma.InputJsonValue, comments: `September close. ${SAMPLE_TAG}`, createdById: reviewer.id, createdAt: atIST('2026-10-02', 18, 0) });
  }
  for (const e of execs) reviewRows.push({ organizationId: org, employeeId: e.id, reviewerId: ctx.managerOf(e.key).id, periodType: 'MONTH', periodStart: dateOnly('2026-10-01'), periodEnd: dateOnly('2026-10-31'), status: 'DRAFT', kpiSummary: [] as unknown as Prisma.InputJsonValue, competencyScores: {} as unknown as Prisma.InputJsonValue, createdAt: atIST('2026-10-12', 10, 0) });
  await prisma.performanceReview.createMany({ data: reviewRows });
  await prisma.scorecard.createMany({ data: scorecards });
  out.reviews = reviewRows.length;
  out.scorecards = scorecards.length;

  // ---- coaching sessions, actions, 1:1s ----------------------------------------------------------------------------------------------
  const TOPICS_BY: Record<string, Array<'OBJECTION_HANDLING' | 'CALL_QUALITY' | 'CLOSING' | 'CONSULTATIVE_SELLING' | 'NEGOTIATION' | 'CRM_USAGE' | 'PIPELINE_MANAGEMENT' | 'FORECASTING' | 'LEADERSHIP'>> = {
    simran: ['OBJECTION_HANDLING', 'CALL_QUALITY', 'CLOSING'], rajat: ['CLOSING', 'PIPELINE_MANAGEMENT', 'NEGOTIATION'], monica: ['CONSULTATIVE_SELLING', 'NEGOTIATION', 'OBJECTION_HANDLING'], sushma: ['CALL_QUALITY', 'CLOSING', 'CRM_USAGE'],
    sarika: ['CALL_QUALITY', 'OBJECTION_HANDLING', 'CRM_USAGE'], iyyanar: ['CRM_USAGE', 'CONSULTATIVE_SELLING', 'CALL_QUALITY'],
    saurabh: ['FORECASTING', 'LEADERSHIP', 'PIPELINE_MANAGEMENT'], prachi: ['LEADERSHIP', 'FORECASTING', 'PIPELINE_MANAGEMENT'],
  };
  const KINDS = ['COACHING', 'CALL_REVIEW', 'ROLE_PLAY', 'SCORECARD_REVIEW'] as const;
  let sessions = 0;
  let oneOnOnes = 0;
  const sessionActions = ['Practise the price-objection script on 5 calls', 'Re-listen to two lost calls and note the turning point', 'Update every lead with a next action before 6 pm', 'Prepare a demo follow-up checklist', 'Role-play the closing summary with a peer'];
  for (const wk of weeks) {
    if (wk > today) continue;
    for (const p of [...execs, u.saurabh!, u.prachi!]) {
      const isMgr = p.role === 'SALES_MANAGER';
      if (p.join > addDaysStr(wk, 6)) continue;
      const coach = isMgr ? teamlead : ctx.managerOf(p.key);
      const times = p.key === 'simran' && wk >= '2026-09-07' ? 2 : isMgr ? (weeks.indexOf(wk) % 2 === 0 ? 1 : 0) : 1;
      for (let i = 0; i < times; i++) {
        const day = addDaysStr(wk, i === 0 ? r.int(1, 3) : r.int(3, 5));
        const when = atIST(day, r.int(11, 17), r.pick([0, 15, 30, 45]));
        if (when > NOW) continue;
        const topics = [r.pick(TOPICS_BY[p.key]!), r.pick(TOPICS_BY[p.key]!)].filter((t, k, a) => a.indexOf(t) === k);
        const done = when < new Date(NOW.getTime() - 6 * DAY);
        await prisma.coachingSession.create({
          data: {
            organizationId: org, coachId: coach.id, kind: r.pick(KINDS), sessionDate: when, durationMin: r.pick([30, 45, 60]), topics, noteVisibility: 'PARTICIPANTS', createdById: coach.id, createdAt: when,
            notes: `Reviewed recent calls and agreed one practice focus for the week: ${topics[0]!.toLowerCase().replace('_', ' ')}. ${SAMPLE_TAG}`,
            participants: { create: [{ userId: p.id, organizationId: org }] },
            actions: { create: [{ organizationId: org, ownerId: p.id, title: r.pick(sessionActions), dueDate: new Date(when.getTime() + 5 * DAY), status: done ? 'DONE' : r.pick(['OPEN', 'IN_PROGRESS'] as const), completedAt: done ? new Date(when.getTime() + 4 * DAY) : null, createdById: coach.id, createdAt: when }] },
          },
        });
        sessions += 1;
      }
      // weekly 1:1 (managers fortnightly with the Team Lead)
      if (isMgr && weeks.indexOf(wk) % 2 === 1) continue;
      const day = addDaysStr(wk, 5);
      const at = atIST(day, 12, 0);
      const held = at < NOW;
      await prisma.oneOnOne.create({ data: { organizationId: org, managerId: coach.id, employeeId: p.id, status: held ? 'HELD' : 'SCHEDULED', scheduledFor: at, durationMin: 30, agenda: 'Weekly check-in: targets, pipeline blockers, support needed', sharedNotes: held ? `Reviewed the week's numbers and the next actions. ${SAMPLE_TAG}` : null, privateNotes: held ? `Manager note: watch workload and morale. ${SAMPLE_TAG}` : null, createdById: coach.id, createdAt: new Date(at.getTime() - 3 * DAY) } });
      oneOnOnes += 1;
    }
  }
  out.coachingSessions = sessions;
  out.oneOnOnes = oneOnOnes;

  // ---- recognition ----------------------------------------------------------------------------------------------------------------------
  const programs = new Map((await prisma.recognitionProgram.findMany({ where: { organizationId: org } })).map((p) => [p.key, p]));
  const topExec = [...execs].sort((a, b) => monthly[b.key]!.act.revenue - monthly[a.key]!.act.revenue)[0]!;
  const mostDisciplined = [...execs].sort((a, b) => monthly[b.key]!.act.onTimePct - monthly[a.key]!.act.onTimePct)[0]!;
  const rec: Prisma.RecognitionCreateManyInput[] = [];
  if (programs.get('top-performer')) rec.push({ organizationId: org, programId: programs.get('top-performer')!.id, recipientId: topExec.id, grantedById: teamlead.id, reason: `Highest September revenue in the team: ${rupees(monthly[topExec.key]!.act.revenue)} from ${monthly[topExec.key]!.act.enrolments} enrolment(s).`, periodLabel: 'September 2026', isPublic: true, createdAt: atIST('2026-10-02', 17, 0) });
  if (programs.get('ownership-award')) rec.push({ organizationId: org, programId: programs.get('ownership-award')!.id, recipientId: mostDisciplined.id, grantedById: founder.id, reason: `${monthly[mostDisciplined.key]!.act.onTimePct}% of follow-ups completed on time in September.`, periodLabel: 'September 2026', competencyKey: 'ownership', isPublic: true, createdAt: atIST('2026-10-03', 11, 0) });
  if (programs.get('learner-hero')) rec.push({ organizationId: org, programId: programs.get('learner-hero')!.id, recipientId: u.saurabh!.id, grantedById: u.studentsuccess!.id, reason: 'Stayed on a late call to help a learner choose the right batch.', periodLabel: 'September 2026', competencyKey: 'customer_first', isPublic: true, createdAt: atIST('2026-10-04', 16, 0) });
  await prisma.recognition.createMany({ data: rec });
  out.recognitions = rec.length;

  // ---- SOP acknowledgements ----------------------------------------------------------------------------------------------------------------
  const versions = await prisma.sopVersion.findMany({ where: { organizationId: org, status: 'APPROVED' }, select: { id: true, documentId: true, approvedAt: true } });
  const ackRows: Prisma.SopAcknowledgementCreateManyInput[] = [];
  for (const v of versions) {
    const base = (v.approvedAt ?? new Date(NOW.getTime() - 3 * HOUR)).getTime();
    for (const p of [...execs, u.saurabh!, u.prachi!, teamlead]) {
      const missing = (p.key === 'simran' && ackRows.filter((a) => a.userId === p.id).length >= 5) || (p.key === 'rajat' && ackRows.filter((a) => a.userId === p.id).length >= 6) || r.chance(0.06);
      if (missing) continue;
      ackRows.push({ organizationId: org, versionId: v.id, documentId: v.documentId, userId: p.id, acknowledgedAt: new Date(Math.min(NOW.getTime() - MIN, base + r.int(5, 70) * MIN)) });
    }
  }
  await prisma.sopAcknowledgement.createMany({ data: ackRows, skipDuplicates: true });
  out.sopAcknowledgements = ackRows.length;

  // ---- probation, onboarding ------------------------------------------------------------------------------------------------------------------
  await prisma.probationReview.deleteMany({ where: { organizationId: org } });
  const prob: Prisma.ProbationReviewCreateManyInput[] = [];
  for (const [p, cps] of [[u.simran!, [30, 60, 90]], [u.rajat!, [30, 60, 90]], [u.monica!, [30, 60, 90]], [u.sushma!, [30, 60, 90]], [u.iyyanar!, [30, 60, 90]]] as Array<[Person, number[]]>) {
    for (const day of cps) {
      const due = new Date(dateOnly(p.join).getTime() + day * DAY);
      const complete = due < NOW && due < dateOnly(today);
      const scores = Object.fromEntries(rubric.slice(0, 5).map((c) => [c.key, r.int(3, 5)]));
      prob.push({ organizationId: org, employeeId: p.id, checkpointDay: day, dueDate: due, status: complete ? 'COMPLETED' : 'SCHEDULED', outcome: complete ? (day === 90 ? 'CONFIRM' : 'ON_TRACK') : null, competencyScores: (complete ? scores : {}) as unknown as Prisma.InputJsonValue, notes: complete ? `Probation checkpoint day ${day}. ${SAMPLE_TAG}` : null, reviewerId: complete ? ctx.managerOf(p.key).id : null, completedAt: complete ? new Date(due.getTime() + DAY) : null });
    }
  }
  await prisma.probationReview.createMany({ data: prob });
  out.probationReviews = prob.length;

  const tpl = await prisma.onboardingTemplate.findFirst({ where: { organizationId: org, roleKey: 'SALES_EXECUTIVE' } });
  if (tpl) {
    const items = (tpl.items as unknown as Array<{ title: string; category: 'ONBOARDING' | 'TRAINING' | 'TOOLS' | 'CULTURE'; dueDay: number }>) ?? [];
    for (const p of [u.simran!, u.monica!, u.sushma!, u.iyyanar!]) {
      if (await prisma.onboardingPlan.findFirst({ where: { employeeId: p.id } })) continue;
      const start = dateOnly(p.join);
      const elapsed = (NOW.getTime() - start.getTime()) / DAY;
      const plan = await prisma.onboardingPlan.create({ data: { organizationId: org, employeeId: p.id, templateId: tpl.id, startDate: start, status: elapsed > 21 ? 'COMPLETED' : 'ACTIVE', createdById: u.hr!.id, createdAt: start } });
      await prisma.onboardingItem.createMany({ data: items.map((it) => { const due = new Date(start.getTime() + it.dueDay * DAY); const done = due < NOW; return { organizationId: org, planId: plan.id, title: it.title, category: it.category, dueDate: due, status: done ? ('DONE' as const) : ('PENDING' as const), completedAt: done ? new Date(due.getTime() - DAY + 10 * HOUR) : null, completedById: done ? u.hr!.id : null }; }) });
      out.onboardingItems = (out.onboardingItems ?? 0) + items.length;
    }
  }

  // ---- hiring: one open requisition for Prachi's team ------------------------------------------------------------------------------------------
  if (!(await prisma.requisition.findFirst({ where: { organizationId: org, notes: { contains: SAMPLE_TAG } } }))) {
    const req = await prisma.requisition.create({ data: { organizationId: org, title: 'Sales Executive (Telecaller) - Team Prachi', roleKey: 'SALES_EXECUTIVE', hiringManagerId: u.prachi!.id, teamId: ctx.team.prachi, headcount: 1, status: 'OPEN', targetDate: dateOnly('2026-11-15'), notes: `Backfill to grow Team Prachi to three executives. ${SAMPLE_TAG}`, createdById: u.hr!.id, createdAt: atIST('2026-09-20', 11, 0) } });
    const people: Array<[string, 'SCREENING' | 'INTERVIEW' | 'OFFER' | 'APPLIED', number, string]> = [['Neha Kapoor', 'OFFER', 3, 'Referral'], ['Vishal Rao', 'INTERVIEW', 2, 'Job portal'], ['Pallavi Sawant', 'INTERVIEW', 1, 'Job portal'], ['Imran Sheikh', 'SCREENING', 0, 'LinkedIn'], ['Reema Dutta', 'APPLIED', 2, 'Job portal']];
    for (const [name, stage, years, source] of people) {
      const cand = await prisma.candidate.create({ data: { organizationId: org, requisitionId: req.id, name, email: `${name.split(' ')[0]!.toLowerCase()}@example.invalid`, source, stage, educationLevel: "Bachelor's", experienceYears: years, industries: ['Education'], createdById: u.hr!.id, createdAt: atIST('2026-09-24', 12, 0) } });
      if (stage === 'INTERVIEW' || stage === 'OFFER') await prisma.interviewFeedback.create({ data: { organizationId: org, candidateId: cand.id, interviewerId: u.prachi!.id, round: 1, interviewAt: atIST('2026-10-06', 15, 0), recommendation: stage === 'OFFER' ? 'STRONG_YES' : 'YES', competencyScores: { communication: 4, customer_first: 4 } as unknown as Prisma.InputJsonValue, notes: `Clear communicator, good energy on the mock call. ${SAMPLE_TAG}` } });
    }
    out.candidates = people.length;
  }

  void istDow;
  return out;
}
