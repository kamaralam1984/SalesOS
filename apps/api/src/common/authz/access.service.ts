import { Injectable } from '@nestjs/common';
import type { ScopeLevel } from '@salesos/shared-types';
import { SCOPE_RANK } from '@salesos/shared-types';
import { PrismaService } from '../prisma';
import { forbidden, notFound } from '../http/errors';
import type { PermissionKey } from './permissions.catalogue';
import type { Principal } from './principal';

export interface ResolvedScope {
  level: ScopeLevel;
  organizationId: string;
  /** own: [self]; team: self + subordinates + led-team members + delegated; org: undefined (everyone in org) */
  userIds?: string[];
  teamIds?: string[];
}

/** Describes how a domain resource maps to users/teams so scopedWhere can build a Prisma filter. */
export interface DomainScope {
  permission: PermissionKey;
  /** column holding the owning user id, e.g. 'assignedToId' */
  ownerField: string;
  /** column holding the organization id (default 'organizationId') */
  orgField?: string;
  /** optional column holding a team id; team-scope also matches records of the caller's teams */
  teamField?: string;
}

export interface VisibleUsers {
  ids: string[];
  teamIds: string[];
  delegatedFrom: string[];
  directReports: number;
}

/**
 * Central scope resolution. EVERY domain query for user-owned data must go through
 * `scopedWhere` (list/filter) or `assertRecordAccess` (single record). Never accept org/user ids from the client.
 */
@Injectable()
export class AccessService {
  private readonly cache = new WeakMap<Principal, Promise<VisibleUsers>>();
  constructor(private readonly prisma: PrismaService) {}

  /** Broadest scope the principal holds for this permission, or null. */
  scopeLevel(p: Principal, permission: PermissionKey): ScopeLevel | null {
    return p.permissions.get(permission) ?? null;
  }

  has(p: Principal, permission: PermissionKey): boolean {
    return p.permissions.has(permission);
  }

  /** True when the principal's widest scope for this key is `summary`: return minimum-data projections only. */
  isSummaryOnly(p: Principal, permission: PermissionKey): boolean {
    return p.permissions.get(permission) === 'summary';
  }

  /** Users the principal can see at TEAM scope (hierarchy + led teams + active delegations), incl. self. */
  visibleUsers(p: Principal): Promise<VisibleUsers> {
    let cached = this.cache.get(p);
    if (!cached) {
      cached = this.computeVisible(p);
      this.cache.set(p, cached);
    }
    return cached;
  }

  private async computeVisible(p: Principal): Promise<VisibleUsers> {
    const now = new Date();
    const descendants = (rootId: string) =>
      this.prisma.$queryRaw<{ id: string }[]>`
        WITH RECURSIVE sub(id) AS (
          SELECT id FROM users WHERE manager_id = ${rootId}::uuid AND organization_id = ${p.organizationId}::uuid
          UNION
          SELECT u.id FROM users u JOIN sub s ON u.manager_id = s.id WHERE u.organization_id = ${p.organizationId}::uuid
        ) SELECT id::text FROM sub`;

    const [ledMemberships, delegations, direct] = await Promise.all([
      this.prisma.teamMembership.findMany({
        where: {
          team: { organizationId: p.organizationId },
          OR: [{ userId: p.userId, membershipRole: 'LEAD' }, { team: { leadUserId: p.userId } }],
        },
        select: { teamId: true },
      }),
      this.prisma.delegation.findMany({
        where: {
          organizationId: p.organizationId,
          delegateId: p.userId,
          revokedAt: null,
          startsAt: { lte: now },
          endsAt: { gt: now },
          delegator: { isActive: true },
        },
        select: { delegatorId: true },
      }),
      this.prisma.user.count({ where: { organizationId: p.organizationId, managerId: p.userId } }),
    ]);
    const ledTeams = await this.prisma.team.findMany({
      where: { organizationId: p.organizationId, leadUserId: p.userId },
      select: { id: true },
    });
    const teamIds = [...new Set([...ledMemberships.map((m) => m.teamId), ...ledTeams.map((t) => t.id)])];
    const delegatedFrom = [...new Set(delegations.map((d) => d.delegatorId))];

    const ids = new Set<string>([p.userId]);
    for (const row of await descendants(p.userId)) ids.add(row.id);
    if (teamIds.length) {
      const members = await this.prisma.teamMembership.findMany({
        where: { teamId: { in: teamIds }, user: { organizationId: p.organizationId } },
        select: { userId: true },
      });
      members.forEach((m) => ids.add(m.userId));
    }
    for (const delegator of delegatedFrom) {
      ids.add(delegator);
      for (const row of await descendants(delegator)) ids.add(row.id);
    }
    return { ids: [...ids], teamIds, delegatedFrom, directReports: direct };
  }

  async resolveScope(p: Principal, permission: PermissionKey): Promise<ResolvedScope> {
    const level = this.scopeLevel(p, permission);
    if (!level) throw forbidden();
    if (level === 'org' || level === 'summary') return { level, organizationId: p.organizationId };
    if (level === 'own') return { level, organizationId: p.organizationId, userIds: [p.userId] };
    const v = await this.visibleUsers(p);
    return { level, organizationId: p.organizationId, userIds: v.ids, teamIds: v.teamIds };
  }

  /**
   * Build a Prisma `where` fragment that ALWAYS pins organizationId and restricts ownership by scope.
   *   prisma.lead.findMany({ where: { ...(await access.scopedWhere(user, { permission:'leads:read', ownerField:'assignedToId' })), status } })
   * Combine with AND if you also use OR at the top level.
   */
  async scopedWhere(p: Principal, scope: DomainScope): Promise<Record<string, unknown>> {
    const resolved = await this.resolveScope(p, scope.permission);
    const where: Record<string, unknown> = { [scope.orgField ?? 'organizationId']: p.organizationId };
    // 'summary' is org-wide: the caller MUST also apply a minimum-data projection (see isSummaryOnly).
    if (resolved.level === 'org' || resolved.level === 'summary') return where;
    if (resolved.level === 'team' && scope.teamField && resolved.teamIds?.length) {
      where.AND = [
        { OR: [{ [scope.ownerField]: { in: resolved.userIds } }, { [scope.teamField]: { in: resolved.teamIds } }] },
      ];
      return where;
    }
    where[scope.ownerField] = { in: resolved.userIds };
    return where;
  }

  /** True if a single record (already loaded) falls inside the principal's scope. */
  async canAccessRecord(
    p: Principal,
    permission: PermissionKey,
    record: { organizationId: string; ownerId: string | null; teamId?: string | null },
  ): Promise<boolean> {
    if (record.organizationId !== p.organizationId) return false;
    const level = this.scopeLevel(p, permission);
    if (!level) return false;
    if (level === 'org' || level === 'summary') return true;
    if (level === 'own') return record.ownerId === p.userId;
    const v = await this.visibleUsers(p);
    return (
      (record.ownerId !== null && v.ids.includes(record.ownerId)) ||
      (!!record.teamId && v.teamIds.includes(record.teamId))
    );
  }

  /** IDOR-safe: out-of-scope and non-existent records both yield 404 (never 403, never leak existence). */
  async assertRecordAccess(
    p: Principal,
    permission: PermissionKey,
    record: { organizationId: string; ownerId: string | null; teamId?: string | null } | null | undefined,
    what = 'Resource',
  ): Promise<void> {
    if (!record || !(await this.canAccessRecord(p, permission, record))) throw notFound(what);
  }

  /** True if `actor` may act on target user at least at `minLevel` (used for user-targeted endpoints). */
  async canSeeUser(p: Principal, permission: PermissionKey, targetUserId: string, targetOrgId: string) {
    return this.canAccessRecord(p, permission, { organizationId: targetOrgId, ownerId: targetUserId });
  }

  static atLeast(level: ScopeLevel | null, min: ScopeLevel): boolean {
    return !!level && SCOPE_RANK[level] >= SCOPE_RANK[min];
  }
}
