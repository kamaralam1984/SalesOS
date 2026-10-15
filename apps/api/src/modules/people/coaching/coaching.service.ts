import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  coachingHoursQuerySchema, createCoachingSessionSchema, createOneOnOneSchema, listActionsQuerySchema, listCoachingQuerySchema, listOneOnOnesQuerySchema, updateActionSchema, updateCoachingSessionSchema,
} from '@salesos/validation';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { PEOPLE_EVENTS } from '@salesos/shared-types';
import { AccessService, type Principal } from '../../../common/authz';
import { AppError, forbidden, notFound } from '../../../common/http/errors';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService } from '../../../common/prisma';
import { assertOrgUsers, assertTargetInScope, isoDay, scopeUserIds, toDate, userNameMap, asPage } from '../common/helpers';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;

@Injectable()
export class CoachingService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService, private readonly outbox: OutboxService) {}

  /** Notes visibility rules: COACH_ONLY -> coach; PARTICIPANTS -> coach + participants; MANAGEMENT -> also anyone with team/org coaching scope. */
  private canReadNotes(user: Principal, s: { coachId: string; noteVisibility: string; participants: { userId: string }[] }): boolean {
    if (s.coachId === user.userId) return true;
    if (s.noteVisibility === 'COACH_ONLY') return false;
    if (s.participants.some((p) => p.userId === user.userId)) return true;
    if (s.noteVisibility === 'MANAGEMENT') {
      const level = this.access.scopeLevel(user, 'coaching:view');
      return level === 'team' || level === 'org';
    }
    return false;
  }

  private async sessionWhere(user: Principal): Promise<Prisma.CoachingSessionWhereInput> {
    const ids = await scopeUserIds(this.access, user, 'coaching:view');
    if (!ids) return { organizationId: user.organizationId };
    return { organizationId: user.organizationId, OR: [{ coachId: { in: ids } }, { participants: { some: { userId: { in: ids } } } }] };
  }

  private async shape(user: Principal, rows: Array<Prisma.CoachingSessionGetPayload<{ include: { participants: true; actions: true } }>>) {
    const names = await userNameMap(this.prisma, user.organizationId, rows.flatMap((s) => [s.coachId, ...s.participants.map((p) => p.userId), ...s.actions.map((a) => a.ownerId)]));
    return rows.map((s) => ({
      id: s.id, kind: s.kind, sessionDate: s.sessionDate, durationMin: s.durationMin, topics: s.topics, callRef: s.callRef, noteVisibility: s.noteVisibility,
      coachId: s.coachId, coachName: names.get(s.coachId) ?? null,
      participants: s.participants.map((p) => ({ userId: p.userId, name: names.get(p.userId) ?? null })),
      notes: this.canReadNotes(user, s) ? s.notes : null,
      notesHidden: !!s.notes && !this.canReadNotes(user, s),
      actions: s.actions.map((a) => ({ id: a.id, title: a.title, ownerId: a.ownerId, ownerName: names.get(a.ownerId) ?? null, dueDate: isoDay(a.dueDate), status: a.status, completedAt: a.completedAt })),
      createdAt: s.createdAt,
    }));
  }

  async listSessions(user: Principal, q: Dto<typeof listCoachingQuerySchema>) {
    const base = await this.sessionWhere(user);
    const where: Prisma.CoachingSessionWhereInput = {
      AND: [base, {
        ...(q.from || q.to ? { sessionDate: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
        ...(q.coachId ? { coachId: q.coachId } : {}),
        ...(q.participantId ? { participants: { some: { userId: q.participantId } } } : {}),
        ...(q.topic ? { topics: { has: q.topic } } : {}),
      }],
    };
    const rows = await this.prisma.coachingSession.findMany({ where, include: { participants: true, actions: true }, orderBy: [{ sessionDate: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    return asPage(res, await this.shape(user, res.data));
  }

  async getSession(user: Principal, id: string) {
    const row = await this.prisma.coachingSession.findFirst({ where: { AND: [await this.sessionWhere(user), { id }] }, include: { participants: true, actions: true } });
    if (!row) throw notFound('Coaching session');
    return (await this.shape(user, [row]))[0]!;
  }

  private async validateParticipants(user: Principal, ids: string[]) {
    await assertOrgUsers(this.prisma, user.organizationId, ids);
    const scope = await scopeUserIds(this.access, user, 'coaching:create');
    if (scope && ids.some((i) => !scope.includes(i))) throw notFound('Participant');
  }

  async createSession(user: Principal, dto: Dto<typeof createCoachingSessionSchema>) {
    const participantIds = [...new Set(dto.participantIds)].filter((i) => i !== user.userId);
    if (participantIds.length === 0) throw new AppError('VALIDATION_ERROR', 'At least one participant other than the coach is required', 400);
    await this.validateParticipants(user, participantIds);
    const allowedOwners = new Set([user.userId, ...participantIds]);
    if (dto.actions.some((a) => !allowedOwners.has(a.ownerId))) throw new AppError('VALIDATION_ERROR', 'Action owners must be the coach or a participant', 400);
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.coachingSession.create({
        data: {
          organizationId: user.organizationId, coachId: user.userId, kind: dto.kind, sessionDate: new Date(dto.sessionDate), durationMin: dto.durationMin, topics: dto.topics,
          notes: dto.notes, noteVisibility: dto.noteVisibility, callRef: dto.callRef, createdById: user.userId,
          participants: { create: participantIds.map((userId) => ({ userId, organizationId: user.organizationId })) },
          actions: { create: dto.actions.map((a) => ({ organizationId: user.organizationId, ownerId: a.ownerId, title: a.title, dueDate: a.dueDate ? toDate(a.dueDate) : null, createdById: user.userId })) },
        },
        include: { participants: true, actions: true },
      });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'coaching.session_recorded', entityType: 'coaching_session', entityId: s.id, metadata: { durationMin: s.durationMin, topics: s.topics, participants: participantIds.length } });
      await this.outbox.publish(tx, { eventType: 'coaching.session_recorded', aggregateType: 'coaching_session', aggregateId: s.id, organizationId: user.organizationId, payload: { sessionId: s.id }, idempotencyKey: `coaching-session:${s.id}` });
      return (await this.shape(user, [s]))[0]!;
    });
  }

  async updateSession(user: Principal, id: string, dto: Dto<typeof updateCoachingSessionSchema>) {
    const s = await this.prisma.coachingSession.findFirst({ where: { AND: [await this.sessionWhere(user), { id }] }, include: { participants: true, actions: true } });
    if (!s) throw notFound('Coaching session');
    const level = this.access.scopeLevel(user, 'coaching:update');
    if (s.coachId !== user.userId && level !== 'org') throw forbidden('Only the coach can edit this session');
    const owners = new Set([s.coachId, ...s.participants.map((p) => p.userId)]);
    if (dto.addActions?.some((a) => !owners.has(a.ownerId))) throw new AppError('VALIDATION_ERROR', 'Action owners must be the coach or a participant', 400);
    await this.prisma.$transaction(async (tx) => {
      await tx.coachingSession.update({
        where: { id },
        data: { ...(dto.durationMin ? { durationMin: dto.durationMin } : {}), ...(dto.topics ? { topics: dto.topics } : {}), ...(dto.notes !== undefined ? { notes: dto.notes } : {}), ...(dto.noteVisibility ? { noteVisibility: dto.noteVisibility } : {}) },
      });
      for (const a of dto.addActions ?? []) {
        const created = await tx.coachingAction.create({ data: { organizationId: user.organizationId, sessionId: id, ownerId: a.ownerId, title: a.title, dueDate: a.dueDate ? toDate(a.dueDate) : null, createdById: user.userId } });
        // the alert carries no coaching content (the title stays inside the coaching module)
        if (a.ownerId !== user.userId) await this.outbox.publish(tx, { eventType: PEOPLE_EVENTS.COACHING_ACTION_ASSIGNED, aggregateType: 'coaching_action', aggregateId: created.id, organizationId: user.organizationId, payload: { actionId: created.id, sessionId: id, ownerId: a.ownerId, dueDate: a.dueDate ?? null }, idempotencyKey: `coaching-action:${created.id}` });
      }
      for (const u of dto.updateActions ?? []) {
        const a = s.actions.find((x) => x.id === u.id);
        if (!a) throw notFound('Action');
        await tx.coachingAction.update({
          where: { id: u.id },
          data: { ...(u.title ? { title: u.title } : {}), ...(u.dueDate !== undefined ? { dueDate: u.dueDate ? toDate(u.dueDate) : null } : {}), ...(u.status ? { status: u.status, completedAt: u.status === 'DONE' ? new Date() : null } : {}) },
        });
      }
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'coaching.session_updated', entityType: 'coaching_session', entityId: id, metadata: { fields: Object.keys(dto) } });
    });
    return this.getSession(user, id);
  }

  // ---------------------------------------------------------------- 1:1
  private async oneOnOneWhere(user: Principal): Promise<Prisma.OneOnOneWhereInput> {
    const ids = await scopeUserIds(this.access, user, 'coaching:view');
    if (!ids) return { organizationId: user.organizationId };
    return { organizationId: user.organizationId, OR: [{ employeeId: { in: ids } }, { managerId: { in: ids } }] };
  }

  private shape1on1(user: Principal, r: Prisma.OneOnOneGetPayload<{ include: { actions: true } }>, names: Map<string, string>) {
    return {
      id: r.id, managerId: r.managerId, managerName: names.get(r.managerId) ?? null, employeeId: r.employeeId, employeeName: names.get(r.employeeId) ?? null,
      status: r.status, scheduledFor: r.scheduledFor, durationMin: r.durationMin, agenda: r.agenda, sharedNotes: r.sharedNotes,
      privateNotes: r.managerId === user.userId ? r.privateNotes : null,
      actions: r.actions.map((a) => ({ id: a.id, title: a.title, ownerId: a.ownerId, ownerName: names.get(a.ownerId) ?? null, dueDate: isoDay(a.dueDate), status: a.status })),
    };
  }

  async listOneOnOnes(user: Principal, q: Dto<typeof listOneOnOnesQuerySchema>) {
    const where: Prisma.OneOnOneWhereInput = { AND: [await this.oneOnOneWhere(user), { ...(q.employeeId ? { employeeId: q.employeeId } : {}), ...(q.status ? { status: q.status } : {}) }] };
    const rows = await this.prisma.oneOnOne.findMany({ where, include: { actions: true }, orderBy: [{ scheduledFor: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const names = await userNameMap(this.prisma, user.organizationId, res.data.flatMap((r) => [r.managerId, r.employeeId, ...r.actions.map((a) => a.ownerId)]));
    return asPage(res, res.data.map((r) => this.shape1on1(user, r, names)));
  }

  async createOneOnOne(user: Principal, dto: Dto<typeof createOneOnOneSchema>) {
    if (dto.employeeId === user.userId) throw new AppError('VALIDATION_ERROR', 'A one-on-one needs a different employee', 400);
    await assertOrgUsers(this.prisma, user.organizationId, [dto.employeeId]);
    await assertTargetInScope(this.access, user, 'coaching:create', dto.employeeId);
    if (dto.actions.some((a) => ![user.userId, dto.employeeId].includes(a.ownerId))) throw new AppError('VALIDATION_ERROR', 'Action owners must be the manager or the employee', 400);
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.oneOnOne.create({
        data: {
          organizationId: user.organizationId, managerId: user.userId, employeeId: dto.employeeId, status: dto.status, scheduledFor: new Date(dto.scheduledFor), durationMin: dto.durationMin,
          agenda: dto.agenda, sharedNotes: dto.sharedNotes, privateNotes: dto.privateNotes, createdById: user.userId,
          actions: { create: dto.actions.map((a) => ({ organizationId: user.organizationId, ownerId: a.ownerId, title: a.title, dueDate: a.dueDate ? toDate(a.dueDate) : null, createdById: user.userId })) },
        },
        include: { actions: true },
      });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'coaching.one_on_one_recorded', entityType: 'one_on_one', entityId: r.id, metadata: { employeeId: dto.employeeId, status: dto.status } });
      const names = await userNameMap(this.prisma, user.organizationId, [user.userId, dto.employeeId]);
      return this.shape1on1(user, r, names);
    });
  }

  // ---------------------------------------------------------------- actions
  async listActions(user: Principal, q: Dto<typeof listActionsQuerySchema>) {
    const ids = await scopeUserIds(this.access, user, 'coaching:view');
    const where: Prisma.CoachingActionWhereInput = {
      organizationId: user.organizationId, ...(ids ? { ownerId: { in: ids } } : {}),
      ...(q.ownerId ? { ownerId: q.ownerId, ...(ids && !ids.includes(q.ownerId) ? { id: { in: [] } } : {}) } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    const rows = await this.prisma.coachingAction.findMany({ where, orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const names = await userNameMap(this.prisma, user.organizationId, res.data.map((a) => a.ownerId));
    return asPage(res, res.data.map((a) => ({ id: a.id, title: a.title, ownerId: a.ownerId, ownerName: names.get(a.ownerId) ?? null, dueDate: isoDay(a.dueDate), status: a.status, sessionId: a.sessionId, oneOnOneId: a.oneOnOneId, sourceRef: a.sourceRef, completedAt: a.completedAt })));
  }

  /** Owner may update status of their own action; coaching:update holders may edit actions of people in their scope. */
  async updateAction(user: Principal, id: string, dto: Dto<typeof updateActionSchema>) {
    const a = await this.prisma.coachingAction.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!a) throw notFound('Action');
    const own = a.ownerId === user.userId;
    if (!own) {
      if (!this.access.has(user, 'coaching:update')) throw notFound('Action');
      await assertTargetInScope(this.access, user, 'coaching:update', a.ownerId, 'Action');
    } else if (dto.title || dto.dueDate !== undefined) {
      if (!this.access.has(user, 'coaching:update')) throw forbidden('You can only change the status of your own action');
    }
    const upd = await this.prisma.$transaction(async (tx) => {
      const r = await tx.coachingAction.update({
        where: { id },
        data: { ...(dto.title ? { title: dto.title } : {}), ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate ? toDate(dto.dueDate) : null } : {}), ...(dto.status ? { status: dto.status, completedAt: dto.status === 'DONE' ? new Date() : null } : {}) },
      });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'coaching.action_updated', entityType: 'coaching_action', entityId: id, metadata: { from: a.status, to: r.status } });
      return r;
    });
    return { id: upd.id, status: upd.status, dueDate: isoDay(upd.dueDate), title: upd.title };
  }

  /** Coaching hours data (facts only): minutes conducted per coach + per topic. Feeds the "coaching hours conducted" KPI. */
  async hours(user: Principal, q: Dto<typeof coachingHoursQuerySchema>) {
    const base = await this.sessionWhere(user);
    const sessions = await this.prisma.coachingSession.findMany({ where: { AND: [base, { sessionDate: { gte: new Date(q.from), lte: new Date(q.to) } }] }, select: { coachId: true, durationMin: true, topics: true } });
    const oneOnOnes = await this.prisma.oneOnOne.findMany({ where: { AND: [await this.oneOnOneWhere(user), { status: 'HELD', scheduledFor: { gte: new Date(q.from), lte: new Date(q.to) } }] }, select: { managerId: true, durationMin: true } });
    const byCoach = new Map<string, { sessionMinutes: number; oneOnOneMinutes: number; sessions: number; oneOnOnes: number }>();
    const row = (id: string) => byCoach.get(id) ?? byCoach.set(id, { sessionMinutes: 0, oneOnOneMinutes: 0, sessions: 0, oneOnOnes: 0 }).get(id)!;
    const byTopic: Record<string, number> = {};
    for (const s of sessions) {
      const r = row(s.coachId);
      r.sessionMinutes += s.durationMin;
      r.sessions += 1;
      for (const t of s.topics) byTopic[t] = (byTopic[t] ?? 0) + s.durationMin;
    }
    for (const o of oneOnOnes) {
      const r = row(o.managerId);
      r.oneOnOneMinutes += o.durationMin;
      r.oneOnOnes += 1;
    }
    const names = await userNameMap(this.prisma, user.organizationId, [...byCoach.keys()]);
    const coaches = [...byCoach.entries()].map(([coachId, r]) => ({ coachId, coachName: names.get(coachId) ?? null, ...r, totalMinutes: r.sessionMinutes + r.oneOnOneMinutes, totalHours: Math.round(((r.sessionMinutes + r.oneOnOneMinutes) / 60) * 100) / 100 }));
    const totalMinutes = coaches.reduce((s, c) => s + c.totalMinutes, 0);
    return { from: q.from, to: q.to, totalMinutes, totalHours: Math.round((totalMinutes / 60) * 100) / 100, coaches, minutesByTopic: byTopic };
  }
}
