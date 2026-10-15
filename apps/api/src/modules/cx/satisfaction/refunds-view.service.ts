import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { listRefundsViewQuerySchema, refundAnalyticsQuerySchema, tagRefundRootCauseSchema } from '@salesos/validation';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { notFound } from '../../../common/http/errors';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService } from '../../../common/prisma';
import { userNameMap, withData } from '../common/support';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;

/**
 * Refund TRACKING VIEW (JD-CX-009, MS-CX-001). Reads the revenue domain's refunds; it never changes a refund and holds no copy of
 * the refund logic. Requested / approved / processed are reported as three separate facts (own amounts, timestamps, actors).
 * The CX-owned part is the root-cause tag (refund_root_causes) plus the like-for-like analytics INPUTS for Phase 5.
 */
@Injectable()
export class RefundsViewService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService) {}

  private where(user: Principal) {
    return this.access.scopedWhere(user, { permission: 'refunds:view', ownerField: 'ownerId', teamField: 'teamId' }) as Promise<Prisma.RefundWhereInput>;
  }

  async list(user: Principal, q: Dto<typeof listRefundsViewQuerySchema>) {
    const summary = this.access.isSummaryOnly(user, 'refunds:view');
    const f: Prisma.RefundWhereInput = { ...(q.status ? { status: q.status as Prisma.RefundWhereInput['status'] } : {}), ...(q.dealId ? { dealId: q.dealId } : {}) };
    const rows = await this.prisma.refund.findMany({ where: { AND: [await this.where(user), f] }, orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const ids = res.data.map((r) => r.id);
    const [tags, deals] = await Promise.all([
      this.prisma.refundRootCause.findMany({ where: { organizationId: user.organizationId, refundId: { in: ids } } }),
      this.prisma.deal.findMany({ where: { organizationId: user.organizationId, id: { in: res.data.map((r) => r.dealId) } }, select: { id: true, leadId: true, programId: true } }),
    ]);
    const tagBy = new Map(tags.map((t) => [t.refundId, t]));
    const dealBy = new Map(deals.map((d) => [d.id, d]));
    const [leads, programs] = await Promise.all([
      this.prisma.lead.findMany({ where: { organizationId: user.organizationId, id: { in: deals.map((d) => d.leadId) } }, select: { id: true, fullName: true } }),
      this.prisma.program.findMany({ where: { organizationId: user.organizationId, id: { in: deals.map((d) => d.programId) } }, select: { id: true, name: true } }),
    ]);
    const ln = new Map(leads.map((l) => [l.id, l.fullName]));
    const pn = new Map(programs.map((p) => [p.id, p.name]));
    const names = await userNameMap(this.prisma, user.organizationId, res.data.flatMap((r) => [r.requestedById, r.approvedById, r.processedById]));
    return withData(res, res.data.map((r) => {
      const d = dealBy.get(r.dealId);
      const tag = tagBy.get(r.id);
      const base = {
        id: r.id, dealId: r.dealId, status: r.status, reasonCategory: r.reasonCategory, learnerName: d ? ln.get(d.leadId) ?? null : null, programName: d ? pn.get(d.programId) ?? null : null,
        rootCause: tag ? { category: tag.category, note: tag.note, complaintId: tag.complaintId } : null,
        requested: { at: r.requestedAt }, approved: { at: r.approvedAt }, processed: { at: r.processedAt },
      };
      if (summary) return { ...base, minimumData: true };
      return {
        ...base, minimumData: false, reason: r.reason, currency: r.currency, recommendation: r.recommendation,
        requested: { at: r.requestedAt, amount: r.amount.toString(), byName: names.get(r.requestedById) ?? null },
        reviewed: { at: r.reviewedAt },
        approved: { at: r.approvedAt, amount: r.approvedAmount?.toString() ?? null, byName: r.approvedById ? names.get(r.approvedById) ?? null : null },
        rejected: { at: r.rejectedAt, reason: r.rejectionReason },
        processed: { at: r.processedAt, amount: r.processedAmount?.toString() ?? null, byName: r.processedById ? names.get(r.processedById) ?? null : null },
      };
    }));
  }

  async tagRootCause(user: Principal, refundId: string, dto: Dto<typeof tagRefundRootCauseSchema>) {
    const refund = await this.prisma.refund.findFirst({ where: { AND: [await this.where(user), { id: refundId }] }, select: { id: true } });
    if (!refund) throw notFound('Refund');
    if (dto.complaintId) {
      const c = await this.prisma.complaint.findFirst({ where: { id: dto.complaintId, organizationId: user.organizationId }, select: { id: true } });
      if (!c) throw notFound('Complaint');
    }
    const row = await this.prisma.refundRootCause.upsert({
      where: { organizationId_refundId: { organizationId: user.organizationId, refundId } },
      create: { organizationId: user.organizationId, refundId, category: dto.category, note: dto.note ?? null, complaintId: dto.complaintId ?? null, taggedById: user.userId },
      update: { category: dto.category, note: dto.note ?? null, complaintId: dto.complaintId ?? null, taggedById: user.userId },
    });
    await this.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'refund.root_cause_tagged', entityType: 'refund', entityId: refundId, metadata: { category: dto.category } });
    return { refundId, category: row.category, note: row.note, complaintId: row.complaintId };
  }

  /**
   * Inputs for KPI-CX-002 (like-for-like refund rate), computed per program and per request month:
   *  - wonEnrolments: WON deals' enrolments closed in the month (SalesRecord.enrolments)
   *  - refundsRequested / refundsApproved (ever approved: APPROVED, PROCESSED, RECONCILED) with REQUEST date in the month
   *  - approvedValue: sum of approved amounts (same refunds)
   *  - cohort variant: refunds attributed to the month of the SALE (deal closedAt), regardless of when requested.
   * REJECTED / WITHDRAWN / REQUESTED-only are excluded from the approved counts (KPI exclusions).
   * Rates are returned as ratios with their numerator/denominator; null when the denominator is 0. The caller's refunds:view scope applies.
   */
  async analytics(user: Principal, q: Dto<typeof refundAnalyticsQuerySchema>) {
    const to = q.to ? new Date(`${q.to}T23:59:59.999Z`) : new Date();
    const from = q.from ? new Date(`${q.from}T00:00:00.000Z`) : new Date(to.getTime() - 365 * 86_400_000);
    const scope = await this.where(user);
    const dealScope = (await this.access.scopedWhere(user, { permission: 'deals:view', ownerField: 'ownerId', teamField: 'teamId' })) as Prisma.SalesRecordWhereInput;
    const salesWhere: Prisma.SalesRecordWhereInput = { AND: [{ organizationId: user.organizationId }, { closedAt: { gte: from, lte: to } }, ...(q.programId ? [{ programId: q.programId }] : []), { deal: dealScope as Prisma.DealWhereInput }] };
    const sales = await this.prisma.salesRecord.findMany({ where: salesWhere, select: { dealId: true, programId: true, enrolments: true, closedAt: true } });
    const approvedStatuses = ['APPROVED', 'PROCESSED', 'RECONCILED'] as const;
    const refunds = await this.prisma.refund.findMany({
      where: { AND: [scope, { requestedAt: { gte: new Date(from.getTime() - 366 * 86_400_000), lte: to } }, ...(q.programId ? [{ deal: { programId: q.programId } }] : [])] },
      select: { id: true, dealId: true, status: true, requestedAt: true, approvedAmount: true, deal: { select: { programId: true } } },
    });
    const month = (d: Date) => d.toISOString().slice(0, 7);
    type Cell = { programId: string; month: string; wonEnrolments: number; refundsRequested: number; refundsApproved: number; approvedValue: number; cohortApproved: number };
    const cells = new Map<string, Cell>();
    const cell = (programId: string, m: string) => {
      const k = `${programId}|${m}`;
      let c = cells.get(k);
      if (!c) { c = { programId, month: m, wonEnrolments: 0, refundsRequested: 0, refundsApproved: 0, approvedValue: 0, cohortApproved: 0 }; cells.set(k, c); }
      return c;
    };
    const saleByDeal = new Map(sales.map((s) => [s.dealId, s]));
    for (const s of sales) cell(s.programId, month(s.closedAt)).wonEnrolments += s.enrolments;
    for (const r of refunds) {
      const approved = (approvedStatuses as readonly string[]).includes(r.status);
      if (r.requestedAt >= from && r.requestedAt <= to) {
        const c = cell(r.deal.programId, month(r.requestedAt));
        if (r.status !== 'WITHDRAWN') c.refundsRequested += 1;
        if (approved) { c.refundsApproved += 1; c.approvedValue += Number(r.approvedAmount ?? 0); }
      }
      const sale = saleByDeal.get(r.dealId);
      if (sale && approved) cell(sale.programId, month(sale.closedAt)).cohortApproved += 1;
    }
    const tags = await this.prisma.refundRootCause.findMany({ where: { organizationId: user.organizationId, refundId: { in: refunds.filter((r) => (approvedStatuses as readonly string[]).includes(r.status)).map((r) => r.id) } }, select: { category: true } });
    const byCause = new Map<string, number>();
    for (const t of tags) byCause.set(t.category, (byCause.get(t.category) ?? 0) + 1);
    const ratio = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10000) / 10000 : null);
    return {
      from: from.toISOString(), to: to.toISOString(),
      method: 'like-for-like: same program, same calendar-month length; rate = approved refunds with request date in month / WON enrolments closed in the same month. cohortApproved attributes each approved refund to its sale month.',
      cells: [...cells.values()].sort((a, b) => `${a.programId}${a.month}`.localeCompare(`${b.programId}${b.month}`)).map((c) => ({ ...c, approvedValue: c.approvedValue.toFixed(2), rate: ratio(c.refundsApproved, c.wonEnrolments), cohortRate: ratio(c.cohortApproved, c.wonEnrolments) })),
      rootCauses: [...byCause.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)),
      untaggedApproved: refunds.filter((r) => (approvedStatuses as readonly string[]).includes(r.status)).length - tags.length,
    };
  }
}
