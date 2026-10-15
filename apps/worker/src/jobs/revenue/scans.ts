import { Prisma, type PrismaClient } from '@prisma/client';
import { PLATFORM_EVENTS, type NotifyRequest } from '@salesos/shared-types';

/**
 * Revenue scans (Phase 4). Pure Prisma + outbox: every alert is a `notification.requested` event with a stable dedupe key,
 * so re-running a scan (retry, restart, overlapping schedules) never produces a second alert. No money is changed here.
 */
const IST_MS = 5.5 * 3_600_000;
const istDay = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
const money = (d: Prisma.Decimal) => d.toFixed(2);

function row(orgId: string, req: NotifyRequest): Prisma.OutboxEventCreateManyInput {
  return {
    eventType: PLATFORM_EVENTS.NOTIFICATION_REQUESTED,
    aggregateType: req.entity?.type ?? 'revenue',
    aggregateId: req.entity?.id ?? orgId,
    organizationId: orgId,
    payload: req as unknown as Prisma.InputJsonValue,
    idempotencyKey: `notify:${req.dedupeKey}`,
  };
}

/** EXPECTED installments past their due date on a WON sale: tell the deal owner once per installment. */
export async function queueOverdueInstallments(prisma: PrismaClient, now = new Date()): Promise<number> {
  const today = new Date(`${istDay(now)}T00:00:00.000Z`);
  const due = await prisma.payment.findMany({
    where: { status: 'EXPECTED', dueDate: { lt: today }, deal: { stage: 'WON' } },
    select: { id: true, organizationId: true, ownerId: true, dealId: true, amount: true, dueDate: true },
    take: 1000,
    orderBy: { dueDate: 'asc' },
  });
  if (!due.length) return 0;
  const res = await prisma.outboxEvent.createMany({
    data: due.map((p) =>
      row(p.organizationId, {
        organizationId: p.organizationId, type: 'collection.status_changed', userIds: [p.ownerId], dedupeKey: `payment.overdue:${p.id}`, severity: 'WARNING',
        title: 'Installment overdue', body: `An expected installment of ${money(p.amount)} INR was due on ${p.dueDate!.toISOString().slice(0, 10)} and no payment is recorded.`,
        entity: { type: 'deal', id: p.dealId }, actionUrl: `/revenue/deals/${p.dealId}`,
      }),
    ),
    skipDuplicates: true,
  });
  return res.count;
}

/** RECORDED payments waiting for Finance verification for more than `hours`: nudge Finance once per payment. */
export async function queueVerificationBacklog(prisma: PrismaClient, now = new Date(), hours = 24): Promise<number> {
  const cutoff = new Date(now.getTime() - hours * 3_600_000);
  const pending = await prisma.payment.findMany({ where: { status: 'RECORDED', recordedAt: { lt: cutoff } }, select: { id: true, organizationId: true, amount: true, dealId: true }, take: 1000, orderBy: { recordedAt: 'asc' } });
  if (!pending.length) return 0;
  const res = await prisma.outboxEvent.createMany({
    data: pending.map((p) =>
      row(p.organizationId, {
        organizationId: p.organizationId, type: 'collection.status_changed', roles: ['FINANCE'], dedupeKey: `payment.verify_pending:${p.id}`, severity: 'WARNING',
        title: 'Payment waiting for verification', body: `A payment of ${money(p.amount)} INR has been waiting for verification for more than ${hours} hours.`,
        entity: { type: 'payment', id: p.id }, actionUrl: '/revenue/collections',
      }),
    ),
    skipDuplicates: true,
  });
  return res.count;
}

/**
 * Accuracy needs a snapshot taken at the START of a period (DEC-030). On Mondays (week) and on the 1st (month), remind the
 * Team Lead / Founder when the organisation-wide forecast has no period-start snapshot yet.
 */
export async function queueForecastSnapshotReminders(prisma: PrismaClient, now = new Date()): Promise<number> {
  const today = istDay(now);
  const dow = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  const periods: Array<{ type: 'WEEK' | 'MONTH'; start: string }> = [];
  if (dow === 1) periods.push({ type: 'WEEK', start: today });
  if (today.endsWith('-01')) periods.push({ type: 'MONTH', start: today });
  if (!periods.length) return 0;
  const orgs = await prisma.organization.findMany({ select: { id: true }, where: { users: { some: { isActive: true, roleAssignments: { some: { role: { key: 'SALES_TEAM_LEAD' } } } } } } });
  let n = 0;
  for (const org of orgs) {
    for (const p of periods) {
      const has = await prisma.forecastSnapshot.count({ where: { organizationId: org.id, kind: 'PERIOD_START', forecast: { periodType: p.type, periodStart: new Date(`${p.start}T00:00:00.000Z`), scopeKey: 'ORG' } } });
      if (has) continue;
      const res = await prisma.outboxEvent.createMany({
        data: [
          row(org.id, {
            organizationId: org.id, type: 'founder.action_item', roles: ['SALES_TEAM_LEAD', 'FOUNDER_CEO'], dedupeKey: `forecast.snapshot_due:${p.type}:${p.start}:${org.id}`,
            title: p.type === 'WEEK' ? 'Take this week\'s forecast snapshot' : 'Take this month\'s forecast snapshot',
            body: 'Forecast accuracy is measured against the snapshot taken at the start of the period. Store it now (it is an estimate).',
            entity: { type: 'forecast', id: org.id }, actionUrl: '/revenue/forecasts',
          }),
        ],
        skipDuplicates: true,
      });
      n += res.count;
    }
  }
  return n;
}

/**
 * Target at risk (CLAUDE.md section 15 "target risk"). Default rule (awaiting owner approval, INT-11): a REVENUE target is AT RISK when at
 * least `minElapsedPct` (25%) of its period has passed and the credited sales so far are below `pacePct` (70%) of the straight-line pace
 * (target x elapsed calendar days / period days). Credits are the original sales_credits of sales closed inside the period (adjustments
 * and refunds are not netted: this is a nudge, not a KPI; the KPI engine owns the numbers). The owner and the owner's manager are told
 * once per ISO week per target. Nothing is changed.
 */
export async function queueTargetRisk(prisma: PrismaClient, now = new Date(), opts: { pacePct?: number; minElapsedPct?: number } = {}): Promise<number> {
  const pacePct = opts.pacePct ?? Number(process.env.TARGET_RISK_PACE_PCT ?? 70);
  const minElapsed = (opts.minElapsedPct ?? Number(process.env.TARGET_RISK_MIN_ELAPSED_PCT ?? 25)) / 100;
  const today = istDay(now);
  const day = (d: Date) => Math.floor(d.getTime() / 86_400_000);
  const todayN = day(new Date(`${today}T00:00:00.000Z`));
  const week = (() => { const d = new Date(`${today}T00:00:00.000Z`); const thursday = new Date(d.getTime() + (3 - ((d.getUTCDay() + 6) % 7)) * 86_400_000); const y = thursday.getUTCFullYear(); return `${y}-W${String(Math.floor((day(thursday) - day(new Date(Date.UTC(y, 0, 1)))) / 7) + 1).padStart(2, '0')}`; })();
  const targets = await prisma.target.findMany({
    where: { metric: 'REVENUE', amount: { gt: 0 }, period: { startsOn: { lte: new Date(`${today}T00:00:00.000Z`) }, endsOn: { gte: new Date(`${today}T00:00:00.000Z`) } } },
    include: { period: true, ownerUser: { select: { managerId: true, isActive: true, name: true } } },
    take: 2000,
  });
  const rows: Prisma.OutboxEventCreateManyInput[] = [];
  for (const t of targets) {
    if (!t.ownerUser.isActive) continue;
    const startN = day(t.period.startsOn);
    const total = day(t.period.endsOn) - startN + 1;
    const elapsed = (todayN - startN + 1) / total;
    if (elapsed < minElapsed) continue;
    const from = new Date(`${t.period.startsOn.toISOString().slice(0, 10)}T00:00:00.000+05:30`);
    const to = new Date(new Date(`${today}T00:00:00.000+05:30`).getTime() + 86_400_000);
    const achieved = new Prisma.Decimal((await prisma.salesCredit.aggregate({ where: { organizationId: t.organizationId, userId: t.ownerUserId, salesRecord: { closedAt: { gte: from, lt: to } } }, _sum: { amount: true } }))._sum.amount ?? 0);
    const pace = t.amount.mul(elapsed).mul(pacePct).div(100);
    if (achieved.gte(pace)) continue;
    const users = [t.ownerUserId, ...(t.ownerUser.managerId ? [t.ownerUser.managerId] : [])];
    rows.push(
      row(t.organizationId, {
        organizationId: t.organizationId, type: 'target.at_risk', userIds: users, dedupeKey: `target.at_risk:${t.id}:${week}`, severity: 'WARNING',
        title: 'Revenue target at risk', body: `${t.period.label}: ${Math.round(elapsed * 100)}% of the period has passed and credited sales (${money(achieved)} INR) are below ${pacePct}% of the pace for a ${money(t.amount)} INR target.`,
        entity: { type: 'target', id: t.id }, actionUrl: '/revenue/targets',
      }),
    );
  }
  if (!rows.length) return 0;
  return (await prisma.outboxEvent.createMany({ data: rows, skipDuplicates: true })).count;
}
