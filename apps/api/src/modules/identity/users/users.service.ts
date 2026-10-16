import { Injectable } from '@nestjs/common';
import { IDENTITY_EVENTS, PRIMARY_ROLE_KEYS, SENSITIVE_ROLE_KEYS, type RoleKey, type UserDeactivatedPayload } from '@salesos/shared-types';
import type { createUserSchema, listUsersQuerySchema, updateUserSchema } from '@salesos/validation';
import type { z } from 'zod';
import { PrismaService, type Tx } from '../../../common/prisma';
import { AuditService, AUDIT_ACTIONS } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { SessionService } from '../../../common/authz/session.service';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { AppError, conflict, forbidden } from '../../../common/http/errors';
import { ApiResult } from '../../../common/http/api-result';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { AuthService } from '../auth/auth.service';
import { OrgService } from '../org/org.service';
import { RolesService } from '../roles.service';
import { toUserDto, toUserSummary, userInclude } from '../dto';

type CreateDto = z.infer<typeof createUserSchema>;
type UpdateDto = z.infer<typeof updateUserSchema>;
type ListQuery = z.infer<typeof listUsersQuerySchema>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly sessions: SessionService,
    private readonly auth: AuthService,
    private readonly org: OrgService,
    private readonly roles: RolesService,
  ) {}

  async list(actor: Principal, q: ListQuery) {
    const scope = await this.access.scopedWhere(actor, { permission: 'users:view', ownerField: 'id' });
    const where = {
      ...scope,
      ...(q.isActive ? { isActive: q.isActive === 'true' } : {}),
      ...(q.search
        ? { OR: [{ name: { contains: q.search, mode: 'insensitive' as const } }, { email: { contains: q.search, mode: 'insensitive' as const } }] }
        : {}),
    };
    const rows = await this.prisma.user.findMany({ where, include: userInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    // page mode ("Page N of M") needs the total; cursor mode does not pay for the count
    const total = q.page ? await this.prisma.user.count({ where }) : undefined;
    const res = pageResult(rows, q, total);
    const summary = this.access.isSummaryOnly(actor, 'users:view');
    return new ApiResult(res.data.map((u) => (summary ? toUserSummary(u) : toUserDto(u))), res.meta);
  }

  /** IDOR-safe load: other-org and out-of-scope users are indistinguishable from non-existent (404). */
  private async loadTarget(actor: Principal, id: string, permission: 'users:view' | 'users:update' | 'users:deactivate', client: Pick<Tx, 'user'> = this.prisma) {
    const target = await client.user.findFirst({ where: { id, organizationId: actor.organizationId }, include: userInclude });
    await this.access.assertRecordAccess(
      actor,
      permission,
      target ? { organizationId: target.organizationId, ownerId: target.id } : null,
      'User',
    );
    // Developer accounts are super-admin: only another Developer may modify them.
    if (permission !== 'users:view' && target!.roleAssignments.some((a) => a.role.key === 'DEVELOPER') && !this.access.has(actor, 'devpanel:access')) {
      throw forbidden('Developer accounts can only be changed from the Developer Panel');
    }
    return target!;
  }

  get(actor: Principal, id: string) {
    const summary = this.access.isSummaryOnly(actor, 'users:view');
    return this.loadTarget(actor, id, 'users:view').then((u) => (summary ? toUserSummary(u) : toUserDto(u)));
  }

  /** Matrix: exactly one primary role; secondary groups are additive. We allow secondary-only staff (NEEDS_DECISION). */
  private assertRoleSet(roles: RoleKey[]) {
    const primaries = roles.filter((r) => (PRIMARY_ROLE_KEYS as readonly string[]).includes(r));
    if (primaries.length > 1) throw new AppError('MULTIPLE_PRIMARY_ROLES', 'A user can hold at most one primary role', 400);
  }

  private assertCanAssign(actor: Principal, roles: RoleKey[]) {
    if (!this.access.has(actor, 'users:role:assign')) throw forbidden();
    if (roles.includes('DEVELOPER')) throw forbidden('The Developer role is managed only from the Developer Panel');
    if (roles.some((r) => SENSITIVE_ROLE_KEYS.includes(r)) && !this.access.has(actor, 'users:role:assign-sensitive')) {
      throw forbidden('Only the Founder can assign Founder, HR or Finance roles');
    }
  }

  private async softLimitWarnings(organizationId: string, managerId: string | null | undefined, client: Pick<Tx, 'user' | 'organization'> = this.prisma) {
    if (!managerId) return [];
    const [limit, count] = await Promise.all([
      this.org.getSettings(organizationId, client),
      client.user.count({ where: { organizationId, managerId, isActive: true } }),
    ]);
    return count > limit.teamSoftLimit
      ? [`MANAGER_REPORTS_ABOVE_SOFT_LIMIT: manager has ${count} direct reports, recommended maximum is ${limit.teamSoftLimit}`]
      : [];
  }

  private async assertValidManager(organizationId: string, managerId: string, selfId?: string, client: Pick<Tx, 'user'> = this.prisma) {
    const manager = await client.user.findFirst({ where: { id: managerId, organizationId } });
    if (!manager) throw new AppError('INVALID_MANAGER', 'Manager not found in this organization', 400);
    if (!manager.isActive) throw new AppError('INVALID_MANAGER', 'Manager is deactivated', 400);
    if (selfId) {
      // walk up the chain to prevent cycles
      let cursor: string | null = manager.id;
      for (let depth = 0; cursor && depth < 50; depth++) {
        if (cursor === selfId) throw new AppError('HIERARCHY_CYCLE', 'This would create a reporting cycle', 400);
        const next: { managerId: string | null } | null = await client.user.findUnique({ where: { id: cursor }, select: { managerId: true } });
        cursor = next?.managerId ?? null;
      }
    }
  }

  async create(actor: Principal, dto: CreateDto) {
    this.assertRoleSet(dto.roles);
    this.assertCanAssign(actor, dto.roles);
    if (dto.managerId) await this.assertValidManager(actor.organizationId, dto.managerId);
    if (dto.teamIds?.length) {
      const n = await this.prisma.team.count({ where: { id: { in: dto.teamIds }, organizationId: actor.organizationId } });
      if (n !== new Set(dto.teamIds).size) throw new AppError('INVALID_TEAM', 'Unknown team', 400);
    }
    const roleIds = await Promise.all(dto.roles.map((r) => this.roles.idFor(r)));
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw conflict('EMAIL_TAKEN', 'A user with this email already exists');

    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { organizationId: actor.organizationId, email: dto.email, name: dto.name, managerId: dto.managerId ?? null, department: dto.department?.trim() || null },
      });
      await tx.userRoleAssignment.createMany({
        data: roleIds.map((roleId) => ({ organizationId: actor.organizationId, userId: user.id, roleId, assignedById: actor.userId })),
      });
      if (dto.teamIds?.length) {
        await tx.teamMembership.createMany({ data: [...new Set(dto.teamIds)].map((teamId) => ({ teamId, userId: user.id })) });
      }
      await this.auth.issueToken(user, 'INVITE', tx);
      await this.outbox.publish(tx, {
        eventType: IDENTITY_EVENTS.USER_CREATED,
        aggregateType: 'user',
        aggregateId: user.id,
        organizationId: actor.organizationId,
        payload: { userId: user.id, organizationId: actor.organizationId, createdById: actor.userId },
      });
      await this.audit.recordTx(tx, {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        action: AUDIT_ACTIONS.USER_CREATED,
        entityType: 'user',
        entityId: user.id,
        metadata: { roles: dto.roles, managerId: dto.managerId ?? null },
      });
      return tx.user.findUniqueOrThrow({ where: { id: user.id }, include: userInclude });
    });
    const warnings = await this.softLimitWarnings(actor.organizationId, dto.managerId);
    return new ApiResult(toUserDto(created), { warnings });
  }

  async update(actor: Principal, id: string, dto: UpdateDto) {
    const target = await this.loadTarget(actor, id, 'users:update');
    if (dto.managerId) {
      if (dto.managerId === id) throw new AppError('HIERARCHY_CYCLE', 'A user cannot manage themselves', 400);
      await this.assertValidManager(actor.organizationId, dto.managerId, id);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: { ...(dto.name !== undefined ? { name: dto.name } : {}), ...(dto.managerId !== undefined ? { managerId: dto.managerId } : {}), ...(dto.department !== undefined ? { department: dto.department?.trim() || null } : {}) },
        include: userInclude,
      });
      await this.audit.recordTx(tx, {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        action: dto.managerId !== undefined && dto.managerId !== target.managerId ? AUDIT_ACTIONS.OWNERSHIP_CHANGED : AUDIT_ACTIONS.USER_UPDATED,
        entityType: 'user',
        entityId: id,
        metadata: { before: { name: target.name, managerId: target.managerId, department: target.department }, after: dto },
      });
      return u;
    });
    const warnings = await this.softLimitWarnings(actor.organizationId, updated.managerId);
    return new ApiResult(toUserDto(updated), { warnings });
  }

  /**
   * Manual invite link for when no email provider is enabled (DEC-013). Returns a fresh single-use link ONCE (never stored in clear
   * text, never audited); older outstanding links are invalidated. Only for active users who have not set a password yet, and the
   * actor must be allowed to assign every role the user holds (so Admin cannot take over a Finance/HR/Founder account).
   */
  async issueInviteLink(actor: Principal, id: string) {
    const target = await this.loadTarget(actor, id, 'users:update');
    if (!target.isActive) throw conflict('USER_INACTIVE', 'User is deactivated');
    if (target.passwordHash) throw conflict('ALREADY_ACCEPTED', 'This user has already set a password; use password reset instead');
    this.assertCanAssign(actor, target.roleAssignments.map((a) => a.role.key as RoleKey));
    const issued = await this.prisma.$transaction(async (tx) => {
      const r = await this.auth.issueToken(target, 'INVITE', tx, { sendEmail: false });
      await this.audit.recordTx(tx, { organizationId: actor.organizationId, actorId: actor.userId, action: AUDIT_ACTIONS.INVITE_LINK_ISSUED, entityType: 'user', entityId: id, metadata: { expiresAt: r.expiresAt.toISOString() } });
      return r;
    });
    return { link: issued.link, expiresAt: issued.expiresAt };
  }

  async deactivate(actor: Principal, id: string, reason?: string) {
    if (id === actor.userId) throw new AppError('CANNOT_DEACTIVATE_SELF', 'You cannot deactivate your own account', 400);
    const target = await this.loadTarget(actor, id, 'users:deactivate');
    if (!target.isActive) throw conflict('ALREADY_INACTIVE', 'User is already deactivated');
    await this.assertNotLastFounder(actor.organizationId, target, 'deactivate');

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: { isActive: false, deactivatedAt: new Date() },
        include: userInclude,
      });
      await this.sessions.revokeAllForUser(id, 'user_deactivated', tx);
      await tx.delegation.updateMany({ where: { OR: [{ delegatorId: id }, { delegateId: id }], revokedAt: null }, data: { revokedAt: new Date() } });
      const payload: UserDeactivatedPayload = {
        userId: id,
        organizationId: actor.organizationId,
        managerId: target.managerId,
        deactivatedById: actor.userId,
        reason: reason ?? null,
      };
      // CRM agent consumes `user.deactivated` to build the reassignment queue (see docs/phase-1-2-backend-report.md).
      await this.outbox.publish(tx, {
        eventType: IDENTITY_EVENTS.USER_DEACTIVATED,
        aggregateType: 'user',
        aggregateId: id,
        organizationId: actor.organizationId,
        payload: payload as unknown as Record<string, unknown>,
        idempotencyKey: `user.deactivated:${id}:${u.deactivatedAt!.toISOString()}`,
      });
      await this.audit.recordTx(tx, {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        action: AUDIT_ACTIONS.USER_DEACTIVATED,
        entityType: 'user',
        entityId: id,
        metadata: { reason: reason ?? null },
      });
      return u;
    });
    return toUserDto(updated);
  }

  async reactivate(actor: Principal, id: string) {
    const target = await this.loadTarget(actor, id, 'users:deactivate');
    if (target.isActive) throw conflict('ALREADY_ACTIVE', 'User is already active');
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: { isActive: true, deactivatedAt: null, failedLoginCount: 0, lockedUntil: null },
        include: userInclude,
      });
      await this.outbox.publish(tx, {
        eventType: IDENTITY_EVENTS.USER_REACTIVATED,
        aggregateType: 'user',
        aggregateId: id,
        organizationId: actor.organizationId,
        payload: { userId: id, organizationId: actor.organizationId, reactivatedById: actor.userId },
      });
      await this.audit.recordTx(tx, {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        action: AUDIT_ACTIONS.USER_REACTIVATED,
        entityType: 'user',
        entityId: id,
      });
      return u;
    });
    return toUserDto(updated);
  }

  private async assertNotLastFounder(organizationId: string, target: { id: string; roleAssignments: { role: { key: string } }[] }, verb: string) {
    if (!target.roleAssignments.some((a) => a.role.key === 'FOUNDER_CEO')) return;
    const others = await this.prisma.user.count({
      where: { organizationId, isActive: true, id: { not: target.id }, roleAssignments: { some: { role: { key: 'FOUNDER_CEO' } } } },
    });
    if (others === 0) throw new AppError('LAST_FOUNDER', `Cannot ${verb}: this is the last active Founder`, 400);
  }

  async setRoles(actor: Principal, id: string, roles: RoleKey[]) {
    if (id === actor.userId) throw new AppError('CANNOT_CHANGE_OWN_ROLES', 'You cannot change your own roles', 403);
    const target = await this.loadTarget(actor, id, 'users:update');
    const before = target.roleAssignments.map((a) => a.role.key as RoleKey);
    const next = [...new Set(roles)];
    const added = next.filter((r) => !before.includes(r));
    const removed = before.filter((r) => !next.includes(r));
    this.assertRoleSet(next);
    this.assertCanAssign(actor, [...added, ...removed]);
    if (removed.includes('FOUNDER_CEO')) await this.assertNotLastFounder(actor.organizationId, target, 'remove the Founder role from');

    const addIds = await Promise.all(added.map((r) => this.roles.idFor(r)));
    const removeIds = await Promise.all(removed.map((r) => this.roles.idFor(r)));
    const updated = await this.prisma.$transaction(async (tx) => {
      if (removeIds.length) await tx.userRoleAssignment.deleteMany({ where: { userId: id, roleId: { in: removeIds } } });
      if (addIds.length) {
        await tx.userRoleAssignment.createMany({
          data: addIds.map((roleId) => ({ organizationId: actor.organizationId, userId: id, roleId, assignedById: actor.userId })),
        });
      }
      await this.audit.recordTx(tx, {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        action: AUDIT_ACTIONS.ROLES_CHANGED,
        entityType: 'user',
        entityId: id,
        metadata: { before, after: next, added, removed },
      });
      await this.outbox.publish(tx, {
        eventType: IDENTITY_EVENTS.USER_ROLES_CHANGED,
        aggregateType: 'user',
        aggregateId: id,
        organizationId: actor.organizationId,
        payload: { userId: id, organizationId: actor.organizationId, before, after: next, changedById: actor.userId },
      });
      return tx.user.findUniqueOrThrow({ where: { id }, include: userInclude });
    });
    return toUserDto(updated);
  }
}

