import type { Prisma } from '@prisma/client';
import { ensureRevenueGuards } from '../../modules/revenue/revenue-guards';
import { allocate, forecastBounds, istDate, periodBounds, stageWeightedForecast, FORECAST_METHOD } from '../../modules/revenue/calc';
import type { SeedContext } from './types';

/**
 * revenue demo data (Phase 4). Every record is labelled [DEMO]. Idempotent: natural keys / createKey `demo-rev:<n>`.
 * Deals, sales, payments and refunds are written directly (the seed bypasses the HTTP rules) but are internally
 * consistent: credits add up to the sale, verified collections never exceed the sale, refunds never exceed collections.
 * The numbers are invented for demonstration only and must never be shown as real.
 */
const day = 86_400_000;
const dateOnly = (s: string) => new Date(`${s}T00:00:00.000Z`);

export async function seedRevenue(ctx: SeedContext): Promise<void> {
  const { prisma, organizationId: org, userIds } = ctx;
  await ensureRevenueGuards(prisma);
  const uid = (local: string) => userIds.get(local)!;
  const programs = await prisma.program.findMany({ where: { organizationId: org, isActive: true }, orderBy: { sortOrder: 'asc' } });
  if (programs.length === 0 || !uid('founder')) return; // CRM seed provides the programs
  const prog = (code: string) => programs.find((p) => p.code === code) ?? programs[0]!;

  await prisma.revenueSettings.upsert({ where: { organizationId: org }, update: {}, create: { organizationId: org } });

  // ---- price versions (append-only) -----------------------------------------------------------------------------
  const prices: Array<[string, string]> = [['CBAX', '49999.00'], ['MCA_X', '149999.00'], ['MCA_ELITE_X', '499999.00']];
  for (const [code, amount] of prices) {
    const p = prog(code);
    await prisma.programPrice.createMany({ data: [{ organizationId: org, programId: p.id, amount, effectiveFrom: dateOnly('2026-04-01'), note: '[DEMO] launch price', createdById: uid('founder') }], skipDuplicates: true });
  }
  await prisma.programRevenueConfig.upsert({ where: { programId: prog('MCA_ELITE_X').id }, update: {}, create: { organizationId: org, programId: prog('MCA_ELITE_X').id, highValueThreshold: '300000.00', updatedById: uid('founder') } });

  // ---- targets: Founder -> Team Lead -> Manager -> Executive for the current month ------------------------------
  const today = istDate(new Date());
  const b = periodBounds('MONTH', today);
  const period = await prisma.targetPeriod.upsert({
    where: { organizationId_type_startsOn: { organizationId: org, type: 'MONTH', startsOn: dateOnly(b.startsOn) } },
    update: {},
    create: { organizationId: org, type: 'MONTH', label: `${b.label} [DEMO]`, startsOn: dateOnly(b.startsOn), endsOn: dateOnly(b.endsOn), createdById: uid('founder') },
  });
  const mkTarget = async (metric: 'REVENUE' | 'COLLECTION' | 'ENROLMENT', level: 'FOUNDER' | 'TEAM_LEAD' | 'MANAGER' | 'EXECUTIVE', owner: string, amount: string, parentId: string | null) => {
    const existing = await prisma.target.findUnique({ where: { periodId_metric_ownerUserId: { periodId: period.id, metric, ownerUserId: uid(owner) } } });
    if (existing) return existing;
    const t = await prisma.target.create({ data: { organizationId: org, periodId: period.id, metric, level, ownerUserId: uid(owner), parentId, amount, originalAmount: amount, note: '[DEMO] target', createdById: uid('founder') } });
    await prisma.targetRevision.create({ data: { organizationId: org, targetId: t.id, seq: 0, oldAmount: null, newAmount: amount, reason: '[DEMO] initial target', status: 'APPROVED', effectiveFrom: period.startsOn, proposedById: uid('founder'), decidedById: uid('founder'), decidedAt: new Date() } });
    return t;
  };
  for (const [metric, scale] of [['REVENUE', 1], ['COLLECTION', 0.8], ['ENROLMENT', 0]] as const) {
    const f = (n: number) => (metric === 'ENROLMENT' ? String(n) : (n * (scale as number)).toFixed(2));
    const root = await mkTarget(metric, 'FOUNDER', 'founder', f(metric === 'ENROLMENT' ? 40 : 2000000), null);
    const tl = await mkTarget(metric, 'TEAM_LEAD', 'teamlead', f(metric === 'ENROLMENT' ? 40 : 2000000), root.id);
    const mA = await mkTarget(metric, 'MANAGER', 'manager.a', f(metric === 'ENROLMENT' ? 24 : 1200000), tl.id);
    const mB = await mkTarget(metric, 'MANAGER', 'manager.b', f(metric === 'ENROLMENT' ? 16 : 800000), tl.id);
    for (let i = 1; i <= 5; i += 1) await mkTarget(metric, 'EXECUTIVE', `exec.a${i}`, f(metric === 'ENROLMENT' ? (i === 5 ? 4 : 5) : 240000), mA.id);
    for (let i = 1; i <= 4; i += 1) await mkTarget(metric, 'EXECUTIVE', `exec.b${i}`, f(metric === 'ENROLMENT' ? 4 : 200000), mB.id);
  }

  // ---- deals, sales, payments, refunds -----------------------------------------------------------------------------
  const marker = await prisma.deal.findFirst({ where: { organizationId: org, createKey: 'demo-rev:1' }, select: { id: true } });
  if (!marker) {
    const teamOf = async (local: string) => (await prisma.teamMembership.findFirst({ where: { userId: uid(local) }, select: { teamId: true } }))?.teamId ?? null;
    let n = 0;
    const mkLead = (owner: string, status: string, cat: 'OPEN' | 'WON', wonValue?: string, wonAt?: Date) =>
      teamOf(owner).then((teamId) => prisma.lead.create({ data: { organizationId: org, fullName: `[DEMO] Learner ${String(n + 1).padStart(3, '0')}`, assignedToId: uid(owner), teamId, status, stageCategory: cat, wonValue: wonValue ?? null, wonAt: wonAt ?? null, createKey: `demo-rev-lead:${n + 1}`, createdById: uid(owner) } }));
    const book = async (owner: string, programCode: string, amount: string, daysAgo: number, payments: Array<{ amount: string; status: 'VERIFIED' | 'RECORDED' | 'EXPECTED' | 'RECONCILED'; due?: string }>, opts: { dealType?: 'NEW' | 'UPSELL'; refund?: { amount: string; status: 'REQUESTED' | 'PROCESSED' | 'APPROVED' } } = {}) => {
      n += 1;
      const closedAt = new Date(Date.now() - daysAgo * day);
      const teamId = await teamOf(owner);
      const lead = await mkLead(owner, 'WON', 'WON', amount, closedAt);
      const program = prog(programCode);
      const deal = await prisma.deal.create({ data: { organizationId: org, leadId: lead.id, programId: program.id, ownerId: uid(owner), teamId, stage: 'WON', dealType: opts.dealType ?? 'NEW', amount, closedAt, note: '[DEMO] deal', createKey: `demo-rev:${n}`, createdById: uid(owner), createdAt: new Date(closedAt.getTime() - 5 * day) } });
      await prisma.dealStatusHistory.createMany({ data: [{ organizationId: org, dealId: deal.id, oldStage: null, newStage: 'OPEN', changedById: uid(owner), reason: '[DEMO] created' }, { organizationId: org, dealId: deal.id, oldStage: 'OPEN', newStage: 'WON', changedById: uid(owner), reason: '[DEMO] closed won' }] });
      const rec = await prisma.salesRecord.create({ data: { organizationId: org, dealId: deal.id, leadId: lead.id, programId: program.id, dealType: opts.dealType ?? 'NEW', saleValue: amount, closedAt, createdById: uid(owner) } });
      await prisma.salesCredit.create({ data: { salesRecordId: rec.id, organizationId: org, userId: uid(owner), sharePct: '100.00', amount: allocate(amount, [{ key: owner, pct: '100' }])[0]!.amount.toFixed(2) } });
      let k = 0;
      for (const p of payments) {
        k += 1;
        const verified = p.status === 'VERIFIED' || p.status === 'RECONCILED';
        const pay = await prisma.payment.create({
          data: {
            organizationId: org, dealId: deal.id, ownerId: uid(owner), teamId, status: p.status, amount: p.amount, expectedAmount: p.status === 'EXPECTED' ? p.amount : null, dueDate: p.due ? dateOnly(p.due) : null,
            method: p.status === 'EXPECTED' ? null : 'UPI', provider: 'MANUAL', externalTransactionRef: p.status === 'EXPECTED' ? null : `DEMO-UTR-${deal.id.slice(0, 8)}-${k}`, paidAt: p.status === 'EXPECTED' ? null : closedAt,
            recordedById: p.status === 'EXPECTED' ? null : uid('manager.a'), recordedAt: p.status === 'EXPECTED' ? null : closedAt, verifiedById: verified ? uid('finance') : null, verifiedAt: verified ? new Date(closedAt.getTime() + 3_600_000) : null,
            reconciledById: p.status === 'RECONCILED' ? uid('finance') : null, reconciledAt: p.status === 'RECONCILED' ? new Date() : null, statementRef: p.status === 'RECONCILED' ? '[DEMO] statement' : null, note: '[DEMO] payment',
          },
        });
        await prisma.paymentEvent.create({ data: { organizationId: org, paymentId: pay.id, fromStatus: null, toStatus: p.status, actorId: uid('finance'), actorRole: 'FINANCE', reason: '[DEMO]' } });
      }
      if (opts.refund) {
        const r = opts.refund;
        const refund = await prisma.refund.create({
          data: {
            organizationId: org, dealId: deal.id, ownerId: uid(owner), teamId, status: r.status, amount: r.amount, approvedAmount: r.status === 'REQUESTED' ? null : r.amount, processedAmount: r.status === 'PROCESSED' ? r.amount : null,
            reasonCategory: 'LEARNER_REQUEST', reason: '[DEMO] learner requested a refund', requestedById: uid(owner), requestedByRole: 'SALES_EXECUTIVE',
            approvedById: r.status === 'REQUESTED' ? null : uid('founder'), approvedByRole: r.status === 'REQUESTED' ? null : 'FOUNDER_CEO', approvedAt: r.status === 'REQUESTED' ? null : new Date(), reviewedById: r.status === 'REQUESTED' ? null : uid('manager.a'), reviewedByRole: r.status === 'REQUESTED' ? null : 'SALES_MANAGER', reviewedAt: r.status === 'REQUESTED' ? null : new Date(), reviewNote: r.status === 'REQUESTED' ? null : '[DEMO] checked', recommendation: r.status === 'REQUESTED' ? null : 'APPROVE',
            processedById: r.status === 'PROCESSED' ? uid('finance') : null, processedByRole: r.status === 'PROCESSED' ? 'FINANCE' : null, processedAt: r.status === 'PROCESSED' ? new Date() : null, processMethod: r.status === 'PROCESSED' ? 'BANK_TRANSFER' : null, externalRef: r.status === 'PROCESSED' ? `DEMO-RFND-${deal.id.slice(0, 8)}` : null,
          },
        });
        await prisma.refundEvent.create({ data: { organizationId: org, refundId: refund.id, fromStatus: null, toStatus: 'REQUESTED', actorId: uid(owner), actorRole: 'SALES_EXECUTIVE', reason: '[DEMO] learner requested a refund' } });
      }
      return deal;
    };
    const due = istDate(new Date(Date.now() + 10 * day));
    await book('exec.a1', 'CBAX', '49999.00', 1, [{ amount: '49999.00', status: 'VERIFIED' }]);
    await book('exec.a1', 'MCA_X', '149999.00', 2, [{ amount: '75000.00', status: 'VERIFIED' }, { amount: '74999.00', status: 'EXPECTED', due }]);
    await book('exec.a2', 'CBAX', '49999.00', 2, [{ amount: '49999.00', status: 'RECORDED' }]);
    await book('exec.a3', 'MCA_X', '149999.00', 3, [{ amount: '149999.00', status: 'RECONCILED' }], { refund: { amount: '10000.00', status: 'PROCESSED' } });
    await book('exec.a4', 'CBAX', '49999.00', 1, [{ amount: '49999.00', status: 'EXPECTED', due: istDate(new Date(Date.now() - 2 * day)) }]);
    await book('exec.b1', 'MCA_X', '149999.00', 4, [{ amount: '100000.00', status: 'VERIFIED' }, { amount: '49999.00', status: 'EXPECTED', due }], { refund: { amount: '5000.00', status: 'REQUESTED' } });
    await book('exec.b2', 'CBAX', '49999.00', 0, [{ amount: '49999.00', status: 'VERIFIED' }]);
    await book('exec.b3', 'MCA_ELITE_X', '499999.00', 5, [{ amount: '250000.00', status: 'VERIFIED' }, { amount: '249999.00', status: 'EXPECTED', due }]);
    await book('exec.a5', 'MCA_ELITE_X', '99999.00', 2, [{ amount: '99999.00', status: 'VERIFIED' }], { dealType: 'UPSELL' });

    // open pipeline: OPEN / NEGOTIATION / PAYMENT_PENDING, one high-value
    const openDeal = async (owner: string, programCode: string, amount: string, stage: 'OPEN' | 'NEGOTIATION' | 'PAYMENT_PENDING', closeInDays: number | null, highValue = false) => {
      n += 1;
      const teamId = await teamOf(owner);
      const lead = await mkLead(owner, 'PROPOSAL_NEGOTIATION', 'OPEN');
      const deal = await prisma.deal.create({ data: { organizationId: org, leadId: lead.id, programId: prog(programCode).id, ownerId: uid(owner), teamId, stage, amount, expectedCloseOn: closeInDays === null ? null : dateOnly(istDate(new Date(Date.now() + closeInDays * day))), isHighValue: highValue, highValueFlaggedAt: highValue ? new Date() : null, highValueThreshold: highValue ? '300000.00' : null, escalationLevel: highValue ? 1 : 0, note: '[DEMO] open deal', createKey: `demo-rev:${n}`, createdById: uid(owner) } });
      await prisma.dealStatusHistory.create({ data: { organizationId: org, dealId: deal.id, oldStage: null, newStage: 'OPEN', changedById: uid(owner), reason: '[DEMO] created' } });
      if (highValue) await prisma.dealBlocker.create({ data: { organizationId: org, dealId: deal.id, kind: 'HIGH_VALUE', note: '[DEMO] Auto-flagged high value deal', raisedById: uid(owner), escalatedToIds: [uid('teamlead')] } });
      return deal;
    };
    await openDeal('exec.a1', 'CBAX', '49999.00', 'NEGOTIATION', 5);
    await openDeal('exec.a2', 'MCA_X', '149999.00', 'PAYMENT_PENDING', 3);
    await openDeal('exec.a3', 'CBAX', '49999.00', 'OPEN', 12);
    await openDeal('exec.b1', 'MCA_ELITE_X', '499999.00', 'NEGOTIATION', 9, true);
    await openDeal('exec.b2', 'MCA_X', '149999.00', 'OPEN', null);
    await openDeal('exec.b4', 'CBAX', '49999.00', 'NEGOTIATION', 6);
  }

  // ---- forecast + immutable snapshot (an ESTIMATE) -----------------------------------------------------------------
  const fb = forecastBounds('MONTH', today);
  const fkey = { organizationId: org, periodType: 'MONTH' as const, periodStart: dateOnly(fb.startsOn), scopeKey: 'ORG' };
  let forecast = await prisma.forecast.findFirst({ where: fkey });
  if (!forecast) {
    forecast = await prisma.forecast.create({ data: { ...fkey, periodEnd: dateOnly(fb.endsOn), method: FORECAST_METHOD, params: {}, createdById: uid('teamlead') } });
    const open = await prisma.deal.findMany({ where: { organizationId: org, stage: { in: ['OPEN', 'NEGOTIATION', 'PAYMENT_PENDING'] } }, include: { lead: { select: { status: true } } } });
    const won = await prisma.salesRecord.aggregate({ where: { organizationId: org, closedAt: { gte: dateOnly(fb.startsOn) } }, _sum: { saleValue: true } });
    const r = stageWeightedForecast({ periodStart: fb.startsOn, periodEnd: fb.endsOn, asOf: today, bookedToDate: won._sum.saleValue ?? 0n, deals: open.map((d) => ({ id: d.id, ownerId: d.ownerId, amount: d.amount, stage: d.stage, leadStatus: d.lead.status, expectedCloseOn: d.expectedCloseOn ? d.expectedCloseOn.toISOString().slice(0, 10) : null })) });
    await prisma.forecastSnapshot.create({ data: { organizationId: org, forecastId: forecast.id, kind: 'PERIOD_START', takenById: uid('teamlead'), total: r.total, bookedToDate: r.bookedToDate, weightedPipeline: r.weightedPipeline, unweightedPipeline: r.unweightedPipeline, breakdown: { byStage: r.byStage, byOwner: r.byOwner, unscheduled: r.unscheduled, overdue: r.overdue } as unknown as Prisma.InputJsonValue, inputs: { method: FORECAST_METHOD, asOf: today, demo: true } } });
  }

  // ---- pricing proposals, market intel, growth, strategy -------------------------------------------------------------
  if (!(await prisma.pricingProposal.findFirst({ where: { organizationId: org, title: { startsWith: '[DEMO]' } } }))) {
    const p = await prisma.pricingProposal.create({ data: { organizationId: org, type: 'OFFER', programId: prog('CBAX').id, title: '[DEMO] Diwali early-bird offer on CBAX', rationale: '[DEMO] Competitor discounts were reported on three calls this week.', proposedAmount: '44999.00', currentAmount: '49999.00', status: 'SUBMITTED', createdById: uid('teamlead'), submittedAt: new Date() } });
    await prisma.pricingProposalEvent.createMany({ data: [{ organizationId: org, proposalId: p.id, fromStatus: null, toStatus: 'DRAFT', actorId: uid('teamlead'), actorRole: 'SALES_TEAM_LEAD', note: '[DEMO] created' }, { organizationId: org, proposalId: p.id, fromStatus: 'DRAFT', toStatus: 'SUBMITTED', actorId: uid('teamlead'), actorRole: 'SALES_TEAM_LEAD', note: '[DEMO] submitted for Founder review' }] });
    await prisma.feedbackEntry.createMany({
      data: [
        { organizationId: org, kind: 'COMPETITOR', category: 'Pricing', source: 'Sales call', title: '[DEMO] Competitor runs a festive discount', notes: '[DEMO] Prospects mention a 30% festive discount elsewhere.', competitor: '[DEMO] Competitor X', createdById: uid('exec.a1'), proposalId: p.id },
        { organizationId: org, kind: 'MARKET', category: 'Demand', source: 'Webinar Q&A', title: '[DEMO] Weekend batches requested', notes: '[DEMO] Working professionals ask for weekend-only cohorts.', createdById: uid('manager.a') },
        { organizationId: org, kind: 'LEARNER', category: 'Experience', source: 'Survey', title: '[DEMO] Learners love the mentor sessions', notes: '[DEMO] Recurring praise for live mentor feedback.', createdById: uid('studentsuccess') },
      ],
    });
    await prisma.growthOpportunity.createMany({
      data: [
        { organizationId: org, type: 'CHANNEL', title: '[DEMO] WhatsApp learner communities', description: '[DEMO] Seed referral communities after each cohort.', estimatedValue: '500000.00', ownerId: uid('manager.a'), status: 'EVALUATING', createdById: uid('manager.a') },
        { organizationId: org, type: 'SEGMENT', title: '[DEMO] Working women re-skilling', description: '[DEMO] A segment to test through a targeted webinar.', ownerId: uid('teamlead'), status: 'IDEA', createdById: uid('teamlead') },
      ],
    });
    const plan = await prisma.strategyPlan.create({ data: { organizationId: org, periodId: period.id, title: '[DEMO] Month plan: convert webinar attendees', summary: '[DEMO] Focus on demo-to-sale conversion and on collections follow-up.', status: 'ACTIVE', ownerId: uid('teamlead') } });
    await prisma.strategyInitiative.createMany({ data: [{ organizationId: org, planId: plan.id, title: '[DEMO] Daily demo follow-up huddle', ownerId: uid('manager.a'), status: 'IN_PROGRESS' }, { organizationId: org, planId: plan.id, title: '[DEMO] Collection chase list every Monday', ownerId: uid('manager.b'), status: 'PLANNED' }] });
  }
}
