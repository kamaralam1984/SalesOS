import { Injectable } from '@nestjs/common';
import type { Prisma, Task } from '@prisma/client';
import { CRM_EVENTS } from '@salesos/shared-types';
import { createTaskTx, getWorkingHours, lockLead, syncLeadExceptions, syncLeadNextAction, zonedParts, type Tx } from '@salesos/crm-core';
import type { z } from 'zod';
import type { calendarQuerySchema, completeTaskSchema, createTaskSchema, listTasksQuerySchema, reassignTaskSchema, updateTaskSchema } from '@salesos/validation';
import type { Principal } from '../../../common/authz';
import { AppError, notFound } from '../../../common/http/errors';
import { ok } from '../../../common/http/api-result';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { CrmSupport, recordAccess, taskAccess } from '../crm.support';

const and = (where: Record<string, unknown>, ...extra: Prisma.TaskWhereInput[]): Prisma.TaskWhereInput => ({
  ...where,
  AND: [...((where.AND as Prisma.TaskWhereInput[] | undefined) ?? []), ...extra],
}) as Prisma.TaskWhereInput;

@Injectable()
export class TasksService {
  constructor(private readonly s: CrmSupport) {}

  private async serialize(user: Principal, tasks: Task[]) {
    const now = new Date();
    const leadIds = [...new Set(tasks.flatMap((t) => (t.leadId ? [t.leadId] : [])))];
    const leads = leadIds.length ? await this.s.prisma.lead.findMany({ where: { id: { in: leadIds }, organizationId: user.organizationId }, select: { id: true, fullName: true, phoneE164: true, phoneRaw: true, status: true } }) : [];
    const lb = new Map(leads.map((l) => [l.id, l]));
    const names = await this.s.userNames(tasks.map((t) => t.assignedToId));
    return tasks.map((t) => ({
      id: t.id,
      leadId: t.leadId,
      lead: t.leadId && lb.get(t.leadId) ? { id: t.leadId, fullName: lb.get(t.leadId)!.fullName, phone: lb.get(t.leadId)!.phoneE164 ?? lb.get(t.leadId)!.phoneRaw, status: lb.get(t.leadId)!.status } : null,
      assignedTo: { id: t.assignedToId, name: names.get(t.assignedToId) ?? null },
      type: t.type,
      title: t.title,
      description: t.description,
      dueAt: t.dueAt.toISOString(),
      status: t.status,
      priority: t.priority,
      isPinned: t.isPinned,
      overdue: t.status === 'OPEN' && t.dueAt < now,
      overdueLevel: t.overdueLevel,
      completedAt: t.completedAt?.toISOString() ?? null,
      completionNote: t.completionNote,
      ruleKey: t.ruleKey,
      version: t.version,
      createdAt: t.createdAt.toISOString(),
    }));
  }

  async loadTask(user: Principal, id: string, permission: 'tasks:view' | 'tasks:update' | 'tasks:reassign'): Promise<Task> {
    const t = await this.s.prisma.task.findFirst({ where: { id, organizationId: user.organizationId } });
    await this.s.access.assertRecordAccess(user, permission, t && taskAccess(t), 'Task');
    return t!;
  }

  async list(user: Principal, q: z.infer<typeof listTasksQuerySchema>) {
    const scoped = await this.s.access.scopedWhere(user, { permission: 'tasks:view', ownerField: 'assignedToId', teamField: 'teamId' });
    const now = new Date();
    const extra: Prisma.TaskWhereInput[] = [];
    if (q.status !== 'ALL') extra.push({ status: q.status });
    if (q.assignedToId) extra.push({ assignedToId: q.assignedToId });
    if (q.mine) extra.push({ assignedToId: user.userId });
    if (q.leadId) extra.push({ leadId: q.leadId });
    if (q.type) extra.push({ type: q.type });
    if (q.pinned !== undefined) extra.push({ isPinned: q.pinned });
    if (q.overdue) extra.push({ status: 'OPEN', dueAt: { lt: now } });
    if (q.dueFrom) extra.push({ dueAt: { gte: q.dueFrom } });
    if (q.dueTo) extra.push({ dueAt: { lte: q.dueTo } });
    const where = and(scoped, ...extra);
    const rows = await this.s.prisma.task.findMany({ where, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], ...pageArgs(q) });
    const total = q.page ? await this.s.prisma.task.count({ where }) : undefined;
    const res = pageResult(rows, q, total);
    return ok(await this.serialize(user, res.data as Task[]), res.meta);
  }

  /** Follow-up calendar: open tasks in [from, to] grouped by business-timezone day, plus the overdue backlog. */
  async calendar(user: Principal, q: z.infer<typeof calendarQuerySchema>) {
    if (q.to.getTime() - q.from.getTime() > 62 * 86_400_000 || q.to < q.from) throw new AppError('VALIDATION_ERROR', 'Range must be 0-62 days', 422);
    const scoped = await this.s.access.scopedWhere(user, { permission: 'tasks:view', ownerField: 'assignedToId', teamField: 'teamId' });
    const owner: Prisma.TaskWhereInput[] = [];
    if (q.assignedToId) owner.push({ assignedToId: q.assignedToId });
    if (q.mine) owner.push({ assignedToId: user.userId });
    const now = new Date();
    const [inRange, overdue] = await Promise.all([
      this.s.prisma.task.findMany({ where: and(scoped, { status: 'OPEN', dueAt: { gte: q.from, lte: q.to } }, ...owner), orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], take: 1000 }),
      this.s.prisma.task.findMany({ where: and(scoped, { status: 'OPEN', dueAt: { lt: q.from < now ? q.from : now } }, ...owner), orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], take: 200 }),
    ]);
    const wh = await getWorkingHours(this.s.prisma as unknown as Tx, user.organizationId, null);
    const ser = await this.serialize(user, [...inRange, ...overdue]);
    const byId = new Map(ser.map((t) => [t.id, t]));
    const days = new Map<string, unknown[]>();
    for (const t of inRange) {
      const p = zonedParts(t.dueAt, wh.timezone);
      const key = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
      days.set(key, [...(days.get(key) ?? []), byId.get(t.id)]);
    }
    return { timezone: wh.timezone, days: [...days].map(([date, tasks]) => ({ date, count: tasks.length, tasks })), overdue: overdue.map((t) => byId.get(t.id)) };
  }

  async create(user: Principal, body: z.infer<typeof createTaskSchema>, forLeadId?: string, idemKey?: string) {
    const leadId = forLeadId ?? body.leadId ?? null;
    let teamId: string | null = null;
    let defaultOwner = user.userId;
    if (leadId) {
      const lead = await this.s.prisma.lead.findFirst({ where: { id: leadId, organizationId: user.organizationId, mergedIntoId: null } });
      await this.s.access.assertRecordAccess(user, 'tasks:create', lead && recordAccess(lead), 'Lead');
      if (lead!.stageCategory === 'WON') throw new AppError('INVALID_STATE', 'Cannot add tasks to a won lead', 409);
      teamId = lead!.teamId;
      defaultOwner = lead!.assignedToId ?? user.userId;
    }
    const assignedToId = body.assignedToId ?? defaultOwner;
    if (assignedToId !== user.userId) await this.s.assertAssignable(user, 'tasks:reassign', assignedToId).catch(() => {
      throw notFound('User');
    });
    const key = idemKey ? `${user.userId}:${idemKey}`.slice(0, 200) : null;
    const res = await this.s.tx(async (tx) => {
      if (leadId) await lockLead(tx, user.organizationId, leadId);
      const r = await createTaskTx(tx, this.s.deps, { organizationId: user.organizationId, leadId, assignedToId, createdById: user.userId, teamId, type: body.type, title: body.title, description: body.description, dueAt: body.dueAt, priority: body.priority, isPinned: body.type === 'CALLBACK' || body.priority === 'URGENT', idempotencyKey: key });
      if (r.created) {
        await this.s.deps.audit(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'task.created', entityType: 'task', entityId: r.task.id, metadata: { leadId, assignedToId, type: body.type } });
        if (leadId) await syncLeadExceptions(tx, leadId);
      }
      return r;
    });
    return (await this.serialize(user, [res.task]))[0];
  }

  async update(user: Principal, id: string, body: z.infer<typeof updateTaskSchema>) {
    const t0 = await this.loadTask(user, id, 'tasks:update');
    if (t0.status !== 'OPEN') throw new AppError('INVALID_STATE', 'Only open tasks can be edited', 409);
    const t = await this.s.tx(async (tx) => {
      const data: Prisma.TaskUncheckedUpdateManyInput = { version: { increment: 1 } };
      if (body.title !== undefined) data.title = body.title;
      if (body.description !== undefined) data.description = body.description ?? null;
      if (body.priority !== undefined) data.priority = body.priority;
      if (body.type !== undefined) data.type = body.type;
      if (body.dueAt !== undefined) {
        data.dueAt = body.dueAt;
        // rescheduling restarts reminder + escalation for the new due date
        data.overdueLevel = 0;
        data.remindedAt = null;
      }
      const res = await tx.task.updateMany({ where: { id, status: 'OPEN', ...(body.version ? { version: body.version } : {}) }, data });
      if (res.count === 0) throw new AppError('VERSION_CONFLICT', 'The task changed or was closed; reload and retry', 409);
      const next = await tx.task.findUniqueOrThrow({ where: { id } });
      if (next.leadId) {
        await syncLeadNextAction(tx, next.leadId);
        await syncLeadExceptions(tx, next.leadId);
      }
      await this.s.deps.audit(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'task.updated', entityType: 'task', entityId: id, metadata: { fields: Object.keys(body).filter((k) => k !== 'version'), rescheduledFrom: body.dueAt ? t0.dueAt.toISOString() : undefined } });
      return next;
    });
    return (await this.serialize(user, [t]))[0];
  }

  /** Atomic complete: compare-and-set on status=OPEN so concurrent completes cannot double-apply. */
  async complete(user: Principal, id: string, body: z.infer<typeof completeTaskSchema>) {
    const t0 = await this.loadTask(user, id, 'tasks:update');
    const t = await this.s.tx(async (tx) => {
      const now = new Date();
      const res = await tx.task.updateMany({ where: { id, status: 'OPEN', ...(body.version ? { version: body.version } : {}) }, data: { status: 'DONE', completedAt: now, completedById: user.userId, completionNote: body.completionNote ?? null, version: { increment: 1 } } });
      if (res.count === 0) throw new AppError('ALREADY_CLOSED', t0.status === 'OPEN' ? 'The task changed; reload and retry' : 'The task is already closed', 409);
      const next = await tx.task.findUniqueOrThrow({ where: { id } });
      if (next.leadId) {
        await tx.lead.update({ where: { id: next.leadId }, data: { lastActivityAt: now } });
        await syncLeadNextAction(tx, next.leadId);
        await syncLeadExceptions(tx, next.leadId);
      }
      await tx.reassignmentQueueEntry.updateMany({ where: { taskId: id, status: 'OPEN' }, data: { status: 'CANCELLED', openKey: null, resolvedAt: now, resolutionNote: 'Task completed' } });
      await this.s.deps.audit(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'task.completed', entityType: 'task', entityId: id, metadata: { leadId: next.leadId } });
      await this.s.deps.publish(tx, { eventType: CRM_EVENTS.TASK_COMPLETED, aggregateType: 'task', aggregateId: id, organizationId: user.organizationId, payload: { taskId: id, leadId: next.leadId, completedById: user.userId }, idempotencyKey: `task.completed:${id}` });
      return next;
    });
    return (await this.serialize(user, [t]))[0];
  }

  async reassign(user: Principal, id: string, body: z.infer<typeof reassignTaskSchema>) {
    const t0 = await this.loadTask(user, id, 'tasks:reassign');
    if (t0.status !== 'OPEN') throw new AppError('INVALID_STATE', 'Only open tasks can be reassigned', 409);
    const target = await this.s.assertAssignable(user, 'tasks:reassign', body.assignedToId);
    if (target.id === t0.assignedToId) throw new AppError('NO_CHANGE', 'The task is already assigned to that user', 422);
    const t = await this.s.tx(async (tx) => {
      const teamIdRows = await tx.$queryRaw<{ team_id: string }[]>`SELECT tm.team_id::text FROM team_memberships tm JOIN teams t ON t.id = tm.team_id WHERE tm.user_id = ${target.id}::uuid AND t.organization_id = ${user.organizationId}::uuid LIMIT 1`;
      const res = await tx.task.updateMany({ where: { id, status: 'OPEN' }, data: { assignedToId: target.id, teamId: teamIdRows[0]?.team_id ?? t0.teamId, overdueLevel: 0, remindedAt: null, version: { increment: 1 } } });
      if (res.count === 0) throw new AppError('ALREADY_CLOSED', 'The task is already closed', 409);
      await tx.reassignmentQueueEntry.updateMany({ where: { taskId: id, status: 'OPEN' }, data: { status: 'RESOLVED', openKey: null, resolvedAt: new Date(), resolvedById: user.userId, newOwnerId: target.id, resolutionNote: body.reason } });
      await this.s.deps.audit(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'ownership.changed', entityType: 'task', entityId: id, metadata: { fromUserId: t0.assignedToId, toUserId: target.id, reason: body.reason } });
      return tx.task.findUniqueOrThrow({ where: { id } });
    });
    return (await this.serialize(user, [t]))[0];
  }
}
