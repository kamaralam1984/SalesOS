import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ROLE_KEYS, type RoleKey } from '@salesos/shared-types';
import type { CreateMeetingInput, ListMeetingsQuery, MeetingAudience } from '@salesos/validation';
import { AuditService } from '../../../common/audit/audit.service';
import type { Principal } from '../../../common/authz';
import { AppError, notFound } from '../../../common/http/errors';
import { PrismaService } from '../../../common/prisma';

const MIN = 60_000;
const DAY = 86_400_000;
const IST = '+05:30';
const MAX_LIST = 60;
const MAX_INVITED_SHOWN = 500;

type Meeting = Prisma.CompanyMeetingGetPayload<{ include: { createdBy: { select: { id: true; name: true } } } }>;
const statusOf = (r: { cancelledAt: Date | null; startsAt: Date; endsAt: Date }, now: Date) =>
  r.cancelledAt ? ('CANCELLED' as const) : r.endsAt <= now ? ('ENDED' as const) : r.startsAt <= now ? ('LIVE' as const) : ('UPCOMING' as const);
const audienceOf = (r: Meeting) => ({ everyone: r.audienceAll, roles: r.audienceRoles as RoleKey[], teamIds: r.audienceTeamIds, userIds: r.audienceUserIds });

/**
 * Extra Zoom meetings the company announces. A meeting reaches only the people it was addressed to (everyone, or chosen roles, teams, people),
 * from the moment it is posted until it ends or is cancelled; pressing Join is recorded so HR can see who attended.
 * The daily meeting link in the workforce policy is a different thing and is not touched here.
 */
@Injectable()
export class MeetingsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** Who a meeting is addressed to, as a user filter (active, approved accounts of the organisation only). */
  private recipientsWhere(organizationId: string, a: { audienceAll: boolean; audienceRoles: string[]; audienceTeamIds: string[]; audienceUserIds: string[] }): Prisma.UserWhereInput {
    const base: Prisma.UserWhereInput = { organizationId, isActive: true, approvalStatus: 'APPROVED' };
    if (a.audienceAll) return base;
    return {
      ...base,
      OR: [
        ...(a.audienceRoles.length ? [{ roleAssignments: { some: { role: { key: { in: a.audienceRoles } } } } }] : []),
        ...(a.audienceTeamIds.length ? [{ teamMemberships: { some: { teamId: { in: a.audienceTeamIds } } } }] : []),
        ...(a.audienceUserIds.length ? [{ id: { in: a.audienceUserIds } }] : []),
      ],
    };
  }

  /** Meetings addressed to a person: for everyone, or naming one of their roles, one of their teams, or them. */
  private invitedTo(roles: readonly string[], teamIds: readonly string[], userId: string): Prisma.CompanyMeetingWhereInput {
    return { OR: [{ audienceAll: true }, { audienceUserIds: { has: userId } }, ...(roles.length ? [{ audienceRoles: { hasSome: [...roles] } }] : []), ...(teamIds.length ? [{ audienceTeamIds: { hasSome: [...teamIds] } }] : [])] };
  }

  private async teamIdsOf(userId: string): Promise<string[]> {
    return (await this.prisma.teamMembership.findMany({ where: { userId }, select: { teamId: true } })).map((m) => m.teamId);
  }

  /** What the signed-in person sees on the home page: only meetings addressed to them. */
  async active(user: Principal) {
    const now = new Date();
    const teamIds = await this.teamIdsOf(user.userId);
    const rows = await this.prisma.companyMeeting.findMany({
      where: { organizationId: user.organizationId, cancelledAt: null, endsAt: { gt: now }, AND: [this.invitedTo(user.roles, teamIds, user.userId)] },
      include: { createdBy: { select: { id: true, name: true } }, joins: { where: { userId: user.userId }, select: { joinedAt: true } } },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: 10,
    });
    return rows.map((r) => ({
      id: r.id, title: r.title, url: r.url, note: r.note, startsAt: r.startsAt, endsAt: r.endsAt, createdByName: r.createdBy.name,
      status: statusOf(r, now), joinedAt: r.joins[0]?.joinedAt ?? null,
    }));
  }

  /** The person pressed Join. Recorded once, only for someone the meeting was addressed to. */
  async join(user: Principal, id: string) {
    const now = new Date();
    const teamIds = await this.teamIdsOf(user.userId);
    const m = await this.prisma.companyMeeting.findFirst({
      where: { id, organizationId: user.organizationId, cancelledAt: null, endsAt: { gt: now }, AND: [this.invitedTo(user.roles, teamIds, user.userId)] },
      select: { id: true },
    });
    if (!m) throw notFound('Meeting');
    const row = await this.prisma.companyMeetingJoin.upsert({ where: { meetingId_userId: { meetingId: id, userId: user.userId } }, create: { meetingId: id, userId: user.userId }, update: {} });
    return { joinedAt: row.joinedAt };
  }

  /** Choices for the "who is it for" pickers (HR / Founder / Developer). */
  async options(user: Principal) {
    const [teams, people] = await Promise.all([
      this.prisma.team.findMany({ where: { organizationId: user.organizationId }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 200 }),
      this.prisma.user.findMany({
        where: { organizationId: user.organizationId, isActive: true, approvalStatus: 'APPROVED' },
        select: { id: true, name: true, roleAssignments: { select: { role: { select: { key: true } } } } },
        orderBy: { name: 'asc' }, take: 500,
      }),
    ]);
    return { roles: ROLE_KEYS.filter((r) => r !== 'DEVELOPER'), teams, people: people.map((p) => ({ id: p.id, name: p.name, roles: p.roleAssignments.map((a) => a.role.key) })) };
  }

  /** HR / Founder / Developer: meetings with who they are for, how many were invited and how many joined; filterable. */
  async list(user: Principal, q: ListMeetingsQuery) {
    const now = new Date();
    const and: Prisma.CompanyMeetingWhereInput[] = [];
    if (q.status === 'CANCELLED') and.push({ cancelledAt: { not: null } });
    else if (q.status === 'UPCOMING') and.push({ cancelledAt: null, startsAt: { gt: now } });
    else if (q.status === 'LIVE') and.push({ cancelledAt: null, startsAt: { lte: now }, endsAt: { gt: now } });
    else if (q.status === 'ENDED') and.push({ cancelledAt: null, endsAt: { lte: now } });
    if (q.q) and.push({ title: { contains: q.q, mode: 'insensitive' } });
    if (q.from) and.push({ startsAt: { gte: new Date(`${q.from}T00:00:00${IST}`) } });
    if (q.to) and.push({ startsAt: { lt: new Date(new Date(`${q.to}T00:00:00${IST}`).getTime() + DAY) } });
    if (q.audience === 'EVERYONE') and.push({ audienceAll: true });
    if (q.audience === 'SELECTED') and.push({ audienceAll: false });
    if (q.roleKey) and.push({ OR: [{ audienceAll: true }, { audienceRoles: { has: q.roleKey } }] });
    if (q.teamId) and.push({ OR: [{ audienceAll: true }, { audienceTeamIds: { has: q.teamId } }] });
    if (q.userId) {
      const [roles, teamIds] = await Promise.all([
        this.prisma.userRoleAssignment.findMany({ where: { userId: q.userId, organizationId: user.organizationId }, select: { role: { select: { key: true } } } }),
        this.teamIdsOf(q.userId),
      ]);
      and.push(this.invitedTo(roles.map((r) => r.role.key), teamIds, q.userId));
    }
    const rows = await this.prisma.companyMeeting.findMany({
      where: { organizationId: user.organizationId, ...(q.status || q.from || q.to || q.q ? {} : { endsAt: { gt: new Date(now.getTime() - 30 * DAY) } }), AND: and },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
      take: MAX_LIST,
    });
    return Promise.all(rows.map(async (r) => ({
      id: r.id, title: r.title, url: r.url, note: r.note, startsAt: r.startsAt, endsAt: r.endsAt, createdById: r.createdBy.id, createdByName: r.createdBy.name, createdAt: r.createdAt,
      status: statusOf(r, now), audience: audienceOf(r),
      invitedCount: await this.prisma.user.count({ where: this.recipientsWhere(user.organizationId, r) }),
      joinedCount: await this.prisma.companyMeetingJoin.count({ where: { meetingId: r.id, user: this.recipientsWhere(user.organizationId, r) } }),
    })));
  }

  /** Who the meeting reached and who has pressed Join. */
  async detail(user: Principal, id: string) {
    const r = await this.prisma.companyMeeting.findFirst({ where: { id, organizationId: user.organizationId }, include: { createdBy: { select: { id: true, name: true } } } });
    if (!r) throw notFound('Meeting');
    const invited = await this.prisma.user.findMany({
      where: this.recipientsWhere(user.organizationId, r),
      select: { id: true, name: true, meetingJoins: { where: { meetingId: id }, select: { joinedAt: true } } },
      orderBy: { name: 'asc' }, take: MAX_INVITED_SHOWN,
    });
    return {
      id: r.id, title: r.title, url: r.url, note: r.note, startsAt: r.startsAt, endsAt: r.endsAt, createdByName: r.createdBy.name, status: statusOf(r, new Date()), audience: audienceOf(r),
      invited: invited.map((u) => ({ id: u.id, name: u.name, joinedAt: u.meetingJoins[0]?.joinedAt ?? null })),
    };
  }

  private async assertAudience(organizationId: string, a: MeetingAudience) {
    if (a.teamIds.length) {
      const n = await this.prisma.team.count({ where: { id: { in: a.teamIds }, organizationId } });
      if (n !== new Set(a.teamIds).size) throw new AppError('INVALID_TEAM', 'Unknown team', 400);
    }
    if (a.userIds.length) {
      const n = await this.prisma.user.count({ where: { id: { in: a.userIds }, organizationId, isActive: true } });
      if (n !== new Set(a.userIds).size) throw new AppError('INVALID_USER', 'Unknown or inactive person', 400);
    }
  }

  async create(user: Principal, dto: CreateMeetingInput) {
    const now = Date.now();
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(startsAt.getTime() + dto.durationMinutes * MIN);
    if (endsAt.getTime() <= now) throw new AppError('MEETING_IN_PAST', 'This meeting has already ended; choose a time that is now or later', 400);
    if (startsAt.getTime() > now + 90 * DAY) throw new AppError('MEETING_TOO_FAR', 'Choose a date within the next 90 days', 400);
    const a = dto.audience;
    await this.assertAudience(user.organizationId, a);
    const data = { audienceAll: a.everyone, audienceRoles: a.everyone ? [] : [...new Set(a.roles)], audienceTeamIds: a.everyone ? [] : [...new Set(a.teamIds)], audienceUserIds: a.everyone ? [] : [...new Set(a.userIds)] };
    const invited = await this.prisma.user.count({ where: this.recipientsWhere(user.organizationId, data) });
    if (invited === 0) throw new AppError('NO_RECIPIENTS', 'Nobody matches this audience', 400);
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.companyMeeting.create({
        data: { organizationId: user.organizationId, title: dto.title, url: dto.url, note: dto.note || null, startsAt, endsAt, createdById: user.userId, ...data },
        include: { createdBy: { select: { id: true, name: true } } },
      });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'meeting.created', entityType: 'company_meeting', entityId: r.id, metadata: { title: dto.title, startsAt, durationMinutes: dto.durationMinutes, everyone: data.audienceAll, roles: data.audienceRoles, teams: data.audienceTeamIds.length, people: data.audienceUserIds.length, invited } });
      return r;
    });
    return { id: row.id, title: row.title, startsAt: row.startsAt, endsAt: row.endsAt, status: statusOf(row, new Date()), audience: audienceOf(row), invitedCount: invited };
  }

  async cancel(user: Principal, id: string) {
    const existing = await this.prisma.companyMeeting.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!existing) throw notFound('Meeting');
    if (existing.cancelledAt) return { id, status: 'CANCELLED' as const };
    await this.prisma.$transaction(async (tx) => {
      await tx.companyMeeting.update({ where: { id }, data: { cancelledAt: new Date(), cancelledById: user.userId } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'meeting.cancelled', entityType: 'company_meeting', entityId: id, metadata: { title: existing.title } });
    });
    return { id, status: 'CANCELLED' as const };
  }
}
