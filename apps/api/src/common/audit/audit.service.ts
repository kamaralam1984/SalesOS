import { Global, Injectable, Module } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService, type Tx } from '../prisma';
import { requestContext } from '../security/request-context';

export interface AuditEntry {
  organizationId: string;
  actorId?: string | null;
  /** dotted verb, e.g. 'user.roles_changed', 'auth.login_failed', 'export.created' */
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Well-known action names (domains may add their own strings). */
export const AUDIT_ACTIONS = {
  LOGIN_SUCCESS: 'auth.login_success',
  LOGIN_FAILED: 'auth.login_failed',
  LOCKOUT: 'auth.account_locked',
  LOGOUT: 'auth.logout',
  PASSWORD_RESET_REQUESTED: 'auth.password_reset_requested',
  PASSWORD_RESET_COMPLETED: 'auth.password_reset_completed',
  INVITE_ACCEPTED: 'auth.invite_accepted',
  INVITE_LINK_ISSUED: 'user.invite_link_issued',
  USER_APPROVED: 'user.approved',
  USER_REJECTED: 'user.rejected',
  RESET_LINK_ISSUED: 'user.password_reset_link_issued',
  RESET_REQUEST_DISMISSED: 'user.password_reset_request_dismissed',
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_DEACTIVATED: 'user.deactivated',
  USER_REACTIVATED: 'user.reactivated',
  ROLES_CHANGED: 'user.roles_changed',
  TEAM_CREATED: 'team.created',
  TEAM_MEMBER_ADDED: 'team.member_added',
  TEAM_MEMBER_REMOVED: 'team.member_removed',
  POLICY_CHANGED: 'org.settings_changed',
  DELEGATION_CREATED: 'delegation.created',
  DELEGATION_REVOKED: 'delegation.revoked',
  OWNERSHIP_CHANGED: 'ownership.changed',
  EXPORT_CREATED: 'export.created',
  DEVPANEL_ROLES_CHANGED: 'devpanel.roles_changed',
  DEVPANEL_FEATURES_CHANGED: 'devpanel.features_changed',
  DEVPANEL_FEATURES_RESET: 'devpanel.features_reset',
  DEVPANEL_SESSIONS_REVOKED: 'devpanel.sessions_revoked',
  DEVPANEL_FORCE_LOGOUT_ALL: 'devpanel.force_logout_all',
} as const;

/**
 * Append-only audit trail. A DB trigger blocks UPDATE/DELETE; this service only exposes create.
 * Use `recordTx` inside the same transaction as the business change whenever possible.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  private data(e: AuditEntry): Prisma.AuditLogUncheckedCreateInput {
    const ctx = requestContext.get();
    return {
      organizationId: e.organizationId,
      actorId: e.actorId ?? null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      metadata: (e.metadata ?? {}) as Prisma.InputJsonValue,
      ip: ctx.ip ?? null,
      requestId: ctx.requestId ?? null,
    };
  }

  async record(e: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({ data: this.data(e) });
  }

  async recordTx(tx: Tx, e: AuditEntry): Promise<void> {
    await tx.auditLog.create({ data: this.data(e) });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
