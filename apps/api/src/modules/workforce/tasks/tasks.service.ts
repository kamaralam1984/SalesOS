import { Injectable } from '@nestjs/common';
import type { Prisma, WorkTaskStatus } from '@prisma/client';
import { PLATFORM_EVENTS, WORKFORCE_EVENTS } from '@salesos/shared-types';
import type { createWorkTaskSchema, listWorkTasksQuerySchema, updateWorkTaskSchema, workTaskCommentSchema, workTaskTransitionSchema } from '@salesos/validation';
import { isTaskOverdue, TASK_OPEN, transitionTask, type TaskActorRole, type TaskStatusKey } from '@salesos/workforce-core';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { AppError, conflict, forbidden, notFound } from '../../../common/http/errors';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService, type Tx } from '../../../common/prisma';
import { asPage, assertOrgUsers, scopeUserIds, userNameMap } from '../../people/common/helpers';
import { WorkforceConfigService } from '../common/workforce-config.service';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;
type TaskRow = Prisma.WorkTaskGetPayload<object>;
const TARGETS: TaskStatusKey[] = ['ACCEPTED', 'IN_PROGRESS', 'REVIEW', 'COMPLETED', 'REJECTED', 'CANCELLED', 'ASSIGNED'];

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly cfg: WorkforceConfigService,
  ) {}

  // ------------------------------------------------------------------ scope
  private async where(user: Principal): Promise<Prisma.WorkTaskWhereInput> {
    const ids = await scopeUserIds(this.access, user, 'work-tasks:view');
    if (ids === null) return { organizationId: user.organizationId };
    return { organizationId: user.organizationId, OR: [{ assigneeId: { in: ids } }, { assignerId: user.userId }] };
  }

  private async load(user: Principal, id: string): Promise<TaskRow> {
    const t = await this.prisma.workTask.findFirst({ where: { AND: [await this.where(user), { id }] } });
    if (!t) throw notFound('Task');
    return t;
  }

  /** ASSIGNEE = the assignee; ASSIGNER = the assigner, or a user whose work-tasks:update scope (team/org) covers the assignee (never for their own task). */
  private async rolesFor(user: Principal, t: { assigneeId: string; assignerId: string }): Promise<Set<TaskActorRole>> {
    const roles = new Set<TaskActorRole>();
    if (!this.access.has(user, 'work-tasks:update')) return roles;
    if (t.assigneeId === user.userId) roles.add('ASSIGNEE');
    if (t.assignerId === user.userId) roles.add('ASSIGNER');
    else if (t.assigneeId !== user.userId) {
      const level = this.access.scopeLevel(user, 'work-tasks:update');
      if (level === 'org') roles.add('ASSIGNER');
      else if (level === 'team' && (await this.access.visibleUsers(user)).ids.includes(t.assigneeId)) roles.add('ASSIGNER');
    }
    return roles;
  }

  /** Create-scope check for who a task may be assigned to. */
  private async assertAssignable(user: Principal, assigneeId: string) {
    if (assigneeId === user.userId) return;
    const level = this.access.scopeLevel(user, 'work-tasks:create');
    if (!level || level === 'own') throw forbidden('You can only create tasks for yourself');
    await assertOrgUsers(this.prisma, user.organizationId, [assigneeId]);
    if (level === 'team' && !(await this.access.visibleUsers(user)).ids.includes(assigneeId)) throw notFound('Employee');
  }

  private async assertGoalLinkable(user: Principal, goalId: string) {
    const ids = await scopeUserIds(this.access, user, 'goals:view');
    const g = await this.prisma.goal.findFirst({ where: { id: goalId, organizationId: user.organizationId, ...(ids ? { OR: [{ ownerId: { in: ids } }, { reviewerId: user.userId }] } : {}) }, select: { id: true } });
    if (!g) throw notFound('Goal');
  }

  // ------------------------------------------------------------------ view
  private async view(user: Principal, t: TaskRow, names: Map<string, string>, requireReview: boolean, now: Date, goalTitles?: Map<string, string>) {
    const roles = await this.rolesFor(user, t);
    const can: Record<string, boolean> = {};
    for (const to of TARGETS) can[to] = transitionTask(t.status as TaskStatusKey, to, roles, { requireReview }).ok;
    const terminalOpen = t.status !== 'COMPLETED' && t.status !== 'CANCELLED';
    return {
      id: t.id, title: t.title, description: t.description, priority: t.priority, status: t.status, project: t.project, evidence: t.evidence, reviewNote: t.reviewNote,
      assignerId: t.assignerId, assignerName: names.get(t.assignerId) ?? null, assigneeId: t.assigneeId, assigneeName: names.get(t.assigneeId) ?? null,
      dueAt: t.dueAt, completedAt: t.completedAt, overdue: isTaskOverdue(t.status as TaskStatusKey, t.dueAt, now), goalId: t.goalId, goalTitle: t.goalId ? goalTitles?.get(t.goalId) ?? null : null,
      version: t.version, createdAt: t.createdAt, updatedAt: t.updatedAt,
      can: { transitions: can, edit: roles.has('ASSIGNER') && terminalOpen, comment: roles.size > 0 },
    };
  }

  private async goalTitles(user: Principal, ids: Array<string | null>): Promise<Map<string, string>> {
    const uniq = [...new Set(ids.filter((i): i is string => !!i))];
    if (uniq.length === 0) return new Map();
    const rows = await this.prisma.goal.findMany({ where: { organizationId: user.organizationId, id: { in: uniq } }, select: { id: true, title: true } });
    return new Map(rows.map((g) => [g.id, g.title]));
  }

  // ------------------------------------------------------------------ reads
  async list(user: Principal, q: Dto<typeof listWorkTasksQuerySchema>) {
    const now = new Date();
    const filters: Prisma.WorkTaskWhereInput[] = [await this.where(user)];
    if (q.view === 'mine') filters.push({ assigneeId: user.userId });
    if (q.view === 'assigned') filters.push({ assignerId: user.userId });
    if (q.view === 'team') filters.push({ assigneeId: { not: user.userId } });
    if (q.status) filters.push({ status: q.status });
    if (q.goalId) filters.push({ goalId: q.goalId });
    if (q.assigneeId) filters.push({ assigneeId: q.assigneeId });
    if (q.overdue !== undefined) {
      const od: Prisma.WorkTaskWhereInput = { status: { in: [...TASK_OPEN] }, dueAt: { lt: now } };
      // not-overdue must be NULL-safe: a task without a due date is never overdue
      filters.push(q.overdue ? od : { OR: [{ status: { notIn: [...TASK_OPEN] } }, { dueAt: null }, { dueAt: { gte: now } }] });
    }
    const { config } = await this.cfg.getConfig(user.organizationId);
    const rows = await this.prisma.workTask.findMany({ where: { AND: filters }, orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const names = await userNameMap(this.prisma, user.organizationId, res.data.flatMap((t) => [t.assigneeId, t.assignerId]));
    const gt = await this.goalTitles(user, res.data.map((t) => t.goalId));
    return asPage(res, await Promise.all(res.data.map((t) => this.view(user, t, names, config.tasks.requireReview, now, gt))));
  }

  async summary(user: Principal) {
    const now = new Date();
    const scope = await this.where(user);
    const { config } = await this.cfg.getConfig(user.organizationId);
    const soon = new Date(now.getTime() + Math.max(config.tasks.reminderHoursBeforeDue, 24) * 3_600_000);
    const open = { status: { in: [...TASK_OPEN] as WorkTaskStatus[] } };
    const [byStatus, overdue, dueSoon, myOpen, myOverdue, awaitingMyReview] = await Promise.all([
      this.prisma.workTask.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
      this.prisma.workTask.count({ where: { AND: [scope, open, { dueAt: { lt: now } }] } }),
      this.prisma.workTask.count({ where: { AND: [scope, open, { dueAt: { gte: now, lte: soon } }] } }),
      this.prisma.workTask.count({ where: { AND: [scope, open, { assigneeId: user.userId }] } }),
      this.prisma.workTask.count({ where: { AND: [scope, open, { assigneeId: user.userId, dueAt: { lt: now } }] } }),
      this.prisma.workTask.count({ where: { AND: [scope, { status: 'REVIEW', assignerId: user.userId }] } }),
    ]);
    return {
      total: byStatus.reduce((n, r) => n + r._count._all, 0), byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
      overdue, dueSoon, mine: { open: myOpen, overdue: myOverdue }, awaitingMyReview,
    };
  }

  async get(user: Principal, id: string) {
    const t = await this.load(user, id);
    const { config } = await this.cfg.getConfig(user.organizationId);
    const events = await this.prisma.workTaskEvent.findMany({ where: { taskId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 500 });
    const names = await userNameMap(this.prisma, user.organizationId, [t.assigneeId, t.assignerId, ...events.map((e) => e.actorId)]);
    const gt = await this.goalTitles(user, [t.goalId]);
    return {
      ...(await this.view(user, t, names, config.tasks.requireReview, new Date(), gt)),
      events: events.map((e) => ({ id: e.id, kind: e.kind, actorId: e.actorId, actorName: e.actorId ? names.get(e.actorId) ?? null : null, fromStatus: e.fromStatus, toStatus: e.toStatus, note: e.note, createdAt: e.createdAt })),
    };
  }

  // ------------------------------------------------------------------ writes
  private async notify(tx: Tx, user: Principal, taskId: string, type: 'work_task.assigned' | 'work_task.update', userId: string | null | undefined, title: string, key: string) {
    if (!userId || userId === user.userId) return;
    await this.outbox.publish(tx, {
      eventType: PLATFORM_EVENTS.NOTIFICATION_REQUESTED, aggregateType: 'work_task', aggregateId: taskId, organizationId: user.organizationId,
      payload: { organizationId: user.organizationId, type, userIds: [userId], entity: { type: 'work_task', id: taskId }, dedupeKey: key, actionUrl: `/work/tasks/${taskId}`, title },
      idempotencyKey: `notification.requested:${key}`,
    });
  }

  private async record(tx: Tx, user: Principal, t: { id: string; assigneeId: string; assignerId: string; version: number }, o: { audit: string; eventType: string; kind: string; from?: string | null; to?: string | null; note?: string | null; key: string; meta?: Record<string, unknown> }) {
    await tx.workTaskEvent.create({ data: { organizationId: user.organizationId, taskId: t.id, actorId: user.userId, kind: o.kind, fromStatus: o.from ?? null, toStatus: o.to ?? null, note: o.note ?? null } });
    // task narrative stays in work_task_events; audit and outbox payloads carry status only
    await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: o.audit, entityType: 'work_task', entityId: t.id, metadata: { assigneeId: t.assigneeId, from: o.from ?? null, to: o.to ?? null, ...(o.meta ?? {}) } });
    await this.outbox.publish(tx, {
      eventType: o.eventType, aggregateType: 'work_task', aggregateId: t.id, organizationId: user.organizationId,
      payload: { taskId: t.id, organizationId: user.organizationId, assigneeId: t.assigneeId, assignerId: t.assignerId, actorId: user.userId, from: o.from ?? null, to: o.to ?? null },
      idempotencyKey: `${o.eventType}:${t.id}:${o.key}`,
    });
  }

  async create(user: Principal, dto: Dto<typeof createWorkTaskSchema>) {
    const assigneeId = dto.assigneeId ?? user.userId;
    await this.assertAssignable(user, assigneeId);
    if (dto.goalId) await this.assertGoalLinkable(user, dto.goalId);
    if (dto.dueAt && new Date(dto.dueAt).getTime() < Date.now() - 60_000) throw new AppError('VALIDATION_ERROR', 'The due date cannot be in the past', 400);
    const self = assigneeId === user.userId;
    const id = await this.prisma.$transaction(async (tx) => {
      const t = await tx.workTask.create({
        data: {
          organizationId: user.organizationId, title: dto.title, description: dto.description ?? null, priority: dto.priority, assignerId: user.userId, assigneeId,
          dueAt: dto.dueAt ? new Date(dto.dueAt) : null, goalId: dto.goalId ?? null, project: dto.project ?? null, status: self ? 'ACCEPTED' : 'ASSIGNED',
        },
      });
      await this.record(tx, user, t, { audit: 'work_task.created', eventType: WORKFORCE_EVENTS.WORK_TASK_ASSIGNED, kind: 'CREATED', to: t.status, key: `created`, meta: { goalId: dto.goalId ?? null } });
      await this.notify(tx, user, t.id, 'work_task.assigned', assigneeId, 'A task was assigned to you', `work_task.assigned:${t.id}:${assigneeId}`);
      return t.id;
    });
    return this.get(user, id);
  }

  async update(user: Principal, id: string, dto: Dto<typeof updateWorkTaskSchema>) {
    const t = await this.load(user, id);
    const roles = await this.rolesFor(user, t);
    if (!roles.has('ASSIGNER')) throw forbidden('Only the person who assigned the task can edit it');
    if (t.status === 'COMPLETED' || t.status === 'CANCELLED') throw conflict('TASK_LOCKED', 'A completed or cancelled task cannot be edited');
    if (dto.version !== t.version) throw conflict('STALE_VERSION', 'The task changed; reload and retry');
    const data: Prisma.WorkTaskUncheckedUpdateManyInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.dueAt !== undefined) data.dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    if (dto.project !== undefined) data.project = dto.project;
    if (dto.goalId !== undefined) {
      if (dto.goalId) await this.assertGoalLinkable(user, dto.goalId);
      data.goalId = dto.goalId;
    }
    const reassigned = dto.assigneeId !== undefined && dto.assigneeId !== t.assigneeId;
    if (reassigned) {
      await this.assertAssignable(user, dto.assigneeId!);
      data.assigneeId = dto.assigneeId;
      data.status = dto.assigneeId === user.userId ? 'ACCEPTED' : 'ASSIGNED';
      data.reviewNote = null;
    }
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.workTask.updateMany({ where: { id, version: t.version }, data: { ...data, version: { increment: 1 } } });
      if (res.count !== 1) throw conflict('STALE_VERSION', 'The task changed; reload and retry');
      const next = { ...t, assigneeId: reassigned ? dto.assigneeId! : t.assigneeId, version: t.version + 1 };
      await this.record(tx, user, next, {
        audit: reassigned ? 'work_task.reassigned' : 'work_task.updated', eventType: WORKFORCE_EVENTS.WORK_TASK_UPDATED, kind: reassigned ? 'REASSIGNED' : 'UPDATED',
        from: t.status, to: (data.status as string | undefined) ?? t.status, note: reassigned ? null : `Edited: ${Object.keys(dto).filter((k) => k !== 'version').join(', ')}`, key: `v${next.version}`,
        meta: { fields: Object.keys(dto).filter((k) => k !== 'version') },
      });
      if (reassigned) await this.notify(tx, user, id, 'work_task.assigned', dto.assigneeId, 'A task was assigned to you', `work_task.assigned:${id}:${dto.assigneeId}`);
      else await this.notify(tx, user, id, 'work_task.update', t.assigneeId, 'A task was updated', `work_task.update:${id}:v${next.version}`);
    });
    return this.get(user, id);
  }

  async transition(user: Principal, id: string, dto: Dto<typeof workTaskTransitionSchema>) {
    const t = await this.load(user, id);
    const { config } = await this.cfg.getConfig(user.organizationId);
    const roles = await this.rolesFor(user, t);
    const from = t.status as TaskStatusKey;
    const r = transitionTask(from, dto.to, roles, { requireReview: config.tasks.requireReview });
    if (!r.ok) {
      if (r.code === 'NOT_ALLOWED') throw forbidden('You cannot move this task to that status');
      throw new AppError('ILLEGAL_TRANSITION', `Cannot move a task from ${from} to ${dto.to}`, 409);
    }
    if (r.needsNote && !dto.note) throw new AppError('VALIDATION_ERROR', 'A note is required for this change', 400);
    if (dto.version !== undefined && dto.version !== t.version) throw conflict('STALE_VERSION', 'The task changed; reload and retry');
    const data: Prisma.WorkTaskUncheckedUpdateManyInput = { status: dto.to };
    if (dto.to === 'COMPLETED') data.completedAt = new Date();
    if (dto.to === 'REJECTED' || (from === 'REVIEW' && dto.to === 'IN_PROGRESS') || dto.to === 'COMPLETED') data.reviewNote = dto.note ?? null;
    if (dto.to === 'ASSIGNED') data.reviewNote = null;
    if (dto.evidence) data.evidence = dto.evidence;
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.workTask.updateMany({ where: { id, version: t.version, status: from }, data: { ...data, version: { increment: 1 } } });
      if (res.count !== 1) throw conflict('STALE_VERSION', 'The task changed; reload and retry');
      const next = { ...t, version: t.version + 1 };
      await this.record(tx, user, next, { audit: `work_task.${dto.to.toLowerCase()}`, eventType: dto.to === 'COMPLETED' ? WORKFORCE_EVENTS.WORK_TASK_UPDATED : WORKFORCE_EVENTS.WORK_TASK_UPDATED, kind: 'STATUS', from, to: dto.to, note: dto.note ?? null, key: `v${next.version}` });
      if (dto.evidence) await tx.workTaskEvent.create({ data: { organizationId: user.organizationId, taskId: id, actorId: user.userId, kind: 'EVIDENCE', note: dto.evidence } });
      const other = user.userId === t.assigneeId ? t.assignerId : t.assigneeId;
      await this.notify(tx, user, id, 'work_task.update', other, 'A task status changed', `work_task.update:${id}:v${next.version}`);
    });
    return this.get(user, id);
  }

  async comment(user: Principal, id: string, dto: Dto<typeof workTaskCommentSchema>) {
    const t = await this.load(user, id);
    if ((await this.rolesFor(user, t)).size === 0) throw forbidden('You cannot comment on this task');
    await this.prisma.$transaction(async (tx) => {
      const ev = await tx.workTaskEvent.create({ data: { organizationId: user.organizationId, taskId: id, actorId: user.userId, kind: 'COMMENT', note: dto.note } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'work_task.commented', entityType: 'work_task', entityId: id, metadata: { assigneeId: t.assigneeId } });
      await this.outbox.publish(tx, {
        eventType: WORKFORCE_EVENTS.WORK_TASK_UPDATED, aggregateType: 'work_task', aggregateId: id, organizationId: user.organizationId,
        payload: { taskId: id, organizationId: user.organizationId, assigneeId: t.assigneeId, assignerId: t.assignerId, actorId: user.userId, from: t.status, to: t.status },
        idempotencyKey: `${WORKFORCE_EVENTS.WORK_TASK_UPDATED}:${id}:comment:${ev.id}`,
      });
      await this.notify(tx, user, id, 'work_task.update', user.userId === t.assigneeId ? t.assignerId : t.assigneeId, 'New comment on a task', `work_task.comment:${ev.id}`);
    });
    return this.get(user, id);
  }
}
