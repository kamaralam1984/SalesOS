import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PEOPLE_EVENTS } from '@salesos/shared-types';
import type { assignResourceSchema, createResourceSchema, listResourcesQuerySchema, updateAssignmentSchema } from '@salesos/validation';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { forbidden, notFound } from '../../../common/http/errors';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService } from '../../../common/prisma';
import { assertOrgUsers, isoDay, toDate, userNameMap, asPage } from '../common/helpers';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;

@Injectable()
export class ResourcesService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService, private readonly outbox: OutboxService) {}

  async list(user: Principal, q: Dto<typeof listResourcesQuerySchema>) {
    const where: Prisma.ResourceWhereInput = {
      organizationId: user.organizationId, isActive: true,
      ...(q.tag ? { skillTags: { has: q.tag.toLowerCase() } } : {}), ...(q.type ? { type: q.type } : {}),
      ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { description: { contains: q.q, mode: 'insensitive' } }, { skillTags: { has: q.q.toLowerCase() } }] } : {}),
    };
    const rows = await this.prisma.resource.findMany({ where, include: { assignments: { where: { userId: user.userId } } }, orderBy: [{ title: 'asc' }, { id: 'asc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    return asPage(res, res.data.map((r) => ({ id: r.id, title: r.title, description: r.description, type: r.type, url: r.url, fileId: r.fileId, skillTags: r.skillTags, myAssignment: r.assignments[0] ? { id: r.assignments[0].id, status: r.assignments[0].status, dueDate: isoDay(r.assignments[0].dueDate), completedAt: r.assignments[0].completedAt } : null })));
  }

  async create(user: Principal, dto: Dto<typeof createResourceSchema>) {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.resource.create({ data: { organizationId: user.organizationId, createdById: user.userId, title: dto.title, description: dto.description, type: dto.type, url: dto.url, fileId: dto.fileId, skillTags: dto.skillTags.map((t) => t.toLowerCase()) } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'resource.created', entityType: 'resource', entityId: r.id, metadata: { tags: r.skillTags } });
      return { id: r.id };
    });
  }

  async assign(user: Principal, id: string, dto: Dto<typeof assignResourceSchema>) {
    const r = await this.prisma.resource.findFirst({ where: { id, organizationId: user.organizationId, isActive: true } });
    if (!r) throw notFound('Resource');
    await assertOrgUsers(this.prisma, user.organizationId, dto.userIds);
    await this.prisma.$transaction(async (tx) => {
      for (const userId of dto.userIds) {
        const a = await tx.resourceAssignment.upsert({ where: { resourceId_userId: { resourceId: id, userId } }, update: { dueDate: dto.dueDate ? toDate(dto.dueDate) : undefined }, create: { organizationId: user.organizationId, resourceId: id, userId, assignedById: user.userId, dueDate: dto.dueDate ? toDate(dto.dueDate) : null } });
        await this.outbox.publish(tx, { eventType: PEOPLE_EVENTS.RESOURCE_ASSIGNED, aggregateType: 'resource_assignment', aggregateId: a.id, organizationId: user.organizationId, payload: { resourceId: id, resourceTitle: r.title, userId }, idempotencyKey: `resource-assigned:${id}:${userId}` });
      }
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'resource.assigned', entityType: 'resource', entityId: id, metadata: { users: dto.userIds.length } });
    });
    return { id, assigned: dto.userIds.length };
  }

  /** Learner sees own assignments; managers (resources:manage) see everyone's completion tracking. */
  async assignments(user: Principal, q: { userId?: string; status?: string }) {
    const manager = this.access.has(user, 'resources:manage');
    const where: Prisma.ResourceAssignmentWhereInput = {
      organizationId: user.organizationId, ...(manager ? (q.userId ? { userId: q.userId } : {}) : { userId: user.userId }), ...(q.status ? { status: q.status as never } : {}),
    };
    const rows = await this.prisma.resourceAssignment.findMany({ where, include: { resource: { select: { title: true, skillTags: true, type: true, url: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 200 });
    const names = await userNameMap(this.prisma, user.organizationId, rows.map((a) => a.userId));
    return rows.map((a) => ({ id: a.id, resourceId: a.resourceId, title: a.resource.title, type: a.resource.type, url: a.resource.url, skillTags: a.resource.skillTags, userId: a.userId, userName: names.get(a.userId) ?? null, status: a.status, dueDate: isoDay(a.dueDate), completedAt: a.completedAt }));
  }

  async updateAssignment(user: Principal, id: string, dto: Dto<typeof updateAssignmentSchema>) {
    const a = await this.prisma.resourceAssignment.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!a) throw notFound('Assignment');
    if (a.userId !== user.userId) throw forbidden('Only the assignee can update their progress');
    await this.prisma.$transaction(async (tx) => {
      await tx.resourceAssignment.update({ where: { id }, data: { status: dto.status, completedAt: dto.status === 'COMPLETED' ? new Date() : null } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'resource.progress', entityType: 'resource_assignment', entityId: id, metadata: { status: dto.status } });
    });
    return { id, status: dto.status };
  }
}
