import { Injectable } from '@nestjs/common';
import type { addTeamMemberSchema, createTeamSchema } from '@salesos/validation';
import type { z } from 'zod';
import { PrismaService } from '../../../common/prisma';
import { AuditService, AUDIT_ACTIONS } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { AppError, conflict, forbidden, notFound } from '../../../common/http/errors';
import { ApiResult } from '../../../common/http/api-result';
import { OrgService } from '../org/org.service';

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly org: OrgService,
  ) {}

  private async visibleTeamWhere(actor: Principal) {
    const level = this.access.scopeLevel(actor, 'teams:view');
    if (!level) throw forbidden();
    if (level === 'org' || level === 'summary') return { organizationId: actor.organizationId };
    const v = await this.access.visibleUsers(actor);
    const ids = level === 'own' ? [actor.userId] : v.ids;
    return {
      organizationId: actor.organizationId,
      OR: [{ leadUserId: { in: ids } }, { memberships: { some: { userId: { in: ids } } } }, ...(level === 'team' && v.teamIds.length ? [{ id: { in: v.teamIds } }] : [])],
    };
  }

  async list(actor: Principal) {
    const teams = await this.prisma.team.findMany({
      where: await this.visibleTeamWhere(actor),
      include: { _count: { select: { memberships: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 200,
    });
    return teams.map((t) => ({ id: t.id, name: t.name, leadUserId: t.leadUserId, memberCount: t._count.memberships, createdAt: t.createdAt }));
  }

  async create(actor: Principal, dto: z.infer<typeof createTeamSchema>) {
    // Creating a team is an organization-level action even for team-scoped managers.
    if (this.access.scopeLevel(actor, 'teams:create') !== 'org') throw forbidden();
    if (dto.leadUserId) {
      const lead = await this.prisma.user.findFirst({ where: { id: dto.leadUserId, organizationId: actor.organizationId, isActive: true } });
      if (!lead) throw new AppError('INVALID_LEAD', 'Lead user not found in this organization', 400);
    }
    const dup = await this.prisma.team.findUnique({ where: { organizationId_name: { organizationId: actor.organizationId, name: dto.name } } });
    if (dup) throw conflict('TEAM_NAME_TAKEN', 'A team with this name already exists');
    return this.prisma.$transaction(async (tx) => {
      const team = await tx.team.create({ data: { organizationId: actor.organizationId, name: dto.name, leadUserId: dto.leadUserId ?? null } });
      if (dto.leadUserId) await tx.teamMembership.create({ data: { teamId: team.id, userId: dto.leadUserId, membershipRole: 'LEAD' } });
      await this.audit.recordTx(tx, {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        action: AUDIT_ACTIONS.TEAM_CREATED,
        entityType: 'team',
        entityId: team.id,
        metadata: { name: dto.name, leadUserId: dto.leadUserId ?? null },
      });
      return team;
    });
  }

  /** Visible = readable under teams:view scope. Everything else is a 404 (IDOR-safe). */
  private async loadVisibleTeam(actor: Principal, teamId: string) {
    const team = await this.prisma.team.findFirst({ where: { AND: [{ id: teamId }, await this.visibleTeamWhere(actor)] } });
    if (!team) throw notFound('Team');
    return team;
  }

  /** Team detail (404 when the team is outside the caller's scope). Summary-only callers get no lead identity. */
  async get(actor: Principal, teamId: string) {
    const team = await this.loadVisibleTeam(actor, teamId);
    const [memberCount, lead, settings] = await Promise.all([
      this.prisma.teamMembership.count({ where: { teamId: team.id } }),
      team.leadUserId ? this.prisma.user.findFirst({ where: { id: team.leadUserId, organizationId: actor.organizationId }, select: { id: true, name: true, isActive: true } }) : null,
      this.org.getSettings(actor.organizationId),
    ]);
    const summaryOnly = this.access.isSummaryOnly(actor, 'teams:view');
    return {
      id: team.id, name: team.name, memberCount, createdAt: team.createdAt,
      leadUserId: summaryOnly ? null : team.leadUserId,
      lead: summaryOnly || !lead ? null : lead,
      softLimit: settings.teamSoftLimit,
      aboveSoftLimit: memberCount > settings.teamSoftLimit,
    };
  }

  async listMembers(actor: Principal, teamId: string) {
    const team = await this.loadVisibleTeam(actor, teamId);
    const members = await this.prisma.teamMembership.findMany({
      where: { teamId: team.id },
      include: { user: { select: { id: true, name: true, email: true, isActive: true, managerId: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const summaryOnly = this.access.isSummaryOnly(actor, 'teams:view');
    const settings = await this.org.getSettings(actor.organizationId);
    const warnings = this.sizeWarnings(members.filter((m) => m.membershipRole === 'MEMBER').length, settings.teamSoftLimit);
    return new ApiResult(
      members.map((m) =>
        summaryOnly
          ? { id: m.user.id, name: m.user.name, isActive: m.user.isActive, membershipRole: m.membershipRole }
          : { ...m.user, membershipRole: m.membershipRole, joinedAt: m.createdAt },
      ),
      { warnings },
    );
  }

  private sizeWarnings(members: number, limit: number) {
    return members > limit ? [`TEAM_ABOVE_SOFT_LIMIT: ${members} members, recommended maximum is ${limit}`] : [];
  }

  /** teams:update/teams:create at org scope may manage any team; team scope only teams the caller leads (and users in scope). */
  private async assertCanManage(actor: Principal, teamId: string, targetUserId: string) {
    const level = this.access.scopeLevel(actor, 'teams:update');
    if (!level || level === 'summary') throw forbidden();
    const team = await this.prisma.team.findFirst({ where: { id: teamId, organizationId: actor.organizationId } });
    if (!team) throw notFound('Team');
    const target = await this.prisma.user.findFirst({ where: { id: targetUserId, organizationId: actor.organizationId } });
    if (!target) throw new AppError('INVALID_USER', 'User not found in this organization', 400);
    if (level === 'org') return team;
    const v = await this.access.visibleUsers(actor);
    if (level === 'own' || !v.teamIds.includes(team.id)) throw notFound('Team');
    if (!v.ids.includes(targetUserId)) throw forbidden('This user is outside your team scope');
    return team;
  }

  async addMember(actor: Principal, teamId: string, dto: z.infer<typeof addTeamMemberSchema>) {
    const team = await this.assertCanManage(actor, teamId, dto.userId);
    const exists = await this.prisma.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId: dto.userId } } });
    if (exists) throw conflict('ALREADY_MEMBER', 'User is already in this team');
    await this.prisma.$transaction(async (tx) => {
      await tx.teamMembership.create({ data: { teamId, userId: dto.userId, membershipRole: dto.membershipRole } });
      await this.audit.recordTx(tx, {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        action: AUDIT_ACTIONS.TEAM_MEMBER_ADDED,
        entityType: 'team',
        entityId: team.id,
        metadata: { userId: dto.userId, membershipRole: dto.membershipRole },
      });
    });
    const [count, settings] = await Promise.all([
      this.prisma.teamMembership.count({ where: { teamId, membershipRole: 'MEMBER' } }),
      this.org.getSettings(actor.organizationId),
    ]);
    return new ApiResult({ teamId, userId: dto.userId, membershipRole: dto.membershipRole }, { warnings: this.sizeWarnings(count, settings.teamSoftLimit) });
  }

  /** Only empty teams (no members) can be deleted; audited. */
  async remove(actor: Principal, teamId: string) {
    const team = await this.prisma.team.findFirst({ where: { id: teamId, organizationId: actor.organizationId }, include: { _count: { select: { memberships: true } } } });
    await this.access.assertRecordAccess(actor, 'teams:delete', team ? { organizationId: team.organizationId, ownerId: null } : null, 'Team');
    if (team!._count.memberships > 0) throw conflict('TEAM_NOT_EMPTY', 'Remove all members before deleting the team');
    try {
      await this.deleteTeamTx(actor, teamId, team!.name);
    } catch (e) {
      // leads, deals, complaints ... keep the team id for history (FK Restrict): such a team is retired by emptying it, not deleted
      if ((e as { code?: string }).code === 'P2003') throw conflict('TEAM_IN_USE', 'This team is referenced by existing records and cannot be deleted');
      throw e;
    }
    return { deleted: true };
  }

  private async deleteTeamTx(actor: Principal, teamId: string, name: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.team.delete({ where: { id: teamId } });
      await this.audit.recordTx(tx, {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        action: 'team.deleted',
        entityType: 'team',
        entityId: teamId,
        metadata: { name },
      });
    });
  }

  async removeMember(actor: Principal, teamId: string, userId: string) {
    const team = await this.assertCanManage(actor, teamId, userId);
    const res = await this.prisma.$transaction(async (tx) => {
      const del = await tx.teamMembership.deleteMany({ where: { teamId, userId } });
      if (del.count === 0) throw notFound('Membership');
      await this.audit.recordTx(tx, {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        action: AUDIT_ACTIONS.TEAM_MEMBER_REMOVED,
        entityType: 'team',
        entityId: team.id,
        metadata: { userId },
      });
      return del;
    });
    return { removed: res.count };
  }
}
