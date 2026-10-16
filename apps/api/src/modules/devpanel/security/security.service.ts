import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import type { Principal } from '../../../common/authz';
import { AppError, conflict, notFound } from '../../../common/http/errors';
import { ok } from '../../../common/http/api-result';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService } from '../../../common/prisma';
import { AuthService } from '../../identity/auth/auth.service';

export const SECURITY_AUDIT = {
  SESSION_REVOKED: 'devpanel.session_revoked',
  ACCOUNT_UNLOCKED: 'devpanel.account_unlocked',
  RESET_LINK_ISSUED: 'devpanel.reset_link_issued',
} as const;

/** Auth events that exist in audit_logs today (see AUDIT_ACTIONS). Failed logins are only recorded for emails that match an account. */
export const LOGIN_HISTORY_ACTIONS = [
  'auth.login_success',
  'auth.login_failed',
  'auth.account_locked',
  'auth.logout',
  'auth.password_reset_requested',
  'auth.password_reset_completed',
  'auth.invite_accepted',
  'auth.sessions_revoked',
] as const;

const UA_MAX = 120;

interface Page { limit?: number; cursor?: string }

@Injectable()
export class SecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  async listSessions(actor: Principal, q: Page & { userId?: string }) {
    const now = new Date();
    // A rotation leaves the previous row valid for a 60s grace window; show one row per session family (the newest).
    const rotatedParents = await this.prisma.session.findMany({
      where: { organizationId: actor.organizationId, revokedAt: null, rotatedFromId: { not: null } },
      select: { rotatedFromId: true },
    });
    const where: Prisma.SessionWhereInput = {
      organizationId: actor.organizationId,
      revokedAt: null,
      idleExpiresAt: { gt: now },
      absoluteExpiresAt: { gt: now },
      id: { notIn: rotatedParents.map((r) => r.rotatedFromId!) },
      ...(q.userId ? { userId: q.userId } : {}),
    };
    const rows = await this.prisma.session.findMany({
      where,
      orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true, userId: true, familyId: true, createdAt: true, lastSeenAt: true, idleExpiresAt: true, absoluteExpiresAt: true, ip: true, userAgent: true,
        user: { select: { name: true, email: true } },
      },
      ...pageArgs(q),
    });
    const res = pageResult(rows, q);
    return ok(res.data.map((s) => ({
      id: s.id,
      userId: s.userId,
      userName: s.user.name,
      userEmail: s.user.email,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.idleExpiresAt < s.absoluteExpiresAt ? s.idleExpiresAt : s.absoluteExpiresAt,
      ip: s.ip,
      userAgent: s.userAgent ? s.userAgent.slice(0, UA_MAX) : null,
      isCurrent: s.familyId === actor.sessionFamilyId,
    })), res.meta);
  }

  async revokeSession(actor: Principal, id: string) {
    const s = await this.prisma.session.findFirst({
      where: { id, organizationId: actor.organizationId, revokedAt: null, absoluteExpiresAt: { gt: new Date() } },
      select: { id: true, userId: true, familyId: true },
    });
    if (!s) throw notFound('Session');
    const revoked = await this.prisma.$transaction(async (tx) => {
      const r = await tx.session.updateMany({
        where: { familyId: s.familyId, organizationId: actor.organizationId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'devpanel_session_revoked' },
      });
      await this.audit.recordTx(tx, {
        organizationId: actor.organizationId, actorId: actor.userId, action: SECURITY_AUDIT.SESSION_REVOKED,
        entityType: 'session', entityId: s.id, metadata: { userId: s.userId, self: s.familyId === actor.sessionFamilyId },
      });
      return r.count;
    });
    return { id: s.id, revoked };
  }

  async loginHistory(actor: Principal, q: Page & { action?: string; userId?: string; from?: Date; to?: Date }) {
    const where: Prisma.AuditLogWhereInput = {
      organizationId: actor.organizationId,
      action: q.action ? q.action : { in: [...LOGIN_HISTORY_ACTIONS] },
      ...(q.userId ? { actorId: q.userId } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    };
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, action: true, actorId: true, ip: true, createdAt: true, metadata: true },
      ...pageArgs(q),
    });
    const res = pageResult(rows, q);
    const ids = [...new Set(res.data.map((r) => r.actorId).filter((x): x is string => !!x))];
    const users = await this.prisma.user.findMany({ where: { id: { in: ids }, organizationId: actor.organizationId }, select: { id: true, name: true, email: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    const data = res.data.map((r) => {
      const u = r.actorId ? byId.get(r.actorId) : undefined;
      const reason = (r.metadata as { reason?: unknown } | null)?.reason;
      return { id: r.id, action: r.action, userId: r.actorId, userName: u?.name ?? null, userEmail: u?.email ?? null, ip: r.ip, createdAt: r.createdAt, reason: typeof reason === 'string' ? reason : null };
    });
    return ok(data, {
      ...res.meta,
      failedAttemptsRecorded: 'known-accounts-only',
      note: 'Failed logins are audited per attempt only when the email matches an account; attempts for unknown emails are not recorded. Lockout state is available under locked-accounts (users.failedLoginCount / lockedUntil).',
    });
  }

  async lockedAccounts(actor: Principal, minFailures: number) {
    const now = new Date();
    const rows = await this.prisma.user.findMany({
      where: {
        organizationId: actor.organizationId,
        isActive: true,
        OR: [{ lockedUntil: { gt: now } }, { failedLoginCount: { gte: minFailures } }],
      },
      orderBy: [{ lockedUntil: { sort: 'desc', nulls: 'last' } }, { failedLoginCount: 'desc' }, { id: 'asc' }],
      take: 200,
      select: { id: true, name: true, email: true, failedLoginCount: true, lockedUntil: true, lastLoginAt: true },
    });
    return rows.map((u) => ({ ...u, isLocked: !!u.lockedUntil && u.lockedUntil > now }));
  }

  private async target(actor: Principal, id: string) {
    const u = await this.prisma.user.findFirst({ where: { id, organizationId: actor.organizationId }, select: { id: true, email: true, organizationId: true, isActive: true } });
    if (!u) throw notFound('User');
    return u;
  }

  async unlock(actor: Principal, id: string) {
    const u = await this.target(actor, id);
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id }, select: { failedLoginCount: true, lockedUntil: true } });
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { failedLoginCount: 0, lockedUntil: null } });
      await this.audit.recordTx(tx, {
        organizationId: actor.organizationId, actorId: actor.userId, action: SECURITY_AUDIT.ACCOUNT_UNLOCKED, entityType: 'user', entityId: u.id,
        metadata: { previousFailedLoginCount: before.failedLoginCount, wasLocked: !!before.lockedUntil && before.lockedUntil > new Date() },
      });
    });
    return { id: u.id, unlocked: true };
  }

  async issueResetLink(actor: Principal, id: string) {
    if (id === actor.userId) throw new AppError('CANNOT_RESET_SELF', 'Use the normal password change flow for your own account', 400);
    const u = await this.target(actor, id);
    if (!u.isActive) throw conflict('USER_INACTIVE', 'User is deactivated');
    const issued = await this.prisma.$transaction(async (tx) => {
      const r = await this.auth.issueToken(u, 'PASSWORD_RESET', tx, { sendEmail: false });
      await this.audit.recordTx(tx, {
        organizationId: actor.organizationId, actorId: actor.userId, action: SECURITY_AUDIT.RESET_LINK_ISSUED, entityType: 'user', entityId: u.id,
        metadata: { expiresAt: r.expiresAt.toISOString() }, // never the token or link
      });
      return r;
    });
    return { link: issued.link, expiresAt: issued.expiresAt };
  }

  async auditTrail(actor: Principal, q: Page & { action?: string; actorId?: string; from?: Date; to?: Date }) {
    const where: Prisma.AuditLogWhereInput = {
      organizationId: actor.organizationId,
      action: q.action ? q.action : { startsWith: 'devpanel.' },
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    };
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, action: true, actorId: true, entityType: true, entityId: true, ip: true, createdAt: true, metadata: true },
      ...pageArgs(q),
    });
    const res = pageResult(rows, q);
    const ids = [...new Set(res.data.map((r) => r.actorId).filter((x): x is string => !!x))];
    const users = await this.prisma.user.findMany({ where: { id: { in: ids }, organizationId: actor.organizationId }, select: { id: true, name: true } });
    const byId = new Map(users.map((u) => [u.id, u.name]));
    return ok(res.data.map((r) => ({ ...r, actorName: r.actorId ? byId.get(r.actorId) ?? null : null })), res.meta);
  }
}
