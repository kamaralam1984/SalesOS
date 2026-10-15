import { Injectable } from '@nestjs/common';
import { Prisma, type PricingProposal } from '@prisma/client';
import { REVENUE_EVENTS } from '@salesos/shared-types';
import type { z } from 'zod';
import type { createProposalSchema, decideProposalSchema, listProposalsQuerySchema, withdrawProposalSchema } from '@salesos/validation';
import type { Principal } from '../../../common/authz';
import { AppError, notFound } from '../../../common/http/errors';
import { ok } from '../../../common/http/api-result';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { canProposalTransition, money, round2, type ProposalStatus } from '../calc';
import { RevenueSupport, hasRole, isUniqueViolation, iso, primaryRole } from '../revenue.support';

@Injectable()
export class PricingService {
  constructor(private readonly s: RevenueSupport) {}

  private get prisma() {
    return this.s.prisma;
  }

  /** Programs the caller may attach to deals / proposals (id, code, name, kind). */
  async programs(user: Principal) {
    const rows = await this.prisma.program.findMany({ where: { organizationId: user.organizationId, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, code: true, name: true, kind: true } });
    const canSeeThreshold = this.s.access.has(user, 'proposals:view');
    const cfg = canSeeThreshold ? await this.prisma.programRevenueConfig.findMany({ where: { organizationId: user.organizationId } }) : [];
    return rows.map((p) => ({ ...p, highValueThreshold: canSeeThreshold ? (cfg.find((c) => c.programId === p.id)?.highValueThreshold ? money(cfg.find((c) => c.programId === p.id)!.highValueThreshold!) : null) : undefined }));
  }

  /** Current effective price per program (latest effective_from <= now) + count of versions. */
  async currentPrices(user: Principal) {
    const now = new Date();
    const prices = await this.prisma.programPrice.findMany({ where: { organizationId: user.organizationId, effectiveFrom: { lte: now } }, orderBy: [{ effectiveFrom: 'desc' }], include: { program: { select: { name: true, code: true } } } });
    const seen = new Set<string>();
    const out = [];
    for (const p of prices) {
      if (seen.has(p.programId)) continue;
      seen.add(p.programId);
      out.push({ programId: p.programId, programName: p.program.name, programCode: p.program.code, id: p.id, amount: money(p.amount), currency: p.currency, taxInclusive: p.taxInclusive, effectiveFrom: iso(p.effectiveFrom), proposalId: p.proposalId });
    }
    return out;
  }

  async priceHistory(user: Principal, programId: string) {
    const prog = await this.prisma.program.findFirst({ where: { id: programId, organizationId: user.organizationId }, select: { id: true } });
    if (!prog) throw notFound('Program');
    const rows = await this.prisma.programPrice.findMany({ where: { organizationId: user.organizationId, programId }, orderBy: { effectiveFrom: 'desc' } });
    const names = await this.s.userNames(rows.map((r) => r.createdById));
    return rows.map((p) => ({ id: p.id, amount: money(p.amount), currency: p.currency, taxInclusive: p.taxInclusive, effectiveFrom: iso(p.effectiveFrom), proposalId: p.proposalId, note: p.note, createdByName: p.createdById ? names.get(p.createdById) ?? null : null, createdAt: iso(p.createdAt) }));
  }

  private dto(p: PricingProposal, names: Map<string, string>, progName?: string | null) {
    return {
      id: p.id, type: p.type, programId: p.programId, programName: progName ?? null, title: p.title, rationale: p.rationale, details: p.details,
      currentAmount: p.currentAmount ? money(p.currentAmount) : null, proposedAmount: p.proposedAmount ? money(p.proposedAmount) : null, currency: p.currency,
      effectiveFrom: iso(p.effectiveFrom), status: p.status, createdById: p.createdById, createdByName: names.get(p.createdById) ?? null, submittedAt: iso(p.submittedAt),
      decidedById: p.decidedById, decidedByName: p.decidedById ? names.get(p.decidedById) ?? null : null, decidedAt: iso(p.decidedAt), decisionNote: p.decisionNote, version: p.version, createdAt: iso(p.createdAt),
    };
  }

  async list(user: Principal, q: z.infer<typeof listProposalsQuerySchema>) {
    const where: Prisma.PricingProposalWhereInput = { organizationId: user.organizationId, ...(q.status ? { status: { in: q.status.split(',').map((x) => x.trim()) as ProposalStatus[] } } : {}), ...(q.programId ? { programId: q.programId } : {}) };
    const rows = await this.prisma.pricingProposal.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const total = q.page ? await this.prisma.pricingProposal.count({ where }) : undefined;
    const res = pageResult(rows, q, total);
    const page = res.data as PricingProposal[];
    const names = await this.s.userNames(page.flatMap((p) => [p.createdById, p.decidedById]));
    const progs = await this.prisma.program.findMany({ where: { id: { in: page.flatMap((p) => (p.programId ? [p.programId] : [])) } }, select: { id: true, name: true } });
    const pm = new Map(progs.map((p) => [p.id, p.name]));
    return ok(page.map((p) => this.dto(p, names, p.programId ? pm.get(p.programId) : null)), res.meta);
  }

  async get(user: Principal, id: string) {
    const p = await this.prisma.pricingProposal.findFirst({ where: { id, organizationId: user.organizationId }, include: { events: { orderBy: { createdAt: 'asc' } } } });
    if (!p) throw notFound('Proposal');
    const names = await this.s.userNames([p.createdById, p.decidedById, ...p.events.map((e) => e.actorId)]);
    const prog = p.programId ? await this.prisma.program.findFirst({ where: { id: p.programId }, select: { name: true } }) : null;
    const feedback = await this.prisma.feedbackEntry.findMany({ where: { proposalId: id, organizationId: user.organizationId }, select: { id: true, kind: true, title: true, category: true } });
    return { ...this.dto(p, names, prog?.name), feedback, history: p.events.map((e) => ({ id: e.id, fromStatus: e.fromStatus, toStatus: e.toStatus, actorId: e.actorId, actorName: names.get(e.actorId) ?? null, actorRole: e.actorRole, note: e.note, at: iso(e.createdAt) })) };
  }

  async create(user: Principal, b: z.infer<typeof createProposalSchema>) {
    let current: Prisma.Decimal | null = null;
    if (b.programId) {
      const prog = await this.prisma.program.findFirst({ where: { id: b.programId, organizationId: user.organizationId } });
      if (!prog) throw notFound('Program');
      const cur = await this.prisma.programPrice.findFirst({ where: { programId: b.programId, effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: 'desc' } });
      current = cur?.amount ?? null;
    }
    const status: ProposalStatus = b.submit ? 'SUBMITTED' : 'DRAFT';
    const role = primaryRole(user);
    const created = await this.s.tx(async (tx) => {
      const p = await tx.pricingProposal.create({
        data: { organizationId: user.organizationId, type: b.type, programId: b.programId ?? null, title: b.title, rationale: b.rationale, details: (b.details ?? undefined) as Prisma.InputJsonValue | undefined, currentAmount: current, proposedAmount: b.proposedAmount ? round2(b.proposedAmount) : null, effectiveFrom: b.effectiveFrom ? new Date(b.effectiveFrom) : null, status, createdById: user.userId, submittedAt: b.submit ? new Date() : null },
      });
      await tx.pricingProposalEvent.create({ data: { organizationId: user.organizationId, proposalId: p.id, fromStatus: null, toStatus: 'DRAFT', actorId: user.userId, actorRole: role, note: 'Created' } });
      if (b.submit) await tx.pricingProposalEvent.create({ data: { organizationId: user.organizationId, proposalId: p.id, fromStatus: 'DRAFT', toStatus: 'SUBMITTED', actorId: user.userId, actorRole: role, note: 'Submitted for Founder review' } });
      await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: b.submit ? 'proposal.submitted' : 'proposal.created', entityType: 'pricing_proposal', entityId: p.id, metadata: { type: p.type, programId: p.programId, proposed: p.proposedAmount ? money(p.proposedAmount) : null } });
      if (b.submit) await this.afterSubmit(tx, user, p);
      return p;
    });
    return this.get(user, created.id);
  }

  private async afterSubmit(tx: Prisma.TransactionClient, user: Principal, p: PricingProposal) {
    await this.s.publish(tx, { eventType: REVENUE_EVENTS.PROPOSAL_SUBMITTED, aggregateType: 'pricing_proposal', aggregateId: p.id, organizationId: user.organizationId, payload: { proposalId: p.id, type: p.type, programId: p.programId, submittedById: user.userId }, idempotencyKey: `proposal.submitted:${p.id}` });
    await this.s.notify(tx, { organizationId: user.organizationId, type: 'founder.action_item', roles: ['FOUNDER_CEO'], dedupeKey: `proposal.submitted:${p.id}`, title: 'Pricing or offer proposal awaiting your decision', body: p.title, entity: { type: 'pricing_proposal', id: p.id }, actionUrl: '/revenue/pricing' });
  }

  private async step(user: Principal, id: string, to: ProposalStatus, note: string | null, extra: (p: PricingProposal, tx: Prisma.TransactionClient) => Promise<Prisma.PricingProposalUncheckedUpdateManyInput>, guard: (p: PricingProposal) => void) {
    const p0 = await this.prisma.pricingProposal.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!p0) throw notFound('Proposal');
    if (!canProposalTransition(p0.status as ProposalStatus, to)) throw new AppError('INVALID_TRANSITION', `A ${p0.status} proposal cannot move to ${to}`, 409, { from: p0.status, to });
    guard(p0);
    try {
      await this.s.tx(async (tx) => {
        const data = await extra(p0, tx);
        const cas = await tx.pricingProposal.updateMany({ where: { id, organizationId: user.organizationId, status: p0.status }, data: { ...data, status: to, version: { increment: 1 } } });
        if (cas.count !== 1) throw new AppError('INVALID_TRANSITION', 'This proposal was just changed by someone else', 409);
        await tx.pricingProposalEvent.create({ data: { organizationId: user.organizationId, proposalId: id, fromStatus: p0.status, toStatus: to, actorId: user.userId, actorRole: primaryRole(user), note } });
        await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: `proposal.${to.toLowerCase()}`, entityType: 'pricing_proposal', entityId: id, metadata: { from: p0.status, to, note } });
        if (to === 'SUBMITTED') await this.afterSubmit(tx, user, { ...p0, status: 'SUBMITTED' });
        if (to === 'APPROVED' || to === 'REJECTED') {
          await this.s.publish(tx, { eventType: REVENUE_EVENTS.PROPOSAL_DECIDED, aggregateType: 'pricing_proposal', aggregateId: id, organizationId: user.organizationId, payload: { proposalId: id, decision: to, decidedById: user.userId }, idempotencyKey: `proposal.decided:${id}` });
          await this.s.notify(tx, { organizationId: user.organizationId, type: 'founder.action_item', userIds: [p0.createdById], dedupeKey: `proposal.decided:${id}`, title: `Proposal ${to.toLowerCase()}`, body: p0.title, entity: { type: 'pricing_proposal', id }, actionUrl: '/revenue/pricing' });
        }
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError('PRICE_VERSION_EXISTS', 'A price already exists for this program at that effective time', 409);
      throw e;
    }
    return this.get(user, id);
  }

  submit(user: Principal, id: string) {
    return this.step(user, id, 'SUBMITTED', 'Submitted for Founder review', async () => ({ submittedAt: new Date() }), (p) => {
      if (p.createdById !== user.userId && !hasRole(user, 'FOUNDER_CEO')) throw new AppError('FORBIDDEN', 'Only the author can submit a draft', 403);
    });
  }

  withdraw(user: Principal, id: string, b: z.infer<typeof withdrawProposalSchema>) {
    return this.step(user, id, 'WITHDRAWN', b.note ?? null, async () => ({}), (p) => {
      if (p.createdById !== user.userId && !hasRole(user, 'FOUNDER_CEO')) throw new AppError('FORBIDDEN', 'Only the author can withdraw a proposal', 403);
    });
  }

  /** Founder decision. Approving a PRICE_CHANGE appends a new program_prices version; historic sales are never touched. */
  decide(user: Principal, id: string, b: z.infer<typeof decideProposalSchema>) {
    const approve = b.decision === 'approve';
    return this.step(
      user, id, approve ? 'APPROVED' : 'REJECTED', b.note ?? null,
      async (p, tx) => {
        if (approve && p.type === 'PRICE_CHANGE' && p.programId && p.proposedAmount) {
          await tx.programPrice.create({ data: { organizationId: user.organizationId, programId: p.programId, amount: p.proposedAmount, currency: p.currency, effectiveFrom: p.effectiveFrom ?? new Date(), proposalId: p.id, createdById: user.userId, note: p.title } });
        }
        return { decidedById: user.userId, decidedAt: new Date(), decisionNote: b.note ?? null };
      },
      () => undefined,
    );
  }
}
