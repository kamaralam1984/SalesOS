import { Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  createIncentivePolicySchema, createIncentiveRecommendationSchema, incentiveTransitionSchema, listIncentivesQuerySchema, markPaidSchema, updateIncentivePolicySchema,
} from '@salesos/validation';
import { incentiveStructureSchema } from '@salesos/validation';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { AppError, conflict, forbidden, notFound } from '../../../common/http/errors';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService, type Tx } from '../../../common/prisma';
import { assertOrgUsers, assertTargetInScope, isoDay, toDate, todayUtc, userNameMap, asPage } from '../common/helpers';
import { calculateIncentive, validateSlabs, type IncentiveInputs, type IncentiveStructure } from './engine';
import { findIncentiveRule, INCENTIVE_TERMINAL } from './incentive-machine';
import { INCENTIVE_INPUT_PROVIDER, ManualInputProvider, type IncentiveInputProvider } from './input-provider';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;
type RecRow = Prisma.IncentiveRecommendationGetPayload<{ include: { adjustments: true } }>;

@Injectable()
export class IncentivesService {
  private readonly provider: IncentiveInputProvider;
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Optional() @Inject(INCENTIVE_INPUT_PROVIDER) provider?: IncentiveInputProvider,
  ) {
    this.provider = provider ?? new ManualInputProvider();
  }

  // ---------------------------------------------------------------- policies
  private policyView(p: Prisma.IncentivePolicyGetPayload<object>, names: Map<string, string>) {
    return {
      id: p.id, versionNumber: p.versionNumber, name: p.name, status: p.status, structure: p.structure, effectiveFrom: isoDay(p.effectiveFrom), notes: p.notes,
      createdByName: names.get(p.createdById) ?? null, approvedByName: p.approvedById ? names.get(p.approvedById) ?? null : null, approvedAt: p.approvedAt, createdAt: p.createdAt,
      configured: (p.structure as { slabs?: unknown[] }).slabs?.length ? true : false,
    };
  }

  async listPolicies(user: Principal) {
    const rows = await this.prisma.incentivePolicy.findMany({ where: { organizationId: user.organizationId }, orderBy: [{ versionNumber: 'desc' }, { id: 'desc' }], take: 50 });
    const names = await userNameMap(this.prisma, user.organizationId, rows.flatMap((p) => [p.createdById, p.approvedById]));
    const items = rows.map((p) => this.policyView(p, names));
    return { policies: items, activePolicyId: items.find((p) => p.status === 'APPROVED')?.id ?? null, state: items.some((p) => p.status === 'APPROVED') ? 'CONFIGURED' : 'POLICY_NOT_CONFIGURED' };
  }

  async createPolicy(user: Principal, dto: Dto<typeof createIncentivePolicySchema>) {
    const row = await this.prisma.$transaction(async (tx) => {
      const max = await tx.incentivePolicy.aggregate({ where: { organizationId: user.organizationId }, _max: { versionNumber: true } });
      const p = await tx.incentivePolicy.create({
        data: { organizationId: user.organizationId, versionNumber: (max._max.versionNumber ?? 0) + 1, name: dto.name, structure: dto.structure, effectiveFrom: dto.effectiveFrom ? toDate(dto.effectiveFrom) : null, notes: dto.notes, createdById: user.userId },
      });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'incentive.policy_created', entityType: 'incentive_policy', entityId: p.id, metadata: { versionNumber: p.versionNumber } });
      return p;
    });
    return this.policyView(row, await userNameMap(this.prisma, user.organizationId, [row.createdById]));
  }

  async updatePolicy(user: Principal, id: string, dto: Dto<typeof updateIncentivePolicySchema>) {
    const p = await this.prisma.incentivePolicy.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!p) throw notFound('Policy');
    if (p.status !== 'DRAFT') throw new AppError('POLICY_IMMUTABLE', 'Approved policy versions are immutable; create a new version', 409);
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.incentivePolicy.update({
        where: { id },
        data: { ...(dto.name ? { name: dto.name } : {}), ...(dto.structure ? { structure: dto.structure } : {}), ...(dto.effectiveFrom ? { effectiveFrom: toDate(dto.effectiveFrom) } : {}), ...(dto.notes !== undefined ? { notes: dto.notes } : {}) },
      });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'incentive.policy_updated', entityType: 'incentive_policy', entityId: id, metadata: { fields: Object.keys(dto) } });
      return r;
    });
    return this.policyView(row, await userNameMap(this.prisma, user.organizationId, [row.createdById]));
  }

  async approvePolicy(user: Principal, id: string) {
    const p = await this.prisma.incentivePolicy.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!p) throw notFound('Policy');
    if (p.status !== 'DRAFT') throw conflict('ILLEGAL_TRANSITION', `Cannot approve a ${p.status} policy`);
    const structure = incentiveStructureSchema.parse(p.structure);
    const errors = validateSlabs(structure.slabs);
    if (errors.length) throw new AppError('POLICY_INVALID', 'Policy is not complete enough to approve', 422, errors);
    await this.prisma.$transaction(async (tx) => {
      await tx.incentivePolicy.updateMany({ where: { organizationId: user.organizationId, status: 'APPROVED' }, data: { status: 'SUPERSEDED' } });
      await tx.incentivePolicy.update({ where: { id }, data: { status: 'APPROVED', approvedById: user.userId, approvedAt: new Date(), effectiveFrom: p.effectiveFrom ?? todayUtc() } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'incentive.policy_approved', entityType: 'incentive_policy', entityId: id, metadata: { versionNumber: p.versionNumber } });
    });
    return { id, status: 'APPROVED' };
  }

  private async activePolicyFor(orgId: string, periodEnd: Date) {
    const p = await this.prisma.incentivePolicy.findFirst({
      where: { organizationId: orgId, status: 'APPROVED', OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: periodEnd } }] },
      orderBy: { versionNumber: 'desc' },
    });
    if (!p) throw new AppError('POLICY_NOT_CONFIGURED', 'No Founder-approved incentive policy applies to this period', 409);
    return p;
  }

  // ---------------------------------------------------------------- recommendations
  /** Employees (and anyone looking at their own record) get a status-only projection. */
  private view(user: Principal, r: RecRow, names: Map<string, string>) {
    const base = { id: r.id, employeeId: r.employeeId, employeeName: names.get(r.employeeId) ?? null, periodStart: isoDay(r.periodStart), periodEnd: isoDay(r.periodEnd), status: r.status, paidAt: r.paidAt, currency: r.currency };
    if (r.employeeId === user.userId || this.access.scopeLevel(user, 'incentives:recommendation:view') === 'own') return { ...base, statusOnly: true as const };
    return {
      ...base, statusOnly: false as const, policyId: r.policyId, snapshotVersion: r.snapshotVersion, inputs: r.inputs, inputSource: r.inputSource, breakdown: r.breakdown, computedAmount: r.computedAmount.toString(),
      approvedAmount: r.approvedAmount?.toString() ?? null, overrideReason: r.overrideReason, recommendedById: r.recommendedById, recommendedByName: names.get(r.recommendedById) ?? null,
      submitComments: r.submitComments, submittedAt: r.submittedAt, decidedByName: r.decidedById ? names.get(r.decidedById) ?? null : null, decidedAt: r.decidedAt,
      rejectionReason: r.rejectionReason, holdReason: r.holdReason, paymentReference: r.paymentReference, version: r.version, createdAt: r.createdAt,
      adjustments: r.adjustments.map((a) => ({ id: a.id, refundId: a.refundId, proposedAmount: a.proposedAmount.toString(), decidedAmount: a.decidedAmount?.toString() ?? null, status: a.status, reason: a.reason, createdAt: a.createdAt })),
    };
  }

  async list(user: Principal, q: Dto<typeof listIncentivesQuerySchema>) {
    const where = { ...(await this.access.scopedWhere(user, { permission: 'incentives:recommendation:view', ownerField: 'employeeId' })), ...(q.employeeId ? { employeeId: q.employeeId } : {}), ...(q.status ? { status: q.status as never } : {}) };
    const rows = await this.prisma.incentiveRecommendation.findMany({ where, include: { adjustments: true }, orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const names = await userNameMap(this.prisma, user.organizationId, res.data.flatMap((r) => [r.employeeId, r.recommendedById, r.decidedById]));
    return asPage(res, res.data.map((r) => this.view(user, r, names)));
  }

  private async load(user: Principal, id: string): Promise<RecRow> {
    const r = await this.prisma.incentiveRecommendation.findFirst({
      where: { ...(await this.access.scopedWhere(user, { permission: 'incentives:recommendation:view', ownerField: 'employeeId' })), id },
      include: { adjustments: true },
    });
    if (!r) throw notFound('Recommendation');
    return r;
  }

  async get(user: Principal, id: string) {
    const r = await this.load(user, id);
    const names = await userNameMap(this.prisma, user.organizationId, [r.employeeId, r.recommendedById, r.decidedById]);
    const view = this.view(user, r, names);
    if (view.statusOnly) return view;
    const history = await this.prisma.peopleStateLog.findMany({ where: { organizationId: user.organizationId, entityType: 'incentive', entityId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const hn = await userNameMap(this.prisma, user.organizationId, history.map((h) => h.actorId));
    return { ...view, history: history.map((h) => ({ from: h.fromStatus, to: h.toStatus, actorName: h.actorId ? hn.get(h.actorId) ?? null : null, note: h.note, at: h.createdAt })) };
  }

  private async resolveInputs(orgId: string, employeeId: string, ps: Date, pe: Date, supplied?: IncentiveInputs): Promise<{ inputs: IncentiveInputs; source: string }> {
    if (supplied) return { inputs: supplied, source: 'MANUAL' };
    const fromProvider = await this.provider.getInputs({ organizationId: orgId, employeeId, periodStart: ps, periodEnd: pe });
    if (!fromProvider) throw new AppError('INPUTS_REQUIRED', 'No automatic input source is registered for this period; supply the inputs explicitly', 422);
    return { inputs: fromProvider, source: this.provider.source };
  }

  private async log(tx: Tx, user: Principal, r: { id: string; employeeId: string }, from: string | null, to: string, audit: string, event: string | null, note?: string | null, extra: Record<string, unknown> = {}) {
    await tx.peopleStateLog.create({ data: { organizationId: user.organizationId, entityType: 'incentive', entityId: r.id, fromStatus: from, toStatus: to, actorId: user.userId, note: note ?? null } });
    await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: audit, entityType: 'incentive_recommendation', entityId: r.id, metadata: { employeeId: r.employeeId, from, to, ...extra } });
    if (event) {
      await this.outbox.publish(tx, {
        eventType: event, aggregateType: 'incentive_recommendation', aggregateId: r.id, organizationId: user.organizationId,
        payload: { recommendationId: r.id, organizationId: user.organizationId, employeeId: r.employeeId, from, to, actorId: user.userId },
        idempotencyKey: `${event}:${r.id}:${to}:${Date.now()}`,
      });
    }
  }

  async create(user: Principal, dto: Dto<typeof createIncentiveRecommendationSchema>) {
    if (dto.employeeId === user.userId) throw forbidden('You cannot recommend an incentive for yourself');
    if (dto.periodEnd < dto.periodStart) throw new AppError('VALIDATION_ERROR', 'periodEnd must not precede periodStart', 400);
    await assertOrgUsers(this.prisma, user.organizationId, [dto.employeeId]);
    await assertTargetInScope(this.access, user, 'incentives:recommendation:create', dto.employeeId);
    const ps = toDate(dto.periodStart);
    const pe = toDate(dto.periodEnd);
    const policy = await this.activePolicyFor(user.organizationId, pe);
    const dup = await this.prisma.incentiveRecommendation.findFirst({ where: { organizationId: user.organizationId, employeeId: dto.employeeId, periodStart: ps, periodEnd: pe, status: { notIn: ['REJECTED', 'WAIVED'] } } });
    if (dup) throw conflict('DUPLICATE_RECOMMENDATION', 'A recommendation for this employee and period already exists');
    const { inputs, source } = await this.resolveInputs(user.organizationId, dto.employeeId, ps, pe, dto.inputs);
    const structure = incentiveStructureSchema.parse(policy.structure) as IncentiveStructure;
    const result = calculateIncentive(structure, inputs);
    const id = await this.prisma.$transaction(async (tx) => {
      const r = await tx.incentiveRecommendation.create({
        data: { organizationId: user.organizationId, policyId: policy.id, employeeId: dto.employeeId, periodStart: ps, periodEnd: pe, inputs: inputs as unknown as Prisma.InputJsonValue, inputSource: source, breakdown: result as unknown as Prisma.InputJsonValue, computedAmount: new Prisma.Decimal(result.amount), currency: structure.currency, recommendedById: user.userId },
      });
      await this.log(tx, user, r, null, 'CALCULATED', 'incentive.calculated', 'incentive.calculated', null, { policyVersion: policy.versionNumber, amount: result.amount });
      return r.id;
    });
    return this.get(user, id);
  }

  async transition(user: Principal, id: string, dto: Dto<typeof incentiveTransitionSchema>) {
    const r = await this.load(user, id);
    const target = dto.to === 'RELEASED' ? 'APPROVED' : dto.to;
    const rule = findIncentiveRule(r.status, target);
    if (!rule || rule.system) throw new AppError('ILLEGAL_TRANSITION', `Cannot move a recommendation from ${r.status} to ${dto.to}`, 409);
    if (!rule.anyOf.some((k) => this.access.has(user, k))) throw forbidden();
    if (r.employeeId === user.userId) throw forbidden('You cannot act on your own incentive');
    const data: Prisma.IncentiveRecommendationUpdateManyMutationInput = {};
    let note: string | null = null;
    let audit = rule.audit;
    let event: string | null = rule.event;
    switch (dto.to) {
      case 'SUBMITTED':
        await assertTargetInScope(this.access, user, 'incentives:recommendation:create', r.employeeId);
        data.submitComments = dto.comments;
        data.submittedAt = new Date();
        note = dto.comments ?? null;
        break;
      case 'CALCULATED': {
        await assertTargetInScope(this.access, user, 'incentives:recommendation:create', r.employeeId);
        const policy = await this.activePolicyFor(user.organizationId, r.periodEnd);
        const { inputs, source } = await this.resolveInputs(user.organizationId, r.employeeId, r.periodStart, r.periodEnd, dto.inputs);
        const structure = incentiveStructureSchema.parse(policy.structure) as IncentiveStructure;
        const result = calculateIncentive(structure, inputs);
        Object.assign(data, { policyId: policy.id, inputs: inputs as unknown as Prisma.InputJsonValue, inputSource: source, breakdown: result as unknown as Prisma.InputJsonValue, computedAmount: new Prisma.Decimal(result.amount), snapshotVersion: { increment: 1 }, submittedAt: null, submitComments: null });
        note = dto.reason;
        break;
      }
      case 'APPROVED': {
        if (r.recommendedById === user.userId) throw forbidden('The recommender cannot approve their own recommendation');
        const approved = new Prisma.Decimal(dto.approvedAmount ?? r.computedAmount.toString());
        if (approved.gt(r.computedAmount) && !dto.overrideReason) throw new AppError('OVERRIDE_REASON_REQUIRED', 'An override reason is required to approve more than the computed amount', 422);
        Object.assign(data, { approvedAmount: approved, overrideReason: dto.overrideReason, decidedById: user.userId, decidedAt: new Date() });
        break;
      }
      case 'REJECTED':
        if (r.recommendedById === user.userId) throw forbidden('The recommender cannot decide their own recommendation');
        Object.assign(data, { rejectionReason: dto.reason, decidedById: user.userId, decidedAt: new Date() });
        note = dto.reason;
        break;
      case 'ON_HOLD':
        data.holdReason = dto.reason;
        note = dto.reason;
        break;
      case 'RELEASED':
        data.holdReason = null;
        audit = 'incentive.released';
        event = 'incentive.released';
        break;
      case 'ADJUSTED':
      case 'WAIVED': {
        const adj = r.adjustments.find((a) => a.id === dto.adjustmentId && a.status === 'PROPOSED');
        if (!adj) throw notFound('Adjustment proposal');
        await this.prisma.incentiveAdjustment.update({ where: { id: adj.id }, data: dto.to === 'ADJUSTED' ? { status: 'APPLIED', decidedAmount: new Prisma.Decimal(dto.decidedAmount), decidedById: user.userId, decidedAt: new Date(), reason: dto.reason, appliedPeriodStart: todayUtc() } : { status: 'WAIVED', decidedById: user.userId, decidedAt: new Date(), reason: dto.reason } });
        note = dto.reason ?? null;
        break;
      }
    }
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.incentiveRecommendation.updateMany({ where: { id, status: r.status, version: r.version }, data: { ...data, status: target, version: { increment: 1 } } });
      if (res.count !== 1) throw conflict('STALE_STATE', 'The recommendation changed; reload and retry');
      await this.log(tx, user, r, r.status, target, audit, event, note);
    });
    return this.get(user, id);
  }

  async markPaid(user: Principal, id: string, dto: Dto<typeof markPaidSchema>) {
    const r = await this.load(user, id);
    if (r.status !== 'APPROVED') throw new AppError('ILLEGAL_TRANSITION', `Cannot mark a ${r.status} recommendation as paid`, 409);
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.incentiveRecommendation.updateMany({ where: { id, status: 'APPROVED', version: r.version }, data: { status: 'PAID', paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(), paidById: user.userId, paymentReference: dto.reference, version: { increment: 1 } } });
      if (res.count !== 1) throw conflict('STALE_STATE', 'The recommendation changed; reload and retry');
      await this.log(tx, user, r, 'APPROVED', 'PAID', 'incentive.paid', 'incentive.paid', null, { payoutExecutedOutsideSalesOS: true });
    });
    return this.get(user, id);
  }

  async adjustments(user: Principal) {
    const where = { ...(await this.access.scopedWhere(user, { permission: 'incentives:recommendation:view', ownerField: 'employeeId' })) };
    if (this.access.scopeLevel(user, 'incentives:recommendation:view') === 'own') return [];
    const rows = await this.prisma.incentiveAdjustment.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 });
    const names = await userNameMap(this.prisma, user.organizationId, rows.map((a) => a.employeeId));
    return rows.map((a) => ({ id: a.id, recommendationId: a.recommendationId, employeeId: a.employeeId, employeeName: names.get(a.employeeId) ?? null, refundId: a.refundId, proposedAmount: a.proposedAmount.toString(), decidedAmount: a.decidedAmount?.toString() ?? null, currency: a.currency, status: a.status, reason: a.reason, createdAt: a.createdAt }));
  }
}

export { INCENTIVE_TERMINAL };
