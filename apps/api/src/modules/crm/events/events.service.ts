import { Injectable } from '@nestjs/common';
import type { AttendanceStatus, CrmEvent, Lead, Prisma } from '@prisma/client';
import { CRM_EVENTS } from '@salesos/shared-types';
import { addWorkingMinutes, createTaskTx, evaluateTransition, getWorkingHours, loadStages, lockLead, syncLeadExceptions, transitionLeadTx } from '@salesos/crm-core';
import type { z } from 'zod';
import type { attendanceSchema, createEventSchema, listEventsQuerySchema, updateEventSchema } from '@salesos/validation';
import type { Principal } from '../../../common/authz';
import { AppError, notFound } from '../../../common/http/errors';
import { ok } from '../../../common/http/api-result';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { CrmSupport, recordAccess } from '../crm.support';

/** Participation machine (docs/state-machines.md section 2). CONVERTED / NOT_CONVERTED are derived by the system only. */
export const ATTENDANCE_TRANSITIONS: Record<AttendanceStatus, AttendanceStatus[]> = {
  INVITED: ['REGISTERED'],
  REGISTERED: ['ATTENDED', 'NO_SHOW', 'CANCELLED'],
  NO_SHOW: ['RESCHEDULED'],
  RESCHEDULED: ['REGISTERED'],
  ATTENDED: ['FOLLOWED_UP', 'CONVERTED'],
  FOLLOWED_UP: ['CONVERTED', 'NOT_CONVERTED'],
  CANCELLED: [],
  CONVERTED: [],
  NOT_CONVERTED: [],
};
const MANUAL_TARGETS: AttendanceStatus[] = ['INVITED', 'REGISTERED', 'ATTENDED', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED', 'FOLLOWED_UP'];

@Injectable()
export class EventsService {
  constructor(private readonly s: CrmSupport) {}
  private get prisma() {
    return this.s.prisma;
  }

  private ser(e: CrmEvent & { _count?: { attendances: number } }, counts?: Record<string, number>) {
    return { id: e.id, type: e.type, title: e.title, programId: e.programId, startsAt: e.startsAt.toISOString(), endsAt: e.endsAt?.toISOString() ?? null, hostId: e.hostId, capacity: e.capacity, location: e.location, status: e.status, counts: counts ?? undefined, createdAt: e.createdAt.toISOString() };
  }

  async list(user: Principal, q: z.infer<typeof listEventsQuerySchema>) {
    const where: Prisma.CrmEventWhereInput = { organizationId: user.organizationId, ...(q.type ? { type: q.type } : {}), ...(q.status ? { status: q.status } : {}), ...(q.programId ? { programId: q.programId } : {}), ...(q.upcoming ? { startsAt: { gte: new Date() }, status: 'SCHEDULED' } : {}) };
    const rows = await this.prisma.crmEvent.findMany({ where, orderBy: [{ startsAt: q.upcoming ? 'asc' : 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const page = res.data as CrmEvent[];
    const grouped = await this.prisma.eventAttendance.groupBy({ by: ['eventId', 'status'], where: { eventId: { in: page.map((e) => e.id) } }, _count: { _all: true } });
    const counts = new Map<string, Record<string, number>>();
    for (const g of grouped) counts.set(g.eventId, { ...(counts.get(g.eventId) ?? {}), [g.status]: g._count._all });
    return ok(page.map((e) => this.ser(e, counts.get(e.id) ?? {})), res.meta);
  }

  async get(user: Principal, id: string) {
    const e = await this.prisma.crmEvent.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!e) throw notFound('Event');
    const grouped = await this.prisma.eventAttendance.groupBy({ by: ['status'], where: { eventId: id }, _count: { _all: true } });
    return this.ser(e, Object.fromEntries(grouped.map((g) => [g.status, g._count._all])));
  }

  async create(user: Principal, b: z.infer<typeof createEventSchema>) {
    if (b.programId && !(await this.prisma.program.findFirst({ where: { id: b.programId, organizationId: user.organizationId } }))) throw new AppError('VALIDATION_ERROR', 'Unknown program', 422);
    if (b.hostId) await this.s.assertAssignable(user, 'events:manage', b.hostId).catch(() => {
      throw new AppError('VALIDATION_ERROR', 'Unknown host', 422);
    });
    if (b.endsAt && b.endsAt <= b.startsAt) throw new AppError('VALIDATION_ERROR', 'endsAt must be after startsAt', 422);
    const row = await this.prisma.crmEvent.create({ data: { organizationId: user.organizationId, type: b.type, title: b.title, programId: b.programId ?? null, startsAt: b.startsAt, endsAt: b.endsAt ?? null, hostId: b.hostId ?? null, capacity: b.capacity ?? null, location: b.location ?? null, createdById: user.userId } });
    await this.prisma.$transaction((tx) => this.s.deps.audit(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'event.created', entityType: 'event', entityId: row.id, metadata: { type: b.type } }));
    return this.ser(row);
  }

  async update(user: Principal, id: string, b: z.infer<typeof updateEventSchema>) {
    const ex = await this.prisma.crmEvent.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!ex) throw notFound('Event');
    const startsAt = b.startsAt ?? ex.startsAt;
    const endsAt = b.endsAt === undefined ? ex.endsAt : b.endsAt;
    if (endsAt && endsAt <= startsAt) throw new AppError('VALIDATION_ERROR', 'endsAt must be after startsAt', 422);
    const row = await this.prisma.crmEvent.update({ where: { id }, data: { ...b } });
    await this.prisma.$transaction((tx) => this.s.deps.audit(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'event.updated', entityType: 'event', entityId: id, metadata: { fields: Object.keys(b) } }));
    return this.ser(row);
  }

  async attendees(user: Principal, id: string, q: { limit?: number; cursor?: string; page?: number }) {
    const ev = await this.prisma.crmEvent.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!ev) throw notFound('Event');
    const scoped = await this.s.access.scopedWhere(user, { permission: 'leads:view', ownerField: 'assignedToId', teamField: 'teamId' });
    const rows = await this.prisma.eventAttendance.findMany({ where: { eventId: id, organizationId: user.organizationId, lead: { ...scoped, mergedIntoId: null } as Prisma.LeadWhereInput }, include: { lead: { select: { id: true, fullName: true, phoneE164: true, phoneRaw: true, assignedToId: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const summary = this.s.access.isSummaryOnly(user, 'leads:view');
    return ok((res.data as typeof rows).map((a) => ({ id: a.id, status: a.status, joinedAt: a.joinedAt?.toISOString() ?? null, durationMinutes: a.durationMinutes, reason: a.reason, lead: summary ? { id: a.lead.id, fullName: a.lead.fullName } : { id: a.lead.id, fullName: a.lead.fullName, phone: a.lead.phoneE164 ?? a.lead.phoneRaw, assignedToId: a.lead.assignedToId } })), res.meta);
  }

  /** Record/advance a lead's participation (manager/marketing path: events:manage). */
  async setAttendance(user: Principal, eventId: string, b: z.infer<typeof attendanceSchema>, permission: 'events:manage' | 'leads:status:change' = 'events:manage') {
    const lead = await this.prisma.lead.findFirst({ where: { id: b.leadId, organizationId: user.organizationId, mergedIntoId: null } });
    await this.s.access.assertRecordAccess(user, permission === 'events:manage' ? 'leads:view' : permission, lead && recordAccess(lead), 'Lead');
    return this.apply(user, eventId, lead!, b);
  }

  private async apply(user: Principal, eventId: string, lead0: Lead, b: z.infer<typeof attendanceSchema>) {
    const org = user.organizationId;
    if (!MANUAL_TARGETS.includes(b.status)) throw new AppError('DERIVED_STATUS', `${b.status} is derived by the system and cannot be set manually`, 422);
    const warnings: string[] = [];
    const res = await this.s.tx(async (tx) => {
      const event = await tx.crmEvent.findFirst({ where: { id: eventId, organizationId: org } });
      if (!event) throw notFound('Event');
      await lockLead(tx, org, lead0.id);
      const now = new Date();
      let row = await tx.eventAttendance.findUnique({ where: { eventId_leadId: { eventId, leadId: lead0.id } } });
      if (row && row.status === b.status) return { row, created: false };
      if (!row) {
        if (!['INVITED', 'REGISTERED'].includes(b.status)) throw new AppError('INVALID_TRANSITION', `A lead must be invited or registered before ${b.status}`, 409);
      } else if (!ATTENDANCE_TRANSITIONS[row.status].includes(b.status)) {
        throw new AppError('INVALID_TRANSITION', `Cannot move attendance from ${row.status} to ${b.status}`, 409, { from: row.status, to: b.status });
      }
      if (['REGISTERED', 'INVITED'].includes(b.status) && event.status !== 'SCHEDULED') throw new AppError('EVENT_CLOSED', `Event is ${event.status}`, 409);
      if (b.status === 'REGISTERED' && event.capacity) {
        const taken = await tx.eventAttendance.count({ where: { eventId, status: { in: ['REGISTERED', 'ATTENDED'] } } });
        if (taken >= event.capacity) throw new AppError('EVENT_FULL', 'The event is full', 409);
      }
      const endsAt = event.endsAt ?? event.startsAt;
      if (b.status === 'NO_SHOW' && endsAt > now) throw new AppError('EVENT_NOT_ENDED', 'No-show can only be recorded after the event ended', 422);
      if (b.status === 'ATTENDED' && event.startsAt.getTime() - now.getTime() > 3600_000) throw new AppError('EVENT_NOT_STARTED', 'Attendance can only be marked once the event has started', 422);
      if (b.status === 'CANCELLED' && !b.reason) throw new AppError('REASON_REQUIRED', 'A reason is required to cancel', 422);
      if (b.status === 'RESCHEDULED' && !b.newEventId) throw new AppError('VALIDATION_ERROR', 'newEventId is required to reschedule', 422);

      const data = { status: b.status, joinedAt: b.status === 'ATTENDED' ? (b.joinedAt ?? now) : undefined, durationMinutes: b.durationMinutes ?? undefined, reason: b.reason ?? undefined, registeredAt: b.status === 'REGISTERED' ? now : undefined, updatedById: user.userId };
      let created = false;
      if (!row) {
        row = await tx.eventAttendance.create({ data: { organizationId: org, eventId, leadId: lead0.id, ...data, source: 'MANUAL' } });
        created = true;
      } else {
        row = await tx.eventAttendance.update({ where: { id: row.id }, data });
      }
      if (b.status === 'RESCHEDULED') {
        const target = await tx.crmEvent.findFirst({ where: { id: b.newEventId!, organizationId: org } });
        if (!target || target.status !== 'SCHEDULED') throw new AppError('EVENT_CLOSED', 'The new event is not open', 409);
        await tx.eventAttendance.upsert({ where: { eventId_leadId: { eventId: target.id, leadId: lead0.id } }, create: { organizationId: org, eventId: target.id, leadId: lead0.id, status: 'REGISTERED', registeredAt: now, rescheduledFromId: row.id, updatedById: user.userId }, update: { status: 'REGISTERED', rescheduledFromId: row.id, registeredAt: now } });
      }

      // lead stage follows participation where the lead machine allows it; never forced
      const stages = await loadStages(tx, org);
      const wantStage = (event.type === 'WEBINAR' && b.status === 'REGISTERED' && 'WEBINAR_REGISTERED') || (event.type === 'WEBINAR' && b.status === 'ATTENDED' && 'WEBINAR_ATTENDED') || (event.type === 'DEMO' && b.status === 'REGISTERED' && 'DEMO_SCHEDULED') || (event.type === 'DEMO' && b.status === 'ATTENDED' && 'DEMO_ATTENDED') || null;
      let lead = await tx.lead.findUniqueOrThrow({ where: { id: lead0.id } });
      if (wantStage && lead.stageCategory === 'OPEN') {
        const v = evaluateTransition(stages, lead.status, wantStage);
        if (v.allowed && v.direction === 'forward' && !v.needsReason) {
          lead = await transitionLeadTx(tx, this.s.deps, { lead, stages, toKey: wantStage, actorId: user.userId, source: 'EVENT', reason: `${event.type.toLowerCase()} ${b.status.toLowerCase()}: ${event.title}`, system: true });
        } else if (lead.status !== wantStage) warnings.push(`Lead stays in ${lead.status}: moving to ${wantStage} is not allowed from here`);
      }
      await tx.lead.update({ where: { id: lead0.id }, data: { lastActivityAt: now } });
      // follow-up / reminder tasks (idempotent keys)
      const owner = lead.assignedToId;
      if (owner && lead.stageCategory === 'OPEN') {
        const wh = await getWorkingHours(tx, org, lead.teamId);
        if (b.status === 'ATTENDED') await createTaskTx(tx, this.s.deps, { organizationId: org, leadId: lead.id, assignedToId: owner, createdById: user.userId, teamId: lead.teamId, type: 'FOLLOW_UP', title: `Follow up after ${event.type.toLowerCase()}: ${event.title}`, dueAt: new Date(now.getTime() + 24 * 3600_000), priority: 'HIGH', ruleKey: 'ATTENDANCE_FOLLOW_UP', idempotencyKey: `attendance:${row.id}:follow-up` });
        if (b.status === 'NO_SHOW') await createTaskTx(tx, this.s.deps, { organizationId: org, leadId: lead.id, assignedToId: owner, createdById: user.userId, teamId: lead.teamId, type: 'FOLLOW_UP', title: `No-show follow-up: ${event.title}`, dueAt: addWorkingMinutes(now, 120, wh), ruleKey: 'NO_SHOW_FOLLOW_UP', idempotencyKey: `attendance:${row.id}:no-show` });
        if (b.status === 'REGISTERED' && event.startsAt > new Date(now.getTime() + 3600_000)) await createTaskTx(tx, this.s.deps, { organizationId: org, leadId: lead.id, assignedToId: owner, createdById: user.userId, teamId: lead.teamId, type: 'WEBINAR_REMINDER', title: `Remind ${lead.fullName}: ${event.title}`, dueAt: new Date(event.startsAt.getTime() - 3600_000), ruleKey: 'EVENT_REMINDER', idempotencyKey: `attendance:${row.id}:reminder` });
      }
      await syncLeadExceptions(tx, lead0.id);
      await this.s.deps.audit(tx, { organizationId: org, actorId: user.userId, action: created ? 'attendance.created' : 'attendance.updated', entityType: 'event_attendance', entityId: row.id, metadata: { eventId, leadId: lead0.id, status: b.status } });
      await this.s.deps.publish(tx, { eventType: CRM_EVENTS.ATTENDANCE_CHANGED, aggregateType: 'event_attendance', aggregateId: row.id, organizationId: org, payload: { eventId, leadId: lead0.id, status: b.status }, idempotencyKey: `attendance.changed:${row.id}:${b.status}` });
      return { row, created };
    });
    return ok({ id: res.row.id, eventId, leadId: lead0.id, status: res.row.status, created: res.created }, { warnings });
  }
}
