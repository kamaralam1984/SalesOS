import { Injectable } from '@nestjs/common';
import { PRIMARY_ROLE_KEYS, ROLE_KEYS, type RoleKey } from '@salesos/shared-types';
import { statfs } from 'node:fs/promises';
import * as os from 'node:os';
import { AuditService, AUDIT_ACTIONS } from '../../common/audit/audit.service';
import { AccessService, type Principal } from '../../common/authz';
import { SessionService } from '../../common/authz/session.service';
import { AppError, forbidden } from '../../common/http/errors';
import { OpsProbeService } from '../../common/observability/ops-probe.service';
import { PrismaService } from '../../common/prisma';
import { RolesService } from '../identity/roles.service';

const userSelect = { roleAssignments: { include: { role: true } } } as const;

@Injectable()
export class DevPanelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly roles: RolesService,
    private readonly probe: OpsProbeService,
  ) {}

  async overview(actor: Principal) {
    const orgId = actor.organizationId;
    const now = new Date();
    const [users, active, sessions, assignments] = await Promise.all([
      this.prisma.user.count({ where: { organizationId: orgId } }),
      this.prisma.user.count({ where: { organizationId: orgId, isActive: true } }),
      this.prisma.session.count({ where: { organizationId: orgId, revokedAt: null, idleExpiresAt: { gt: now }, absoluteExpiresAt: { gt: now } } }),
      this.prisma.userRoleAssignment.findMany({ where: { organizationId: orgId, user: { isActive: true } }, select: { role: { select: { key: true } } } }),
    ]);
    const perRole: Record<string, number> = Object.fromEntries(ROLE_KEYS.map((k) => [k, 0]));
    for (const a of assignments) perRole[a.role.key] = (perRole[a.role.key] ?? 0) + 1;
    return { users, activeUsers: active, activeSessions: sessions, usersPerRole: perRole };
  }

  async listUsers(actor: Principal, q: { search?: string; role?: RoleKey; isActive?: 'true' | 'false'; limit: number }) {
    const rows = await this.prisma.user.findMany({
      where: {
        organizationId: actor.organizationId,
        ...(q.isActive ? { isActive: q.isActive === 'true' } : {}),
        ...(q.role ? { roleAssignments: { some: { role: { key: q.role } } } } : {}),
        ...(q.search
          ? { OR: [{ name: { contains: q.search, mode: 'insensitive' as const } }, { email: { contains: q.search, mode: 'insensitive' as const } }] }
          : {}),
      },
      include: userSelect,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: q.limit,
    });
    const now = new Date();
    const counts = await this.prisma.session.groupBy({
      by: ['userId'],
      where: { userId: { in: rows.map((r) => r.id) }, revokedAt: null, idleExpiresAt: { gt: now }, absoluteExpiresAt: { gt: now } },
      _count: { _all: true },
    });
    const bySession = new Map(counts.map((c) => [c.userId, c._count._all]));
    return rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      isActive: u.isActive,
      lastLoginAt: u.lastLoginAt ?? null,
      roles: u.roleAssignments.map((a) => a.role.key as RoleKey),
      activeSessions: bySession.get(u.id) ?? 0,
    }));
  }

  private async loadTarget(actor: Principal, id: string) {
    const t = await this.prisma.user.findFirst({ where: { id, organizationId: actor.organizationId }, include: userSelect });
    if (!t) throw new AppError('NOT_FOUND', 'User not found', 404);
    return t;
  }

  private async countOtherActive(orgId: string, role: RoleKey, excludeId: string) {
    return this.prisma.user.count({
      where: { organizationId: orgId, isActive: true, id: { not: excludeId }, roleAssignments: { some: { role: { key: role } } } },
    });
  }

  /** Replace the full role set. Developer can grant/remove ANY role; guards: not self, one primary, never strand the last Founder/Developer. */
  async setRoles(actor: Principal, id: string, next: RoleKey[]) {
    if (id === actor.userId) throw new AppError('CANNOT_CHANGE_OWN_ROLES', 'You cannot change your own roles', 403);
    const target = await this.loadTarget(actor, id);
    const before = target.roleAssignments.map((a) => a.role.key as RoleKey);
    const set = [...new Set(next)];
    const added = set.filter((r) => !before.includes(r));
    const removed = before.filter((r) => !set.includes(r));
    if (set.filter((r) => (PRIMARY_ROLE_KEYS as readonly string[]).includes(r)).length > 1) {
      throw new AppError('MULTIPLE_PRIMARY_ROLES', 'A user can hold at most one primary role', 400);
    }
    if ([...added, ...removed].includes('DEVELOPER') && !this.access.has(actor, 'devpanel:developer:assign')) throw forbidden();
    for (const guarded of ['FOUNDER_CEO', 'DEVELOPER'] as const) {
      if (removed.includes(guarded) && (await this.countOtherActive(actor.organizationId, guarded, id)) === 0) {
        throw new AppError(`LAST_${guarded}`, `Cannot remove the ${guarded} role: this is the last active holder`, 400);
      }
    }
    const addIds = await Promise.all(added.map((r) => this.roles.idFor(r)));
    const removeIds = await Promise.all(removed.map((r) => this.roles.idFor(r)));
    await this.prisma.$transaction(async (tx) => {
      if (removeIds.length) await tx.userRoleAssignment.deleteMany({ where: { userId: id, roleId: { in: removeIds } } });
      if (addIds.length) {
        await tx.userRoleAssignment.createMany({ data: addIds.map((roleId) => ({ organizationId: actor.organizationId, userId: id, roleId, assignedById: actor.userId })) });
      }
      // Role change takes effect on the next request (principal is rebuilt per request); drop sessions so stale UI state is cleared too.
      if (added.length || removed.length) await this.sessions.revokeAllForUser(id, 'roles_changed_by_developer', tx);
      await this.audit.recordTx(tx, {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        action: AUDIT_ACTIONS.DEVPANEL_ROLES_CHANGED,
        entityType: 'user',
        entityId: id,
        metadata: { before, after: set, added, removed },
      });
    });
    return { id, roles: set, added, removed };
  }

  async revokeUserSessions(actor: Principal, id: string) {
    const target = await this.loadTarget(actor, id);
    const r = await this.prisma.$transaction(async (tx) => {
      const res = await this.sessions.revokeAllForUser(target.id, 'revoked_by_developer', tx);
      await this.audit.recordTx(tx, {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        action: AUDIT_ACTIONS.DEVPANEL_SESSIONS_REVOKED,
        entityType: 'user',
        entityId: id,
        metadata: { revoked: res.count },
      });
      return res;
    });
    return { revoked: r.count };
  }

  /** Emergency: end every session in the organisation except the caller's own. */
  async forceLogoutAll(actor: Principal, reason: string) {
    const r = await this.prisma.$transaction(async (tx) => {
      const res = await tx.session.updateMany({
        where: { organizationId: actor.organizationId, revokedAt: null, userId: { not: actor.userId } },
        data: { revokedAt: new Date(), revokedReason: 'force_logout_all' },
      });
      await this.audit.recordTx(tx, {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        action: AUDIT_ACTIONS.DEVPANEL_FORCE_LOGOUT_ALL,
        entityType: 'organization',
        entityId: actor.organizationId,
        metadata: { revoked: res.count, reason },
      });
      return res;
    });
    return { revoked: r.count };
  }

  /** Read-only server snapshot. No shell, no restart: process control stays with the deploy tooling (docs/deployment-runbook.md). */
  async serverStatus() {
    const t0 = Date.now();
    const [database, redis, worker, outbox] = await Promise.all([this.probe.database(), this.probe.redisUp(), this.probe.worker(), this.probe.outbox()]);
    let disk: { totalBytes: number; freeBytes: number } | null = null;
    try {
      const s = await statfs(process.cwd());
      disk = { totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize };
    } catch {
      disk = null;
    }
    const mem = process.memoryUsage();
    return {
      checkedAt: new Date().toISOString(),
      probeMs: Date.now() - t0,
      services: { database: database ? 'ok' : 'down', redis: redis ? 'ok' : 'down', worker: worker.status },
      worker,
      outbox,
      process: { nodeVersion: process.version, uptimeSeconds: Math.round(process.uptime()), rssBytes: mem.rss, heapUsedBytes: mem.heapUsed, env: process.env.NODE_ENV ?? 'unknown' },
      host: { cpuCount: os.cpus().length, loadAvg: os.loadavg(), totalMemBytes: os.totalmem(), freeMemBytes: os.freemem(), hostUptimeSeconds: Math.round(os.uptime()), disk },
    };
  }
}
