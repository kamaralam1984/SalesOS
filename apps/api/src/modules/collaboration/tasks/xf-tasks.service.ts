import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DEPARTMENT_ROLE, emitCx, findRule, logState, missingRequired, ruleAllows, WORK_RULES, WORK_OPEN_STATUSES, type XfDepartmentKey } from '@salesos/cx-core';
import { CX_EVENTS } from '@salesos/shared-types';
import type { createXfTaskSchema, listXfTasksQuerySchema, updateXfTaskSchema, xfCommentSchema, xfDependencySchema } from '@salesos/validation';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { AppError, conflict, notFound } from '../../../common/http/errors';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService, type Tx } from '../../../common/prisma';
import { fieldsRequired, hasRole, illegalTransition, scopeUserIds, userNameMap, withData } from '../../cx/common/support';
import { assertNoPii, departmentsOf, isLeadership, MINIMUM_DATA_DEPARTMENTS } from '../collab-support';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;
type Row = Prisma.XfTaskGetPayload<object>;

@Injectable()
export class XfTasksService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService) {}

  /**
   * Department-scoped visibility. Founder + Team Lead see everything; everyone else sees tasks they own or requested,
   * tasks of the people in their reporting scope (managers), and tasks addressed to THEIR non-sales department
   * (Marketing sees Marketing tasks, not Operations'). `xf-tasks:view` org scope for a department role does NOT mean org-wide.
   */
  private async where(user: Principal): Promise<Prisma.XfTaskWhereInput> {
    const org = { organizationId: user.organizationId };
    if (!this.access.has(user, 'xf-tasks:view')) throw new AppError('FORBIDDEN', 'Forbidden', 403);
    if (isLeadership(user)) return org;
    const ids = await scopeUserIds(this.access, user, 'xf-tasks:view');
    const dept = departmentsOf(user).filter((d) => d !== 'SALES' && d !== 'FOUNDER');
    const ors: Prisma.XfTaskWhereInput[] = [{ ownerId: user.userId }, { requesterId: user.userId }];
    if (hasRole(user, 'SALES_MANAGER') && ids?.length) ors.push({ ownerId: { in: ids } }, { requesterId: { in: ids } });
    if (dept.length) ors.push({ department: { in: dept } });
    return { ...org, OR: ors };
  }

  private async view(user: Principal, rows: Row[]) {
    const names = await userNameMap(this.prisma, user.organizationId, rows.flatMap((r) => [r.ownerId, r.requesterId, r.confirmedById]));
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id, title: r.title, description: r.description, kind: r.kind, department: r.department, requesterDepartment: r.requesterDepartment, priority: r.priority,
      status: r.status, dueAt: r.dueAt, overdue: WORK_OPEN_STATUSES.includes(r.status) && r.dueAt.getTime() < now,
      ownerId: r.ownerId, ownerName: names.get(r.ownerId) ?? null, requesterId: r.requesterId, requesterName: names.get(r.requesterId) ?? null,
      programId: r.programId, eventId: r.eventId, campaignId: r.campaignId, planLinkId: r.planLinkId, payload: r.payload,
      completedAt: r.completedAt, completionNote: r.completionNote, evidenceFileIds: r.evidenceFileIds,
      confirmedAt: r.confirmedAt, confirmedByName: r.confirmedById ? names.get(r.confirmedById) ?? null : null, cancelReason: r.cancelReason,
      overdueLevel: r.overdueLevel, escalatedAt: r.escalatedAt, version: r.version, createdAt: r.createdAt, updatedAt: r.updatedAt,
    }));
  }

  async list(user: Principal, q: Dto<typeof listXfTasksQuerySchema>) {
    const f: Prisma.XfTaskWhereInput = {
      ...(q.status ? { status: q.status } : {}), ...(q.department ? { department: q.department } : {}), ...(q.ownerId ? { ownerId: q.ownerId } : {}),
      ...(q.mine === true ? { OR: [{ ownerId: user.userId }, { requesterId: user.userId }] } : {}), ...(q.open === true ? { status: { in: WORK_OPEN_STATUSES } } : {}),
    };
    const rows = await this.prisma.xfTask.findMany({ where: { AND: [await this.where(user), f] }, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    return withData(res, await this.view(user, res.data));
  }

  private async load(user: Principal, id: string): Promise<Row> {
    const t = await this.prisma.xfTask.findFirst({ where: { AND: [await this.where(user), { id }] } });
    if (!t) throw notFound('Task');
    return t;
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
    const t = await this.load(user, id);
    const [v] = await this.view(user, [t]);
    const [comments, deps, history] = await Promise.all([
      this.prisma.xfTaskComment.findMany({ where: { taskId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      this.prisma.xfTaskDependency.findMany({ where: { taskId: id }, include: { dependsOn: { select: { id: true, title: true, status: true, department: true } } } }),
      this.prisma.cxStateLog.findMany({ where: { organizationId: user.organizationId, entityType: 'xf_task', entityId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    ]);
    const names = await userNameMap(this.prisma, user.organizationId, [...comments.map((c) => c.authorId), ...history.map((h) => h.actorId)]);
    return {
      ...v!,
      comments: comments.map((c) => ({ id: c.id, body: c.body, authorName: names.get(c.authorId) ?? null, createdAt: c.createdAt })),
      dependencies: deps.map((d) => ({ id: d.dependsOn.id, title: d.dependsOn.title, status: d.dependsOn.status, department: d.dependsOn.department })),
      blockedBy: deps.filter((d) => d.dependsOn.status !== 'COMPLETED').length,
      history: history.map((h) => ({ from: h.fromStatus, to: h.toStatus, actorName: h.actorId ? names.get(h.actorId) ?? null : 'System', note: h.note, at: h.createdAt })),
    };
  }

  /** Assignable users of a department: id + name only (minimum data). */
  async assignees(user: Principal, department: XfDepartmentKey) {
    const roles = department === 'SALES' ? ['SALES_TEAM_LEAD', 'SALES_MANAGER', 'SALES_EXECUTIVE'] : [DEPARTMENT_ROLE[department]];
    const rows = await this.prisma.user.findMany({ where: { organizationId: user.organizationId, isActive: true, roleAssignments: { some: { role: { key: { in: roles } } } } }, select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 200 });
    return rows;
  }

  private async assertOwnerInDepartment(orgId: string, ownerId: string, department: XfDepartmentKey) {
    const roles = department === 'SALES' ? ['SALES_TEAM_LEAD', 'SALES_MANAGER', 'SALES_EXECUTIVE'] : [DEPARTMENT_ROLE[department]];
    const n = await this.prisma.user.count({ where: { id: ownerId, organizationId: orgId, isActive: true, roleAssignments: { some: { role: { key: { in: roles } } } } } });
    if (n !== 1) throw new AppError('INVALID_OWNER', `The owner must be an active member of the ${department} department`, 422, [{ path: 'ownerId', message: 'not in department' }]);
  }

  private async assertRefs(orgId: string, dto: { programId?: string; eventId?: string; campaignId?: string; planLinkId?: string }) {
    const [p, e, c, pl] = await Promise.all([
      dto.programId ? this.prisma.program.count({ where: { id: dto.programId, organizationId: orgId } }) : 1,
      dto.eventId ? this.prisma.crmEvent.count({ where: { id: dto.eventId, organizationId: orgId } }) : 1,
      dto.campaignId ? this.prisma.leadCampaign.count({ where: { id: dto.campaignId, organizationId: orgId } }) : 1,
      dto.planLinkId ? this.prisma.campaignPlanLink.count({ where: { id: dto.planLinkId, organizationId: orgId } }) : 1,
    ]);
    if (!p || !e || !c || !pl) throw new AppError('INVALID_REFERENCE', 'A linked program / event / campaign / plan does not exist in this organization', 422);
  }

  async create(user: Principal, dto: Dto<typeof createXfTaskSchema>) {
    const org = user.organizationId;
    const dueAt = new Date(dto.dueAt);
    if (dueAt.getTime() < Date.now() - 60_000) throw new AppError('VALIDATION_ERROR', 'dueAt cannot be in the past', 422, [{ path: 'dueAt', message: 'in the past' }]);
    if (MINIMUM_DATA_DEPARTMENTS.includes(dto.department)) assertNoPii({ texts: [dto.title, dto.description], payload: dto.payload }, 'This task');
    else assertNoPii({ payload: dto.payload }, 'This task');
    const ownerId = dto.ownerId;
    if (!ownerId) throw fieldsRequired(['ownerId']);
    await this.assertOwnerInDepartment(org, ownerId, dto.department);
    await this.assertRefs(org, dto);
    const reqDept = departmentsOf(user)[0] ?? 'SALES';
    const deps = [...new Set(dto.dependsOnIds)];
    if (deps.length) {
      const found = await this.prisma.xfTask.findMany({ where: { AND: [await this.where(user), { id: { in: deps } }] }, select: { id: true } });
      if (found.length !== deps.length) throw new AppError('INVALID_DEPENDENCY', 'A dependency task was not found', 422);
    }
    const id = await this.prisma.$transaction(async (tx) => {
      const t = await tx.xfTask.create({
        data: { organizationId: org, title: dto.title, description: dto.description ?? null, kind: dto.kind, department: dto.department, requesterDepartment: reqDept, ownerId, requesterId: user.userId, priority: dto.priority, dueAt, programId: dto.programId ?? null, eventId: dto.eventId ?? null, campaignId: dto.campaignId ?? null, planLinkId: dto.planLinkId ?? null, payload: dto.payload as Prisma.InputJsonValue },
      });
      if (deps.length) await tx.xfTaskDependency.createMany({ data: deps.map((d) => ({ organizationId: org, taskId: t.id, dependsOnId: d })) });
      await logState(tx, { organizationId: org, entityType: 'xf_task', entityId: t.id, from: null, to: 'OPEN', actorId: user.userId });
      await this.audit.recordTx(tx, { organizationId: org, actorId: user.userId, action: 'xf_task.created', entityType: 'xf_task', entityId: t.id, metadata: { department: t.department, ownerId, kind: t.kind } });
      await emitCx(tx, { organizationId: org, eventType: CX_EVENTS.XF_TASK_CREATED, aggregateType: 'xf_task', aggregateId: t.id, key: `xf_task.created:${t.id}`, payload: { organizationId: org, taskId: t.id, status: 'OPEN', ownerId, department: t.department, dueAt: t.dueAt.toISOString(), notifyUserIds: [ownerId].filter((u) => u !== user.userId) } });
      return t.id;
    });
    return this.get(user, id);
  }

  async update(user: Principal, id: string, dto: Dto<typeof updateXfTaskSchema>) {
    const t = await this.load(user, id);
    const isOwner = t.ownerId === user.userId;
    const isRequester = t.requesterId === user.userId;
    const manager = hasRole(user, 'FOUNDER_CEO', 'SALES_TEAM_LEAD', 'SALES_MANAGER');
    const editsDetails = dto.title !== undefined || dto.description !== undefined || dto.dueAt !== undefined || dto.ownerId !== undefined || dto.priority !== undefined;
    if (editsDetails && !(isRequester || manager)) throw new AppError('FORBIDDEN', 'Only the requester or a manager can change task details', 403);
    if (dto.status === undefined && !editsDetails && dto.evidenceFileIds === undefined) return this.get(user, id);
    if (MINIMUM_DATA_DEPARTMENTS.includes(t.department)) assertNoPii({ texts: [dto.title, dto.description, dto.completionNote] });

    const data: Prisma.XfTaskUncheckedUpdateManyInput = { version: { increment: 1 } };
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.dueAt !== undefined) data.dueAt = new Date(dto.dueAt);
    if (dto.ownerId !== undefined) { await this.assertOwnerInDepartment(user.organizationId, dto.ownerId, t.department); data.ownerId = dto.ownerId; }
    if (dto.evidenceFileIds !== undefined) data.evidenceFileIds = dto.evidenceFileIds;
    let audit = 'xf_task.updated';
    let eventType: string = CX_EVENTS.XF_TASK_UPDATED;
    let notify: string[] = [t.ownerId, t.requesterId];
    if (dto.status && dto.status !== t.status) {
      const rule = findRule(WORK_RULES, t.status, dto.status);
      if (!rule) throw illegalTransition(t.status, dto.status);
      // the requester may also cancel their own request (extension of the section-8 actor list)
      const allowed = ruleAllows(rule, { roles: user.roles, isOwner }) || (dto.status === 'CANCELLED' && isRequester);
      if (!allowed) throw new AppError('FORBIDDEN', 'Your role cannot perform this transition on this task', 403);
      const miss = missingRequired({ ...rule, required: dto.status === 'CANCELLED' ? ['cancelReason'] : rule.required }, { ...dto });
      if (miss.length) throw fieldsRequired(miss);
      data.status = dto.status;
      const now = new Date();
      if (dto.status === 'COMPLETED') {
        const open = await this.prisma.xfTaskDependency.count({ where: { taskId: id, dependsOn: { status: { notIn: ['COMPLETED', 'CANCELLED'] } } } });
        if (open > 0) throw new AppError('DEPENDENCIES_OPEN', `${open} dependency task(s) are not finished`, 409);
        data.completedAt = now; data.completionNote = dto.completionNote; audit = 'xf_task.completed'; eventType = CX_EVENTS.XF_TASK_COMPLETED; notify = [t.requesterId];
      }
      if (dto.status === 'CANCELLED') { data.cancelReason = dto.cancelReason; audit = 'xf_task.cancelled'; }
    } else if (dto.status && dto.status === t.status && !editsDetails) {
      return this.get(user, id);
    }
    await this.prisma.$transaction(async (tx: Tx) => {
      const res = await tx.xfTask.updateMany({ where: { id, status: t.status, version: t.version }, data });
      if (res.count !== 1) throw conflict('CONFLICT', 'The task was changed by someone else; reload and retry');
      if (dto.status && dto.status !== t.status) await logState(tx, { organizationId: user.organizationId, entityType: 'xf_task', entityId: id, from: t.status, to: dto.status, actorId: user.userId, note: dto.completionNote ?? dto.cancelReason ?? null });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: audit, entityType: 'xf_task', entityId: id, metadata: { from: t.status, to: dto.status ?? t.status, fields: Object.keys(dto) } });
      await emitCx(tx, { organizationId: user.organizationId, eventType, aggregateType: 'xf_task', aggregateId: id, key: `${eventType}:${id}:${t.version + 1}`, payload: { organizationId: user.organizationId, taskId: id, status: dto.status ?? t.status, ownerId: dto.ownerId ?? t.ownerId, department: t.department, dueAt: (dto.dueAt ? new Date(dto.dueAt) : t.dueAt).toISOString(), notifyUserIds: [...new Set(notify.concat(dto.ownerId ? [dto.ownerId] : []))].filter((u) => u !== user.userId) } });
    });
    return this.get(user, id);
  }

  /** Completion confirmation: the requester (or a manager) confirms the delivered work. COMPLETED -> confirmed marker only. */
  async confirm(user: Principal, id: string) {
    const t = await this.load(user, id);
    if (t.status !== 'COMPLETED') throw new AppError('NOT_COMPLETED', 'Only a completed task can be confirmed', 409);
    if (t.confirmedAt) return this.get(user, id);
    if (!(t.requesterId === user.userId || hasRole(user, 'FOUNDER_CEO', 'SALES_TEAM_LEAD'))) throw new AppError('FORBIDDEN', 'Only the requester can confirm completion', 403);
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.xfTask.updateMany({ where: { id, status: 'COMPLETED', confirmedAt: null }, data: { confirmedAt: new Date(), confirmedById: user.userId, version: { increment: 1 } } });
      if (res.count !== 1) return;
      await logState(tx, { organizationId: user.organizationId, entityType: 'xf_task', entityId: id, from: 'COMPLETED', to: 'COMPLETED', actorId: user.userId, note: 'completion confirmed' });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'xf_task.confirmed', entityType: 'xf_task', entityId: id });
      await emitCx(tx, { organizationId: user.organizationId, eventType: CX_EVENTS.XF_TASK_CONFIRMED, aggregateType: 'xf_task', aggregateId: id, key: `xf_task.confirmed:${id}`, payload: { organizationId: user.organizationId, taskId: id, status: 'COMPLETED', ownerId: t.ownerId, department: t.department, dueAt: t.dueAt.toISOString(), notifyUserIds: [t.ownerId].filter((u) => u !== user.userId) } });
    });
    return this.get(user, id);
  }

  /** Manual escalation (extension): flags the task to the owner's manager and the Team Lead without changing its status. */
  async escalate(user: Principal, id: string, reason: string) {
    const t = await this.load(user, id);
    if (!['OPEN', 'IN_PROGRESS', 'OVERDUE', 'ESCALATED'].includes(t.status)) throw new AppError('ILLEGAL_TRANSITION', 'Only unfinished tasks can be escalated', 409);
    if (!(t.ownerId === user.userId || t.requesterId === user.userId || hasRole(user, 'FOUNDER_CEO', 'SALES_TEAM_LEAD', 'SALES_MANAGER'))) throw new AppError('FORBIDDEN', 'Only the owner, the requester or a manager can escalate', 403);
    const owner = await this.prisma.user.findFirst({ where: { id: t.ownerId, organizationId: user.organizationId }, select: { managerId: true } });
    await this.prisma.$transaction(async (tx) => {
      await tx.xfTask.update({ where: { id }, data: { escalatedAt: new Date(), version: { increment: 1 } } });
      await logState(tx, { organizationId: user.organizationId, entityType: 'xf_task', entityId: id, from: t.status, to: t.status, actorId: user.userId, note: `escalated: ${reason}` });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'xf_task.escalated', entityType: 'xf_task', entityId: id, metadata: { manual: true } });
      await emitCx(tx, { organizationId: user.organizationId, eventType: CX_EVENTS.XF_TASK_ESCALATED, aggregateType: 'xf_task', aggregateId: id, key: `xf_task.escalated:${id}:manual:${t.version + 1}`, payload: { organizationId: user.organizationId, taskId: id, status: t.status, ownerId: t.ownerId, department: t.department, dueAt: t.dueAt.toISOString(), level: 2, manual: true, notifyUserIds: [t.requesterId, ...(owner?.managerId ? [owner.managerId] : [])].filter((u) => u !== user.userId), notifyRoles: ['SALES_TEAM_LEAD'] } });
    });
    return this.get(user, id);
  }

  async comment(user: Principal, id: string, dto: Dto<typeof xfCommentSchema>) {
    const t = await this.load(user, id);
    if (MINIMUM_DATA_DEPARTMENTS.includes(t.department)) assertNoPii({ texts: [dto.body] }, 'This comment');
    const c = await this.prisma.$transaction(async (tx) => {
      const row = await tx.xfTaskComment.create({ data: { organizationId: user.organizationId, taskId: id, authorId: user.userId, body: dto.body } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'xf_task.commented', entityType: 'xf_task', entityId: id, metadata: { commentId: row.id } });
      return row;
    });
    return { id: c.id, body: c.body, authorName: user.name, createdAt: c.createdAt };
  }

  async addDependency(user: Principal, id: string, dto: Dto<typeof xfDependencySchema>) {
    const t = await this.load(user, id);
    if (dto.dependsOnId === id) throw new AppError('INVALID_DEPENDENCY', 'A task cannot depend on itself', 422);
    if (['COMPLETED', 'CANCELLED'].includes(t.status)) throw new AppError('ILLEGAL_TRANSITION', 'Finished tasks cannot get new dependencies', 409);
    const dep = await this.prisma.xfTask.findFirst({ where: { AND: [await this.where(user), { id: dto.dependsOnId }] }, select: { id: true } });
    if (!dep) throw notFound('Dependency task');
    // cycle check: walk the dependency's own dependencies; reaching `id` would close a loop
    const seen = new Set<string>();
    const stack = [dto.dependsOnId];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === id) throw new AppError('DEPENDENCY_CYCLE', 'This dependency would create a cycle', 409);
      if (seen.has(cur)) continue;
      seen.add(cur);
      const next = await this.prisma.xfTaskDependency.findMany({ where: { taskId: cur }, select: { dependsOnId: true } });
      stack.push(...next.map((n) => n.dependsOnId));
    }
    await this.prisma.xfTaskDependency.upsert({ where: { taskId_dependsOnId: { taskId: id, dependsOnId: dto.dependsOnId } }, create: { organizationId: user.organizationId, taskId: id, dependsOnId: dto.dependsOnId }, update: {} });
    await this.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'xf_task.dependency_added', entityType: 'xf_task', entityId: id, metadata: { dependsOnId: dto.dependsOnId } });
    return this.get(user, id);
  }
}
