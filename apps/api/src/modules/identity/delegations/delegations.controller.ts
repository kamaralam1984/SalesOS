import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createDelegationSchema } from '@salesos/validation';
import type { z } from 'zod';
import { AccessService, CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { AuditService, AUDIT_ACTIONS } from '../../../common/audit/audit.service';
import { AppError, notFound } from '../../../common/http/errors';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { PrismaService } from '../../../common/prisma';

const MAX_DELEGATION_DAYS = 90;

/**
 * Time-boxed delegation: the delegate gains the delegator's TEAM scope (their subtree) until endsAt.
 * Without an explicit delegation a manager never sees a sibling team.
 */
@ApiTags('delegations')
@Controller('delegations')
export class DelegationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('users:delegation:manage')
  async list(@CurrentUser() user: Principal) {
    const where = await this.access.scopedWhere(user, { permission: 'users:delegation:manage', ownerField: 'delegatorId' });
    return this.prisma.delegation.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  @Post()
  @RequirePermission('users:delegation:manage')
  async create(@CurrentUser() user: Principal, @Body(new ZodPipe(createDelegationSchema)) body: z.infer<typeof createDelegationSchema>) {
    if (body.delegatorId === body.delegateId) throw new AppError('INVALID_DELEGATION', 'Delegator and delegate must differ', 400);
    const startsAt = body.startsAt ?? new Date();
    if (body.endsAt <= startsAt) throw new AppError('INVALID_DELEGATION', 'endsAt must be after startsAt', 400);
    if (body.endsAt.getTime() - startsAt.getTime() > MAX_DELEGATION_DAYS * 86_400_000) {
      throw new AppError('INVALID_DELEGATION', `Delegations are limited to ${MAX_DELEGATION_DAYS} days`, 400);
    }
    const users = await this.prisma.user.findMany({
      where: { id: { in: [body.delegatorId, body.delegateId] }, organizationId: user.organizationId, isActive: true },
    });
    if (users.length !== 2) throw new AppError('INVALID_DELEGATION', 'Users must be active members of your organization', 400);
    // No escalation: the delegator's subtree must lie inside the caller's own hierarchy (Founder: whole org).
    await this.access.assertRecordAccess(user, 'users:delegation:manage', { organizationId: user.organizationId, ownerId: body.delegatorId }, 'User');
    const visible = await this.access.visibleUsers(user);
    if (!user.roles.includes('FOUNDER_CEO') && !visible.ids.includes(body.delegatorId)) throw notFound('User');
    return this.prisma.$transaction(async (tx) => {
      const d = await tx.delegation.create({
        data: { organizationId: user.organizationId, delegatorId: body.delegatorId, delegateId: body.delegateId, createdById: user.userId, startsAt, endsAt: body.endsAt },
      });
      await this.audit.recordTx(tx, {
        organizationId: user.organizationId,
        actorId: user.userId,
        action: AUDIT_ACTIONS.DELEGATION_CREATED,
        entityType: 'delegation',
        entityId: d.id,
        metadata: { delegatorId: d.delegatorId, delegateId: d.delegateId, endsAt: d.endsAt },
      });
      return d;
    });
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermission('users:delegation:manage')
  async revoke(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const d = await this.prisma.delegation.findFirst({ where: { id, organizationId: user.organizationId } });
    await this.access.assertRecordAccess(user, 'users:delegation:manage', d ? { organizationId: d.organizationId, ownerId: d.delegatorId } : null, 'Delegation');
    if (!d) throw notFound('Delegation');
    await this.prisma.$transaction(async (tx) => {
      await tx.delegation.update({ where: { id }, data: { revokedAt: new Date() } });
      await this.audit.recordTx(tx, {
        organizationId: user.organizationId,
        actorId: user.userId,
        action: AUDIT_ACTIONS.DELEGATION_REVOKED,
        entityType: 'delegation',
        entityId: id,
      });
    });
    return { revoked: true };
  }
}
