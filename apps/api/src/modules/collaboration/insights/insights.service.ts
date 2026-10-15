import { Injectable } from '@nestjs/common';
import { emitCx } from '@salesos/cx-core';
import { CX_EVENTS } from '@salesos/shared-types';
import type { createInsightSchema, listInsightsQuerySchema } from '@salesos/validation';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import type { Principal } from '../../../common/authz';
import { AppError } from '../../../common/http/errors';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService } from '../../../common/prisma';
import { userNameMap, withData } from '../../cx/common/support';
import { assertNoPii, departmentsOf, isLeadership } from '../collab-support';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;

/** Learner / market insights shared with other functions with the MINIMUM data: themes and counts, never names or contact details. */
@Injectable()
export class InsightsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async create(user: Principal, dto: Dto<typeof createInsightSchema>) {
    assertNoPii({ texts: [dto.title, dto.body, ...dto.tags] }, 'This insight');
    if (dto.programId) {
      const n = await this.prisma.program.count({ where: { id: dto.programId, organizationId: user.organizationId } });
      if (!n) throw new AppError('INVALID_REFERENCE', 'Program not found', 422);
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.insight.create({ data: { organizationId: user.organizationId, authorId: user.userId, kind: dto.kind, title: dto.title, body: dto.body, programId: dto.programId ?? null, tags: dto.tags, audience: dto.audience } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'insight.shared', entityType: 'insight', entityId: r.id, metadata: { audience: dto.audience, kind: dto.kind } });
      await emitCx(tx, { organizationId: user.organizationId, eventType: CX_EVENTS.INSIGHT_SHARED, aggregateType: 'insight', aggregateId: r.id, key: `insight.shared:${r.id}`, payload: { organizationId: user.organizationId, insightId: r.id, audience: dto.audience } });
      return r;
    });
    return { id: row.id, kind: row.kind, title: row.title, body: row.body, tags: row.tags, audience: row.audience, programId: row.programId, authorName: user.name, createdAt: row.createdAt };
  }

  async list(user: Principal, q: Dto<typeof listInsightsQuerySchema>) {
    const mine = departmentsOf(user);
    const where = {
      organizationId: user.organizationId,
      ...(q.kind ? { kind: q.kind } : {}),
      ...(isLeadership(user) ? {} : { OR: [{ authorId: user.userId }, { audience: { hasSome: mine } }] }),
    };
    const rows = await this.prisma.insight.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const names = await userNameMap(this.prisma, user.organizationId, res.data.map((r) => r.authorId));
    return withData(res, res.data.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, tags: r.tags, audience: r.audience, programId: r.programId, authorName: names.get(r.authorId) ?? null, createdAt: r.createdAt })));
  }
}
