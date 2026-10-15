import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { paginationQuerySchema } from '@salesos/validation';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ok } from '../../../common/http/api-result';
import { notFound } from '../../../common/http/errors';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { CrmSupport } from '../crm.support';

/** Dead-letter view over the transactional outbox (rows that exhausted retries are status=DEAD). */
@ApiTags('platform: dead-letter jobs')
@Controller('jobs/dlq')
export class DlqController {
  constructor(private readonly s: CrmSupport) {}

  @Get()
  @RequirePermission('jobs:dlq:view')
  async list(@CurrentUser() u: Principal, @Query(new ZodPipe(paginationQuerySchema)) q: { limit?: number; cursor?: string; page?: number }) {
    const rows = await this.s.prisma.outboxEvent.findMany({ where: { organizationId: u.organizationId, status: 'DEAD' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    return ok((res.data as typeof rows).map((r) => ({ id: r.id, eventType: r.eventType, aggregateType: r.aggregateType, aggregateId: r.aggregateId, attempts: r.attempts, lastError: r.lastError, createdAt: r.createdAt.toISOString() })), res.meta);
  }

  @Post(':id/retry')
  @HttpCode(200)
  @RequirePermission('jobs:dlq:retry')
  async retry(@CurrentUser() u: Principal, @Param('id', new ParseUUIDPipe()) id: string) {
    const res = await this.s.prisma.$transaction(async (tx) => {
      const r = await tx.outboxEvent.updateMany({ where: { id, organizationId: u.organizationId, status: 'DEAD' }, data: { status: 'PENDING', attempts: 0, availableAt: new Date(), lastError: null } });
      if (r.count) await this.s.deps.audit(tx, { organizationId: u.organizationId, actorId: u.userId, action: 'dlq.retried', entityType: 'outbox_event', entityId: id });
      return r;
    });
    if (!res.count) throw notFound('Dead-letter job');
    return { id, requeued: true };
  }
}
