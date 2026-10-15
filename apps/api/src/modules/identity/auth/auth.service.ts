import { Inject, Injectable } from '@nestjs/common';
import type { MeResponse } from '@salesos/shared-types';
import { passwordWeakness } from '@salesos/validation';

import { APP_ENV } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import { PrismaService } from '../../../common/prisma';
import { AuditService, AUDIT_ACTIONS } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { SessionService, newOpaqueToken, sha256 } from '../../../common/authz/session.service';
import { EMAIL_PROVIDER, type EmailProvider } from '../../../common/outbox/email.provider';
import { AppError } from '../../../common/http/errors';
import { PasswordService } from '../password.service';
import { userInclude, toUserDto } from '../dto';

export const INVALID_CREDENTIALS = () => new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
const INVALID_TOKEN = () => new AppError('INVALID_TOKEN', 'This link is invalid, expired or already used', 400);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  async login(email: string, password: string, meta: { ip?: string; userAgent?: string; presentedToken?: string }) {
    const user = await this.prisma.user.findUnique({ where: { email }, include: userInclude });
    if (!user || !user.passwordHash) {
      await this.passwords.verifyDummy(password);
      // Unknown account: no org to attach an audit row to; the structured log + throttler cover it.
      throw INVALID_CREDENTIALS();
    }
    const now = new Date();
    const locked = !!user.lockedUntil && user.lockedUntil > now;
    const passwordOk = await this.passwords.verify(user.passwordHash, password);

    if (locked || !user.isActive || !passwordOk) {
      const reason = locked ? 'locked' : !user.isActive ? 'inactive' : 'bad_password';
      await this.recordFailure(user, reason, locked || !user.isActive);
      throw INVALID_CREDENTIALS();
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });
    // Session fixation hygiene: a session cookie presented with the login request is revoked; the new session gets a fresh id/token/family.
    if (meta.presentedToken) await this.sessions.revokeByToken(meta.presentedToken, 'superseded_by_login');
    const { token, session, csrfToken } = await this.sessions.create(user, meta);
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: AUDIT_ACTIONS.LOGIN_SUCCESS,
      entityType: 'session',
      entityId: session.id,
    });
    return { user: toUserDto(user), token, csrfToken, absoluteExpiresAt: session.absoluteExpiresAt };
  }

  private async recordFailure(
    user: { id: string; organizationId: string; failedLoginCount: number },
    reason: string,
    skipCounter: boolean,
  ) {
    let lockedNow = false;
    if (!skipCounter) {
      // Atomic increment so concurrent guesses cannot dodge the counter.
      const updated = await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: { increment: 1 } },
        select: { failedLoginCount: true },
      });
      if (updated.failedLoginCount >= this.env.LOGIN_MAX_ATTEMPTS) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + this.env.LOGIN_LOCKOUT_MINUTES * 60_000) },
        });
        lockedNow = true;
      }
    }
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      entityType: 'user',
      entityId: user.id,
      metadata: { reason },
    });
    if (lockedNow) {
      await this.audit.record({
        organizationId: user.organizationId,
        actorId: user.id,
        action: AUDIT_ACTIONS.LOCKOUT,
        entityType: 'user',
        entityId: user.id,
        metadata: { minutes: this.env.LOGIN_LOCKOUT_MINUTES },
      });
    }
  }

  async logout(p: Principal, token: string | undefined) {
    // Revoke the whole family (current + grace-period rotated tokens).
    await this.prisma.session.updateMany({
      where: { userId: p.userId, revokedAt: null, familyId: p.sessionFamilyId },
      data: { revokedAt: new Date(), revokedReason: 'logout' },
    });
    if (token) await this.sessions.revokeByToken(token);
    await this.audit.record({
      organizationId: p.organizationId,
      actorId: p.userId,
      action: AUDIT_ACTIONS.LOGOUT,
      entityType: 'session',
      entityId: p.sessionId,
    });
  }

  csrf(p: Principal) {
    return { csrfToken: this.sessions.csrfTokenFor(p.sessionFamilyId) };
  }

  async revokeOtherSessions(p: Principal): Promise<number> {
    const res = await this.prisma.session.updateMany({
      where: { userId: p.userId, revokedAt: null, familyId: { not: p.sessionFamilyId } },
      data: { revokedAt: new Date(), revokedReason: 'revoked_by_user' },
    });
    await this.audit.record({
      organizationId: p.organizationId,
      actorId: p.userId,
      action: 'auth.sessions_revoked',
      entityType: 'user',
      entityId: p.userId,
      metadata: { count: res.count },
    });
    return res.count;
  }

  async me(p: Principal): Promise<MeResponse> {
    const [user, visible, session] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: p.userId }, include: userInclude }),
      this.access.visibleUsers(p),
      this.prisma.session.findUniqueOrThrow({ where: { id: p.sessionId } }),
    ]);
    const dto = toUserDto(user);
    return {
      user: { id: dto.id, organizationId: dto.organizationId, email: dto.email, name: dto.name, isActive: dto.isActive, managerId: dto.managerId, roles: dto.roles },
      permissions: [...p.permissions.entries()].map(([key, scope]) => ({ key, scope })).sort((a, b) => a.key.localeCompare(b.key)),
      scope: {
        organizationId: p.organizationId,
        teamIds: visible.teamIds,
        directReportCount: visible.directReports,
        visibleUserCount: visible.ids.length,
        delegatedFromUserIds: visible.delegatedFrom,
      },
      csrfToken: this.sessions.csrfTokenFor(p.sessionFamilyId),
      session: { expiresAt: session.absoluteExpiresAt.toISOString(), idleExpiresAt: session.idleExpiresAt.toISOString() },
    };
  }

  /**
   * Always resolves with the same answer AND (approximately) the same latency: both branches burn one argon2 verify and the
   * whole call is padded to a floor, so neither the body nor the response time reveals whether the email has an account.
   */
  async forgotPassword(email: string) {
    const started = Date.now();
    const user = await this.prisma.user.findUnique({ where: { email } });
    await this.passwords.verifyDummy('x'); // same CPU burn on both paths
    if (user && user.isActive) {
      await this.issueToken(user, 'PASSWORD_RESET');
      await this.audit.record({
        organizationId: user.organizationId,
        actorId: user.id,
        action: AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED,
        entityType: 'user',
        entityId: user.id,
      });
    }
    const floor = Number(process.env.FORGOT_PASSWORD_MIN_MS ?? 400);
    const wait = floor - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  /** Creates a hashed single-use token and hands the raw link to the email provider (via outbox). */
  async issueToken(user: { id: string; email: string; organizationId: string }, purpose: 'PASSWORD_RESET' | 'INVITE', tx?: Parameters<EmailProvider['send']>[0], opts: { sendEmail?: boolean } = {}) {
    const sendEmail = opts.sendEmail ?? true;
    const run = async (client: Parameters<EmailProvider['send']>[0]) => {
      await client.authToken.updateMany({
        where: { userId: user.id, purpose, usedAt: null },
        data: { usedAt: new Date() }, // invalidate older outstanding tokens
      });
      const raw = newOpaqueToken();
      const ttlMs = purpose === 'INVITE' ? this.env.INVITE_TOKEN_TTL_HOURS * 3_600_000 : this.env.RESET_TOKEN_TTL_MINUTES * 60_000;
      await client.authToken.create({
        data: { userId: user.id, purpose, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + ttlMs) },
      });
      const path = purpose === 'INVITE' ? 'invite/accept' : 'reset-password';
      const link = `${this.env.APP_BASE_URL}/${path}?token=${raw}`;
      const expiresAt = new Date(Date.now() + ttlMs);
      if (sendEmail) await this.email.send(client, {
        organizationId: user.organizationId,
        userId: user.id,
        to: user.email,
        template: purpose === 'INVITE' ? 'invite' : 'password_reset',
        variables: { link },
      });
      return { link, expiresAt };
    };
    if (tx) return run(tx);
    return this.prisma.$transaction(run);
  }

  async consumeToken(rawToken: string, newPassword: string, purpose: 'PASSWORD_RESET' | 'INVITE') {
    const tokenHash = sha256(rawToken);
    const hash = await this.passwords.hash(newPassword);
    const userId = await this.prisma.$transaction(async (tx) => {
      // Atomic single use: only one concurrent request can flip usedAt from null.
      const claimed = await tx.authToken.updateMany({
        where: { tokenHash, purpose, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw INVALID_TOKEN();
      const token = await tx.authToken.findUniqueOrThrow({ where: { tokenHash } });
      const user = await tx.user.findUniqueOrThrow({ where: { id: token.userId } });
      if (!user.isActive) throw INVALID_TOKEN();
      const weak = passwordWeakness(newPassword, [user.email.split('@')[0]!, user.name]);
      if (weak) throw new AppError('WEAK_PASSWORD', weak, 400);
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: hash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
      });
      await this.sessions.revokeAllForUser(user.id, purpose === 'INVITE' ? 'invite_accepted' : 'password_reset', tx);
      await this.audit.recordTx(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: purpose === 'INVITE' ? AUDIT_ACTIONS.INVITE_ACCEPTED : AUDIT_ACTIONS.PASSWORD_RESET_COMPLETED,
        entityType: 'user',
        entityId: user.id,
      });
      return user.id;
    });
    return { userId };
  }
}

