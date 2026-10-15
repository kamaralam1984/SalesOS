import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { emitCx, ESCALATION_RULES, findRule, logState, missingRequired, ruleAllows } from '@salesos/cx-core';
import { CX_EVENTS } from '@salesos/shared-types';
import type { createEscalationSchema, escalationTransitionSchema, listEscalationsQuerySchema } from '@salesos/validation';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { AppError, conflict, notFound } from '../../../common/http/errors';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService } from '../../../common/prisma';
import { assertOrgUsers, canActOnUser, fieldsRequired, illegalTransition, loadVisibleLead, scopedByUsers, userNameMap, withData } from '../common/support';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;
type Row = Prisma.RelationshipEscalationGetPayload<object>;

/** High-value / complex-conversation escalations raised from a lead (JD-CX-004/005): owner, blocker, TL/Founder involvement, resolution. */
@Injectable()
export class EscalationsService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService) {}

  private async view(rows: Row[], user: Principal) {
    const names = await userNameMap(this.prisma, user.organizationId, rows.flatMap((r) => [r.ownerId, r.createdById, r.teamLeadId]));
    const leads = await this.prisma.lead.findMany({ where: { organizationId: user.organizationId, id: { in: rows.map((r) => r.leadId) } }, select: { id: true, fullName: true } });
    const ln = new Map(leads.map((l) => [l.id, l.fullName]));
    return rows.map((r) => ({
      id: r.id, leadId: r.leadId, learnerName: ln.get(r.leadId) ?? null, type: r.type, title: r.title, context: r.context, blocker: r.blocker, requestedHelp: r.requestedHelp,
      status: r.status, ownerId: r.ownerId, ownerName: names.get(r.ownerId) ?? null, createdByName: names.get(r.createdById) ?? null,
      teamLeadId: r.teamLeadId, teamLeadName: r.teamLeadId ? names.get(r.teamLeadId) ?? null : null, founderInvolved: r.founderInvolved,
      resolution: r.resolution, resolvedAt: r.resolvedAt, version: r.version, createdAt: r.createdAt, updatedAt: r.updatedAt,
    }));
  }

  private async where(user: Principal, key: 'complaints:view' | 'complaints:update' = 'complaints:view'): Promise<Prisma.RelationshipEscalationWhereInput> {
    return (await scopedByUsers(this.access, user, key, ['ownerId', 'createdById', 'teamLeadId'])) as Prisma.RelationshipEscalationWhereInput;
  }

  async list(user: Principal, q: Dto<typeof listEscalationsQuerySchema>) {
    const f: Prisma.RelationshipEscalationWhereInput = { ...(q.status ? { status: q.status } : {}), ...(q.type ? { type: q.type } : {}), ...(q.leadId ? { leadId: q.leadId } : {}) };
    const rows = await this.prisma.relationshipEscalation.findMany({ where: { AND: [await this.where(user), f] }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    return withData(res, await this.view(res.data, user));
  }

  async get(user: Principal, id: string, key: 'complaints:view' | 'complaints:update' = 'complaints:view') {
    const r = await this.prisma.relationshipEscalation.findFirst({ where: { AND: [await this.where(user, key), { id }] } });
    if (!r) throw notFound('Escalation');
    return r;
  }

  async detail(user: Principal, id: string) {
    const r = await this.get(user, id);
    const [v] = await this.view([r], user);
    const history = await this.prisma.cxStateLog.findMany({ where: { organizationId: user.organizationId, entityType: 'escalation', entityId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const hn = await userNameMap(this.prisma, user.organizationId, history.map((h) => h.actorId));
    return { ...v!, history: history.map((h) => ({ from: h.fromStatus, to: h.toStatus, actorName: h.actorId ? hn.get(h.actorId) ?? null : 'System', note: h.note, at: h.createdAt })) };
  }

  async create(user: Principal, dto: Dto<typeof createEscalationSchema>) {
    const lead = await loadVisibleLead(this.prisma, this.access, user, dto.leadId);
    const ownerId = dto.ownerId ?? lead.assignedToId ?? user.userId;
    await assertOrgUsers(this.prisma, user.organizationId, [ownerId]);
    if (dto.ownerId && !(await canActOnUser(this.access, user, 'complaints:create', ownerId))) throw notFound('Owner');
    const team = lead.teamId ? await this.prisma.team.findFirst({ where: { id: lead.teamId, organizationId: user.organizationId }, select: { leadUserId: true } }) : null;
    const id = await this.prisma.$transaction(async (tx) => {
      const r = await tx.relationshipEscalation.create({
        data: { organizationId: user.organizationId, leadId: lead.id, type: dto.type, title: dto.title, context: dto.context, blocker: dto.blocker ?? null, requestedHelp: dto.requestedHelp ?? null, ownerId, createdById: user.userId, teamId: lead.teamId, teamLeadId: team?.leadUserId ?? null, founderInvolved: dto.involveFounder ?? dto.type === 'HIGH_VALUE' },
      });
      await logState(tx, { organizationId: user.organizationId, entityType: 'escalation', entityId: r.id, from: null, to: 'OPEN', actorId: user.userId });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'escalation.raised', entityType: 'escalation', entityId: r.id, metadata: { type: r.type, leadId: lead.id } });
      await emitCx(tx, {
        organizationId: user.organizationId, eventType: CX_EVENTS.ESCALATION_RAISED, aggregateType: 'escalation', aggregateId: r.id, key: `escalation.raised:${r.id}`,
        payload: { organizationId: user.organizationId, escalationId: r.id, leadId: lead.id, type: r.type, notifyUserIds: [team?.leadUserId].filter((u): u is string => !!u && u !== user.userId), notifyRoles: r.founderInvolved ? ['SALES_TEAM_LEAD', 'FOUNDER_CEO'] : ['SALES_TEAM_LEAD'] },
      });
      return r.id;
    });
    return this.detail(user, id);
  }

  async transition(user: Principal, id: string, dto: Dto<typeof escalationTransitionSchema>) {
    const r = await this.get(user, id, 'complaints:update');
    const rule = findRule(ESCALATION_RULES, r.status, dto.to);
    if (!rule) throw illegalTransition(r.status, dto.to);
    if (!ruleAllows(rule, { roles: user.roles, isOwner: r.ownerId === user.userId })) throw new AppError('FORBIDDEN', 'Your role cannot perform this transition', 403);
    const missing = missingRequired(rule, { ...dto });
    if (missing.length) throw fieldsRequired(missing);
    const now = new Date();
    const data: Prisma.RelationshipEscalationUncheckedUpdateManyInput = { status: dto.to, version: { increment: 1 } };
    if (dto.to === 'IN_REVIEW') {
      data.teamLeadId = dto.teamLeadId ?? (user.roles.includes('SALES_TEAM_LEAD') || user.roles.includes('FOUNDER_CEO') ? user.userId : r.teamLeadId);
      if (dto.involveFounder !== undefined) data.founderInvolved = dto.involveFounder;
      if (dto.teamLeadId) await assertOrgUsers(this.prisma, user.organizationId, [dto.teamLeadId]);
    }
    if (dto.to === 'RESOLVED') { data.resolution = dto.resolution; data.resolvedAt = now; }
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.relationshipEscalation.updateMany({ where: { id, status: r.status, version: r.version }, data });
      if (res.count !== 1) throw conflict('CONFLICT', 'The escalation was changed by someone else; reload and retry');
      await logState(tx, { organizationId: user.organizationId, entityType: 'escalation', entityId: id, from: r.status, to: dto.to, actorId: user.userId, note: dto.resolution ?? dto.note ?? dto.reason ?? null });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: rule.audit, entityType: 'escalation', entityId: id, metadata: { from: r.status, to: dto.to } });
      await emitCx(tx, {
        organizationId: user.organizationId, eventType: CX_EVENTS.ESCALATION_UPDATED, aggregateType: 'escalation', aggregateId: id, key: `escalation.updated:${id}:${r.version + 1}`,
        payload: { organizationId: user.organizationId, escalationId: id, leadId: r.leadId, status: dto.to, notifyUserIds: [r.ownerId, r.createdById].filter((u) => u !== user.userId) },
      });
    });
    return this.detail(user, id);
  }
}
