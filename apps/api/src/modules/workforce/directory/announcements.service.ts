import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PLATFORM_EVENTS, ROLE_KEYS } from '@salesos/shared-types';
import type { CreateAnnouncementInput } from '@salesos/validation';
import { AuditService } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { ApiResult } from '../../../common/http/api-result';
import { notFound } from '../../../common/http/errors';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService } from '../../../common/prisma';

type Row = Prisma.AnnouncementGetPayload<object>;

@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService, private readonly outbox: OutboxService) {}

  /** Announcements the viewer may read: audience matches one of their roles (empty audience = everyone) and not expired. */
  activeWhere(user: Principal, now = new Date()): Prisma.AnnouncementWhereInput {
    return {
      organizationId: user.organizationId,
      publishedAt: { lte: now },
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, { OR: [{ audienceRoles: { isEmpty: true } }, { audienceRoles: { hasSome: user.roles } }] }],
    };
  }

  private view(a: Row, names: Map<string, string>, now: Date) {
    return { id: a.id, title: a.title, body: a.body, audienceRoles: a.audienceRoles, publishedAt: a.publishedAt, expiresAt: a.expiresAt, expired: !!a.expiresAt && a.expiresAt <= now, createdByName: names.get(a.createdById) ?? null };
  }

  private async names(orgId: string, ids: string[]) {
    const rows = await this.prisma.user.findMany({ where: { organizationId: orgId, id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  async list(user: Principal, q: { limit?: number; cursor?: string; page?: number; include: 'active' | 'all' }) {
    const manager = this.access.has(user, 'announcements:manage');
    const now = new Date();
    // managers may see everything (all audiences, expired); everyone else only what is addressed to them and live
    const where: Prisma.AnnouncementWhereInput = manager && q.include === 'all' ? { organizationId: user.organizationId } : this.activeWhere(user, now);
    const rows = await this.prisma.announcement.findMany({ where, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const names = await this.names(user.organizationId, rows.map((r) => r.createdById));
    const res = pageResult(rows, q);
    return new ApiResult(res.data.map((r) => this.view(r, names, now)), res.meta);
  }

  async create(user: Principal, dto: CreateAnnouncementInput) {
    const roles = [...new Set(dto.audienceRoles)];
    const created = await this.prisma.$transaction(async (tx) => {
      const a = await tx.announcement.create({
        data: { organizationId: user.organizationId, title: dto.title, body: dto.body, audienceRoles: roles, expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null, createdById: user.userId },
      });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'announcement.published', entityType: 'announcement', entityId: a.id, metadata: { audienceRoles: roles, expires: !!dto.expiresAt } });
      // generic title, no narrative text in the notification (the body is read in the app)
      await this.outbox.publish(tx, {
        eventType: PLATFORM_EVENTS.NOTIFICATION_REQUESTED, aggregateType: 'announcement', aggregateId: a.id, organizationId: user.organizationId,
        payload: { organizationId: user.organizationId, type: 'announcement.published', roles: roles.length ? roles : [...ROLE_KEYS], entity: { type: 'announcement', id: a.id }, dedupeKey: `announcement.published:${a.id}`, actionUrl: '/work', title: 'New company announcement', body: 'A new announcement was published. Open My Work to read it.' },
        idempotencyKey: `notification.requested:announcement.published:${a.id}`,
      });
      return a;
    });
    const names = await this.names(user.organizationId, [created.createdById]);
    return this.view(created, names, new Date());
  }

  async remove(user: Principal, id: string) {
    await this.prisma.$transaction(async (tx) => {
      const found = await tx.announcement.findFirst({ where: { id, organizationId: user.organizationId } });
      if (!found) throw notFound('Announcement');
      await tx.announcement.delete({ where: { id } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'announcement.deleted', entityType: 'announcement', entityId: id, metadata: { audienceRoles: found.audienceRoles } });
    });
    return { id, deleted: true };
  }
}
