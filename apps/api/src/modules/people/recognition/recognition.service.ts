import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PEOPLE_EVENTS } from '@salesos/shared-types';
import type { createRecognitionProgramSchema, createRecognitionSchema, listRecognitionsQuerySchema } from '@salesos/validation';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { conflict, forbidden, notFound } from '../../../common/http/errors';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService } from '../../../common/prisma';
import { assertOrgUsers, assertTargetInScope, userNameMap , asPage } from '../common/helpers';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;

@Injectable()
export class RecognitionService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService, private readonly outbox: OutboxService) {}

  async programs(user: Principal) {
    return this.prisma.recognitionProgram.findMany({ where: { organizationId: user.organizationId, isActive: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 100 });
  }

  async createProgram(user: Principal, dto: Dto<typeof createRecognitionProgramSchema>) {
    if (this.access.scopeLevel(user, 'recognition:create') !== 'org') throw forbidden('Only organization-level recognisers can define programs');
    const dup = await this.prisma.recognitionProgram.findUnique({ where: { organizationId_key: { organizationId: user.organizationId, key: dto.key } } });
    if (dup) throw conflict('PROGRAM_KEY_TAKEN', 'A program with this key exists');
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.recognitionProgram.create({ data: { organizationId: user.organizationId, createdById: user.userId, ...dto } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'recognition.program_created', entityType: 'recognition_program', entityId: p.id, metadata: { key: p.key } });
      return p;
    });
  }

  /** wall=true: org-wide wall of PUBLIC recognitions with a minimum-data projection. Otherwise scoped by recognition:view. */
  async list(user: Principal, q: Dto<typeof listRecognitionsQuerySchema>) {
    const wall = q.wall === 'true';
    const where: Prisma.RecognitionWhereInput = wall
      ? { organizationId: user.organizationId, isPublic: true, ...(q.recipientId ? { recipientId: q.recipientId } : {}) }
      : { AND: [(await this.access.scopedWhere(user, { permission: 'recognition:view', ownerField: 'recipientId' })) as Prisma.RecognitionWhereInput, q.recipientId ? { recipientId: q.recipientId } : {}] };
    const rows = await this.prisma.recognition.findMany({ where, include: { program: { select: { name: true, kind: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const names = await userNameMap(this.prisma, user.organizationId, res.data.flatMap((r) => [r.recipientId, r.grantedById]));
    return asPage(
      res,
      res.data.map((r) => ({
        id: r.id, programId: r.programId, programName: r.program.name, programKind: r.program.kind, recipientId: r.recipientId, recipientName: names.get(r.recipientId) ?? null,
        reason: r.reason, periodLabel: r.periodLabel, competencyKey: r.competencyKey, isPublic: r.isPublic, createdAt: r.createdAt,
        ...(wall ? {} : { grantedById: r.grantedById, grantedByName: names.get(r.grantedById) ?? null }),
      })),
    );
  }

  async create(user: Principal, dto: Dto<typeof createRecognitionSchema>) {
    if (dto.recipientId === user.userId) throw forbidden('You cannot recognise yourself');
    await assertOrgUsers(this.prisma, user.organizationId, [dto.recipientId]);
    await assertTargetInScope(this.access, user, 'recognition:create', dto.recipientId);
    const program = await this.prisma.recognitionProgram.findFirst({ where: { id: dto.programId, organizationId: user.organizationId, isActive: true } });
    if (!program) throw notFound('Program');
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.recognition.create({ data: { organizationId: user.organizationId, grantedById: user.userId, ...dto } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'recognition.granted', entityType: 'recognition', entityId: r.id, metadata: { programId: dto.programId, recipientId: dto.recipientId, isPublic: dto.isPublic } });
      await this.outbox.publish(tx, { eventType: PEOPLE_EVENTS.RECOGNITION_GRANTED, aggregateType: 'recognition', aggregateId: r.id, organizationId: user.organizationId, payload: { recognitionId: r.id, recipientId: dto.recipientId, programName: program.name }, idempotencyKey: `recognition:${r.id}` });
      return { id: r.id };
    });
  }
}
