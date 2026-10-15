import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { buildOrgFixture, createUser, type OrgFixture } from '../helpers';

/** IST wall-clock -> instant. */
export const ist = (date: string, time = '10:00'): Date => new Date(`${date}T${time}:00+05:30`);
const uuid = () => randomUUID();

export const WINDOW = { from: '2026-07-01', to: '2026-07-31' } as const;

type LeadSpec = {
  k: string; owner: string | null; team: string | null; status: string; cat: 'OPEN' | 'WON' | 'LOST' | 'NURTURE'; created: Date; source: 'S1' | 'S2'; program: 'P1' | 'P2';
  wonAt?: Date; lostReason?: string; nextAction?: Date; lastActivity?: Date; firstContact?: Date; assignedAt?: Date; merged?: string; noContact?: boolean;
};

/**
 * Deterministic analytics fixture. Every expected value in kpi.spec.ts is hand-computed from THIS data; change a row here and the
 * hand calculation next to the assertion must change too.
 * Window: July 2026 (IST). "Now" is the real clock, so point-in-time KPIs only use rows that are old (stale) or far-future.
 */
export async function buildAnalyticsFixture(prisma: PrismaClient) {
  const f: OrgFixture = await buildOrgFixture(prisma);
  const org = f.org.id;
  // everyone joined long before the window (new-joiner exclusions must not hide the fixture)
  await prisma.user.updateMany({ where: { organizationId: org }, data: { createdAt: new Date('2026-01-01T00:00:00Z') } });
  const u = { founder: f.founder.id, tl: f.teamLead.id, mA: f.managerA.id, mB: f.managerB.id, a1: f.execA1.id, a2: f.execA2.id, b1: f.execB1.id, b2: f.execB2.id, admin: f.admin.id, hr: f.hr.id, finance: f.finance.id };
  const tA = f.teamA.id;
  const tB = f.teamB.id;

  const sources = { S1: uuid(), S2: uuid() };
  const programs = { P1: uuid(), P2: uuid() };
  await prisma.leadSource.createMany({ data: [{ id: sources.S1, organizationId: org, name: 'Meta Ads' }, { id: sources.S2, organizationId: org, name: 'Referral' }] });
  await prisma.program.createMany({ data: [{ id: programs.P1, organizationId: org, code: 'CBAX', name: 'CBAX' }, { id: programs.P2, organizationId: org, code: 'MCAX', name: 'MCA X' }] });

  const specs: LeadSpec[] = [
    { k: 'L1', owner: u.a1, team: tA, status: 'WON', cat: 'WON', created: ist('2026-07-06', '10:00'), source: 'S1', program: 'P1', wonAt: ist('2026-07-16'), firstContact: ist('2026-07-06', '10:30') },
    { k: 'L2', owner: u.a1, team: tA, status: 'CONNECTED', cat: 'OPEN', created: ist('2026-07-06', '18:30'), source: 'S1', program: 'P1', nextAction: new Date('2099-01-01T00:00:00Z'), lastActivity: new Date(Date.now() - 2 * 86_400_000), firstContact: ist('2026-07-07', '09:30') },
    { k: 'L3', owner: u.a1, team: tA, status: 'LOST', cat: 'LOST', created: ist('2026-07-06', '12:00'), source: 'S2', program: 'P2', lostReason: 'PRICE', firstContact: ist('2026-07-06', '12:05') },
    { k: 'L4', owner: u.a1, team: tA, status: 'CONTACT_ATTEMPTED', cat: 'OPEN', created: ist('2026-07-04', '18:50'), source: 'S2', program: 'P1', lastActivity: new Date(Date.now() - 2 * 86_400_000), firstContact: ist('2026-07-06', '09:10') },
    { k: 'L5', owner: u.a2, team: tA, status: 'WON', cat: 'WON', created: ist('2026-07-02', '11:00'), source: 'S1', program: 'P1', wonAt: new Date(ist('2026-07-02', '11:00').getTime() + 70 * 86_400_000) },
    { k: 'L6', owner: u.a2, team: tA, status: 'NEW', cat: 'OPEN', created: ist('2026-07-08', '11:00'), source: 'S2', program: 'P2', noContact: true },
    { k: 'L7', owner: u.a2, team: tA, status: 'LOST', cat: 'LOST', created: ist('2026-07-08', '12:00'), source: 'S2', program: 'P2', lostReason: 'NOT_ELIGIBLE' },
    { k: 'L8', owner: u.b1, team: tB, status: 'WON', cat: 'WON', created: ist('2026-07-07', '09:00'), source: 'S1', program: 'P1', wonAt: ist('2026-07-12'), assignedAt: ist('2026-07-07', '11:00'), firstContact: ist('2026-07-07', '11:20') },
    { k: 'L9', owner: u.b1, team: tB, status: 'NEW', cat: 'OPEN', created: ist('2026-07-09', '11:00'), source: 'S2', program: 'P2' },
    { k: 'L10', owner: u.b2, team: tB, status: 'NEW', cat: 'OPEN', created: ist('2026-07-09', '12:00'), source: 'S1', program: 'P2', nextAction: new Date('2099-01-01T00:00:00Z'), lastActivity: new Date(Date.now() - 86_400_000) },
    { k: 'L11', owner: u.b2, team: tB, status: 'NEW', cat: 'OPEN', created: ist('2026-07-09', '13:00'), source: 'S2', program: 'P2', merged: 'L10' },
    { k: 'L12', owner: null, team: null, status: 'NEW', cat: 'OPEN', created: ist('2026-07-10', '10:00'), source: 'S1', program: 'P1' },
  ];
  const lead: Record<string, string> = {};
  for (const s of specs) lead[s.k] = uuid();
  await prisma.lead.createMany({
    data: specs.map((s) => ({
      id: lead[s.k]!, organizationId: org, fullName: `Lead ${s.k}`, phoneE164: s.noContact ? null : `+9199000000${s.k.replace('L', '').padStart(2, '0')}`, phoneRaw: s.noContact ? null : '9900000000', phoneValid: !s.noContact,
      email: null, sourceId: sources[s.source], programId: programs[s.program], assignedToId: s.owner, teamId: s.team, status: s.status, stageCategory: s.cat,
      nextActionAt: s.nextAction ?? null, wonValue: s.wonAt ? '1.00' : null, wonAt: s.wonAt ?? null, lostReason: s.lostReason ?? null, lastActivityAt: s.lastActivity ?? null,
      firstContactAt: s.firstContact ?? null, assignedAt: s.assignedAt ?? s.created, mergedIntoId: s.merged ? lead[s.merged]! : null, createdAt: s.created,
    })),
  });

  // ---- status history (funnel "ever reached")
  const hist = (l: string, from: string | null, to: string, cat: 'OPEN' | 'WON' | 'LOST', at: string) => ({ organizationId: org, leadId: lead[l]!, oldStatus: from, newStatus: to, oldCategory: 'OPEN' as const, newCategory: cat, createdAt: ist(at) });
  await prisma.leadStatusHistory.createMany({
    data: [
      hist('L1', 'NEW', 'CONTACT_ATTEMPTED', 'OPEN', '2026-07-06'), hist('L1', 'CONTACT_ATTEMPTED', 'CONNECTED', 'OPEN', '2026-07-07'), hist('L1', 'CONNECTED', 'WON', 'WON', '2026-07-16'),
      hist('L2', 'NEW', 'CONTACT_ATTEMPTED', 'OPEN', '2026-07-07'), hist('L2', 'CONTACT_ATTEMPTED', 'CONNECTED', 'OPEN', '2026-07-08'),
      hist('L8', 'NEW', 'CONNECTED', 'OPEN', '2026-07-08'), hist('L8', 'CONNECTED', 'WON', 'WON', '2026-07-12'),
    ],
  });

  // ---- calls (July IST). c13 is 00:30 IST on Aug 1 and must NOT count in July.
  const call = (user: string, l: string, outcome: string, at: Date, source: 'MANUAL' | 'PROVIDER' = 'MANUAL') => ({ organizationId: org, leadId: lead[l]!, userId: user, source, outcome: outcome as 'CONNECTED', startedAt: at });
  await prisma.callLog.createMany({
    data: [
      call(u.a1, 'L1', 'CONNECTED', ist('2026-07-06', '10:30')), call(u.a1, 'L1', 'NO_ANSWER', ist('2026-07-06', '11:00')), call(u.a1, 'L2', 'NO_ANSWER', ist('2026-07-07', '09:30')),
      call(u.a1, 'L3', 'FAILED', ist('2026-07-06', '12:05')), call(u.a1, 'L4', 'CALLBACK', ist('2026-07-06', '09:10'), 'PROVIDER'),
      call(u.a2, 'L5', 'CONNECTED', ist('2026-07-03')), call(u.a2, 'L5', 'BUSY', ist('2026-07-04')), call(u.a2, 'L6', 'LOST', ist('2026-07-09')),
      call(u.b1, 'L8', 'WON', ist('2026-07-07', '11:20')), call(u.b1, 'L9', 'SWITCHED_OFF', ist('2026-07-10')),
      call(u.b2, 'L10', 'NO_ANSWER', ist('2026-07-10')), call(u.b2, 'L10', 'CONNECTED', ist('2026-07-31', '23:30')), call(u.b2, 'L10', 'CONNECTED', ist('2026-08-01', '00:30')),
    ],
  });

  // ---- tasks
  const task = (owner: string, l: string, type: string, due: Date, status: 'OPEN' | 'DONE' | 'CANCELLED', completed?: Date, team?: string) => ({ organizationId: org, leadId: lead[l]!, assignedToId: owner, teamId: team ?? null, type: type as 'FOLLOW_UP', title: `${type} ${l}`, dueAt: due, status, completedAt: completed ?? null });
  await prisma.task.createMany({
    data: [
      task(u.a1, 'L1', 'FOLLOW_UP', ist('2026-07-08', '10:00'), 'DONE', ist('2026-07-08', '09:00')), // t1 on time
      task(u.a1, 'L2', 'CALLBACK', ist('2026-07-09', '10:00'), 'DONE', ist('2026-07-10', '10:00')), // t2 late
      task(u.a1, 'L2', 'FOLLOW_UP', ist('2026-07-20', '10:00'), 'OPEN'), // t3 overdue open
      task(u.a1, 'L1', 'CALL', ist('2026-07-08', '12:00'), 'DONE', ist('2026-07-08', '12:30')), // t4 wrong type
      task(u.a1, 'L3', 'EMAIL', ist('2026-07-21', '10:00'), 'CANCELLED'), // t5 cancelled
      task(u.a2, 'L5', 'FOLLOW_UP', ist('2026-07-11', '10:00'), 'DONE', ist('2026-07-11', '08:00')), // t6 on time
      task(u.a2, 'L6', 'DEMO', ist('2026-07-15', '10:00'), 'OPEN'), // t7 overdue open
      task(u.b1, 'L8', 'FOLLOW_UP', ist('2026-07-12', '10:00'), 'DONE', ist('2026-07-12', '09:00')), // t8 on time
      task(u.b1, 'L9', 'FOLLOW_UP', ist('2026-08-05', '10:00'), 'DONE', ist('2026-07-30', '10:00')), // t9 completed in July, due in Aug
      task(u.a1, 'L4', 'FOLLOW_UP', new Date('2099-01-01T00:00:00Z'), 'OPEN'), // t10 future open (gives L4 a next action)
    ],
  });

  // ---- events / attendance
  const webinar = uuid();
  const demo = uuid();
  await prisma.crmEvent.createMany({
    data: [
      { id: webinar, organizationId: org, type: 'WEBINAR', title: 'AI Sprint', programId: programs.P1, startsAt: ist('2026-07-10', '18:00'), status: 'COMPLETED' },
      { id: demo, organizationId: org, type: 'DEMO', title: 'CBAX demo', programId: programs.P1, startsAt: ist('2026-07-14', '18:00'), status: 'COMPLETED' },
    ],
  });
  const att = (ev: string, l: string, status: string, joined?: Date) => ({ organizationId: org, eventId: ev, leadId: lead[l]!, status: status as 'ATTENDED', joinedAt: joined ?? null });
  await prisma.eventAttendance.createMany({
    data: [
      att(webinar, 'L1', 'ATTENDED', ist('2026-07-10', '18:05')), att(webinar, 'L2', 'ATTENDED', ist('2026-07-10', '18:05')), att(webinar, 'L3', 'NO_SHOW'), att(webinar, 'L9', 'ATTENDED', ist('2026-07-10', '18:05')), att(webinar, 'L12', 'FOLLOWED_UP', ist('2026-07-10', '18:05')),
      att(demo, 'L8', 'ATTENDED', ist('2026-07-14', '18:05')), att(demo, 'L5', 'ATTENDED', ist('2026-07-14', '18:05')), att(demo, 'L6', 'REGISTERED'),
    ],
  });

  // ---- deals + sales
  const deals: Record<string, string> = {};
  const sale = async (k: string, l: string, program: 'P1' | 'P2', owner: string, value: string, closed: Date, credits: Array<[string, string, string]>) => {
    deals[k] = uuid();
    await prisma.deal.create({ data: { id: deals[k]!, organizationId: org, leadId: lead[l]!, programId: programs[program], ownerId: owner, stage: 'WON', amount: value, closedAt: closed, createdById: owner } });
    const sr = await prisma.salesRecord.create({ data: { organizationId: org, dealId: deals[k]!, leadId: lead[l]!, programId: programs[program], dealType: 'NEW', saleValue: value, closedAt: closed, createdById: owner } });
    await prisma.salesCredit.createMany({ data: credits.map(([user, pct, amount]) => ({ salesRecordId: sr.id, organizationId: org, userId: user, sharePct: pct, amount })) });
    return sr.id;
  };
  await sale('D1', 'L1', 'P1', u.a1, '100000.00', ist('2026-07-16'), [[u.a1, '100.00', '100000.00']]);
  const sr2 = await sale('D2', 'L8', 'P1', u.b1, '60000.00', ist('2026-07-12'), [[u.b1, '100.00', '60000.00']]);
  await sale('D3', 'L5', 'P2', u.a2, '50000.00', ist('2026-07-20'), [[u.a2, '60.00', '30000.00'], [u.a1, '40.00', '20000.00']]);
  await sale('D4', 'L10', 'P1', u.b2, '20000.00', new Date('2026-07-31T18:00:00Z'), [[u.b2, '100.00', '20000.00']]); // 23:30 IST on Jul 31
  await sale('D5', 'L10', 'P1', u.b2, '99999.00', new Date('2026-07-31T19:00:00Z'), [[u.b2, '100.00', '99999.00']]); // 00:30 IST Aug 1: outside July
  await sale('D6', 'L1', 'P1', u.a1, '80000.00', ist('2026-06-15'), [[u.a1, '100.00', '80000.00']]); // previous period
  const adj = (sr: string, deal: string, delta: string, status: 'APPROVED' | 'PENDING', owner: string) => ({ organizationId: org, salesRecordId: sr, dealId: deals[deal]!, delta, reason: 'fixture', status, creditAllocations: [{ userId: owner, amount: delta }], createdById: u.founder });
  await prisma.saleAdjustment.createMany({ data: [adj(sr2, 'D2', '-5000.00', 'APPROVED', u.b1), adj(sr2, 'D2', '-1000.00', 'PENDING', u.b1)] });

  // ---- payments (VERIFIED/RECONCILED count) and refunds
  const pay = (deal: string, owner: string, status: string, amount: string, verified?: Date) => ({ organizationId: org, dealId: deals[deal]!, ownerId: owner, status: status as 'VERIFIED', amount, verifiedAt: verified ?? null, provider: 'MANUAL', externalTransactionRef: uuid() });
  await prisma.payment.createMany({
    data: [
      pay('D1', u.a1, 'VERIFIED', '60000.00', ist('2026-07-18')), pay('D1', u.a1, 'RECORDED', '40000.00'), pay('D2', u.b1, 'RECONCILED', '30000.00', ist('2026-07-13')),
      pay('D3', u.a2, 'VERIFIED', '50000.00', ist('2026-07-22')), pay('D4', u.b2, 'VERIFIED', '20000.00', ist('2026-07-31', '23:00')), pay('D2', u.b1, 'VERIFIED', '5000.00', ist('2026-08-02')), pay('D2', u.b1, 'EXPECTED', '10000.00'),
    ],
  });
  const refund = (deal: string, owner: string, status: string, amount: string, requested: Date, extra: Record<string, unknown> = {}) => ({ organizationId: org, dealId: deals[deal]!, ownerId: owner, status: status as 'APPROVED', amount, reasonCategory: 'LEARNER_REQUEST' as const, reason: 'fixture', requestedById: owner, requestedAt: requested, ...extra });
  await prisma.refund.createMany({
    data: [
      refund('D1', u.a1, 'APPROVED', '12000.00', ist('2026-07-18'), { approvedAmount: '10000.00', approvedAt: ist('2026-07-20') }), // R1
      refund('D3', u.a2, 'REQUESTED', '5000.00', ist('2026-07-21')), // R2 ignored
      refund('D2', u.b1, 'PROCESSED', '3000.00', ist('2026-07-10'), { approvedAmount: '3000.00', approvedAt: ist('2026-07-14'), processedAmount: '3000.00', processedAt: ist('2026-07-25') }), // R3
      refund('D6', u.a1, 'PROCESSED', '8000.00', ist('2026-06-20'), { approvedAmount: '8000.00', approvedAt: ist('2026-06-21'), processedAmount: '8000.00', processedAt: ist('2026-06-25') }), // R4
    ],
  });

  // ---- open pipeline
  const od = (k: string, l: string, owner: string, stage: 'OPEN' | 'NEGOTIATION' | 'PAYMENT_PENDING', amount: string, expected: string | null, hv = false) => ({ id: uuid(), organizationId: org, leadId: lead[l]!, programId: programs.P1, ownerId: owner, stage, amount, expectedCloseOn: expected ? new Date(`${expected}T00:00:00Z`) : null, isHighValue: hv, createdById: owner, note: k });
  await prisma.deal.createMany({ data: [od('DO1', 'L2', u.a1, 'OPEN', '40000.00', '2026-10-30', true), od('DO2', 'L6', u.a2, 'NEGOTIATION', '100000.00', '2026-09-01'), od('DO3', 'L9', u.b1, 'PAYMENT_PENDING', '20000.00', null)] });

  // ---- targets (July 2026 month)
  const period = await prisma.targetPeriod.create({ data: { organizationId: org, type: 'MONTH', label: 'Jul 2026', startsOn: new Date('2026-07-01T00:00:00Z'), endsOn: new Date('2026-07-31T00:00:00Z') } });
  const tgt = async (metric: 'REVENUE' | 'COLLECTION' | 'ENROLMENT', level: 'FOUNDER' | 'TEAM_LEAD' | 'MANAGER' | 'EXECUTIVE', owner: string, amount: string, parent: string | null, team: string | null = null) => {
    const t = await prisma.target.create({ data: { organizationId: org, periodId: period.id, metric, level, ownerUserId: owner, amount, originalAmount: amount, parentId: parent, teamId: team, createdById: u.founder } });
    await prisma.targetRevision.create({ data: { organizationId: org, targetId: t.id, seq: 0, newAmount: amount, reason: 'initial', status: 'APPROVED', effectiveFrom: new Date('2026-07-01T00:00:00Z'), proposedById: u.founder } });
    return t.id;
  };
  const tf = await tgt('REVENUE', 'FOUNDER', u.founder, '300000.00', null);
  const ttl = await tgt('REVENUE', 'TEAM_LEAD', u.tl, '300000.00', tf);
  const tmA = await tgt('REVENUE', 'MANAGER', u.mA, '150000.00', ttl, tA);
  const tmB = await tgt('REVENUE', 'MANAGER', u.mB, '150000.00', ttl, tB);
  await tgt('REVENUE', 'EXECUTIVE', u.a1, '80000.00', tmA, tA);
  await tgt('REVENUE', 'EXECUTIVE', u.a2, '70000.00', tmA, tA);
  await tgt('REVENUE', 'EXECUTIVE', u.b1, '80000.00', tmB, tB);
  await tgt('REVENUE', 'EXECUTIVE', u.b2, '70000.00', tmB, tB);
  await tgt('COLLECTION', 'FOUNDER', u.founder, '150000.00', null);
  await tgt('ENROLMENT', 'FOUNDER', u.founder, '10', null);

  // ---- forecasts (period-start snapshots)
  const fc = async (type: 'MONTH' | 'WEEK', start: string, end: string, total: string, kind: 'PERIOD_START' | 'ADHOC' = 'PERIOD_START') => {
    const forecast = await prisma.forecast.create({ data: { organizationId: org, periodType: type, periodStart: new Date(`${start}T00:00:00Z`), periodEnd: new Date(`${end}T00:00:00Z`), scopeKey: 'ORG', method: 'STAGE_WEIGHTED_V1', params: {}, createdById: u.founder } });
    await prisma.forecastSnapshot.create({ data: { organizationId: org, forecastId: forecast.id, kind, takenById: u.founder, total, bookedToDate: '0.00', weightedPipeline: total, unweightedPipeline: total, breakdown: {}, inputs: {} } });
  };
  await fc('MONTH', '2026-07-01', '2026-07-31', '200000.00');
  await fc('MONTH', '2026-06-01', '2026-06-30', '100000.00');
  await fc('WEEK', '2026-07-13', '2026-07-19', '55000.00');

  // ---- people: coaching hours, SOP, attrition, engagement
  const sess = (coach: string, date: string, mins: number) => ({ organizationId: org, coachId: coach, sessionDate: ist(date), durationMin: mins, createdById: coach });
  await prisma.coachingSession.createMany({ data: [sess(u.mA, '2026-07-08', 60), sess(u.mA, '2026-07-15', 45), sess(u.tl, '2026-07-20', 30)] });
  const oo = (mgr: string, emp: string, date: string, status: 'HELD' | 'SCHEDULED') => ({ organizationId: org, managerId: mgr, employeeId: emp, status, scheduledFor: ist(date), durationMin: 30, createdById: mgr });
  await prisma.oneOnOne.createMany({ data: [oo(u.mA, u.a1, '2026-07-09', 'HELD'), oo(u.mB, u.b1, '2026-07-10', 'HELD'), oo(u.mA, u.a2, '2026-07-11', 'SCHEDULED')] });

  const docAll = uuid();
  const docExec = uuid();
  const docOpt = uuid();
  await prisma.sopDocument.createMany({
    data: [
      { id: docAll, organizationId: org, category: 'LEAD_HANDLING', title: 'Lead handling', ownerId: u.tl, isMandatory: true, audienceRoles: [], createdById: u.tl },
      { id: docExec, organizationId: org, category: 'FOLLOW_UP_CADENCE', title: 'Follow-up cadence', ownerId: u.tl, isMandatory: true, audienceRoles: ['SALES_EXECUTIVE'], createdById: u.tl },
      { id: docOpt, organizationId: org, category: 'OTHER', title: 'Optional playbook', ownerId: u.tl, isMandatory: false, audienceRoles: [], createdById: u.tl },
    ] as never,
  });
  const ver = (doc: string) => ({ id: uuid(), organizationId: org, documentId: doc, versionNumber: 1, title: 'v1', body: 'body', status: 'APPROVED' as const, effectiveDate: new Date('2026-01-01T00:00:00Z'), createdById: u.tl, approvedById: u.founder, approvedAt: new Date('2026-01-01T00:00:00Z') });
  const v1 = ver(docAll);
  const v2 = ver(docExec);
  const v3 = ver(docOpt);
  await prisma.sopVersion.createMany({ data: [v1, v2, v3] });
  const ack = (v: { id: string }, doc: string, user: string) => ({ organizationId: org, versionId: v.id, documentId: doc, userId: user });
  await prisma.sopAcknowledgement.createMany({ data: [ack(v1, docAll, u.founder), ack(v1, docAll, u.a1), ack(v1, docAll, u.a2), ack(v2, docExec, u.a1), ack(v2, docExec, u.b1)] });

  // attrition: three leavers (inactive), profile exit dates in July
  const leaver = async (exit: string, type: 'VOLUNTARY' | 'INVOLUNTARY' | 'TRANSFER') => {
    const x = await createUser(prisma, f.org, { roles: ['SALES_EXECUTIVE'], managerId: u.mA, isActive: false });
    await prisma.user.update({ where: { id: x.id }, data: { createdAt: new Date('2026-01-01T00:00:00Z'), deactivatedAt: new Date(`${exit}T10:00:00Z`) } });
    await prisma.employeeProfile.create({ data: { organizationId: org, userId: x.id, joinDate: new Date('2026-01-01T00:00:00Z'), exitDate: new Date(`${exit}T00:00:00Z`), exitType: type } });
    return x.id;
  };
  await leaver('2026-07-20', 'VOLUNTARY');
  await leaver('2026-07-25', 'INVOLUNTARY');
  await leaver('2026-07-28', 'TRANSFER');

  const survey = await prisma.engagementSurvey.create({ data: { organizationId: org, title: 'July pulse', questions: [{ id: 'q1', text: 'Q1', type: 'SCALE_5' }, { id: 'q2', text: 'Q2', type: 'SCALE_5' }], createdById: u.hr } });
  const small = await prisma.engagementSurvey.create({ data: { organizationId: org, title: 'Tiny pulse', questions: [{ id: 'q1', text: 'Q1', type: 'SCALE_5' }], createdById: u.hr } });
  const resp = (s: string, a: Record<string, number>) => ({ organizationId: org, surveyId: s, answers: a, respondedOn: new Date('2026-07-15T00:00:00Z') });
  await prisma.engagementResponse.createMany({ data: [resp(survey.id, { q1: 5, q2: 4 }), resp(survey.id, { q1: 4, q2: 4 }), resp(survey.id, { q1: 3, q2: 5 }), resp(survey.id, { q1: 5, q2: 5 }), resp(survey.id, { q1: 4, q2: 3 }), resp(small.id, { q1: 1 }), resp(small.id, { q1: 1 }), resp(small.id, { q1: 1 })] });

  // ---- CX
  const sat = (kind: 'CSAT' | 'NPS' | 'ENROLMENT_EXPERIENCE', score: number, owner: string, date: string, outside = false) => ({ organizationId: org, kind, score, ownerId: owner, respondedAt: ist(date), consentGiven: true, consentAt: ist(date), capturedById: owner, outsideWindow: outside, respondentRef: uuid() });
  await prisma.satisfactionResponse.createMany({
    data: [
      sat('CSAT', 5, u.a1, '2026-07-05'), sat('CSAT', 4, u.a1, '2026-07-06'), sat('CSAT', 4, u.a2, '2026-07-07'), sat('CSAT', 3, u.a2, '2026-07-08'), sat('CSAT', 5, u.b1, '2026-07-09'), sat('CSAT', 2, u.b2, '2026-07-10'),
      sat('NPS', 10, u.a1, '2026-07-05'), sat('NPS', 9, u.a2, '2026-07-06'), sat('NPS', 7, u.b1, '2026-07-07'), sat('NPS', 3, u.b2, '2026-07-08'),
      sat('ENROLMENT_EXPERIENCE', 5, u.a1, '2026-07-09'), sat('ENROLMENT_EXPERIENCE', 4, u.a2, '2026-07-10'), sat('ENROLMENT_EXPERIENCE', 1, u.b1, '2026-07-11', true),
    ],
  });
  const cmp = (owner: string, created: string, status: string, extra: Record<string, unknown> = {}) => ({ organizationId: org, title: 'complaint', description: 'fixture', category: 'SERVICE', priority: 'P3' as const, status: status as 'OPEN', ownerId: owner, createdById: owner, firstResponseDueAt: ist(created), resolutionDueAt: ist(created), createdAt: ist(created, '09:00'), ...extra });
  await prisma.complaint.createMany({
    data: [
      cmp(u.a1, '2026-07-05', 'OPEN'),
      cmp(u.a2, '2026-07-10', 'RESOLVED', { resolvedAt: ist('2026-07-12', '09:00'), resolvedWithinSla: true }),
      cmp(u.b1, '2026-07-15', 'CLOSED', { createdAt: ist('2026-07-15', '10:00'), resolvedAt: ist('2026-07-16', '10:00'), resolvedWithinSla: false }),
      cmp(u.a1, '2026-07-12', 'RESOLVED', { resolvedAt: ist('2026-07-13', '09:00'), closedAsInvalid: true }),
      cmp(u.a2, '2026-06-30', 'RESOLVED', { createdAt: new Date('2026-06-29T00:00:00Z'), resolvedAt: ist('2026-07-02'), resolvedWithinSla: true }),
      cmp(u.a2, '2026-07-25', 'RESOLVED', { resolvedAt: ist('2026-08-05', '09:00'), resolvedWithinSla: true }),
    ],
  });
  const ai = (owner: string, due: string, status: 'OPEN' | 'COMPLETED' | 'CANCELLED', completed?: string) => ({ organizationId: org, title: 'action', ownerId: owner, createdById: u.founder, dueAt: ist(due, '18:00'), status, completedAt: completed ? ist(completed, '12:00') : null, completedOnTime: completed ? ist(completed, '12:00') <= ist(due, '18:00') : null });
  await prisma.actionItem.createMany({ data: [ai(u.a1, '2026-07-10', 'COMPLETED', '2026-07-09'), ai(u.a2, '2026-07-12', 'COMPLETED', '2026-07-14'), ai(u.mA, '2026-07-20', 'OPEN'), ai(u.a1, '2026-07-22', 'CANCELLED'), ai(u.a1, '2026-07-25', 'COMPLETED', '2026-07-24')] });
  const rep = (type: 'WEEKLY', start: string, end: string, due: string, status: 'DRAFT' | 'PUBLISHED', published: string | null, completeness: number | null, rating: number | null, version = 1) => ({ organizationId: org, type, periodStart: new Date(`${start}T00:00:00Z`), periodEnd: new Date(`${end}T00:00:00Z`), versionNumber: version, status, title: 'weekly', authorId: u.tl, dueAt: ist(due, '10:00'), publishedAt: published ? ist(published.split(' ')[0]!, published.split(' ')[1]) : null, completenessPct: completeness, rating, onTime: published ? ist(published.split(' ')[0]!, published.split(' ')[1]) <= ist(due, '10:00') : null });
  await prisma.founderReport.createMany({
    data: [
      rep('WEEKLY', '2026-07-06', '2026-07-12', '2026-07-13', 'PUBLISHED', '2026-07-13 09:00', 100, 4),
      rep('WEEKLY', '2026-07-13', '2026-07-19', '2026-07-20', 'PUBLISHED', '2026-07-21 09:00', 75, null),
      rep('WEEKLY', '2026-07-20', '2026-07-26', '2026-07-27', 'DRAFT', null, null, null),
      rep('WEEKLY', '2026-07-06', '2026-07-12', '2026-07-13', 'PUBLISHED', '2026-07-14 09:00', 25, 1, 2),
    ],
  });
  await prisma.kpiReconciliationRun.createMany({
    data: [
      { organizationId: org, trigger: 'SCHEDULED', periodStart: new Date('2026-07-01T00:00:00Z'), periodEnd: new Date('2026-07-15T00:00:00Z'), totalChecks: 8, passed: 8, failed: 0, skipped: 1, checks: [], durationMs: 10, ranAt: ist('2026-07-15', '03:00') },
      { organizationId: org, trigger: 'SCHEDULED', periodStart: new Date('2026-07-01T00:00:00Z'), periodEnd: new Date('2026-07-20T00:00:00Z'), totalChecks: 10, passed: 9, failed: 1, skipped: 0, checks: [], durationMs: 10, ranAt: ist('2026-07-20', '03:00') },
    ],
  });

  return { ...f, ids: { ...u, tA, tB, lead, deals, programs, sources, period: period.id, docAll, docExec } };
}
export type AnalyticsFixture = Awaited<ReturnType<typeof buildAnalyticsFixture>>;
