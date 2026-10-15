import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CrmError, type CoreDeps } from '@salesos/crm-core';
import { PLATFORM_EVENTS, type NotifyRequest, type CreditedOwner } from '@salesos/shared-types';
import { AccessService, type Principal } from '../../common/authz';
import { AuditService } from '../../common/audit/audit.service';
import { AppError, notFound } from '../../common/http/errors';
import { OutboxService, type OutboxEventInput } from '../../common/outbox/outbox.service';
import { PrismaService, type Tx } from '../../common/prisma';
import { D, money, type Dec } from './calc';

export const REVENUE_DEPS = Symbol('REVENUE_DEPS');
/** Test seam: invoked between the steps of the deal-close transaction. Production binding is a no-op. */
export const REVENUE_FAULT_INJECTOR = Symbol('REVENUE_FAULT_INJECTOR');
export type CloseStep = 'after_lead_transition' | 'after_sales_record' | 'after_payments' | 'after_tasks';
export type FaultInjector = (step: CloseStep) => void | Promise<void>;
export const faultInjectorProvider = { provide: REVENUE_FAULT_INJECTOR, useValue: (() => undefined) as FaultInjector };

export const depsFactory = {
  provide: REVENUE_DEPS,
  inject: [AuditService, OutboxService],
  useFactory: (audit: AuditService, outbox: OutboxService): CoreDeps => ({
    audit: (tx, e) => audit.recordTx(tx, e),
    publish: (tx, e) => outbox.publish(tx, e),
  }),
};

/** Roles ordered by authority for recording "the role the actor acted in". */
const ROLE_ORDER = ['FOUNDER_CEO', 'SALES_TEAM_LEAD', 'FINANCE', 'SALES_MANAGER', 'STUDENT_SUCCESS', 'SALES_EXECUTIVE', 'MARKETING', 'COMMUNITY', 'HR', 'ADMIN'];
export const primaryRole = (p: Principal): string | null => ROLE_ORDER.find((r) => (p.roles as string[]).includes(r)) ?? (p.roles[0] as string | undefined) ?? null;
export const hasRole = (p: Principal, ...roles: string[]) => roles.some((r) => (p.roles as string[]).includes(r));

export const isUniqueViolation = (e: unknown): e is Prisma.PrismaClientKnownRequestError => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
export const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
export const dateOnly = (s: string) => new Date(`${s}T00:00:00.000Z`);

@Injectable()
export class RevenueSupport {
  constructor(
    readonly prisma: PrismaService,
    readonly access: AccessService,
    readonly audit: AuditService,
    readonly outbox: OutboxService,
    @Inject(REVENUE_DEPS) readonly deps: CoreDeps,
  ) {}

  /** Map crm-core domain errors (lead transitions) to API errors with the same code/status. */
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

  /** Row lock held until the surrounding transaction ends (serialises money-affecting changes per deal). */
  async lockDeal(tx: Tx, organizationId: string, dealId: string) {
    await tx.$queryRaw`SELECT id FROM deals WHERE id = ${dealId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
    const deal = await tx.deal.findFirst({ where: { id: dealId, organizationId } });
    if (!deal) throw notFound('Deal');
    return deal;
  }

  async lockTarget(tx: Tx, organizationId: string, targetId: string) {
    await tx.$queryRaw`SELECT id FROM targets WHERE id = ${targetId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
    const t = await tx.target.findFirst({ where: { id: targetId, organizationId } });
    if (!t) throw notFound('Target');
    return t;
  }

  async settings(db: Pick<PrismaService, 'revenueSettings'> | Tx, organizationId: string) {
    const existing = await db.revenueSettings.findUnique({ where: { organizationId } });
    if (existing) return existing;
    await db.revenueSettings.createMany({ data: [{ organizationId }], skipDuplicates: true });
    return db.revenueSettings.findUniqueOrThrow({ where: { organizationId } });
  }

  async userNames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    if (!uniq.length) return new Map();
    const rows = await this.prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** Active users of the org holding any of the roles. */
  async usersWithRoles(organizationId: string, roles: string[], db: Pick<PrismaService, 'user'> | Tx = this.prisma): Promise<string[]> {
    const rows = await db.user.findMany({ where: { organizationId, isActive: true, roleAssignments: { some: { role: { key: { in: roles } } } } }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  async teamOf(tx: Pick<PrismaService, 'teamMembership'> | Tx, userId: string): Promise<string | null> {
    const m = await tx.teamMembership.findFirst({ where: { userId }, select: { teamId: true }, orderBy: { teamId: 'asc' } });
    return m?.teamId ?? null;
  }

  /** The target user must be an ACTIVE user of the caller's organisation (cross-org is a 404) and inside the caller's scope. */
  async assertUserInScope(actor: Principal, permission: Parameters<AccessService['scopeLevel']>[1], targetUserId: string, opts: { requireActive?: boolean } = {}) {
    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, organizationId: actor.organizationId },
      select: { id: true, name: true, isActive: true, managerId: true, roleAssignments: { select: { role: { select: { key: true } } } } },
    });
    if (!target) throw notFound('User');
    if (opts.requireActive !== false && !target.isActive) throw new AppError('TARGET_INACTIVE', 'The selected user is deactivated', 422);
    const level = this.access.scopeLevel(actor, permission);
    if (level === 'own' && target.id !== actor.userId) throw notFound('User');
    if (level === 'team') {
      const v = await this.access.visibleUsers(actor);
      if (!v.ids.includes(target.id)) throw notFound('User');
    }
    return { ...target, roles: target.roleAssignments.map((r) => r.role.key) };
  }

  /** All users under `userId` (manager_id subtree) plus members of teams they lead, incl. the user. */
  async subtreeUserIds(organizationId: string, userId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE sub(id) AS (
        SELECT id FROM users WHERE manager_id = ${userId}::uuid AND organization_id = ${organizationId}::uuid
        UNION
        SELECT u.id FROM users u JOIN sub s ON u.manager_id = s.id WHERE u.organization_id = ${organizationId}::uuid
      ) SELECT id::text FROM sub`;
    const ids = new Set<string>([userId, ...rows.map((r) => r.id)]);
    const led = await this.prisma.teamMembership.findMany({
      where: { team: { organizationId, OR: [{ leadUserId: userId }] } },
      select: { userId: true },
    });
    led.forEach((m) => ids.add(m.userId));
    return [...ids];
  }

  /** DEC-005 credit split of a booked sale. */
  async creditedOwners(db: Pick<PrismaService, 'salesCredit' | 'salesRecord'> | Tx, dealId: string): Promise<CreditedOwner[]> {
    const rec = await db.salesRecord.findUnique({ where: { dealId }, select: { credits: { select: { userId: true, sharePct: true } } } });
    return (rec?.credits ?? []).map((c) => ({ userId: c.userId, sharePct: money(c.sharePct) }));
  }

  /** Fire a platform notification through the outbox (delivered by the platform worker, deduplicated by dedupeKey). */
  async notify(tx: Tx, req: NotifyRequest): Promise<void> {
    const input: OutboxEventInput = {
      eventType: PLATFORM_EVENTS.NOTIFICATION_REQUESTED,
      aggregateType: req.entity?.type ?? 'revenue',
      aggregateId: req.entity?.id ?? req.organizationId,
      organizationId: req.organizationId,
      payload: req as unknown as Record<string, unknown>,
      idempotencyKey: `notify:${req.dedupeKey}`,
    };
    await this.outbox.publish(tx, input);
  }

  async publish(tx: Tx, e: OutboxEventInput) {
    return this.outbox.publish(tx, e);
  }
}

export const dec = (v: Prisma.Decimal | string | null | undefined): Dec => D(v);
export const recordAccess = (r: { organizationId: string; ownerId: string; teamId: string | null }) => ({ organizationId: r.organizationId, ownerId: r.ownerId, teamId: r.teamId });
