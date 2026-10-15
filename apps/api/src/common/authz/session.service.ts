import { Inject, Injectable } from '@nestjs/common';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { RoleKey } from '@salesos/shared-types';
import { APP_ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService } from '../prisma';
import type { Principal } from './principal';
import { PermissionResolver } from './principal.loader';

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
export const newOpaqueToken = () => randomBytes(32).toString('base64url');

export interface AuthenticatedSession {
  principal: Principal;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  /** set when the session was rotated on this request; caller must set the cookie */
  rotatedToken?: string;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PermissionResolver,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  csrfTokenFor(familyId: string): string {
    return createHmac('sha256', this.env.SESSION_SECRET).update(`csrf:${familyId}`).digest('hex');
  }

  verifyCsrf(familyId: string, presented: string | undefined): boolean {
    if (!presented) return false;
    const a = Buffer.from(this.csrfTokenFor(familyId));
    const b = Buffer.from(presented);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private expiries(idleMinutes: number, createdAt = new Date()) {
    return {
      idleExpiresAt: new Date(Date.now() + idleMinutes * 60_000),
      absoluteExpiresAt: new Date(createdAt.getTime() + this.env.SESSION_ABSOLUTE_HOURS * 3_600_000),
    };
  }

  async create(user: { id: string; organizationId: string }, meta: { ip?: string; userAgent?: string }) {
    const token = newOpaqueToken();
    const familyId = randomUUID();
    const idle = await this.idleMinutes(user.organizationId);
    const session = await this.prisma.session.create({
      data: {
        id: familyId,
        familyId,
        organizationId: user.organizationId,
        userId: user.id,
        tokenHash: sha256(token),
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 300),
        ...this.expiries(idle),
      },
    });
    return { token, session, csrfToken: this.csrfTokenFor(familyId) };
  }

  private async idleMinutes(organizationId: string): Promise<number> {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } });
    const v = (org?.settings as { sessionIdleMinutes?: number } | null)?.sessionIdleMinutes;
    return typeof v === 'number' && v > 0 ? v : this.env.SESSION_IDLE_MINUTES;
  }

  /** Validates an opaque token. Returns null for unknown/expired/revoked sessions or inactive users. */
  async authenticate(token: string): Promise<AuthenticatedSession | null> {
    const now = new Date();
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: { include: { roleAssignments: { include: { role: true } } } } },
    });
    if (!session || session.revokedAt) return null;
    if (session.idleExpiresAt <= now || session.absoluteExpiresAt <= now) return null;
    const user = session.user;
    if (!user.isActive || user.organizationId !== session.organizationId) return null;

    const roles = user.roleAssignments.map((a) => a.role.key as RoleKey);
    const principal: Principal = {
      userId: user.id,
      organizationId: user.organizationId,
      email: user.email,
      name: user.name,
      managerId: user.managerId,
      roles,
      permissions: this.resolver.effective(roles),
      sessionId: session.id,
      sessionFamilyId: session.familyId,
    };

    let { idleExpiresAt } = session;
    const idle = await this.idleMinutes(session.organizationId);
    let rotatedToken: string | undefined;

    const rotateAfter = session.rotatedAt.getTime() + this.env.SESSION_ROTATE_MINUTES * 60_000;
    if (now.getTime() >= rotateAfter) {
      rotatedToken = newOpaqueToken();
      idleExpiresAt = new Date(Date.now() + idle * 60_000);
      const graceEnd = new Date(Date.now() + 60_000);
      await this.prisma.$transaction([
        this.prisma.session.create({
          data: {
            organizationId: session.organizationId,
            userId: session.userId,
            familyId: session.familyId,
            rotatedFromId: session.id,
            tokenHash: sha256(rotatedToken),
            ip: session.ip,
            userAgent: session.userAgent,
            createdAt: session.createdAt,
            idleExpiresAt,
            absoluteExpiresAt: session.absoluteExpiresAt,
          },
        }),
        // Old token stays valid for 60s so parallel in-flight requests do not log the user out.
        this.prisma.session.update({
          where: { id: session.id },
          data: { rotatedAt: now, idleExpiresAt: graceEnd < session.idleExpiresAt ? graceEnd : session.idleExpiresAt },
        }),
      ]);
    } else if (now.getTime() - session.lastSeenAt.getTime() > 60_000) {
      idleExpiresAt = new Date(Date.now() + idle * 60_000);
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now, idleExpiresAt } });
    }
    return { principal, idleExpiresAt, absoluteExpiresAt: session.absoluteExpiresAt, rotatedToken };
  }

  /**
   * Long-lived connections (SSE) resolve the principal once; this re-checks, per tick, that the session family is not revoked or
   * expired, the user is still active and the role set is unchanged, so logout / deactivation / role changes cut a stream within
   * one poll interval instead of at its max lifetime.
   */
  async stillValid(p: Pick<Principal, 'sessionFamilyId' | 'userId' | 'roles'>): Promise<boolean> {
    const s = await this.prisma.session.findFirst({
      where: { familyId: p.sessionFamilyId, userId: p.userId, revokedAt: null, absoluteExpiresAt: { gt: new Date() } },
      select: { user: { select: { isActive: true, roleAssignments: { select: { role: { select: { key: true } } } } } } },
    });
    if (!s || !s.user.isActive) return false;
    const now = s.user.roleAssignments.map((a) => a.role.key).sort().join(',');
    return now === [...p.roles].sort().join(',');
  }

  revokeByToken(token: string, reason = 'logout') {
    return this.prisma.session.updateMany({
      where: { tokenHash: sha256(token), revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** Revoke every session in the user's family chain(s). Accepts a tx client. */
  revokeAllForUser(userId: string, reason: string, client: Pick<PrismaService, 'session'> = this.prisma) {
    return client.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }
}
