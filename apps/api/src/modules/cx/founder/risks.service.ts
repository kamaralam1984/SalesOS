import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { createRiskSchema, listRisksQuerySchema, updateRiskSchema } from '@salesos/validation';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import type { Principal } from '../../../common/authz';
import { AppError, notFound } from '../../../common/http/errors';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService } from '../../../common/prisma';
import { assertOrgUsers, userNameMap, withData } from '../common/support';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;

/** Issue / risk register: raise issues early WITH a proposed solution (JD-REPORT-003). */
@Injectable()
export class RisksService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private view(r: Prisma.RiskEntryGetPayload<object>, names: Map<string, string>) {
    return {
      id: r.id, title: r.title, description: r.description, severity: r.severity, status: r.status, proposedSolution: r.proposedSolution, hasSolution: !!r.proposedSolution?.trim(),
      earlyWarning: r.earlyWarning, ownerId: r.ownerId, ownerName: names.get(r.ownerId) ?? null, raisedByName: names.get(r.raisedById) ?? null, raisedAt: r.raisedAt,
      resolvedAt: r.resolvedAt, resolutionNote: r.resolutionNote, lastReportId: r.lastReportId, updatedAt: r.updatedAt,
    };
  }

  async list(user: Principal, q: Dto<typeof listRisksQuerySchema>) {
    const rows = await this.prisma.riskEntry.findMany({ where: { organizationId: user.organizationId, ...(q.status ? { status: q.status } : {}) }, orderBy: [{ severity: 'desc' }, { raisedAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const names = await userNameMap(this.prisma, user.organizationId, res.data.flatMap((r) => [r.ownerId, r.raisedById]));
    return withData(res, res.data.map((r) => this.view(r, names)));
  }

  async create(user: Principal, dto: Dto<typeof createRiskSchema>) {
    const ownerId = dto.ownerId ?? user.userId;
    await assertOrgUsers(this.prisma, user.organizationId, [ownerId]);
    const r = await this.prisma.$transaction(async (tx) => {
      const row = await tx.riskEntry.create({ data: { organizationId: user.organizationId, title: dto.title, description: dto.description, severity: dto.severity, proposedSolution: dto.proposedSolution?.trim() || null, earlyWarning: dto.earlyWarning, ownerId, raisedById: user.userId } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'risk.raised', entityType: 'risk', entityId: row.id, metadata: { severity: row.severity, earlyWarning: row.earlyWarning, hasSolution: !!row.proposedSolution } });
      return row;
    });
    return this.view(r, await userNameMap(this.prisma, user.organizationId, [r.ownerId, r.raisedById]));
  }

  async update(user: Principal, id: string, dto: Dto<typeof updateRiskSchema>) {
    const r = await this.prisma.riskEntry.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!r) throw notFound('Risk');
    if (dto.ownerId) await assertOrgUsers(this.prisma, user.organizationId, [dto.ownerId]);
    const status = dto.status ?? r.status;
    const solution = dto.proposedSolution !== undefined ? dto.proposedSolution.trim() || null : r.proposedSolution;
    if (status === 'RESOLVED' && !(dto.resolutionNote ?? r.resolutionNote)?.trim()) throw new AppError('FIELDS_REQUIRED', 'A resolution note is required to resolve a risk', 422, [{ path: 'resolutionNote', message: 'required' }]);
    const row = await this.prisma.$transaction(async (tx) => {
      const u = await tx.riskEntry.update({
        where: { id },
        data: {
          ...(dto.title ? { title: dto.title } : {}), ...(dto.description ? { description: dto.description } : {}), ...(dto.severity ? { severity: dto.severity } : {}),
          ...(dto.proposedSolution !== undefined ? { proposedSolution: solution } : {}), ...(dto.earlyWarning !== undefined ? { earlyWarning: dto.earlyWarning } : {}),
          ...(dto.ownerId ? { ownerId: dto.ownerId } : {}), ...(dto.status ? { status: dto.status } : {}), ...(dto.resolutionNote !== undefined ? { resolutionNote: dto.resolutionNote } : {}),
          ...(status === 'RESOLVED' && r.status !== 'RESOLVED' ? { resolvedAt: new Date() } : {}), version: { increment: 1 },
        },
      });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'risk.updated', entityType: 'risk', entityId: id, metadata: { fields: Object.keys(dto), from: r.status, to: status } });
      return u;
    });
    return this.view(row, await userNameMap(this.prisma, user.organizationId, [row.ownerId, row.raisedById]));
  }
}
