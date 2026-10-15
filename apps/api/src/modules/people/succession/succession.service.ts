import { Injectable } from '@nestjs/common';
import type { createSuccessionPositionSchema, upsertSuccessionCandidateSchema } from '@salesos/validation';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import type { Principal } from '../../../common/authz';
import { notFound } from '../../../common/http/errors';
import { PrismaService } from '../../../common/prisma';
import { assertOrgUsers, userNameMap } from '../common/helpers';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;

/** Succession bench (Founder / Team Lead / HR only; org-level by permission matrix). */
@Injectable()
export class SuccessionService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async board(user: Principal) {
    const positions = await this.prisma.successionPosition.findMany({ where: { organizationId: user.organizationId }, include: { candidates: true }, orderBy: [{ title: 'asc' }, { id: 'asc' }], take: 100 });
    const names = await userNameMap(this.prisma, user.organizationId, positions.flatMap((p) => [p.incumbentId, ...p.candidates.map((c) => c.userId)]));
    return positions.map((p) => ({
      id: p.id, title: p.title, roleKey: p.roleKey, incumbentId: p.incumbentId, incumbentName: p.incumbentId ? names.get(p.incumbentId) ?? null : null, notes: p.notes,
      readyNow: p.candidates.filter((c) => c.readiness === 'READY_NOW').map((c) => this.cand(c, names)),
      readyLater: p.candidates.filter((c) => c.readiness === 'READY_LATER').map((c) => this.cand(c, names)),
      coverage: p.candidates.some((c) => c.readiness === 'READY_NOW') ? 'COVERED' : p.candidates.length ? 'DEVELOPING' : 'NO_BENCH',
    }));
  }

  private cand(c: { id: string; userId: string; readiness: string; developmentActions: unknown; notes: string | null }, names: Map<string, string>) {
    return { id: c.id, userId: c.userId, name: names.get(c.userId) ?? null, readiness: c.readiness, developmentActions: c.developmentActions, notes: c.notes };
  }

  async createPosition(user: Principal, dto: Dto<typeof createSuccessionPositionSchema>) {
    if (dto.incumbentId) await assertOrgUsers(this.prisma, user.organizationId, [dto.incumbentId]);
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.successionPosition.create({ data: { organizationId: user.organizationId, createdById: user.userId, ...dto } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'succession.position_created', entityType: 'succession_position', entityId: p.id, metadata: { roleKey: dto.roleKey } });
      return { id: p.id };
    });
  }

  async upsertCandidate(user: Principal, dto: Dto<typeof upsertSuccessionCandidateSchema>) {
    const pos = await this.prisma.successionPosition.findFirst({ where: { id: dto.positionId, organizationId: user.organizationId } });
    if (!pos) throw notFound('Position');
    await assertOrgUsers(this.prisma, user.organizationId, [dto.userId]);
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.successionCandidate.upsert({
        where: { positionId_userId: { positionId: dto.positionId, userId: dto.userId } },
        update: { readiness: dto.readiness, developmentActions: dto.developmentActions, notes: dto.notes },
        create: { organizationId: user.organizationId, positionId: dto.positionId, userId: dto.userId, readiness: dto.readiness, developmentActions: dto.developmentActions, notes: dto.notes, addedById: user.userId },
      });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'succession.candidate_saved', entityType: 'succession_candidate', entityId: c.id, metadata: { positionId: dto.positionId, userId: dto.userId, readiness: dto.readiness } });
      return { id: c.id };
    });
  }

  async removeCandidate(user: Principal, id: string) {
    const c = await this.prisma.successionCandidate.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!c) throw notFound('Bench entry');
    await this.prisma.$transaction(async (tx) => {
      await tx.successionCandidate.delete({ where: { id } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'succession.candidate_removed', entityType: 'succession_candidate', entityId: id, metadata: { positionId: c.positionId, userId: c.userId } });
    });
    return { id };
  }
}
