import { Inject, Injectable } from '@nestjs/common';
import { CrmError, type CoreDeps, type Tx } from '@salesos/crm-core';
import { AccessService, type Principal, type PermissionKey } from '../../common/authz';
import { AuditService } from '../../common/audit/audit.service';
import { AppError, forbidden, notFound } from '../../common/http/errors';
import { OutboxService } from '../../common/outbox/outbox.service';
import { PrismaService } from '../../common/prisma';

export const CRM_DEPS = Symbol('CRM_DEPS');
/** Test seam: invoked between the steps of the disposition transaction. Production binding is a no-op. */
export const CRM_FAULT_INJECTOR = Symbol('CRM_FAULT_INJECTOR');
export type FaultInjector = (step: 'after_call_insert' | 'after_task_insert' | 'after_status_change') => void | Promise<void>;

export const crmDepsFactory = {
  provide: CRM_DEPS,
  inject: [AuditService, OutboxService],
  useFactory: (audit: AuditService, outbox: OutboxService): CoreDeps => ({
    audit: (tx, e) => audit.recordTx(tx, e),
    publish: (tx, e) => outbox.publish(tx, e),
  }),
};
export const faultInjectorProvider = { provide: CRM_FAULT_INJECTOR, useValue: (() => undefined) as FaultInjector };

const SALES_ROLES = ['FOUNDER_CEO', 'SALES_TEAM_LEAD', 'SALES_MANAGER', 'SALES_EXECUTIVE'];

@Injectable()
export class CrmSupport {
  constructor(
    readonly prisma: PrismaService,
    readonly access: AccessService,
    @Inject(CRM_DEPS) readonly deps: CoreDeps,
  ) {}

  /** Map crm-core domain errors to API errors (same code/status). */
  async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof CrmError) throw new AppError(e.code, e.message, e.status, e.details);
      throw e;
    }
  }

  tx<T>(fn: (tx: Tx) => Promise<T>, timeout = 20_000): Promise<T> {
    return this.guard(() => this.prisma.$transaction(fn, { timeout, maxWait: 10_000 }));
  }

  async userNames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    if (!uniq.length) return new Map();
    const rows = await this.prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /**
   * The target of an assignment must be an ACTIVE user of the caller's organization holding a sales role, and (when
   * the caller only has team scope for `permission`) inside the caller's visible hierarchy. Cross-org is always 404.
   */
  async assertAssignable(actor: Principal, permission: PermissionKey, targetUserId: string) {
    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, organizationId: actor.organizationId },
      select: { id: true, name: true, isActive: true, managerId: true, roleAssignments: { select: { role: { select: { key: true } } } } },
    });
    if (!target) throw notFound('User');
    if (!target.isActive) throw new AppError('TARGET_INACTIVE', 'The selected user is deactivated', 422);
    if (!target.roleAssignments.some((r) => SALES_ROLES.includes(r.role.key))) throw new AppError('TARGET_NOT_SALES', 'The selected user cannot own leads', 422);
    const level = this.access.scopeLevel(actor, permission);
    if (!level) throw forbidden();
    if (level === 'own') {
      if (target.id !== actor.userId) throw notFound('User');
    } else if (level === 'team') {
      const v = await this.access.visibleUsers(actor);
      if (!v.ids.includes(target.id)) throw notFound('User');
    }
    return target;
  }

  /** Manager of a user (users.manager_id), else the lead of one of their teams; null if none. */
  async managerOf(organizationId: string, userId: string, db: Pick<Tx, 'user' | 'teamMembership'> = this.prisma): Promise<string | null> {
    // Inside a transaction callers MUST pass the tx client: using the pool while a transaction holds a connection starves the pool
    // (P2024 / 500 once concurrent requests >= connection_limit; docs/performance-evidence-l3.md).
    const u = await db.user.findFirst({ where: { id: userId, organizationId }, select: { managerId: true } });
    if (u?.managerId) return u.managerId;
    const t = await db.teamMembership.findFirst({ where: { userId, team: { organizationId, leadUserId: { not: null } } }, select: { team: { select: { leadUserId: true } } } });
    return t?.team.leadUserId && t.team.leadUserId !== userId ? t.team.leadUserId : null;
  }
}

export const recordAccess = (l: { organizationId: string; assignedToId: string | null; teamId: string | null }) => ({
  organizationId: l.organizationId,
  ownerId: l.assignedToId,
  teamId: l.teamId,
});
export const taskAccess = (t: { organizationId: string; assignedToId: string; teamId: string | null }) => ({
  organizationId: t.organizationId,
  ownerId: t.assignedToId,
  teamId: t.teamId,
});

export const toIso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
