import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { createPlanLinkSchema, listPlanLinksQuerySchema } from '@salesos/validation';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { type Principal } from '../../../common/authz';
import { AppError } from '../../../common/http/errors';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService } from '../../../common/prisma';
import { assertOrgUsers, userNameMap, withData } from '../../cx/common/support';
import { assertNoPii } from '../collab-support';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;

/** Campaign / webinar / event / lead-gen alignment with the sales plan (JD-CROSS-006..008). Shows plan vs actual lead intake (counts only). */
@Injectable()
export class PlanLinksService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async create(user: Principal, dto: Dto<typeof createPlanLinkSchema>) {
    const org = user.organizationId;
    const start = new Date(dto.windowStart);
    const end = new Date(dto.windowEnd);
    if (end <= start) throw new AppError('VALIDATION_ERROR', 'windowEnd must be after windowStart', 422, [{ path: 'windowEnd', message: 'before start' }]);
    assertNoPii({ texts: [dto.title, dto.salesPlanNote] }, 'This plan');
    const [p, e, c, s] = await Promise.all([
      dto.programId ? this.prisma.program.count({ where: { id: dto.programId, organizationId: org } }) : 1,
      dto.eventId ? this.prisma.crmEvent.count({ where: { id: dto.eventId, organizationId: org } }) : 1,
      dto.campaignId ? this.prisma.leadCampaign.count({ where: { id: dto.campaignId, organizationId: org } }) : 1,
      dto.sourceId ? this.prisma.leadSource.count({ where: { id: dto.sourceId, organizationId: org } }) : 1,
    ]);
    if (!p || !e || !c || !s) throw new AppError('INVALID_REFERENCE', 'A linked program / event / campaign / source does not exist in this organization', 422);
    if ((dto.kind === 'WEBINAR' || dto.kind === 'EVENT') && !dto.eventId) throw new AppError('VALIDATION_ERROR', 'Link the webinar/event record (eventId)', 422, [{ path: 'eventId', message: 'required' }]);
    const ownerId = dto.ownerId ?? user.userId;
    await assertOrgUsers(this.prisma, org, [ownerId]);
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.campaignPlanLink.create({ data: { organizationId: org, kind: dto.kind, title: dto.title, programId: dto.programId ?? null, eventId: dto.eventId ?? null, campaignId: dto.campaignId ?? null, sourceId: dto.sourceId ?? null, windowStart: start, windowEnd: end, plannedLeads: dto.plannedLeads ?? null, salesPlanNote: dto.salesPlanNote ?? null, ownerId, createdById: user.userId } });
      await this.audit.recordTx(tx, { organizationId: org, actorId: user.userId, action: 'plan_link.created', entityType: 'plan_link', entityId: r.id, metadata: { kind: r.kind } });
      return r;
    });
    return (await this.enrich(user, [row]))[0];
  }

  private async enrich(user: Principal, rows: Prisma.CampaignPlanLinkGetPayload<object>[]) {
    const org = user.organizationId;
    const names = await userNameMap(this.prisma, org, rows.flatMap((r) => [r.ownerId, r.createdById]));
    const [programs, events] = await Promise.all([
      this.prisma.program.findMany({ where: { organizationId: org, id: { in: rows.map((r) => r.programId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
      this.prisma.crmEvent.findMany({ where: { organizationId: org, id: { in: rows.map((r) => r.eventId).filter((x): x is string => !!x) } }, select: { id: true, title: true, startsAt: true, status: true, type: true } }),
    ]);
    const pn = new Map(programs.map((p) => [p.id, p.name]));
    const en = new Map(events.map((e) => [e.id, e]));
    const out = [];
    for (const r of rows) {
      // actual intake = COUNT of leads created in the window for the linked campaign/source (no lead data is returned)
      const where: Prisma.LeadWhereInput = { organizationId: org, mergedIntoId: null, createdAt: { gte: r.windowStart, lte: r.windowEnd }, ...(r.campaignId ? { campaignId: r.campaignId } : {}), ...(r.sourceId && !r.campaignId ? { sourceId: r.sourceId } : {}), ...(r.programId && !r.campaignId && !r.sourceId ? { programId: r.programId } : {}) };
      const hasKey = !!(r.campaignId || r.sourceId || r.programId);
      const actualLeads = hasKey ? await this.prisma.lead.count({ where }) : null;
      const att = r.eventId ? await this.prisma.eventAttendance.groupBy({ by: ['status'], where: { organizationId: org, eventId: r.eventId }, _count: { _all: true } }) : [];
      const ev = r.eventId ? en.get(r.eventId) : null;
      out.push({
        id: r.id, kind: r.kind, title: r.title, programId: r.programId, programName: r.programId ? pn.get(r.programId) ?? null : null, eventId: r.eventId,
        event: ev ? { id: ev.id, title: ev.title, startsAt: ev.startsAt, status: ev.status, type: ev.type } : null, campaignId: r.campaignId, sourceId: r.sourceId,
        windowStart: r.windowStart, windowEnd: r.windowEnd, plannedLeads: r.plannedLeads, actualLeads, salesPlanNote: r.salesPlanNote, status: r.status,
        attendance: Object.fromEntries(att.map((a) => [a.status, a._count._all])), ownerName: names.get(r.ownerId) ?? null, createdByName: names.get(r.createdById) ?? null, createdAt: r.createdAt,
      });
    }
    return out;
  }

  async list(user: Principal, q: Dto<typeof listPlanLinksQuerySchema>) {
    const rows = await this.prisma.campaignPlanLink.findMany({ where: { organizationId: user.organizationId, ...(q.kind ? { kind: q.kind } : {}) }, orderBy: [{ windowStart: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    return withData(res, await this.enrich(user, res.data));
  }
}
