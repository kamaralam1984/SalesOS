import { Inject, Injectable } from '@nestjs/common';
import { ROLE_KEYS } from '@salesos/shared-types';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { AUDIT_ACTIONS } from '../../../common/audit/audit.service';
import type { Principal } from '../../../common/authz';
import { OpsProbeService } from '../../../common/observability/ops-probe.service';
import { PrismaService } from '../../../common/prisma';
import { APP_ENV } from '../../../config/config.module';
import type { Env } from '../../../config/env';

export type AlertSeverity = 'critical' | 'warning' | 'info';
const DAY_MS = 24 * 3600 * 1000;

@Injectable()
export class DevDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly probe: OpsProbeService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  /** Consolidated snapshot: service health, 24 h alert counters, live sessions and users per role. */
  async snapshot(actor: Principal) {
    const orgId = actor.organizationId;
    const now = new Date();
    const since = new Date(now.getTime() - DAY_MS);
    const started = Date.now();
    const [database, redis, worker, outbox, audit, lockedNow, users, activeUsers, sessions, assignments] = await Promise.all([
      this.probe.database(),
      this.probe.redisUp(),
      this.probe.worker(),
      this.probe.outbox(),
      this.prisma.auditLog.groupBy({
        by: ['action'],
        where: {
          organizationId: orgId,
          createdAt: { gte: since },
          action: { in: [AUDIT_ACTIONS.LOCKOUT, AUDIT_ACTIONS.LOGIN_FAILED, AUDIT_ACTIONS.DEVPANEL_FORCE_LOGOUT_ALL, AUDIT_ACTIONS.DEVPANEL_SESSIONS_REVOKED, AUDIT_ACTIONS.DEVPANEL_ROLES_CHANGED] },
        },
        _count: { _all: true },
      }),
      this.prisma.user.count({ where: { organizationId: orgId, lockedUntil: { gt: now } } }),
      this.prisma.user.count({ where: { organizationId: orgId } }),
      this.prisma.user.count({ where: { organizationId: orgId, isActive: true } }),
      this.prisma.session.count({ where: { organizationId: orgId, revokedAt: null, idleExpiresAt: { gt: now }, absoluteExpiresAt: { gt: now } } }),
      this.prisma.userRoleAssignment.findMany({ where: { organizationId: orgId, user: { isActive: true } }, select: { role: { select: { key: true } } } }),
    ]);
    const n = (a: string) => audit.find((r) => r.action === a)?._count._all ?? 0;
    const usersPerRole: Record<string, number> = Object.fromEntries(ROLE_KEYS.map((k) => [k, 0]));
    for (const a of assignments) usersPerRole[a.role.key] = (usersPerRole[a.role.key] ?? 0) + 1;

    const counters = {
      accountLockouts: n(AUDIT_ACTIONS.LOCKOUT),
      failedLogins: n(AUDIT_ACTIONS.LOGIN_FAILED),
      forceLogouts: n(AUDIT_ACTIONS.DEVPANEL_FORCE_LOGOUT_ALL) + n(AUDIT_ACTIONS.DEVPANEL_SESSIONS_REVOKED),
      roleChanges: n(AUDIT_ACTIONS.DEVPANEL_ROLES_CHANGED),
      deadOutboxEvents: outbox?.dead ?? null,
      currentlyLockedAccounts: lockedNow,
    };
    const alerts: Array<{ key: string; severity: AlertSeverity; count: number | null }> = [];
    if (!database) alerts.push({ key: 'databaseDown', severity: 'critical', count: null });
    if (!redis) alerts.push({ key: 'redisDown', severity: 'critical', count: null });
    if (worker.status === 'stale') alerts.push({ key: 'workerStale', severity: 'critical', count: null });
    if (worker.status === 'unknown') alerts.push({ key: 'workerUnknown', severity: 'warning', count: null });
    if (outbox && outbox.dead > 0) alerts.push({ key: 'deadOutbox', severity: 'critical', count: outbox.dead });
    if (outbox && outbox.pending > 0 && outbox.oldestPendingSeconds > 120) alerts.push({ key: 'outboxBacklog', severity: 'warning', count: outbox.pending });
    if (counters.accountLockouts > 0) alerts.push({ key: 'lockouts', severity: 'warning', count: counters.accountLockouts });
    if (counters.failedLogins >= 10) alerts.push({ key: 'failedLogins', severity: 'warning', count: counters.failedLogins });
    if (counters.forceLogouts > 0) alerts.push({ key: 'forceLogouts', severity: 'info', count: counters.forceLogouts });
    if (counters.roleChanges > 0) alerts.push({ key: 'roleChanges', severity: 'info', count: counters.roleChanges });
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);

    const status: 'ok' | 'degraded' | 'down' = !database || !redis ? 'down' : worker.status === 'ok' && (outbox?.dead ?? 0) === 0 && outbox !== null ? 'ok' : 'degraded';
    return {
      checkedAt: now.toISOString(),
      probeMs: Date.now() - started,
      health: {
        status,
        database: database ? 'ok' : 'down',
        redis: redis ? 'ok' : 'down',
        worker: worker.status,
        workerInstances: worker.instances,
        outbox,
      },
      users: { total: users, active: activeUsers, perRole: usersPerRole },
      liveSessions: sessions,
      alerts24h: { windowHours: 24, counters, alerts },
    };
  }

  /** Integration health from configuration + delivery/webhook outcomes. Never returns settings, secrets or error bodies. */
  async integrations(actor: Principal) {
    const orgId = actor.organizationId;
    const since = new Date(Date.now() - 7 * DAY_MS);
    const [configs, deliveries, webhooks] = await Promise.all([
      this.prisma.integrationConfig.findMany({
        where: { organizationId: orgId },
        select: { provider: true, kind: true, enabled: true, mode: true, blockedReason: true, lastHealthAt: true, lastHealthStatus: true, secretCipher: true },
        orderBy: { provider: 'asc' },
        take: 50,
      }),
      this.prisma.notificationDelivery.groupBy({
        by: ['provider', 'status'],
        where: { organizationId: orgId, createdAt: { gte: since } },
        _count: { _all: true },
        _max: { lastAttemptAt: true, createdAt: true },
      }),
      this.prisma.webhookEvent.groupBy({
        by: ['provider', 'outcome'],
        where: { organizationId: orgId, receivedAt: { gte: since } },
        _count: { _all: true },
        _max: { receivedAt: true },
      }),
    ]);
    const stamp = (d: Date | null | undefined) => (d ? d.toISOString() : null);
    const items = configs.map((c) => {
      const del = deliveries.filter((d) => d.provider === c.provider);
      const hooks = webhooks.filter((w) => w.provider === c.provider);
      const sum = (rows: Array<{ _count: { _all: number } }>) => rows.reduce((a, r) => a + r._count._all, 0);
      const last = (rows: Array<Date | null | undefined>) => rows.filter((x): x is Date => Boolean(x)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      const okRows = del.filter((d) => d.status === 'SENT' || d.status === 'DELIVERED');
      const badRows = del.filter((d) => d.status === 'FAILED' || d.status === 'DEAD_LETTER');
      const state: 'not_configured' | 'blocked' | 'disabled' | 'healthy' | 'degraded' | 'unknown' = !c.secretCipher && !c.enabled ? 'not_configured'
        : c.blockedReason ? 'blocked'
        : !c.enabled ? 'disabled'
        : c.lastHealthStatus && !/^(ok|healthy)$/i.test(c.lastHealthStatus) ? 'degraded'
        : c.lastHealthStatus ? 'healthy' : 'unknown';
      return {
        provider: c.provider,
        kind: c.kind,
        enabled: c.enabled,
        mode: c.mode,
        credentialsStored: Boolean(c.secretCipher),
        blocked: Boolean(c.blockedReason),
        state,
        lastHealthAt: stamp(c.lastHealthAt),
        lastHealthStatus: c.lastHealthStatus ?? null,
        last7d: {
          deliveriesOk: sum(okRows),
          deliveriesFailed: sum(badRows),
          webhooksAccepted: sum(hooks.filter((w) => w.outcome === 'ACCEPTED')),
          webhooksFailed: sum(hooks.filter((w) => w.outcome === 'FAILED')),
          lastSuccessAt: stamp(last(okRows.map((r) => r._max.lastAttemptAt ?? r._max.createdAt))),
          lastFailureAt: stamp(last([...badRows.map((r) => r._max.lastAttemptAt ?? r._max.createdAt), ...hooks.filter((w) => w.outcome === 'FAILED').map((w) => w._max.receivedAt)])),
        },
      };
    });
    return { checkedAt: new Date().toISOString(), configured: items.filter((i) => i.state !== 'not_configured').length, items };
  }

  /** Last backup status from the newest `*.dump` file in BACKUP_DIR. UNKNOWN (with a reason) when that cannot be verified. */
  async backup() {
    const checkedAt = new Date().toISOString();
    const maxAgeHours = this.env.BACKUP_MAX_AGE_HOURS;
    const dir = this.env.BACKUP_DIR;
    if (!dir) return { checkedAt, status: 'UNKNOWN' as const, reason: 'BACKUP_DIR_NOT_SET', lastBackupAt: null, ageHours: null, sizeBytes: null, hasChecksum: null, maxAgeHours };
    try {
      const names = (await readdir(dir)).filter((f) => f.endsWith('.dump') || f.endsWith('.dump.age')).slice(0, 5000);
      let best: { name: string; mtime: Date; size: number } | null = null;
      for (const name of names) {
        const st = await stat(join(dir, name));
        if (st.isFile() && (!best || st.mtime > best.mtime)) best = { name, mtime: st.mtime, size: st.size };
      }
      if (!best) return { checkedAt, status: 'MISSING' as const, reason: 'NO_BACKUP_FILES', lastBackupAt: null, ageHours: null, sizeBytes: null, hasChecksum: null, maxAgeHours };
      const ageHours = Math.round(((Date.now() - best.mtime.getTime()) / 3600_000) * 10) / 10;
      const hasChecksum = await stat(join(dir, `${best.name}.sha256`)).then(() => true, () => false);
      return {
        checkedAt,
        status: (ageHours <= maxAgeHours ? 'OK' : 'STALE') as 'OK' | 'STALE',
        reason: null,
        lastBackupAt: best.mtime.toISOString(),
        ageHours,
        sizeBytes: best.size,
        hasChecksum,
        maxAgeHours,
      };
    } catch {
      return { checkedAt, status: 'UNKNOWN' as const, reason: 'BACKUP_DIR_UNREADABLE', lastBackupAt: null, ageHours: null, sizeBytes: null, hasChecksum: null, maxAgeHours };
    }
  }
}
