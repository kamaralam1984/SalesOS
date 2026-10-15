import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { actionItemCompletion, emitCx, findRule, logState, missingRequired, ruleAllows, WORK_OPEN_STATUSES, WORK_RULES } from '@salesos/cx-core';
import { CX_EVENTS } from '@salesos/shared-types';
import type { createActionItemSchema, listActionItemsQuerySchema, metricsQuerySchema, updateActionItemSchema } from '@salesos/validation';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { AppError, conflict, notFound } from '../../../common/http/errors';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService, type Tx } from '../../../common/prisma';
import { assertOrgUsers, canActOnUser, fieldsRequired, hasRole, illegalTransition, scopedByUsers, userNameMap, withData } from '../common/support';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;
type Row = Prisma.ActionItemGetPayload<object>;

/** Founder-review action items (JD-REPORT-002): owner, due date, status machine (section 8), evidence, overdue alerts (worker). */
@Injectable()
export class ActionItemsService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService) {}

  private async where(user: Principal, key: 'action-items:view' | 'action-items:update' = 'action-items:view'): Promise<Prisma.ActionItemWhereInput> {
    return (await scopedByUsers(this.access, user, key, ['ownerId', 'createdById'])) as Prisma.ActionItemWhereInput;
  }

  private view(a: Row, names: Map<string, string>) {
    return {
      id: a.id, reportId: a.reportId, source: a.source, title: a.title, description: a.description, ownerId: a.ownerId, ownerName: names.get(a.ownerId) ?? null, createdByName: names.get(a.createdById) ?? null,
      dueAt: a.dueAt, status: a.status, overdue: WORK_OPEN_STATUSES.includes(a.status) && a.dueAt.getTime() < Date.now(), completedAt: a.completedAt, completionNote: a.completionNote,
      evidence: a.evidence, evidenceFileIds: a.evidenceFileIds, completedOnTime: a.completedOnTime, cancelReason: a.cancelReason, overdueLevel: a.overdueLevel, escalatedAt: a.escalatedAt, version: a.version, createdAt: a.createdAt, updatedAt: a.updatedAt,
    };
  }

  async list(user: Principal, q: Dto<typeof listActionItemsQuerySchema>) {
    const f: Prisma.ActionItemWhereInput = {
      ...(q.status ? { status: q.status } : {}), ...(q.ownerId ? { ownerId: q.ownerId } : {}), ...(q.reportId ? { reportId: q.reportId } : {}),
      ...(q.mine === true ? { ownerId: user.userId } : {}), ...(q.open === true ? { status: { in: WORK_OPEN_STATUSES } } : {}),
    };
    const rows = await this.prisma.actionItem.findMany({ where: { AND: [await this.where(user), f] }, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const names = await userNameMap(this.prisma, user.organizationId, res.data.flatMap((a) => [a.ownerId, a.createdById]));
    return withData(res, res.data.map((a) => this.view(a, names)));
  }

  private async load(user: Principal, id: string, key: 'action-items:view' | 'action-items:update' = 'action-items:view'): Promise<Row> {
    const a = await this.prisma.actionItem.findFirst({ where: { AND: [await this.where(user, key), { id }] } });
    if (!a) throw notFound('Action item');
    return a;
  }

  async canAccess(user: Principal, id: string): Promise<boolean> {
    try {
      await this.load(user, id);
      return true;
    } catch {
      return false;
    }
  }

  async get(user: Principal, id: string) {
    const a = await this.load(user, id);
    const history = await this.prisma.cxStateLog.findMany({ where: { organizationId: user.organizationId, entityType: 'action_item', entityId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const names = await userNameMap(this.prisma, user.organizationId, [a.ownerId, a.createdById, ...history.map((h) => h.actorId)]);
    return { ...this.view(a, names), history: history.map((h) => ({ from: h.fromStatus, to: h.toStatus, actorName: h.actorId ? names.get(h.actorId) ?? null : 'System', note: h.note, at: h.createdAt })) };
  }

  async create(user: Principal, dto: Dto<typeof createActionItemSchema>) {
    await assertOrgUsers(this.prisma, user.organizationId, [dto.ownerId]);
    if (!(await canActOnUser(this.access, user, 'action-items:create', dto.ownerId))) throw notFound('Owner');
    const dueAt = new Date(dto.dueAt);
    if (dueAt.getTime() < Date.now() - 60_000) throw new AppError('VALIDATION_ERROR', 'dueAt cannot be in the past', 422, [{ path: 'dueAt', message: 'in the past' }]);
    if (dto.reportId) {
      const r = await this.prisma.founderReport.count({ where: { id: dto.reportId, organizationId: user.organizationId } });
      if (!r) throw new AppError('INVALID_REFERENCE', 'Report not found', 422);
    }
    const id = await this.prisma.$transaction(async (tx) => {
      const a = await tx.actionItem.create({ data: { organizationId: user.organizationId, reportId: dto.reportId ?? null, source: dto.reportId && dto.source === 'MANUAL' ? 'FOUNDER_REPORT' : dto.source, title: dto.title, description: dto.description ?? null, ownerId: dto.ownerId, createdById: user.userId, dueAt } });
      await logState(tx, { organizationId: user.organizationId, entityType: 'action_item', entityId: a.id, from: null, to: 'OPEN', actorId: user.userId });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'action_item.created', entityType: 'action_item', entityId: a.id, metadata: { ownerId: a.ownerId, dueAt: dueAt.toISOString() } });
      await emitCx(tx, { organizationId: user.organizationId, eventType: CX_EVENTS.ACTION_ITEM_CREATED, aggregateType: 'action_item', aggregateId: a.id, key: `action_item.created:${a.id}`, payload: { organizationId: user.organizationId, actionItemId: a.id, status: 'OPEN', ownerId: a.ownerId, dueAt: dueAt.toISOString(), notifyUserIds: [a.ownerId].filter((u) => u !== user.userId) } });
      return a.id;
    });
    return this.get(user, id);
  }

  async update(user: Principal, id: string, dto: Dto<typeof updateActionItemSchema>) {
    const a = await this.load(user, id, 'action-items:update');
    const isOwner = a.ownerId === user.userId;
    const isCreator = a.createdById === user.userId;
    const manager = hasRole(user, 'FOUNDER_CEO', 'SALES_TEAM_LEAD', 'SALES_MANAGER');
    const editsDetails = dto.title !== undefined || dto.description !== undefined || dto.dueAt !== undefined || dto.ownerId !== undefined;
    if (editsDetails && !(isCreator || manager)) throw new AppError('FORBIDDEN', 'Only the creator or a manager can change action item details', 403);
    if (['COMPLETED', 'CANCELLED'].includes(a.status) && (editsDetails || dto.status)) throw new AppError('ILLEGAL_TRANSITION', `A ${a.status.toLowerCase()} action item cannot be changed (create a new one)`, 409);
    const data: Prisma.ActionItemUncheckedUpdateManyInput = { version: { increment: 1 } };
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.dueAt !== undefined) data.dueAt = new Date(dto.dueAt);
    if (dto.ownerId !== undefined) {
      await assertOrgUsers(this.prisma, user.organizationId, [dto.ownerId]);
      if (!(await canActOnUser(this.access, user, 'action-items:create', dto.ownerId))) throw notFound('Owner');
      data.ownerId = dto.ownerId;
    }
    if (dto.evidence !== undefined) data.evidence = dto.evidence;
    if (dto.evidenceFileIds !== undefined) data.evidenceFileIds = dto.evidenceFileIds;
    let audit = 'action_item.updated';
    let eventType: string = CX_EVENTS.ACTION_ITEM_CREATED;
    let notify: string[] = [];
    if (dto.status && dto.status !== a.status) {
      const rule = findRule(WORK_RULES, a.status, dto.status);
      if (!rule) throw illegalTransition(a.status, dto.status);
      if (!ruleAllows(rule, { roles: user.roles, isOwner })) throw new AppError('FORBIDDEN', 'Your role cannot perform this transition on this action item', 403);
      const required = dto.status === 'CANCELLED' ? ['cancelReason'] : rule.required;
      const miss = missingRequired({ ...rule, required }, { ...dto });
      if (miss.length) throw fieldsRequired(miss);
      data.status = dto.status;
      if (dto.status === 'COMPLETED') {
        // action items need a completion note AND evidence (text reference or uploaded file ids)
        const evidenceText = (dto.evidence ?? a.evidence)?.trim();
        const files = dto.evidenceFileIds ?? a.evidenceFileIds;
        if (!evidenceText && files.length === 0) throw fieldsRequired(['evidence']);
        const now = new Date();
        data.completedAt = now; data.completionNote = dto.completionNote; data.completedOnTime = now.getTime() <= ((data.dueAt as Date | undefined) ?? a.dueAt).getTime();
        audit = 'action_item.completed'; eventType = CX_EVENTS.ACTION_ITEM_COMPLETED; notify = [a.createdById];
      }
      if (dto.status === 'CANCELLED') { data.cancelReason = dto.cancelReason; audit = 'action_item.cancelled'; }
    }
    if (Object.keys(data).length === 1) return this.get(user, id);
    await this.prisma.$transaction(async (tx: Tx) => {
      const res = await tx.actionItem.updateMany({ where: { id, status: a.status, version: a.version }, data });
      if (res.count !== 1) throw conflict('CONFLICT', 'The action item was changed by someone else; reload and retry');
      if (dto.status && dto.status !== a.status) await logState(tx, { organizationId: user.organizationId, entityType: 'action_item', entityId: id, from: a.status, to: dto.status, actorId: user.userId, note: dto.completionNote ?? dto.cancelReason ?? null });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: audit, entityType: 'action_item', entityId: id, metadata: { from: a.status, to: dto.status ?? a.status, fields: Object.keys(dto) } });
      if (dto.status === 'COMPLETED') {
        await emitCx(tx, { organizationId: user.organizationId, eventType, aggregateType: 'action_item', aggregateId: id, key: `action_item.completed:${id}`, payload: { organizationId: user.organizationId, actionItemId: id, status: 'COMPLETED', ownerId: a.ownerId, dueAt: a.dueAt.toISOString(), notifyUserIds: notify.filter((u) => u !== user.userId) } });
      }
    });
    return this.get(user, id);
  }

  /** KPI-FND-001 inputs (cancelled excluded; items without a due date cannot exist). */
  async metrics(user: Principal, q: Dto<typeof metricsQuerySchema>) {
    const to = q.to ? new Date(`${q.to}T23:59:59.999Z`) : new Date();
    const from = q.from ? new Date(`${q.from}T00:00:00.000Z`) : new Date(to.getTime() - 90 * 86_400_000);
    const rows = await this.prisma.actionItem.findMany({ where: { AND: [await this.where(user), { dueAt: { gte: from, lte: to } }] }, select: { dueAt: true, status: true, completedAt: true, ownerId: true } });
    const overall = actionItemCompletion(rows, from, new Date(to.getTime() + 1));
    const byOwner = new Map<string, typeof rows>();
    for (const r of rows) byOwner.set(r.ownerId, [...(byOwner.get(r.ownerId) ?? []), r]);
    const names = await userNameMap(this.prisma, user.organizationId, [...byOwner.keys()]);
    return {
      from: from.toISOString(), to: to.toISOString(), ...overall,
      open: rows.filter((r) => WORK_OPEN_STATUSES.includes(r.status)).length, overdue: rows.filter((r) => WORK_OPEN_STATUSES.includes(r.status) && r.dueAt.getTime() < Date.now()).length,
      byOwner: [...byOwner.entries()].map(([ownerId, rs]) => ({ ownerId, ownerName: names.get(ownerId) ?? null, ...actionItemCompletion(rs, from, new Date(to.getTime() + 1)) })).sort((x, y) => (x.ownerName ?? '').localeCompare(y.ownerName ?? '')),
    };
  }
}
