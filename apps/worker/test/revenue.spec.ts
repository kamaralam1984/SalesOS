import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { REFUND_PROCESSED_EVENT, type DomainEvent, type RevenueRefundProcessedPayload } from '@salesos/shared-types';
import { queueForecastSnapshotReminders, queueOverdueInstallments, queueTargetRisk, queueVerificationBacklog } from '../src/jobs/revenue/scans';
import { handleRefundProcessed } from '../src/jobs/people/clawback';
import { buildRegistry } from '../src/jobs/registry';

const DB = process.env.TEST_WORKER_DATABASE_URL ?? 'postgresql://salesos:salesos_dev_only@127.0.0.1:5533/salesos_agentb_wtest?schema=public';
let prisma: PrismaClient;
const tag = () => randomUUID().slice(0, 8);
const orgIds: string[] = [];

async function fixture() {
  const org = await prisma.organization.create({ data: { name: `[TEST] rev worker ${tag()}`, slug: `rw-${tag()}` } });
  const owner = await prisma.user.create({ data: { organizationId: org.id, email: `o-${tag()}@test.salesos.local`, name: '[TEST] owner' } });
  const lead = await prisma.lead.create({ data: { organizationId: org.id, fullName: '[TEST] lead', status: 'WON', stageCategory: 'WON', assignedToId: owner.id } });
  const program = await prisma.program.create({ data: { organizationId: org.id, code: `P${tag()}`, name: '[TEST] prog' } });
  const deal = await prisma.deal.create({ data: { organizationId: org.id, leadId: lead.id, programId: program.id, ownerId: owner.id, stage: 'WON', amount: '1000.00', createdById: owner.id, closedAt: new Date() } });
  orgIds.push(org.id);
  return { org, owner, deal };
}
const outbox = (orgId: string, key: string) => prisma.outboxEvent.findMany({ where: { organizationId: orgId, idempotencyKey: { startsWith: `notify:${key}` } } });

beforeAll(() => { prisma = new PrismaClient({ datasourceUrl: DB }); });
afterAll(async () => {
  // leave no PENDING outbox rows behind: the dispatcher test in outbox.spec.ts shares this database
  await prisma.outboxEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.$disconnect();
});

describe('revenue scans', () => {
  it('overdue installments notify the deal owner once, only for won sales and only after the due date', async () => {
    const f = await fixture();
    const mk = (dueDate: string, status: 'EXPECTED' | 'VERIFIED' = 'EXPECTED') => prisma.payment.create({ data: { organizationId: f.org.id, dealId: f.deal.id, ownerId: f.owner.id, status, amount: '500.00', dueDate: new Date(`${dueDate}T00:00:00Z`) } });
    const overdue = await mk('2026-10-01');
    await mk('2026-10-20'); // not due yet
    await mk('2026-09-01', 'VERIFIED'); // not expected any more
    const now = new Date('2026-10-15T05:00:00Z');
    expect(await queueOverdueInstallments(prisma, now)).toBeGreaterThanOrEqual(1);
    const rows = await outbox(f.org.id, 'payment.overdue');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.idempotencyKey).toBe(`notify:payment.overdue:${overdue.id}`);
    expect(rows[0]!.payload).toMatchObject({ type: 'collection.status_changed', userIds: [f.owner.id], dedupeKey: `payment.overdue:${overdue.id}`, severity: 'WARNING' });
    await queueOverdueInstallments(prisma, now); // idempotent
    expect(await outbox(f.org.id, 'payment.overdue')).toHaveLength(1);
  });

  it('payments waiting >24h for verification nudge Finance once', async () => {
    const f = await fixture();
    const old = await prisma.payment.create({ data: { organizationId: f.org.id, dealId: f.deal.id, ownerId: f.owner.id, status: 'RECORDED', amount: '700.00', externalTransactionRef: `W-${tag()}`, recordedAt: new Date('2026-10-10T00:00:00Z') } });
    await prisma.payment.create({ data: { organizationId: f.org.id, dealId: f.deal.id, ownerId: f.owner.id, status: 'RECORDED', amount: '700.00', externalTransactionRef: `W-${tag()}`, recordedAt: new Date('2026-10-15T04:00:00Z') } });
    const now = new Date('2026-10-15T05:00:00Z');
    await queueVerificationBacklog(prisma, now);
    await queueVerificationBacklog(prisma, now);
    const rows = await outbox(f.org.id, 'payment.verify_pending');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({ roles: ['FINANCE'], dedupeKey: `payment.verify_pending:${old.id}` });
  });

  it('reminds the Team Lead to take the period-start snapshot on Mondays and the 1st, only if none exists', async () => {
    const f = await fixture();
    const tlRole = await prisma.role.upsert({ where: { key: 'SALES_TEAM_LEAD' }, update: {}, create: { key: 'SALES_TEAM_LEAD', name: 'Sales Team Lead' } });
    await prisma.user.create({ data: { organizationId: f.org.id, email: `tl-${tag()}@test.salesos.local`, name: '[TEST] tl', roleAssignments: { create: [{ organizationId: f.org.id, roleId: tlRole.id }] } } });
    const monday = new Date('2026-11-02T04:00:00Z'); // Monday 2 Nov 2026 IST
    expect(await queueForecastSnapshotReminders(prisma, new Date('2026-11-03T04:00:00Z'))).toBe(0); // Tuesday, not the 1st
    const n = await queueForecastSnapshotReminders(prisma, monday);
    expect(n).toBeGreaterThanOrEqual(1);
    expect((await outbox(f.org.id, 'forecast.snapshot_due:WEEK:2026-11-02')).length).toBe(1);
    await queueForecastSnapshotReminders(prisma, monday);
    expect((await outbox(f.org.id, 'forecast.snapshot_due:WEEK:2026-11-02')).length).toBe(1);
    // once the snapshot exists no reminder is raised for that period
    const tl = await prisma.user.findFirstOrThrow({ where: { organizationId: f.org.id } });
    const fc = await prisma.forecast.create({ data: { organizationId: f.org.id, periodType: 'WEEK', periodStart: new Date('2026-11-09T00:00:00Z'), periodEnd: new Date('2026-11-15T00:00:00Z'), scopeKey: 'ORG', method: 'STAGE_WEIGHTED_V1', params: {}, createdById: tl.id } });
    await prisma.forecastSnapshot.create({ data: { organizationId: f.org.id, forecastId: fc.id, kind: 'PERIOD_START', takenById: tl.id, total: '1', bookedToDate: '0', weightedPipeline: '1', unweightedPipeline: '1', breakdown: {}, inputs: {} } });
    await queueForecastSnapshotReminders(prisma, new Date('2026-11-09T04:00:00Z'));
    expect((await outbox(f.org.id, 'forecast.snapshot_due:WEEK:2026-11-09')).length).toBe(0);
  });

  it('is registered with the worker registry', () => {
    const r = buildRegistry();
    expect(r.processors.some((p) => p.queue === 'revenue-scans')).toBe(true);
    expect(r.repeatables.filter((x) => x.queue === 'revenue-scans').map((x) => x.name).sort()).toEqual(['forecast-snapshot-reminder', 'overdue-installments', 'target-risk', 'verification-backlog']);
  });
});

describe('contract with the people (incentive clawback) consumer', () => {
  it('the revenue refund.processed payload is accepted by the people handler without errors', async () => {
    const f = await fixture();
    const payload: RevenueRefundProcessedPayload = {
      refundId: randomUUID(), organizationId: f.org.id, dealId: f.deal.id, paymentId: null, attributedUserId: f.owner.id, amount: '100.00', currency: 'INR', processedAt: new Date().toISOString(), paymentCollectedAt: new Date().toISOString(),
      leadId: f.deal.leadId, programId: f.deal.programId, approvedAmount: '100.00', processedById: f.owner.id, processedByRole: 'FINANCE', externalRef: 'X-1', saleClosedAt: new Date().toISOString(), creditedOwners: [{ userId: f.owner.id, sharePct: '100.00' }],
    };
    const event: DomainEvent<RevenueRefundProcessedPayload> = { id: randomUUID(), eventType: REFUND_PROCESSED_EVENT, aggregateType: 'refund', aggregateId: payload.refundId, organizationId: f.org.id, payload, occurredAt: new Date().toISOString(), attempt: 1 };
    const res = await handleRefundProcessed(event as DomainEvent, prisma);
    expect(res).toBeDefined();
  });
});

describe('target risk scan (CLAUDE.md section 15: target risk)', () => {
  it('flags a revenue target behind the straight-line pace once per ISO week, tells the owner and the manager, ignores healthy / too-early / inactive owners', async () => {
    const f = await fixture();
    const mgr = await prisma.user.create({ data: { organizationId: f.org.id, email: `m-${tag()}@test.salesos.local`, name: '[TEST] manager' } });
    await prisma.user.update({ where: { id: f.owner.id }, data: { managerId: mgr.id } });
    const period = await prisma.targetPeriod.create({ data: { organizationId: f.org.id, type: 'MONTH', label: 'Oct 2026', startsOn: new Date('2026-10-01T00:00:00Z'), endsOn: new Date('2026-10-31T00:00:00Z') } });
    const mk = (ownerId: string, amount: string) => prisma.target.create({ data: { organizationId: f.org.id, periodId: period.id, metric: 'REVENUE', level: 'EXECUTIVE', ownerUserId: ownerId, amount, originalAmount: amount } });
    const behind = await mk(f.owner.id, '100000.00');
    const healthy = await mk(mgr.id, '100000.00');
    // sales credited inside the period: owner 10k (pace at day 15 = 100k x 15/31 x 70% = 33.8k -> behind), manager 80k (healthy)
    const sale = async (userId: string, amount: string, deal: string | null) => {
      const lead = await prisma.lead.create({ data: { organizationId: f.org.id, fullName: '[TEST] l', status: 'WON', stageCategory: 'WON', assignedToId: userId } });
      const program = await prisma.program.create({ data: { organizationId: f.org.id, code: `P${tag()}`, name: '[TEST] p' } });
      const d = await prisma.deal.create({ data: { organizationId: f.org.id, leadId: lead.id, programId: program.id, ownerId: userId, stage: 'WON', amount, createdById: userId, closedAt: new Date('2026-10-05T05:00:00Z') } });
      const rec = await prisma.salesRecord.create({ data: { organizationId: f.org.id, dealId: d.id, leadId: lead.id, programId: program.id, dealType: 'NEW', saleValue: amount, closedAt: new Date('2026-10-05T05:00:00Z'), createdById: userId } });
      await prisma.salesCredit.create({ data: { salesRecordId: rec.id, organizationId: f.org.id, userId, sharePct: '100.00', amount } });
      void deal;
    };
    await sale(f.owner.id, '10000.00', null);
    await sale(mgr.id, '80000.00', null);
    const now = new Date('2026-10-15T05:00:00Z');
    expect(await queueTargetRisk(prisma, now)).toBe(1);
    const rows = await outbox(f.org.id, `target.at_risk:${behind.id}`);
    expect(rows).toHaveLength(1);
    expect((rows[0]!.payload as { userIds: string[]; type: string }).type).toBe('target.at_risk');
    expect((rows[0]!.payload as { userIds: string[] }).userIds.sort()).toEqual([f.owner.id, mgr.id].sort());
    expect(await outbox(f.org.id, `target.at_risk:${healthy.id}`)).toHaveLength(0);
    // same week again -> nothing new; next ISO week -> a fresh nudge
    expect(await queueTargetRisk(prisma, new Date('2026-10-16T05:00:00Z'))).toBe(0);
    expect(await queueTargetRisk(prisma, new Date('2026-10-22T05:00:00Z'))).toBe(1);
    // too early in the period: no alert; inactive owner: no alert
    expect(await queueTargetRisk(prisma, new Date('2026-10-03T05:00:00Z'))).toBe(0);
    await prisma.user.update({ where: { id: f.owner.id }, data: { isActive: false } });
    expect(await queueTargetRisk(prisma, new Date('2026-10-29T05:00:00Z'))).toBe(0);
    // the generic notification contract turns it into a platform notification
    const reg = buildRegistry();
    expect(reg.handlers.get('notification.requested')?.length).toBeGreaterThan(0);
  });
});
