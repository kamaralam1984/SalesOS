import { Injectable } from '@nestjs/common';
import { Prisma, type FeedbackEntry, type GrowthOpportunity } from '@prisma/client';
import type { z } from 'zod';
import type { createFeedbackSchema, createGrowthSchema, listFeedbackQuerySchema, listGrowthQuerySchema, updateFeedbackSchema, updateGrowthSchema } from '@salesos/validation';
import type { Principal } from '../../../common/authz';
import { AppError, notFound } from '../../../common/http/errors';
import { ok } from '../../../common/http/api-result';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { money, round2 } from '../calc';
import { RevenueSupport, iso, recordAccess } from '../revenue.support';

/** Market / competitor / learner feedback log and the new channel / segment / growth opportunity tracker. */
@Injectable()
export class IntelService {
  constructor(private readonly s: RevenueSupport) {}

  private get prisma() {
    return this.s.prisma;
  }

  private canEdit(user: Principal, ownerIds: string[]) {
    return ownerIds.includes(user.userId) || ['team', 'org'].includes(this.s.access.scopeLevel(user, 'market-intel:create') ?? '');
  }

  private fdto(f: FeedbackEntry, names: Map<string, string>) {
    return { id: f.id, kind: f.kind, category: f.category, source: f.source, title: f.title, notes: f.notes, competitor: f.competitor, evidenceUrl: f.evidenceUrl, programId: f.programId, leadId: f.leadId, proposalId: f.proposalId, status: f.status, createdById: f.createdById, createdByName: names.get(f.createdById) ?? null, createdAt: iso(f.createdAt), updatedAt: iso(f.updatedAt) };
  }

  async listFeedback(user: Principal, q: z.infer<typeof listFeedbackQuerySchema>) {
    const scoped = await this.s.access.scopedWhere(user, { permission: 'market-intel:view', ownerField: 'createdById', teamField: 'teamId' });
    const and: Prisma.FeedbackEntryWhereInput[] = [];
    if (q.kind) and.push({ kind: q.kind });
    if (q.status) and.push({ status: { in: q.status.split(',').map((x) => x.trim()) as FeedbackEntry['status'][] } });
    if (q.programId) and.push({ programId: q.programId });
    const prior = (scoped.AND as Prisma.FeedbackEntryWhereInput[] | undefined) ?? [];
    const where = { ...scoped, AND: [...prior, ...and] } as Prisma.FeedbackEntryWhereInput;
    const rows = await this.prisma.feedbackEntry.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const total = q.page ? await this.prisma.feedbackEntry.count({ where }) : undefined;
    const res = pageResult(rows, q, total);
    const page = res.data as FeedbackEntry[];
    return this.withNames(page, res.meta);
  }

  private async withNames(page: FeedbackEntry[], meta: Parameters<typeof ok>[1]) {
    const names = await this.s.userNames(page.map((f) => f.createdById));
    return ok(page.map((f) => this.fdto(f, names)), meta);
  }

  async createFeedback(user: Principal, b: z.infer<typeof createFeedbackSchema>) {
    if (b.programId && !(await this.prisma.program.findFirst({ where: { id: b.programId, organizationId: user.organizationId }, select: { id: true } }))) throw notFound('Program');
    if (b.leadId) {
      const lead = await this.prisma.lead.findFirst({ where: { id: b.leadId, organizationId: user.organizationId }, select: { organizationId: true, assignedToId: true, teamId: true } });
      await this.s.access.assertRecordAccess(user, 'leads:view', lead && { organizationId: lead.organizationId, ownerId: lead.assignedToId, teamId: lead.teamId }, 'Lead');
    }
    const teamId = await this.s.teamOf(this.prisma, user.userId);
    const f = await this.s.tx(async (tx) => {
      const created = await tx.feedbackEntry.create({ data: { organizationId: user.organizationId, kind: b.kind, category: b.category, source: b.source ?? null, title: b.title, notes: b.notes, competitor: b.competitor ?? null, evidenceUrl: b.evidenceUrl ?? null, programId: b.programId ?? null, leadId: b.leadId ?? null, createdById: user.userId, teamId } });
      await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'feedback.created', entityType: 'feedback', entityId: created.id, metadata: { kind: b.kind, category: b.category } });
      return created;
    });
    return this.fdto(f, await this.s.userNames([f.createdById]));
  }

  async updateFeedback(user: Principal, id: string, b: z.infer<typeof updateFeedbackSchema>) {
    const f = await this.prisma.feedbackEntry.findFirst({ where: { id, organizationId: user.organizationId } });
    await this.s.access.assertRecordAccess(user, 'market-intel:view', f && recordAccess({ organizationId: f.organizationId, ownerId: f.createdById, teamId: f.teamId }), 'Feedback entry');
    if (!this.canEdit(user, [f!.createdById])) throw new AppError('FORBIDDEN', 'Only the author or a manager can update this entry', 403);
    if (b.proposalId && !(await this.prisma.pricingProposal.findFirst({ where: { id: b.proposalId, organizationId: user.organizationId }, select: { id: true } }))) throw notFound('Proposal');
    const u = await this.prisma.feedbackEntry.update({ where: { id }, data: { ...(b.status ? { status: b.status } : {}), ...(b.proposalId !== undefined ? { proposalId: b.proposalId } : {}) } });
    await this.s.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'feedback.updated', entityType: 'feedback', entityId: id, metadata: { status: b.status ?? null, proposalId: b.proposalId ?? null } });
    return this.fdto(u, await this.s.userNames([u.createdById]));
  }

  // ---- growth ----------------------------------------------------------------------------------------------------
  private gdto(g: GrowthOpportunity, names: Map<string, string>) {
    return { id: g.id, type: g.type, title: g.title, description: g.description, estimatedValue: g.estimatedValue ? money(g.estimatedValue) : null, currency: g.currency, ownerId: g.ownerId, ownerName: names.get(g.ownerId) ?? null, status: g.status, createdById: g.createdById, createdAt: iso(g.createdAt), updatedAt: iso(g.updatedAt), isEstimate: true };
  }

  async listGrowth(user: Principal, q: z.infer<typeof listGrowthQuerySchema>) {
    const scoped = await this.s.access.scopedWhere(user, { permission: 'market-intel:view', ownerField: 'ownerId', teamField: 'teamId' });
    const and: Prisma.GrowthOpportunityWhereInput[] = [];
    if (q.type) and.push({ type: q.type });
    if (q.status) and.push({ status: { in: q.status.split(',').map((x) => x.trim()) as GrowthOpportunity['status'][] } });
    const prior = (scoped.AND as Prisma.GrowthOpportunityWhereInput[] | undefined) ?? [];
    const where = { ...scoped, AND: [...prior, ...and] } as Prisma.GrowthOpportunityWhereInput;
    const rows = await this.prisma.growthOpportunity.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const total = q.page ? await this.prisma.growthOpportunity.count({ where }) : undefined;
    const res = pageResult(rows, q, total);
    const page = res.data as GrowthOpportunity[];
    const names = await this.s.userNames(page.map((g) => g.ownerId));
    return ok(page.map((g) => this.gdto(g, names)), res.meta);
  }

  async createGrowth(user: Principal, b: z.infer<typeof createGrowthSchema>) {
    const ownerId = b.ownerId && b.ownerId !== user.userId ? (await this.s.assertUserInScope(user, 'market-intel:create', b.ownerId)).id : user.userId;
    const teamId = await this.s.teamOf(this.prisma, ownerId);
    const g = await this.s.tx(async (tx) => {
      const created = await tx.growthOpportunity.create({ data: { organizationId: user.organizationId, type: b.type, title: b.title, description: b.description, estimatedValue: b.estimatedValue ? round2(b.estimatedValue) : null, ownerId, teamId, createdById: user.userId } });
      await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'growth_opportunity.created', entityType: 'growth_opportunity', entityId: created.id, metadata: { type: b.type } });
      return created;
    });
    return this.gdto(g, await this.s.userNames([g.ownerId]));
  }

  async updateGrowth(user: Principal, id: string, b: z.infer<typeof updateGrowthSchema>) {
    const g = await this.prisma.growthOpportunity.findFirst({ where: { id, organizationId: user.organizationId } });
    await this.s.access.assertRecordAccess(user, 'market-intel:view', g && recordAccess({ organizationId: g.organizationId, ownerId: g.ownerId, teamId: g.teamId }), 'Opportunity');
    if (!this.canEdit(user, [g!.ownerId, g!.createdById])) throw new AppError('FORBIDDEN', 'Only the owner or a manager can update this opportunity', 403);
    const ownerId = b.ownerId ? (await this.s.assertUserInScope(user, 'market-intel:create', b.ownerId)).id : undefined;
    const u = await this.prisma.growthOpportunity.update({ where: { id }, data: { ...(b.status ? { status: b.status } : {}), ...(b.description ? { description: b.description } : {}), ...(b.estimatedValue !== undefined ? { estimatedValue: b.estimatedValue ? round2(b.estimatedValue) : null } : {}), ...(ownerId ? { ownerId } : {}) } });
    await this.s.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'growth_opportunity.updated', entityType: 'growth_opportunity', entityId: id, metadata: { status: b.status ?? null } });
    return this.gdto(u, await this.s.userNames([u.ownerId]));
  }
}
