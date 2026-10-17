import { Injectable } from '@nestjs/common';
import { SENSITIVE_ROLE_KEYS, type RoleKey } from '@salesos/shared-types';
import { AuditService, AUDIT_ACTIONS } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { AppError, conflict, forbidden, notFound } from '../../../common/http/errors';
import { PrismaService } from '../../../common/prisma';
import { AuthService } from '../auth/auth.service';
import { userInclude } from '../dto';

/** Roles that only the Founder or the Developer may approve or reset: HR must not be able to take over a leadership, finance or admin account. */
const LEADERSHIP: readonly RoleKey[] = [...SENSITIVE_ROLE_KEYS, 'ADMIN'];

/**
 * Who may let a new account in and who may hand out password-reset links: HR, the Founder (CEO) and the Developer.
 * A new account is created PENDING and cannot log in, get an invite link or accept one until somebody other than its creator approves it.
 * There is no e-mail, so links are returned to the approver ONCE (never stored in clear text) and handed to the person.
 */
@Injectable()
export class AccountAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  /** HR may deal with ordinary employee accounts; leadership accounts need the Founder; the Developer account only the Developer. */
  private assertMayHandle(actor: Principal, roles: readonly RoleKey[]) {
    const isDeveloper = this.access.has(actor, 'devpanel:access');
    if (roles.includes('DEVELOPER') && !isDeveloper) throw forbidden('Only the Developer can handle a Developer account');
    if (roles.some((r) => LEADERSHIP.includes(r)) && !isDeveloper && !this.access.has(actor, 'users:role:assign-sensitive')) {
      throw forbidden('Only the Founder or the Developer can handle Founder, HR, Finance or Admin accounts');
    }
  }

  private async loadAccount(actor: Principal, id: string) {
    const u = await this.prisma.user.findFirst({ where: { id, organizationId: actor.organizationId }, include: userInclude });
    if (!u) throw notFound('User');
    return u;
  }

  // ---------------------------------------------------------------- approval
  async pending(actor: Principal) {
    const rows = await this.prisma.user.findMany({
      where: { organizationId: actor.organizationId, approvalStatus: 'PENDING' },
      include: { ...userInclude, createdBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    const others = await this.hasOtherApprover(actor.organizationId, actor.userId);
    return rows.map((u) => ({
      id: u.id, name: u.name, email: u.email, department: u.department, roles: u.roleAssignments.map((a) => a.role.key as RoleKey),
      createdAt: u.createdAt, createdById: u.createdById, createdByName: u.createdBy?.name ?? null,
      /** the creator cannot approve their own account while another approver exists */
      canApprove: (u.createdById !== actor.userId || !others) && this.mayHandle(actor, u.roleAssignments.map((a) => a.role.key as RoleKey)),
    }));
  }

  /**
   * "Someone else must approve" only holds while someone else exists. When the actor is the organisation's only active approver (HR, Founder or
   * Developer account) they may approve their own creation, so a single-owner company is never locked out; the audit row says so.
   */
  private async hasOtherApprover(organizationId: string, actorId: string): Promise<boolean> {
    const n = await this.prisma.user.count({
      where: { organizationId, id: { not: actorId }, isActive: true, approvalStatus: 'APPROVED', roleAssignments: { some: { role: { key: { in: ['FOUNDER_CEO', 'HR', 'DEVELOPER'] } } } } },
    });
    return n > 0;
  }

  private mayHandle(actor: Principal, roles: readonly RoleKey[]): boolean {
    try { this.assertMayHandle(actor, roles); return true; } catch { return false; }
  }

  async approve(actor: Principal, id: string) {
    const target = await this.loadAccount(actor, id);
    if (target.approvalStatus !== 'PENDING') throw conflict('NOT_PENDING', 'This account is not waiting for approval');
    const selfApproved = target.createdById === actor.userId;
    if (selfApproved && (await this.hasOtherApprover(actor.organizationId, actor.userId))) {
      throw new AppError('SELF_APPROVAL', 'Someone other than the person who created the account must approve it', 403);
    }
    this.assertMayHandle(actor, target.roleAssignments.map((a) => a.role.key as RoleKey));
    const invite = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.user.updateMany({
        where: { id, organizationId: actor.organizationId, approvalStatus: 'PENDING' },
        data: { approvalStatus: 'APPROVED', approvedById: actor.userId, approvedAt: new Date(), isActive: true },
      });
      if (claimed.count !== 1) throw conflict('NOT_PENDING', 'This account is not waiting for approval');
      const issued = await this.auth.issueToken(target, 'INVITE', tx, { sendEmail: false });
      await this.audit.recordTx(tx, { organizationId: actor.organizationId, actorId: actor.userId, action: AUDIT_ACTIONS.USER_APPROVED, entityType: 'user', entityId: id, metadata: { createdById: target.createdById, selfApproved, roles: target.roleAssignments.map((a) => a.role.key) } });
      return issued;
    });
    return { id, approvalStatus: 'APPROVED' as const, invite: { link: invite.link, expiresAt: invite.expiresAt } };
  }

  async reject(actor: Principal, id: string, reason?: string) {
    const target = await this.loadAccount(actor, id);
    if (target.approvalStatus !== 'PENDING') throw conflict('NOT_PENDING', 'This account is not waiting for approval');
    this.assertMayHandle(actor, target.roleAssignments.map((a) => a.role.key as RoleKey));
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.user.updateMany({
        where: { id, organizationId: actor.organizationId, approvalStatus: 'PENDING' },
        data: { approvalStatus: 'REJECTED', isActive: false, deactivatedAt: new Date(), approvedById: actor.userId, approvedAt: new Date(), approvalNote: reason?.trim() || null },
      });
      if (claimed.count !== 1) throw conflict('NOT_PENDING', 'This account is not waiting for approval');
      await this.audit.recordTx(tx, { organizationId: actor.organizationId, actorId: actor.userId, action: AUDIT_ACTIONS.USER_REJECTED, entityType: 'user', entityId: id, metadata: { reason: reason ?? null } });
    });
    return { id, approvalStatus: 'REJECTED' as const };
  }

  /** A fresh invite link for an approved person who has not set a password yet. Any approver may re-issue it (not only the creator). */
  async reissueInvite(actor: Principal, id: string) {
    const target = await this.loadAccount(actor, id);
    if (target.approvalStatus !== 'APPROVED') throw conflict('NOT_APPROVED', 'The account must be approved first');
    if (!target.isActive) throw conflict('USER_INACTIVE', 'User is deactivated');
    if (target.passwordHash) throw conflict('ALREADY_ACCEPTED', 'This user has already set a password; use a password reset link instead');
    this.assertMayHandle(actor, target.roleAssignments.map((a) => a.role.key as RoleKey));
    const issued = await this.prisma.$transaction(async (tx) => {
      const r = await this.auth.issueToken(target, 'INVITE', tx, { sendEmail: false });
      await this.audit.recordTx(tx, { organizationId: actor.organizationId, actorId: actor.userId, action: AUDIT_ACTIONS.INVITE_LINK_ISSUED, entityType: 'user', entityId: id, metadata: { expiresAt: r.expiresAt } });
      return r;
    });
    return { link: issued.link, expiresAt: issued.expiresAt };
  }

  // ---------------------------------------------------------------- password reset
  async resetRequests(actor: Principal) {
    const rows = await this.prisma.passwordResetRequest.findMany({
      where: { organizationId: actor.organizationId, status: 'PENDING' },
      include: { user: { include: userInclude } },
      orderBy: { requestedAt: 'asc' },
      take: 200,
    });
    return rows.map((r) => {
      const roles = r.user.roleAssignments.map((a) => a.role.key as RoleKey);
      return { id: r.id, userId: r.userId, name: r.user.name, email: r.user.email, roles, requestedAt: r.requestedAt, canIssue: this.mayHandle(actor, roles) };
    });
  }

  private async issueResetLink(actor: Principal, userId: string, requestId?: string) {
    const target = await this.loadAccount(actor, userId);
    if (target.approvalStatus !== 'APPROVED' || !target.isActive) throw conflict('USER_INACTIVE', 'The account is not active');
    this.assertMayHandle(actor, target.roleAssignments.map((a) => a.role.key as RoleKey));
    const issued = await this.prisma.$transaction(async (tx) => {
      const r = await this.auth.issueToken(target, 'PASSWORD_RESET', tx, { sendEmail: false });
      await tx.passwordResetRequest.updateMany({
        where: requestId ? { id: requestId } : { userId, status: 'PENDING' },
        data: { status: 'ISSUED', handledById: actor.userId, handledAt: new Date() },
      });
      await this.audit.recordTx(tx, { organizationId: actor.organizationId, actorId: actor.userId, action: AUDIT_ACTIONS.RESET_LINK_ISSUED, entityType: 'user', entityId: userId, metadata: { requestId: requestId ?? null, expiresAt: r.expiresAt } });
      return r;
    });
    return { userId, name: target.name, email: target.email, link: issued.link, expiresAt: issued.expiresAt };
  }

  async issueFromRequest(actor: Principal, requestId: string) {
    const req = await this.prisma.passwordResetRequest.findFirst({ where: { id: requestId, organizationId: actor.organizationId, status: 'PENDING' } });
    if (!req) throw notFound('Reset request');
    return this.issueResetLink(actor, req.userId, req.id);
  }

  /** An approver resets someone who did not (or could not) ask: looked up by e-mail inside the organisation. */
  async issueDirect(actor: Principal, email: string) {
    const u = await this.prisma.user.findFirst({ where: { organizationId: actor.organizationId, email: email.trim().toLowerCase() }, select: { id: true } });
    if (!u) throw notFound('User');
    return this.issueResetLink(actor, u.id);
  }

  async dismiss(actor: Principal, requestId: string) {
    const req = await this.prisma.passwordResetRequest.findFirst({ where: { id: requestId, organizationId: actor.organizationId, status: 'PENDING' } });
    if (!req) throw notFound('Reset request');
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetRequest.update({ where: { id: requestId }, data: { status: 'DISMISSED', handledById: actor.userId, handledAt: new Date() } });
      await this.audit.recordTx(tx, { organizationId: actor.organizationId, actorId: actor.userId, action: AUDIT_ACTIONS.RESET_REQUEST_DISMISSED, entityType: 'user', entityId: req.userId, metadata: { requestId } });
    });
    return { id: requestId, status: 'DISMISSED' as const };
  }
}
