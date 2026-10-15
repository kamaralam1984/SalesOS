import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type Deal, type DealBlocker } from '@prisma/client';
import { createTaskTx, loadStages, lockLead, transitionLeadTx } from '@salesos/crm-core';
import { REVENUE_EVENTS, type CreditedOwner } from '@salesos/shared-types';
import type { z } from 'zod';
import type { adjustmentSchema, closeDealSchema, createDealSchema, decideAdjustmentSchema, escalateDealSchema, listDealsQuerySchema, reopenDealSchema, resolveBlockerSchema, updateDealSchema } from '@salesos/validation';
import type { Principal } from '../../../common/authz';
import { AppError, notFound } from '../../../common/http/errors';
import { ok } from '../../../common/http/api-result';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { D, OPEN_DEAL_STAGES, ZERO, allocate, canDealTransition, evaluateHighValue, istDate, money, resolveThreshold, round2, serializeDealMoney, sum, addDays, type DealStage } from '../calc';
import { REVENUE_FAULT_INJECTOR, RevenueSupport, dateOnly, hasRole, isUniqueViolation, iso, isoDay, primaryRole, recordAccess, type FaultInjector } from '../revenue.support';
import { DealMoneyService } from './deal-money.service';

type ListQuery = z.infer<typeof listDealsQuerySchema>;
const OPEN_STAGES: DealStage[] = [...OPEN_DEAL_STAGES];
const MANAGER_ROLES = ['SALES_MANAGER', 'SALES_TEAM_LEAD', 'FOUNDER_CEO'];

const and = (where: Record<string, unknown>, ...extra: Prisma.DealWhereInput[]): Prisma.DealWhereInput => {
  const existing = (where.AND as Prisma.DealWhereInput[] | undefined) ?? [];
  return { ...where, AND: [...existing, ...extra] } as Prisma.DealWhereInput;
};

@Injectable()
export class DealsService {
  constructor(
    private readonly s: RevenueSupport,
    private readonly dealMoney: DealMoneyService,
    @Inject(REVENUE_FAULT_INJECTOR) private readonly fault: FaultInjector,
  ) {}

  private get prisma() {
    return this.s.prisma;
  }

  // ---- loading / serialisation -----------------------------------------------------------------------------------
  async loadDeal(user: Principal, id: string, permission: Parameters<RevenueSupport['access']['assertRecordAccess']>[1]): Promise<Deal> {
    const d = await this.prisma.deal.findFirst({ where: { id, organizationId: user.organizationId } });
    await this.s.access.assertRecordAccess(user, permission, d && recordAccess({ organizationId: d.organizationId, ownerId: d.ownerId, teamId: d.teamId }), 'Deal');
    return d!;
  }

  private async lookups(user: Principal, deals: Deal[]) {
    const [leads, programs, names] = await Promise.all([
      this.prisma.lead.findMany({ where: { organizationId: user.organizationId, id: { in: deals.map((d) => d.leadId) } }, select: { id: true, fullName: true, status: true } }),
      this.prisma.program.findMany({ where: { organizationId: user.organizationId, id: { in: deals.flatMap((d) => [d.programId, ...(d.fromProgramId ? [d.fromProgramId] : [])]) } }, select: { id: true, name: true, code: true } }),
      this.s.userNames(deals.map((d) => d.ownerId)),
    ]);
    return { leads: new Map(leads.map((l) => [l.id, l])), programs: new Map(programs.map((p) => [p.id, p])), names };
  }

  private dto(d: Deal, lk: Awaited<ReturnType<DealsService['lookups']>>, summaryOnly: boolean, moneyBlock?: ReturnType<typeof serializeDealMoney> | null) {
    const lead = lk.leads.get(d.leadId);
    const prog = lk.programs.get(d.programId);
    return {
      id: d.id,
      leadId: d.leadId,
      leadName: summaryOnly ? null : lead?.fullName ?? null,
      leadStatus: summaryOnly ? null : lead?.status ?? null,
      programId: d.programId,
      programName: prog?.name ?? null,
      programCode: prog?.code ?? null,
      fromProgramId: d.fromProgramId,
      fromProgramName: d.fromProgramId ? lk.programs.get(d.fromProgramId)?.name ?? null : null,
      ownerId: d.ownerId,
      ownerName: lk.names.get(d.ownerId) ?? null,
      teamId: d.teamId,
      stage: d.stage,
      dealType: d.dealType,
      amount: summaryOnly ? null : money(d.amount),
      currency: d.currency,
      enrolments: d.enrolments,
      expectedCloseOn: isoDay(d.expectedCloseOn),
      isHighValue: summaryOnly ? null : d.isHighValue,
      highValueThreshold: summaryOnly || d.highValueThreshold === null ? null : money(d.highValueThreshold),
      escalationLevel: d.escalationLevel,
      closedAt: iso(d.closedAt),
      lostReason: summaryOnly ? null : d.lostReason,
      note: summaryOnly ? null : d.note,
      money: summaryOnly ? null : moneyBlock ?? null,
      version: d.version,
      createdAt: iso(d.createdAt),
      updatedAt: iso(d.updatedAt),
    };
  }

  private async serializeMany(user: Principal, deals: Deal[]) {
    const summaryOnly = this.s.access.isSummaryOnly(user, 'deals:view');
    const [lk, moneyMap] = await Promise.all([this.lookups(user, deals), summaryOnly ? new Map() : this.dealMoney.forDeals(user.organizationId, deals.filter((d) => d.stage === 'WON' || d.stage === 'CANCELLED').map((d) => d.id))]);
    return deals.map((d) => this.dto(d, lk, summaryOnly, moneyMap.has(d.id) ? serializeDealMoney(moneyMap.get(d.id)!, d.currency) : null));
  }

  // ---- list / pipeline / detail ----------------------------------------------------------------------------------
  private async filters(user: Principal, q: ListQuery): Promise<Prisma.DealWhereInput> {
    const scoped = await this.s.access.scopedWhere(user, { permission: 'deals:view', ownerField: 'ownerId', teamField: 'teamId' });
    const extra: Prisma.DealWhereInput[] = [];
    if (q.stage) extra.push({ stage: { in: q.stage.split(',').map((x) => x.trim()).filter(Boolean) as DealStage[] } });
    if (q.ownerId) extra.push({ ownerId: q.ownerId });
    if (q.teamId) extra.push({ teamId: q.teamId });
    if (q.programId) extra.push({ programId: q.programId });
    if (q.leadId) extra.push({ leadId: q.leadId });
    if (q.dealType) extra.push({ dealType: q.dealType });
    if (q.highValue) {
      // filtering on a hidden field would be an oracle for it
      if (this.s.access.isSummaryOnly(user, 'deals:view')) throw new AppError('VALIDATION_ERROR', 'highValue filter is not available for your role', 400);
      extra.push({ isHighValue: q.highValue === 'true' });
    }
    if (q.expectedFrom) extra.push({ expectedCloseOn: { gte: dateOnly(q.expectedFrom) } });
    if (q.expectedTo) extra.push({ expectedCloseOn: { lte: dateOnly(q.expectedTo) } });
    if (q.closedFrom) extra.push({ closedAt: { gte: dateOnly(q.closedFrom) } });
    if (q.closedTo) extra.push({ closedAt: { lt: dateOnly(addDays(q.closedTo, 1)) } });
    if (q.q) extra.push({ lead: { fullName: { contains: q.q, mode: 'insensitive' } } });
    return and(scoped, ...extra);
  }

  async list(user: Principal, q: ListQuery) {
    const where = await this.filters(user, q);
    const rows = await this.prisma.deal.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const total = q.page ? await this.prisma.deal.count({ where }) : undefined;
    const res = pageResult(rows, q, total);
    return ok(await this.serializeMany(user, res.data as Deal[]), res.meta);
  }

  async listForLead(user: Principal, leadId: string, q: ListQuery) {
    return this.list(user, { ...q, leadId });
  }

  /** Per-stage counts and amounts (scoped) for the pipeline board header. Amounts hidden for summary-only roles. */
  async pipeline(user: Principal) {
    const where = await this.filters(user, {} as ListQuery);
    const rows = await this.prisma.deal.groupBy({ by: ['stage'], where, _count: { _all: true }, _sum: { amount: true } });
    const hv = await this.prisma.deal.groupBy({ by: ['stage'], where: and(where, { isHighValue: true }), _count: { _all: true } });
    const summaryOnly = this.s.access.isSummaryOnly(user, 'deals:view');
    return (['OPEN', 'NEGOTIATION', 'PAYMENT_PENDING', 'WON', 'LOST', 'CANCELLED'] as DealStage[]).map((stage) => {
      const r = rows.find((x) => x.stage === stage);
      return { stage, count: r?._count._all ?? 0, amount: summaryOnly ? null : money(r?._sum.amount ?? ZERO), currency: 'INR', highValueCount: summaryOnly ? null : hv.find((x) => x.stage === stage)?._count._all ?? 0 };
    });
  }

  async get(user: Principal, id: string) {
    const deal = await this.loadDeal(user, id, 'deals:view');
    const summaryOnly = this.s.access.isSummaryOnly(user, 'deals:view');
    const [base] = await this.serializeMany(user, [deal]);
    if (summaryOnly) return base;
    const canPay = this.s.access.has(user, 'collections:view');
    const canRefund = this.s.access.has(user, 'refunds:view');
    const [history, blockers, record, payments, refunds] = await Promise.all([
      this.prisma.dealStatusHistory.findMany({ where: { dealId: id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.dealBlocker.findMany({ where: { dealId: id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.salesRecord.findUnique({ where: { dealId: id }, include: { credits: true, adjustments: { orderBy: { createdAt: 'desc' } } } }),
      canPay ? this.prisma.payment.findMany({ where: { dealId: id, organizationId: user.organizationId }, orderBy: [{ createdAt: 'desc' }] }) : Promise.resolve(null),
      canRefund ? this.prisma.refund.findMany({ where: { dealId: id, organizationId: user.organizationId }, orderBy: [{ createdAt: 'desc' }] }) : Promise.resolve(null),
    ]);
    const names = await this.s.userNames([...history.map((h) => h.changedById), ...blockers.flatMap((b) => [b.raisedById, b.resolvedById]), ...(record?.credits.map((c) => c.userId) ?? []), ...(record?.adjustments.flatMap((a) => [a.createdById, a.approvedById]) ?? [])]);
    const m = base.money ?? (record ? serializeDealMoney((await this.dealMoney.forDeals(user.organizationId, [id])).get(id)!, deal.currency) : null);
    return {
      ...base,
      money: m,
      history: history.map((h) => ({ id: h.id, oldStage: h.oldStage, newStage: h.newStage, reason: h.reason, changedById: h.changedById, changedByName: h.changedById ? names.get(h.changedById) ?? null : null, at: iso(h.createdAt) })),
      blockers: blockers.map((b) => this.blockerDto(b, names)),
      salesRecord: record && {
        id: record.id,
        saleValue: money(record.saleValue),
        currency: record.currency,
        closedAt: iso(record.closedAt),
        credits: record.credits.map((c) => ({ userId: c.userId, userName: names.get(c.userId) ?? null, sharePct: money(c.sharePct), amount: money(c.amount) })),
        adjustments: record.adjustments.map((a) => ({ id: a.id, kind: a.kind, delta: money(a.delta), reason: a.reason, status: a.status, createdById: a.createdById, createdByName: names.get(a.createdById) ?? null, createdAt: iso(a.createdAt), approvedById: a.approvedById, approvedByName: a.approvedById ? names.get(a.approvedById) ?? null : null, approvedAt: iso(a.approvedAt), decisionNote: a.decisionNote })),
      },
      payments: payments && payments.map((p) => ({ id: p.id, status: p.status, amount: money(p.amount), expectedAmount: p.expectedAmount ? money(p.expectedAmount) : null, dueDate: isoDay(p.dueDate), method: p.method, provider: p.provider, externalTransactionRef: p.externalTransactionRef, paidAt: iso(p.paidAt), verifiedAt: iso(p.verifiedAt), createdAt: iso(p.createdAt) })),
      refunds: refunds && refunds.map((r) => ({ id: r.id, status: r.status, amount: money(r.amount), approvedAmount: r.approvedAmount ? money(r.approvedAmount) : null, processedAmount: r.processedAmount ? money(r.processedAmount) : null, reasonCategory: r.reasonCategory, requestedAt: iso(r.requestedAt) })),
    };
  }

  private blockerDto(b: DealBlocker, names: Map<string, string>) {
    return { id: b.id, kind: b.kind, note: b.note, requestedHelp: b.requestedHelp, raisedById: b.raisedById, raisedByName: b.raisedById ? names.get(b.raisedById) ?? null : null, escalatedToIds: b.escalatedToIds, resolvedAt: iso(b.resolvedAt), resolvedById: b.resolvedById, resolvedByName: b.resolvedById ? names.get(b.resolvedById) ?? null : null, resolution: b.resolution, createdAt: iso(b.createdAt) };
  }

  // ---- create ----------------------------------------------------------------------------------------------------
  async createForLead(user: Principal, leadId: string, b: z.infer<typeof createDealSchema>, idempotencyKey?: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, organizationId: user.organizationId, mergedIntoId: null } });
    await this.s.access.assertRecordAccess(user, 'deals:create', lead && { organizationId: lead.organizationId, ownerId: lead.assignedToId, teamId: lead.teamId }, 'Lead');
    if (idempotencyKey) {
      const existing = await this.prisma.deal.findFirst({ where: { organizationId: user.organizationId, createKey: idempotencyKey } });
      if (existing) return this.replayDto(user, existing);
    }
    const l = lead!;
    const wantsWon = b.dealType !== 'NEW';
    if (wantsWon ? l.stageCategory !== 'WON' : l.stageCategory !== 'OPEN') {
      throw new AppError('LEAD_NOT_ELIGIBLE', wantsWon ? 'Upsell and cross-sell deals need a lead that already bought (Won)' : 'A new deal needs an open lead (not Lost, Nurture or already Won)', 422, { leadStatus: l.status, stageCategory: l.stageCategory });
    }
    const program = await this.prisma.program.findFirst({ where: { id: b.programId, organizationId: user.organizationId, isActive: true } });
    if (!program) throw notFound('Program');
    if (b.fromProgramId && !(await this.prisma.program.findFirst({ where: { id: b.fromProgramId, organizationId: user.organizationId } }))) throw notFound('Program');
    let ownerId = b.ownerId ?? l.assignedToId ?? user.userId;
    if (ownerId !== user.userId) {
      const o = await this.s.assertUserInScope(user, 'deals:create', ownerId);
      if (!o.roles.some((r) => ['SALES_EXECUTIVE', 'SALES_MANAGER', 'SALES_TEAM_LEAD', 'FOUNDER_CEO'].includes(r))) throw new AppError('TARGET_NOT_SALES', 'The deal owner must be a sales user', 422);
      ownerId = o.id;
    }
    const open = await this.prisma.deal.findFirst({ where: { organizationId: user.organizationId, leadId, programId: b.programId, stage: { in: OPEN_STAGES } }, select: { id: true } });
    if (open) throw new AppError('DUPLICATE_OPEN_DEAL', 'This lead already has an open deal for this program', 409, { dealId: open.id });
    const teamId = l.teamId ?? (await this.s.teamOf(this.prisma, ownerId));
    try {
      const created = await this.s.tx(async (tx) => {
        const d = await tx.deal.create({
          data: { organizationId: user.organizationId, leadId, programId: b.programId, fromProgramId: b.fromProgramId ?? null, ownerId, teamId, stage: 'OPEN', dealType: b.dealType, amount: round2(b.amount), currency: 'INR', enrolments: b.enrolments, expectedCloseOn: b.expectedCloseOn ? dateOnly(b.expectedCloseOn) : null, note: b.note ?? null, createKey: idempotencyKey ?? null, createdById: user.userId },
        });
        await tx.dealStatusHistory.create({ data: { organizationId: user.organizationId, dealId: d.id, oldStage: null, newStage: 'OPEN', changedById: user.userId, reason: 'Deal created' } });
        await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'deal.created', entityType: 'deal', entityId: d.id, metadata: { leadId, programId: b.programId, amount: money(d.amount), dealType: d.dealType } });
        await this.s.publish(tx, { eventType: REVENUE_EVENTS.DEAL_CREATED, aggregateType: 'deal', aggregateId: d.id, organizationId: user.organizationId, payload: { dealId: d.id, leadId, programId: d.programId, ownerId, amount: money(d.amount), currency: d.currency, dealType: d.dealType }, idempotencyKey: `deal.created:${d.id}` });
        return this.applyHighValue(tx, user, d);
      });
      return (await this.serializeMany(user, [created]))[0];
    } catch (e) {
      if (isUniqueViolation(e) && idempotencyKey) {
        const existing = await this.prisma.deal.findFirst({ where: { organizationId: user.organizationId, createKey: idempotencyKey } });
        if (existing) return this.replayDto(user, existing);
      }
      throw e;
    }
  }

  private async replayDto(user: Principal, d: Deal) {
    return { ...(await this.serializeMany(user, [d]))[0], replayed: true };
  }

  /** DEC-027: evaluates the threshold and, on breach, flags + escalates in the SAME transaction (idempotent per level). */
  private async applyHighValue(tx: Prisma.TransactionClient, user: Principal, deal: Deal): Promise<Deal> {
    if (!OPEN_STAGES.includes(deal.stage)) return deal;
    const [cfg, settings, recent] = await Promise.all([
      tx.programRevenueConfig.findUnique({ where: { programId: deal.programId } }),
      this.s.settings(tx, user.organizationId),
      tx.deal.findMany({ where: { organizationId: user.organizationId, id: { not: deal.id }, stage: { in: OPEN_STAGES }, createdAt: { gte: new Date(Date.now() - 90 * 86_400_000) } }, select: { amount: true }, take: 5000 }),
    ]);
    const verdict = evaluateHighValue(deal.amount, resolveThreshold({ program: cfg?.highValueThreshold ?? null, orgDefault: settings.defaultHighValueThreshold, recentOpenAmounts: recent.map((r) => r.amount) }));
    if (!verdict.isHighValue) return deal;
    if (deal.isHighValue && deal.escalationLevel >= verdict.escalationLevel) return deal;
    const level = verdict.escalationLevel;
    const tls = await this.s.usersWithRoles(user.organizationId, ['SALES_TEAM_LEAD'], tx);
    const founders = level === 2 ? await this.s.usersWithRoles(user.organizationId, ['FOUNDER_CEO'], tx) : [];
    const notified = [...new Set([...tls, ...founders])];
    const updated = await tx.deal.update({ where: { id: deal.id }, data: { isHighValue: true, highValueFlaggedAt: deal.highValueFlaggedAt ?? new Date(), highValueThreshold: verdict.threshold, escalationLevel: level } });
    const blocker = await tx.dealBlocker.create({
      data: { organizationId: user.organizationId, dealId: deal.id, kind: 'HIGH_VALUE', note: `Auto-flagged high value: ${money(deal.amount)} INR exceeds the ${verdict.source.toLowerCase().replace(/_/g, ' ')} threshold ${money(verdict.threshold!)} INR`, raisedById: user.userId, escalatedToIds: notified },
    });
    await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'deal.high_value_flagged', entityType: 'deal', entityId: deal.id, metadata: { amount: money(deal.amount), threshold: money(verdict.threshold!), source: verdict.source, level } });
    const payload = { dealId: deal.id, blockerId: blocker.id, kind: 'HIGH_VALUE', amount: money(deal.amount), currency: deal.currency, escalationLevel: level, notifiedUserIds: notified };
    await this.s.publish(tx, { eventType: REVENUE_EVENTS.DEAL_HIGH_VALUE, aggregateType: 'deal', aggregateId: deal.id, organizationId: user.organizationId, payload, idempotencyKey: `deal.high_value:${deal.id}:${level}` });
    await this.s.publish(tx, { eventType: REVENUE_EVENTS.DEAL_ESCALATED, aggregateType: 'deal', aggregateId: deal.id, organizationId: user.organizationId, payload, idempotencyKey: `deal.escalated:${blocker.id}` });
    await this.s.notify(tx, { organizationId: user.organizationId, type: 'founder.action_item', userIds: notified, dedupeKey: `deal.high_value:${deal.id}:${level}`, title: level === 2 ? 'Very high-value deal needs the Founder' : 'High-value deal needs the Team Lead', body: `A deal of ${money(deal.amount)} INR passed the high-value threshold. Review blockers and step in.`, entity: { type: 'deal', id: deal.id }, actionUrl: `/revenue/deals/${deal.id}`, severity: 'WARNING' });
    return updated;
  }

  // ---- update (stage within the open pipeline, amount, expected close) -------------------------------------------
  async update(user: Principal, id: string, b: z.infer<typeof updateDealSchema>) {
    const before = await this.loadDeal(user, id, 'deals:update');
    const updated = await this.s.tx(async (tx) => {
      const d = await this.s.lockDeal(tx, user.organizationId, id);
      if (!OPEN_STAGES.includes(d.stage)) throw new AppError('DEAL_CLOSED', 'Only open deals can be edited. Use an adjustment record to correct a booked sale.', 409);
      if (b.version !== undefined && b.version !== d.version) throw new AppError('VERSION_CONFLICT', 'The deal was changed by someone else; reload and retry', 409);
      const data: Prisma.DealUncheckedUpdateInput = { version: { increment: 1 } };
      if (b.amount !== undefined) data.amount = round2(b.amount);
      if (b.expectedCloseOn !== undefined) data.expectedCloseOn = b.expectedCloseOn ? dateOnly(b.expectedCloseOn) : null;
      if (b.note !== undefined) data.note = b.note;
      if (b.stage !== undefined && b.stage !== d.stage) {
        if (!canDealTransition(d.stage as DealStage, b.stage as DealStage)) throw new AppError('INVALID_TRANSITION', `A deal cannot move from ${d.stage} to ${b.stage}`, 409, { from: d.stage, to: b.stage });
        data.stage = b.stage;
      }
      const u = await tx.deal.update({ where: { id }, data });
      if (data.stage) {
        await tx.dealStatusHistory.create({ data: { organizationId: user.organizationId, dealId: id, oldStage: d.stage, newStage: u.stage, changedById: user.userId, reason: b.reason ?? null } });
        await this.s.publish(tx, { eventType: REVENUE_EVENTS.DEAL_STATUS_CHANGED, aggregateType: 'deal', aggregateId: id, organizationId: user.organizationId, payload: { dealId: id, from: d.stage, to: u.stage, changedById: user.userId }, idempotencyKey: `deal.status_changed:${id}:${u.version}` });
      }
      await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: data.stage ? 'deal.status_changed' : 'deal.updated', entityType: 'deal', entityId: id, metadata: { from: d.stage, to: u.stage, amountFrom: money(d.amount), amountTo: money(u.amount), reason: b.reason ?? null } });
      return this.applyHighValue(tx, user, u);
    });
    void before;
    return (await this.serializeMany(user, [updated]))[0];
  }

  // ---- escalation / blockers -------------------------------------------------------------------------------------
  async escalate(user: Principal, id: string, b: z.infer<typeof escalateDealSchema>) {
    const deal = await this.loadDeal(user, id, 'deals:escalate');
    if (!OPEN_STAGES.includes(deal.stage)) throw new AppError('DEAL_CLOSED', 'Only open deals can be escalated', 409);
    const blocker = await this.s.tx(async (tx) => {
      const tls = await this.s.usersWithRoles(user.organizationId, ['SALES_TEAM_LEAD'], tx);
      const toFounder = b.escalateToFounder || deal.escalationLevel >= 2;
      const founders = toFounder ? await this.s.usersWithRoles(user.organizationId, ['FOUNDER_CEO'], tx) : [];
      const notified = [...new Set([...tls, ...founders])];
      const created = await tx.dealBlocker.create({ data: { organizationId: user.organizationId, dealId: id, kind: 'BLOCKER', note: b.note, requestedHelp: b.requestedHelp ?? null, raisedById: user.userId, escalatedToIds: notified } });
      const level = Math.max(deal.escalationLevel, toFounder ? 2 : 1);
      if (level !== deal.escalationLevel) await tx.deal.update({ where: { id }, data: { escalationLevel: level } });
      await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'deal.escalated', entityType: 'deal', entityId: id, metadata: { blockerId: created.id, level, toFounder } });
      await this.s.publish(tx, { eventType: REVENUE_EVENTS.DEAL_ESCALATED, aggregateType: 'deal', aggregateId: id, organizationId: user.organizationId, payload: { dealId: id, blockerId: created.id, kind: 'BLOCKER', amount: money(deal.amount), currency: deal.currency, escalationLevel: level, notifiedUserIds: notified }, idempotencyKey: `deal.escalated:${created.id}` });
      await this.s.notify(tx, { organizationId: user.organizationId, type: 'founder.action_item', userIds: notified, dedupeKey: `deal.escalated:${created.id}`, title: 'Deal escalated with a blocker', body: 'A deal needs help to close. Open it to read the blocker note.', entity: { type: 'deal', id }, actionUrl: `/revenue/deals/${id}`, severity: 'WARNING' });
      return created;
    });
    return this.blockerDto(blocker, await this.s.userNames([blocker.raisedById]));
  }

  async resolveBlocker(user: Principal, id: string, blockerId: string, b: z.infer<typeof resolveBlockerSchema>) {
    await this.loadDeal(user, id, 'deals:escalate');
    const now = new Date();
    const cas = await this.prisma.dealBlocker.updateMany({ where: { id: blockerId, dealId: id, organizationId: user.organizationId, resolvedAt: null }, data: { resolvedAt: now, resolvedById: user.userId, resolution: b.resolution } });
    if (cas.count !== 1) {
      const exists = await this.prisma.dealBlocker.findFirst({ where: { id: blockerId, dealId: id, organizationId: user.organizationId } });
      if (!exists) throw notFound('Blocker');
      throw new AppError('INVALID_TRANSITION', 'This blocker is already resolved', 409);
    }
    await this.s.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'deal.blocker_resolved', entityType: 'deal', entityId: id, metadata: { blockerId } });
    const row = await this.prisma.dealBlocker.findUniqueOrThrow({ where: { id: blockerId } });
    return this.blockerDto(row, await this.s.userNames([row.raisedById, row.resolvedById]));
  }

  // ---- close (ONE transaction) -----------------------------------------------------------------------------------
  async close(user: Principal, id: string, b: z.infer<typeof closeDealSchema>, idempotencyKey?: string) {
    const deal = await this.loadDeal(user, id, 'deals:close');
    return b.outcome === 'WON' ? this.closeWon(user, deal, b, idempotencyKey) : this.closeLost(user, deal, b, idempotencyKey);
  }

  private async closeResult(user: Principal, dealId: string, replayed: boolean) {
    const d = await this.prisma.deal.findUniqueOrThrow({ where: { id: dealId } });
    const [dto] = await this.serializeMany(user, [d]);
    return { ...dto, replayed };
  }

  private async closeWon(user: Principal, deal: Deal, b: Extract<z.infer<typeof closeDealSchema>, { outcome: 'WON' }>, idempotencyKey?: string) {
    if (deal.stage === 'WON') return this.closeResult(user, deal.id, true);
    if (!OPEN_STAGES.includes(deal.stage)) throw new AppError('INVALID_TRANSITION', `A ${deal.stage} deal cannot be closed won`, 409, { stage: deal.stage });
    const credits = b.credits?.length ? b.credits : [{ userId: deal.ownerId, sharePct: '100' }];
    const pctTotal = sum(credits.map((c) => c.sharePct));
    if (!pctTotal.equals(100)) throw new AppError('CREDIT_SPLIT_INVALID', 'Credit shares must add up to exactly 100%', 422, { total: pctTotal.toFixed(2) });
    if (new Set(credits.map((c) => c.userId)).size !== credits.length) throw new AppError('CREDIT_SPLIT_INVALID', 'A user can appear only once in the credit split', 422);
    if (credits.length > 1 && !this.s.access.has(user, 'targets:approve')) throw new AppError('SPLIT_REQUIRES_TEAM_LEAD', 'A shared-credit sale needs Team Lead approval: ask a Team Lead or Founder to close it', 403);
    const creditUsers = await this.prisma.user.findMany({ where: { organizationId: user.organizationId, isActive: true, id: { in: credits.map((c) => c.userId) } }, select: { id: true } });
    if (creditUsers.length !== credits.length) throw new AppError('CREDIT_SPLIT_INVALID', 'Every credited user must be an active user of this organisation', 422);
    const now = new Date();
    const closedAt = b.closedAt ? new Date(b.closedAt) : now;
    if (closedAt.getTime() > now.getTime() + 5 * 60_000) throw new AppError('VALIDATION_ERROR', 'The close time cannot be in the future', 422);
    const final = D(b.finalAmount);
    const settings = await this.s.settings(this.prisma, user.organizationId);
    const plan = b.paymentPlan?.length ? b.paymentPlan : [{ amount: money(final), dueDate: addDays(istDate(closedAt), settings.defaultPaymentDueDays) }];
    if (!sum(plan.map((p) => p.amount)).equals(final)) throw new AppError('PAYMENT_PLAN_MISMATCH', 'The payment plan must add up to the final amount', 422, { planTotal: money(sum(plan.map((p) => p.amount))), finalAmount: money(final) });
    const shares = allocate(final, credits.map((c) => ({ key: c.userId, pct: c.sharePct })));

    let result: { replayed: boolean };
    try {
      result = await this.s.tx(async (tx) => {
        const d = await this.s.lockDeal(tx, user.organizationId, deal.id);
        if (d.stage === 'WON') return { replayed: true };
        if (!OPEN_STAGES.includes(d.stage)) throw new AppError('INVALID_TRANSITION', `A ${d.stage} deal cannot be closed won`, 409, { stage: d.stage });

        // 1. lead status history through the CRM service interface (crm-core), same transaction
        const lead = await lockLead(tx, user.organizationId, d.leadId);
        if (lead.stageCategory !== 'WON') {
          const stages = await loadStages(tx, user.organizationId);
          await transitionLeadTx(tx, this.s.deps, { lead, stages, toKey: 'WON', actorId: user.userId, source: 'MANUAL', reason: 'Deal closed won', wonValue: final.toFixed(2), wonAt: closedAt });
        }
        await this.fault('after_lead_transition');

        // 2. deal + immutable sales record + credit split
        const u = await tx.deal.update({ where: { id: d.id }, data: { stage: 'WON', amount: final, closedAt, closeKey: idempotencyKey ?? null, version: { increment: 1 } } });
        const record = await tx.salesRecord.create({
          data: { organizationId: user.organizationId, dealId: d.id, leadId: d.leadId, programId: d.programId, dealType: d.dealType, saleValue: final, currency: 'INR', enrolments: d.enrolments, closedAt, createdById: user.userId },
        });
        await tx.salesCredit.createMany({ data: credits.map((c, i) => ({ salesRecordId: record.id, organizationId: user.organizationId, userId: c.userId, sharePct: D(c.sharePct).toDecimalPlaces(2), amount: shares[i]!.amount })) });
        await tx.dealStatusHistory.create({ data: { organizationId: user.organizationId, dealId: d.id, oldStage: d.stage, newStage: 'WON', changedById: user.userId, reason: b.note ?? 'Closed won' } });
        await this.fault('after_sales_record');

        // 3. expected collections (Closed-Won is NOT paid)
        for (const item of plan) {
          const p = await tx.payment.create({ data: { organizationId: user.organizationId, dealId: d.id, ownerId: d.ownerId, teamId: d.teamId, status: 'EXPECTED', amount: D(item.amount), expectedAmount: D(item.amount), currency: 'INR', dueDate: dateOnly(item.dueDate) } });
          await tx.paymentEvent.create({ data: { organizationId: user.organizationId, paymentId: p.id, fromStatus: null, toStatus: 'EXPECTED', actorId: user.userId, actorRole: primaryRole(user), reason: 'Expected at close' } });
          await this.s.publish(tx, { eventType: REVENUE_EVENTS.PAYMENT_EXPECTED, aggregateType: 'payment', aggregateId: p.id, organizationId: user.organizationId, payload: { paymentId: p.id, dealId: d.id, status: 'EXPECTED', amount: money(item.amount), currency: 'INR', ownerId: d.ownerId, actorId: user.userId, externalTransactionRef: null, provider: 'MANUAL', creditedOwners: credits.map((c) => ({ userId: c.userId, sharePct: money(c.sharePct) })), at: now.toISOString() }, idempotencyKey: `payment.expected:${p.id}` });
        }
        await this.fault('after_payments');

        // 4. follow-up / onboarding tasks (after the lead transition, which closes the lead's open tasks)
        const firstDue = plan.map((p) => p.dueDate).sort()[0]!;
        const dueAt = new Date(`${firstDue}T04:30:00.000Z`);
        await createTaskTx(tx, this.s.deps, { organizationId: user.organizationId, leadId: d.leadId, assignedToId: d.ownerId, createdById: user.userId, teamId: d.teamId, type: 'ONBOARDING', title: 'Start learner onboarding and handover', dueAt: new Date(now.getTime() + 24 * 3_600_000), priority: 'HIGH', idempotencyKey: `deal:${d.id}:onboarding`, ruleKey: 'DEAL_WON' });
        await createTaskTx(tx, this.s.deps, { organizationId: user.organizationId, leadId: d.leadId, assignedToId: d.ownerId, createdById: user.userId, teamId: d.teamId, type: 'FOLLOW_UP', title: 'Follow up on the first payment', dueAt: dueAt > now ? dueAt : new Date(now.getTime() + 3_600_000), priority: 'NORMAL', idempotencyKey: `deal:${d.id}:payment-followup`, ruleKey: 'DEAL_WON' });
        await this.fault('after_tasks');

        // 5. audit + outbox
        await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'deal.closed', entityType: 'deal', entityId: d.id, metadata: { outcome: 'WON', saleValue: money(final), credits: credits.map((c) => ({ userId: c.userId, sharePct: money(c.sharePct) })), installments: plan.length } });
        const payload = { dealId: d.id, leadId: d.leadId, programId: d.programId, outcome: 'WON', ownerId: d.ownerId, saleValue: money(final), currency: 'INR', closedAt: closedAt.toISOString(), dealType: d.dealType, creditedOwners: credits.map((c): CreditedOwner => ({ userId: c.userId, sharePct: money(c.sharePct) })), lostReason: null };
        await this.s.publish(tx, { eventType: REVENUE_EVENTS.DEAL_CLOSED, aggregateType: 'deal', aggregateId: d.id, organizationId: user.organizationId, payload, idempotencyKey: `deal.closed:${d.id}` });
        void u;
        return { replayed: false };
      });
    } catch (e) {
      if (isUniqueViolation(e)) return this.closeResult(user, deal.id, true); // lost a close race: the other transaction won
      throw e;
    }
    return this.closeResult(user, deal.id, result.replayed);
  }

  private async closeLost(user: Principal, deal: Deal, b: Extract<z.infer<typeof closeDealSchema>, { outcome: 'LOST' }>, idempotencyKey?: string) {
    if (deal.stage === 'LOST') return this.closeResult(user, deal.id, true);
    if (!OPEN_STAGES.includes(deal.stage)) throw new AppError('INVALID_TRANSITION', `A ${deal.stage} deal cannot be closed lost`, 409, { stage: deal.stage });
    const res = await this.s.tx(async (tx) => {
      const d = await this.s.lockDeal(tx, user.organizationId, deal.id);
      if (d.stage === 'LOST') return { replayed: true };
      if (!OPEN_STAGES.includes(d.stage)) throw new AppError('INVALID_TRANSITION', `A ${d.stage} deal cannot be closed lost`, 409, { stage: d.stage });
      const lead = await lockLead(tx, user.organizationId, d.leadId);
      if (lead.stageCategory === 'OPEN') {
        const stages = await loadStages(tx, user.organizationId);
        await transitionLeadTx(tx, this.s.deps, { lead, stages, toKey: 'LOST', actorId: user.userId, source: 'MANUAL', reason: 'Deal closed lost', lostReason: b.lostReason, lostNote: b.lostNote ?? null });
      }
      const now = new Date();
      await tx.deal.update({ where: { id: d.id }, data: { stage: 'LOST', closedAt: now, lostReason: b.lostReason, lostNote: b.lostNote ?? null, closeKey: idempotencyKey ?? null, version: { increment: 1 } } });
      await tx.dealStatusHistory.create({ data: { organizationId: user.organizationId, dealId: d.id, oldStage: d.stage, newStage: 'LOST', changedById: user.userId, reason: b.lostReason } });
      await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'deal.closed', entityType: 'deal', entityId: d.id, metadata: { outcome: 'LOST', lostReason: b.lostReason } });
      await this.s.publish(tx, { eventType: REVENUE_EVENTS.DEAL_CLOSED, aggregateType: 'deal', aggregateId: d.id, organizationId: user.organizationId, payload: { dealId: d.id, leadId: d.leadId, programId: d.programId, outcome: 'LOST', ownerId: d.ownerId, saleValue: null, currency: d.currency, closedAt: now.toISOString(), dealType: d.dealType, creditedOwners: [], lostReason: b.lostReason }, idempotencyKey: `deal.closed:${d.id}` });
      return { replayed: false };
    });
    return this.closeResult(user, deal.id, res.replayed);
  }

  // ---- reopen ----------------------------------------------------------------------------------------------------
  async reopen(user: Principal, id: string, b: z.infer<typeof reopenDealSchema>) {
    const deal = await this.loadDeal(user, id, 'deals:update');
    if (!hasRole(user, ...MANAGER_ROLES)) throw new AppError('FORBIDDEN', 'Only a Manager, Team Lead or Founder can reopen a lost deal', 403);
    if (deal.stage === 'WON') throw new AppError('INVALID_TRANSITION', 'A won deal cannot be reopened; create a new deal or record an adjustment', 409);
    if (deal.stage !== 'LOST') throw new AppError('INVALID_TRANSITION', 'Only lost deals can be reopened', 409);
    await this.s.tx(async (tx) => {
      const d = await this.s.lockDeal(tx, user.organizationId, id);
      if (d.stage !== 'LOST') throw new AppError('INVALID_TRANSITION', 'Only lost deals can be reopened', 409);
      const lead = await lockLead(tx, user.organizationId, d.leadId);
      if (lead.stageCategory === 'LOST' || lead.stageCategory === 'NURTURE') {
        const stages = await loadStages(tx, user.organizationId);
        await transitionLeadTx(tx, this.s.deps, { lead, stages, toKey: 'CONTACT_ATTEMPTED', actorId: user.userId, source: 'MANUAL', reason: b.reason });
      }
      await tx.deal.update({ where: { id }, data: { stage: 'OPEN', closedAt: null, lostReason: null, lostNote: null, version: { increment: 1 } } });
      await tx.dealStatusHistory.create({ data: { organizationId: user.organizationId, dealId: id, oldStage: 'LOST', newStage: 'OPEN', changedById: user.userId, reason: b.reason } });
      await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'deal.reopened', entityType: 'deal', entityId: id, metadata: { reason: b.reason } });
      await this.s.publish(tx, { eventType: REVENUE_EVENTS.DEAL_REOPENED, aggregateType: 'deal', aggregateId: id, organizationId: user.organizationId, payload: { dealId: id, reopenedById: user.userId, reason: b.reason }, idempotencyKey: `deal.reopened:${id}:${d.version}` });
    });
    return this.get(user, id);
  }

  // ---- adjustments (corrections never rewrite history) -----------------------------------------------------------
  async createAdjustment(user: Principal, id: string, b: z.infer<typeof adjustmentSchema>) {
    const deal = await this.loadDeal(user, id, 'sales-adjustments:create');
    const selfApproving = hasRole(user, 'FOUNDER_CEO', 'FINANCE');
    if (b.kind === 'CANCELLATION' && !selfApproving) throw new AppError('FORBIDDEN', 'Only the Founder or Finance can cancel a sale', 403);
    const res = await this.s.tx(async (tx) => {
      const d = await this.s.lockDeal(tx, user.organizationId, id);
      if (d.stage !== 'WON') throw new AppError('INVALID_TRANSITION', 'Only a won (booked) deal has a sale to adjust', 409, { stage: d.stage });
      const record = await tx.salesRecord.findUniqueOrThrow({ where: { dealId: id }, include: { credits: true, adjustments: { where: { status: 'APPROVED' } } } });
      const net = D(record.saleValue).plus(sum(record.adjustments.map((a) => a.delta)));
      let delta: Prisma.Decimal;
      if (b.kind === 'CANCELLATION') {
        delta = net.negated();
        const live = await tx.refund.count({ where: { dealId: id, status: { in: ['REQUESTED', 'REVIEWED', 'APPROVED'] } } });
        if (live > 0) throw new AppError('REFUND_IN_PROGRESS', 'Finish (process, reject or cancel) the refunds of this deal before cancelling the sale', 409);
      } else {
        if (!b.delta) throw new AppError('VALIDATION_ERROR', 'An adjustment needs a non-zero delta', 422);
        delta = D(b.delta);
        if (net.plus(delta).isNegative()) throw new AppError('ADJUSTMENT_INVALID', 'The adjustment would make the sale value negative', 422, { netSaleValue: money(net), delta: money(delta) });
        if (b.kind === 'DISCOUNT' && delta.isPositive()) throw new AppError('ADJUSTMENT_INVALID', 'A discount must reduce the sale value (negative delta)', 422);
      }
      const allocations = allocate(delta, record.credits.map((c) => ({ key: c.userId, pct: c.sharePct }))).map((a) => ({ userId: a.key, amount: money(a.amount) }));
      const status = selfApproving ? 'APPROVED' : 'PENDING';
      const adj = await tx.saleAdjustment.create({
        data: { organizationId: user.organizationId, salesRecordId: record.id, dealId: id, kind: b.kind, delta, currency: record.currency, reason: b.reason, status, creditAllocations: allocations, createdById: user.userId, approvedById: selfApproving ? user.userId : null, approvedAt: selfApproving ? new Date() : null },
      });
      if (status === 'APPROVED' && b.kind === 'CANCELLATION') await tx.deal.update({ where: { id }, data: { stage: 'CANCELLED', cancelledAt: new Date(), cancelReason: b.reason, version: { increment: 1 } } });
      if (status === 'APPROVED' && b.kind === 'CANCELLATION') await tx.dealStatusHistory.create({ data: { organizationId: user.organizationId, dealId: id, oldStage: 'WON', newStage: 'CANCELLED', changedById: user.userId, reason: b.reason } });
      await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'sale.adjusted', entityType: 'deal', entityId: id, metadata: { adjustmentId: adj.id, kind: b.kind, delta: money(delta), status, reason: b.reason } });
      await this.s.publish(tx, { eventType: REVENUE_EVENTS.SALE_ADJUSTED, aggregateType: 'deal', aggregateId: id, organizationId: user.organizationId, payload: { dealId: id, adjustmentId: adj.id, kind: b.kind, delta: money(delta), status, currency: record.currency }, idempotencyKey: `sale.adjusted:${adj.id}` });
      if (status === 'APPROVED' && b.kind === 'CANCELLATION') await this.s.publish(tx, { eventType: REVENUE_EVENTS.DEAL_CANCELLED, aggregateType: 'deal', aggregateId: id, organizationId: user.organizationId, payload: { dealId: id, adjustmentId: adj.id, cancelledById: user.userId }, idempotencyKey: `deal.cancelled:${id}` });
      if (status === 'PENDING') await this.s.notify(tx, { organizationId: user.organizationId, type: 'founder.action_item', roles: ['FOUNDER_CEO', 'FINANCE'], dedupeKey: `sale.adjustment:${adj.id}`, title: 'Sale adjustment awaiting approval', body: 'A Team Lead proposed an adjustment to a booked sale.', entity: { type: 'deal', id }, actionUrl: `/revenue/deals/${id}` });
      return adj;
    });
    void deal;
    return { id: res.id, status: res.status, kind: res.kind, delta: money(res.delta), reason: res.reason };
  }

  async decideAdjustment(user: Principal, id: string, adjustmentId: string, b: z.infer<typeof decideAdjustmentSchema>) {
    await this.loadDeal(user, id, 'sales-adjustments:create');
    if (!hasRole(user, 'FOUNDER_CEO', 'FINANCE')) throw new AppError('FORBIDDEN', 'Only the Founder or Finance can decide a sale adjustment', 403);
    const adj = await this.prisma.saleAdjustment.findFirst({ where: { id: adjustmentId, dealId: id, organizationId: user.organizationId } });
    if (!adj) throw notFound('Adjustment');
    if (adj.createdById === user.userId) throw new AppError('SEPARATION_OF_DUTIES', 'You cannot approve your own adjustment', 403);
    const approve = b.decision === 'approve';
    await this.s.tx(async (tx) => {
      await this.s.lockDeal(tx, user.organizationId, id);
      const cas = await tx.saleAdjustment.updateMany({ where: { id: adj.id, status: 'PENDING' }, data: { status: approve ? 'APPROVED' : 'REJECTED', approvedById: user.userId, approvedAt: new Date(), decisionNote: b.note ?? null } });
      if (cas.count !== 1) throw new AppError('INVALID_TRANSITION', 'This adjustment has already been decided', 409);
      if (approve && adj.kind === 'CANCELLATION') {
        await tx.deal.update({ where: { id }, data: { stage: 'CANCELLED', cancelledAt: new Date(), cancelReason: adj.reason, version: { increment: 1 } } });
        await tx.dealStatusHistory.create({ data: { organizationId: user.organizationId, dealId: id, oldStage: 'WON', newStage: 'CANCELLED', changedById: user.userId, reason: adj.reason } });
      }
      await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: approve ? 'sale.adjustment_approved' : 'sale.adjustment_rejected', entityType: 'deal', entityId: id, metadata: { adjustmentId: adj.id, delta: money(adj.delta), note: b.note ?? null } });
    });
    return { id: adj.id, status: approve ? 'APPROVED' : 'REJECTED' };
  }
}
