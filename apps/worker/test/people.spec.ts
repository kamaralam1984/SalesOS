import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { planClawback, handleRefundProcessed, type PaidRecommendation } from '../src/jobs/people/clawback';
import { queueSopReminders } from '../src/jobs/people/sop-reminders';
import { queueProbationDue } from '../src/jobs/people/probation-due';
import { buildRegistry } from '../src/jobs/registry';
import { REFUND_PROCESSED_EVENT, type DomainEvent, type RefundProcessedPayload } from '@salesos/shared-types';

const DB = process.env.TEST_WORKER_DATABASE_URL ?? 'postgresql://salesos:salesos_dev_only@127.0.0.1:5533/salesos_agentb_wtest?schema=public';
let prisma: PrismaClient;
let orgId: string;
let u1: string;
let u2: string;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

const paid = (over: Partial<PaidRecommendation> = {}): PaidRecommendation => ({
  id: 'r1', employeeId: 'e1', periodStart: d('2026-09-01'), periodEnd: d('2026-09-30'), paidAt: d('2026-10-05'), approvedAmount: new Prisma.Decimal('50.00'), basisAmount: new Prisma.Decimal('1000.00'), currency: 'INR', clawbackWindowDays: 30, ...over,
});

describe('planClawback (pure)', () => {
  it('proposes a proportional clawback inside the window, capped at the approved amount', () => {
    const plan = planClawback({ amount: '200.00', currency: 'INR', processedAt: '2026-10-10T00:00:00Z', paymentCollectedAt: '2026-09-20T00:00:00Z' }, [paid()]);
    expect(plan).toMatchObject({ recommendationId: 'r1', proposedAmount: '10.00', currency: 'INR' }); // 200 x (50/1000)
    const big = planClawback({ amount: '99999.00', currency: 'INR', processedAt: '2026-10-10T00:00:00Z', paymentCollectedAt: '2026-09-20T00:00:00Z' }, [paid()]);
    expect(big?.proposedAmount).toBe('50.00');
  });
  it('proposes nothing outside the configured window, for other currencies, or before the sale', () => {
    expect(planClawback({ amount: '10', currency: 'INR', processedAt: '2026-11-30T00:00:00Z', paymentCollectedAt: '2026-09-20T00:00:00Z' }, [paid()])).toBeNull();
    expect(planClawback({ amount: '10', currency: 'USD', processedAt: '2026-10-10T00:00:00Z', paymentCollectedAt: '2026-09-20T00:00:00Z' }, [paid()])).toBeNull();
    expect(planClawback({ amount: '10', currency: 'INR', processedAt: '2026-09-01T00:00:00Z', paymentCollectedAt: '2026-09-20T00:00:00Z' }, [paid()])).toBeNull();
    expect(planClawback({ amount: '10', currency: 'INR', processedAt: '2026-10-10T00:00:00Z' }, [])).toBeNull();
  });
  it('targets the recommendation whose period contains the collection date', () => {
    const a = paid({ id: 'aug', periodStart: d('2026-08-01'), periodEnd: d('2026-08-31'), paidAt: d('2026-09-05') });
    const s = paid({ id: 'sep' });
    expect(planClawback({ amount: '10', currency: 'INR', processedAt: '2026-09-20T00:00:00Z', paymentCollectedAt: '2026-08-25T00:00:00Z' }, [a, s])?.recommendationId).toBe('aug');
  });
  it('falls back to the payout date as window anchor when the collection date is unknown', () => {
    expect(planClawback({ amount: '10', currency: 'INR', processedAt: '2026-10-20T00:00:00Z' }, [paid()])?.recommendationId).toBe('r1');
    expect(planClawback({ amount: '10', currency: 'INR', processedAt: '2026-12-20T00:00:00Z' }, [paid()])).toBeNull();
  });
});

describe('people worker jobs (real Postgres)', () => {
  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: DB });
    const org = await prisma.organization.create({ data: { name: '[TEST] people-worker', slug: `pw-${randomUUID().slice(0, 8)}` } });
    orgId = org.id;
    const mk = (n: string) => prisma.user.create({ data: { organizationId: orgId, email: `${n}-${randomUUID().slice(0, 6)}@test.local`, name: n } });
    u1 = (await mk('u1')).id;
    u2 = (await mk('u2')).id;
  });
  afterAll(async () => { await prisma.$disconnect(); });

  async function paidRec(employeeId: string) {
    const policy = await prisma.incentivePolicy.create({ data: { organizationId: orgId, versionNumber: Math.floor(Math.random() * 1e6), name: 'p', status: 'APPROVED', structure: { clawbackWindowDays: 30 }, createdById: employeeId } });
    return prisma.incentiveRecommendation.create({
      data: {
        organizationId: orgId, policyId: policy.id, employeeId, periodStart: d('2026-09-01'), periodEnd: d('2026-09-30'), status: 'PAID', inputs: {}, breakdown: { netBasisAmount: '1000.00' },
        computedAmount: '50.00', approvedAmount: '50.00', recommendedById: employeeId, paidAt: d('2026-10-05'),
      },
    });
  }
  const refundEvent = (employeeId: string, refundId: string, over: Partial<RefundProcessedPayload> = {}): DomainEvent => ({
    id: randomUUID(), eventType: REFUND_PROCESSED_EVENT, aggregateType: 'refund', aggregateId: refundId, organizationId: orgId, occurredAt: new Date().toISOString(), attempt: 0,
    payload: { refundId, organizationId: orgId, dealId: null, paymentId: null, attributedUserId: employeeId, amount: '200.00', currency: 'INR', processedAt: '2026-10-10T00:00:00Z', paymentCollectedAt: '2026-09-20T00:00:00Z', ...over } satisfies RefundProcessedPayload,
  });

  it('refund.processed proposes a clawback (PAID -> CLAWBACK_PROPOSED), audited, idempotent, never applied', async () => {
    const rec = await paidRec(u1);
    const refundId = randomUUID();
    expect((await handleRefundProcessed(refundEvent(u1, refundId), prisma)).proposed).toBe(true);
    expect((await handleRefundProcessed(refundEvent(u1, refundId), prisma)).proposed).toBe(false); // redelivery
    const after = await prisma.incentiveRecommendation.findUniqueOrThrow({ where: { id: rec.id }, include: { adjustments: true } });
    expect(after.status).toBe('CLAWBACK_PROPOSED');
    expect(after.adjustments).toHaveLength(1);
    expect(after.adjustments[0]).toMatchObject({ status: 'PROPOSED', decidedAmount: null });
    expect(after.adjustments[0]!.proposedAmount.toString()).toBe('10');
    expect(await prisma.auditLog.count({ where: { entityId: rec.id, action: 'incentive.clawback_proposed' } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: rec.id, eventType: 'incentive.clawback_proposed' } })).toBe(1);
    // a second refund adds another proposal without leaving CLAWBACK_PROPOSED
    expect((await handleRefundProcessed(refundEvent(u1, randomUUID()), prisma)).proposed).toBe(true);
    expect(await prisma.incentiveAdjustment.count({ where: { recommendationId: rec.id } })).toBe(2);
  });

  it('ignores refunds with no attributed user, outside the window, or when nothing was paid', async () => {
    await paidRec(u2);
    expect((await handleRefundProcessed(refundEvent(u2, randomUUID(), { attributedUserId: null }), prisma)).proposed).toBe(false);
    expect((await handleRefundProcessed(refundEvent(u2, randomUUID(), { processedAt: '2027-03-01T00:00:00Z' }), prisma)).proposed).toBe(false);
    const nobody = (await prisma.user.create({ data: { organizationId: orgId, email: `n-${randomUUID().slice(0, 6)}@test.local`, name: 'n' } })).id;
    expect((await handleRefundProcessed(refundEvent(nobody, randomUUID()), prisma)).proposed).toBe(false);
  });

  it('registers the refund subscriber and the reminder schedules in the job registry', () => {
    const reg = buildRegistry();
    expect(reg.handlers.get(REFUND_PROCESSED_EVENT)?.length).toBeGreaterThan(0);
    expect(reg.processors.some((p) => p.queue === 'people-reminders')).toBe(true);
    expect(reg.repeatables.filter((r) => r.queue === 'people-reminders').map((r) => r.name).sort()).toEqual(['probation-due', 'sop-ack-reminders']);
  });

  it('SOP reminder job queues one reminder per un-acknowledged user per day (idempotent), only after the grace period', async () => {
    const doc = await prisma.sopDocument.create({ data: { organizationId: orgId, category: 'OTHER', title: 'w', ownerId: u1, createdById: u1, isMandatory: true } });
    const old = await prisma.sopVersion.create({ data: { organizationId: orgId, documentId: doc.id, versionNumber: 1, title: 'w', body: 'b', status: 'APPROVED', effectiveDate: d('2026-01-01'), createdById: u1, approvedById: u1, approvedAt: new Date() } });
    const doc2 = await prisma.sopDocument.create({ data: { organizationId: orgId, category: 'OTHER', title: 'fresh', ownerId: u1, createdById: u1, isMandatory: true } });
    await prisma.sopVersion.create({ data: { organizationId: orgId, documentId: doc2.id, versionNumber: 1, title: 'fresh', body: 'b', status: 'APPROVED', effectiveDate: d('2026-10-14'), createdById: u1, approvedById: u1, approvedAt: new Date() } });
    await prisma.sopAcknowledgement.create({ data: { organizationId: orgId, versionId: old.id, documentId: doc.id, userId: u1 } });
    const now = new Date('2026-10-15T04:00:00Z');
    const mine = () => prisma.outboxEvent.count({ where: { organizationId: orgId, eventType: 'sop.acknowledgement_reminder', aggregateId: old.id } });
    const users = await prisma.user.count({ where: { organizationId: orgId, isActive: true } });
    const first = await queueSopReminders(prisma, now);
    expect(first).toBeGreaterThanOrEqual(users - 1);
    const queuedForOld = await mine();
    expect(queuedForOld).toBe(users - 1); // everyone but u1, who acknowledged
    await queueSopReminders(prisma, now);
    expect(await mine()).toBe(queuedForOld); // same day -> deduplicated
    await queueSopReminders(prisma, new Date('2026-10-16T04:00:00Z'));
    expect(await mine()).toBe(queuedForOld * 2); // next day -> a new reminder
    expect(await prisma.outboxEvent.count({ where: { organizationId: orgId, eventType: 'sop.acknowledgement_reminder', payload: { path: ['documentTitle'], equals: 'fresh' } } })).toBe(0); // within grace
  });

  it('probation-due job queues one event per review per day', async () => {
    await prisma.probationReview.create({ data: { organizationId: orgId, employeeId: u1, checkpointDay: 30, dueDate: d('2026-10-16') } });
    const now = new Date('2026-10-15T04:30:00Z');
    expect(await queueProbationDue(prisma, now)).toBe(1);
    expect(await queueProbationDue(prisma, now)).toBe(0);
  });
});
