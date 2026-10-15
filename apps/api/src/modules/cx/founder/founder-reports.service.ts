import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { canonicalJson, contentHash, emitCx, lastCompletedPeriod, logState, periodContaining, reportCompleteness, reportDueAt, reportTimeliness, risksMissingSolution, type ReportSections } from '@salesos/cx-core';
import { CX_EVENTS } from '@salesos/shared-types';
import type { createFounderReportSchema, listFounderReportsQuerySchema, metricsQuerySchema, reviewFounderReportSchema, updateFounderReportSchema } from '@salesos/validation';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { type Principal } from '../../../common/authz';
import { AppError, conflict, notFound } from '../../../common/http/errors';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService } from '../../../common/prisma';
import { cxConfig, userNameMap, withData } from '../common/support';
import { REPORT_DATA_PROVIDER, type ReportDataProvider } from './report-data.provider';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;
type Row = Prisma.FounderReportGetPayload<object>;
const day = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class FounderReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(REPORT_DATA_PROVIDER) private readonly data: ReportDataProvider,
  ) {}

  private view(r: Row, names: Map<string, string>) {
    const sections = (r.sections ?? {}) as ReportSections;
    return {
      id: r.id, type: r.type, periodStart: day(r.periodStart), periodEnd: day(r.periodEnd), versionNumber: r.versionNumber, supersedesId: r.supersedesId, status: r.status, title: r.title,
      sections, authorId: r.authorId, authorName: names.get(r.authorId) ?? null, dueAt: r.dueAt, publishedAt: r.publishedAt, publishedByName: r.publishedById ? names.get(r.publishedById) ?? null : null,
      contentHash: r.contentHash, onTime: r.onTime, completenessPct: r.status === 'PUBLISHED' ? r.completenessPct : reportCompleteness(sections).pct,
      rating: r.rating, reviewNote: r.reviewNote, reviewedByName: r.reviewedById ? names.get(r.reviewedById) ?? null : null, reviewedAt: r.reviewedAt,
      overdue: r.status === 'DRAFT' && r.dueAt.getTime() < Date.now(), version: r.version, createdAt: r.createdAt, updatedAt: r.updatedAt,
    };
  }

  async list(user: Principal, q: Dto<typeof listFounderReportsQuerySchema>) {
    const where: Prisma.FounderReportWhereInput = { organizationId: user.organizationId, ...(q.type ? { type: q.type } : {}), ...(q.status ? { status: q.status } : {}) };
    const rows = await this.prisma.founderReport.findMany({ where, orderBy: [{ periodStart: 'desc' }, { versionNumber: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const names = await userNameMap(this.prisma, user.organizationId, res.data.flatMap((r) => [r.authorId, r.publishedById, r.reviewedById]));
    return withData(res, res.data.map((r) => this.view(r, names)));
  }

  private async load(user: Principal, id: string): Promise<Row> {
    const r = await this.prisma.founderReport.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!r) throw notFound('Report');
    return r;
  }

  async get(user: Principal, id: string) {
    const r = await this.load(user, id);
    const names = await userNameMap(this.prisma, user.organizationId, [r.authorId, r.publishedById, r.reviewedById]);
    // live data sections only for drafts; a published report shows its frozen snapshot content
    const dataSections = r.status === 'DRAFT' ? await this.data.getSections({ user, organizationId: user.organizationId, type: r.type, periodStart: day(r.periodStart), periodEnd: day(r.periodEnd) }) : null;
    const actionItems = r.status === 'DRAFT' ? await this.actionItemSummary(user.organizationId, r) : null;
    const versions = await this.prisma.founderReport.findMany({ where: { organizationId: user.organizationId, type: r.type, periodStart: r.periodStart }, orderBy: { versionNumber: 'asc' }, select: { id: true, versionNumber: true, status: true, publishedAt: true } });
    return { ...this.view(r, names), dataSections, actionItems, versions };
  }

  private async actionItemSummary(orgId: string, r: Row) {
    const items = await this.prisma.actionItem.findMany({ where: { organizationId: orgId, OR: [{ reportId: r.id }, { status: { in: ['OPEN', 'IN_PROGRESS', 'OVERDUE', 'ESCALATED'] } }] }, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], take: 200 });
    return items.map((a) => ({ id: a.id, title: a.title, ownerId: a.ownerId, dueAt: a.dueAt.toISOString(), status: a.status }));
  }

  async create(user: Principal, dto: Dto<typeof createFounderReportSchema>) {
    const { cfg, wh } = await cxConfig(this.prisma, user.organizationId);
    const period = dto.periodDate ? periodContaining(dto.type, dto.periodDate) : lastCompletedPeriod(dto.type, new Date(), cfg.reports.timezone);
    const periodStart = new Date(`${period.start}T00:00:00.000Z`);
    const existing = await this.prisma.founderReport.findFirst({ where: { organizationId: user.organizationId, type: dto.type, periodStart }, orderBy: { versionNumber: 'desc' } });
    if (existing) {
      if (existing.status === 'DRAFT') return this.get(user, existing.id);
      throw new AppError('REPORT_PUBLISHED', 'This period already has a published report; create a corrected version instead', 409, { reportId: existing.id });
    }
    const title = dto.title ?? `${dto.type === 'WEEKLY' ? 'Weekly' : 'Monthly'} Founder report ${period.start} to ${period.end}`;
    const created = await this.prisma.$transaction(async (tx) => {
      const r = await tx.founderReport.create({
        data: { organizationId: user.organizationId, type: dto.type, periodStart, periodEnd: new Date(`${period.end}T00:00:00.000Z`), title, sections: (dto.sections ?? {}) as Prisma.InputJsonValue, authorId: user.userId, dueAt: reportDueAt(dto.type, period.end, cfg, wh) },
      });
      await logState(tx, { organizationId: user.organizationId, entityType: 'founder_report', entityId: r.id, from: null, to: 'DRAFT', actorId: user.userId });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'founder_report.created', entityType: 'founder_report', entityId: r.id, metadata: { type: r.type, periodStart: period.start } });
      return r;
    });
    return this.get(user, created.id);
  }

  async update(user: Principal, id: string, dto: Dto<typeof updateFounderReportSchema>) {
    const r = await this.load(user, id);
    if (r.status !== 'DRAFT') throw new AppError('REPORT_IMMUTABLE', 'A published report is an immutable snapshot and cannot be edited. Create a corrected version.', 409);
    if (dto.version !== undefined && dto.version !== r.version) throw conflict('CONFLICT', 'The draft was changed by someone else; reload and retry');
    const res = await this.prisma.founderReport.updateMany({
      where: { id, status: 'DRAFT', version: r.version },
      data: { ...(dto.title ? { title: dto.title } : {}), ...(dto.sections ? { sections: dto.sections as Prisma.InputJsonValue } : {}), version: { increment: 1 } },
    });
    if (res.count !== 1) throw conflict('CONFLICT', 'The draft was changed or published by someone else; reload and retry');
    await this.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'founder_report.updated', entityType: 'founder_report', entityId: id, metadata: { fields: Object.keys(dto).filter((k) => k !== 'version') } });
    return this.get(user, id);
  }

  /** Publish = freeze. Writes the immutable snapshot (content + SHA-256 hash) in the same transaction as the status change. */
  async publish(user: Principal, id: string) {
    const r = await this.load(user, id);
    if (r.status === 'PUBLISHED') return this.get(user, id); // idempotent
    const sections = (r.sections ?? {}) as ReportSections;
    const noSolution = risksMissingSolution(sections);
    if (noSolution.length) throw new AppError('RISK_SOLUTION_REQUIRED', `Every risk needs a proposed solution before publishing: ${noSolution.join(', ')}`, 422, noSolution.map((t) => ({ path: `risks.${t}`, message: 'proposedSolution required' })));
    if (!sections.performance?.narrative?.trim()) throw new AppError('SECTION_REQUIRED', 'The performance section needs a narrative before publishing', 422, [{ path: 'performance.narrative', message: 'required' }]);
    const now = new Date();
    const completeness = reportCompleteness(sections);
    const dataSections = await this.data.getSections({ user, organizationId: user.organizationId, type: r.type, periodStart: day(r.periodStart), periodEnd: day(r.periodEnd) });
    const actionItems = await this.actionItemSummary(user.organizationId, r);
    const original = r.versionNumber > 1 ? await this.prisma.founderReport.findFirst({ where: { organizationId: user.organizationId, type: r.type, periodStart: r.periodStart, versionNumber: 1 }, select: { onTime: true } }) : null;
    // corrections inherit the original's timeliness; only version 1 counts toward KPI-FND-003
    const onTime = r.versionNumber > 1 ? original?.onTime ?? false : now.getTime() <= r.dueAt.getTime();
    const content = {
      schema: 1, reportId: r.id, type: r.type, periodStart: day(r.periodStart), periodEnd: day(r.periodEnd), versionNumber: r.versionNumber, supersedesId: r.supersedesId, title: r.title,
      sections, dataSections, actionItems, completeness, dueAt: r.dueAt.toISOString(), publishedAt: now.toISOString(), authorId: r.authorId, onTime,
    };
    const hash = contentHash(content);
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.founderReport.updateMany({ where: { id, status: 'DRAFT', version: r.version }, data: { status: 'PUBLISHED', publishedAt: now, publishedById: user.userId, contentHash: hash, onTime, completenessPct: completeness.pct, version: { increment: 1 } } });
      if (res.count !== 1) throw conflict('CONFLICT', 'The draft was changed or published by someone else; reload and retry');
      await tx.founderReportSnapshot.create({ data: { organizationId: user.organizationId, reportId: id, type: r.type, periodStart: r.periodStart, periodEnd: r.periodEnd, versionNumber: r.versionNumber, content: JSON.parse(canonicalJson(content)) as Prisma.InputJsonValue, contentHash: hash, dueAt: r.dueAt, publishedAt: now, publishedById: user.userId, onTime } });
      const riskIds = (sections.risks?.items ?? []).map((x) => x.riskId).filter((x): x is string => !!x);
      if (riskIds.length) await tx.riskEntry.updateMany({ where: { organizationId: user.organizationId, id: { in: riskIds } }, data: { lastReportId: id } });
      await logState(tx, { organizationId: user.organizationId, entityType: 'founder_report', entityId: id, from: 'DRAFT', to: 'PUBLISHED', actorId: user.userId, metadata: { contentHash: hash, onTime } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'founder_report.published', entityType: 'founder_report', entityId: id, metadata: { contentHash: hash, onTime, versionNumber: r.versionNumber, completenessPct: completeness.pct } });
      await emitCx(tx, { organizationId: user.organizationId, eventType: CX_EVENTS.FOUNDER_REPORT_PUBLISHED, aggregateType: 'founder_report', aggregateId: id, key: `founder_report.published:${id}`, payload: { organizationId: user.organizationId, reportId: id, type: r.type, periodStart: day(r.periodStart), dueAt: r.dueAt.toISOString(), onTime, contentHash: hash, notifyRoles: ['FOUNDER_CEO'] } });
    });
    return this.get(user, id);
  }

  async snapshot(user: Principal, id: string) {
    const r = await this.load(user, id);
    const s = await this.prisma.founderReportSnapshot.findUnique({ where: { reportId: id } });
    if (!s || s.organizationId !== user.organizationId) throw new AppError('NOT_PUBLISHED', r.status === 'DRAFT' ? 'This report has not been published yet' : 'Snapshot not found', 404);
    const recomputed = contentHash(s.content);
    return {
      id: s.id, reportId: s.reportId, type: s.type, periodStart: day(s.periodStart), periodEnd: day(s.periodEnd), versionNumber: s.versionNumber, content: s.content, contentHash: s.contentHash,
      integrityVerified: recomputed === s.contentHash, dueAt: s.dueAt, publishedAt: s.publishedAt, onTime: s.onTime,
    };
  }

  async newVersion(user: Principal, id: string) {
    const r = await this.load(user, id);
    if (r.status !== 'PUBLISHED') throw new AppError('NOT_PUBLISHED', 'Only a published report can be corrected', 409);
    const latest = await this.prisma.founderReport.findFirst({ where: { organizationId: user.organizationId, type: r.type, periodStart: r.periodStart }, orderBy: { versionNumber: 'desc' } });
    if (latest && latest.status === 'DRAFT') return this.get(user, latest.id);
    const next = (latest?.versionNumber ?? r.versionNumber) + 1;
    const created = await this.prisma.$transaction(async (tx) => {
      const n = await tx.founderReport.create({ data: { organizationId: user.organizationId, type: r.type, periodStart: r.periodStart, periodEnd: r.periodEnd, versionNumber: next, supersedesId: latest?.id ?? r.id, title: r.title, sections: (r.sections ?? {}) as Prisma.InputJsonValue, authorId: user.userId, dueAt: r.dueAt } });
      await logState(tx, { organizationId: user.organizationId, entityType: 'founder_report', entityId: n.id, from: null, to: 'DRAFT', actorId: user.userId, note: `correction of version ${r.versionNumber}` });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'founder_report.correction_started', entityType: 'founder_report', entityId: n.id, metadata: { supersedes: r.id, versionNumber: next } });
      return n;
    });
    return this.get(user, created.id);
  }

  async review(user: Principal, id: string, dto: Dto<typeof reviewFounderReportSchema>) {
    const r = await this.load(user, id);
    if (r.status !== 'PUBLISHED') throw new AppError('NOT_PUBLISHED', 'Only a published report can be reviewed', 409);
    if (dto.rating === undefined && !dto.note) throw new AppError('VALIDATION_ERROR', 'Give a rating or a note', 422);
    // Review fields live on the report row, NOT in the frozen snapshot content (the DB guard allows only these columns to change)
    await this.prisma.founderReport.update({ where: { id }, data: { rating: dto.rating ?? null, reviewNote: dto.note ?? null, reviewedById: user.userId, reviewedAt: new Date() } });
    await this.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'founder_report.reviewed', entityType: 'founder_report', entityId: id, metadata: { rating: dto.rating ?? null } });
    return this.get(user, id);
  }

  /** Inputs for KPI-FND-003 (timeliness) and KPI-FND-002 (quality proxy): only ORIGINAL (version 1) reports count. */
  async metrics(user: Principal, q: Dto<typeof metricsQuerySchema>) {
    const to = q.to ? new Date(`${q.to}T23:59:59.999Z`) : new Date();
    const from = q.from ? new Date(`${q.from}T00:00:00.000Z`) : new Date(to.getTime() - 90 * 86_400_000);
    const rows = await this.prisma.founderReport.findMany({ where: { organizationId: user.organizationId, versionNumber: 1, dueAt: { gte: from, lte: to } }, select: { id: true, type: true, dueAt: true, publishedAt: true, status: true, completenessPct: true, rating: true } });
    const timeliness = reportTimeliness(rows.map((r) => ({ dueAt: r.dueAt, publishedAt: r.publishedAt })), from, new Date(to.getTime() + 1));
    const published = rows.filter((r) => r.status === 'PUBLISHED');
    const comp = published.filter((r) => r.completenessPct !== null);
    const rated = published.filter((r) => r.rating !== null);
    return {
      from: from.toISOString(), to: to.toISOString(), timeliness,
      quality: { published: published.length, meanCompletenessPct: comp.length ? Math.round(comp.reduce((a, r) => a + (r.completenessPct ?? 0), 0) / comp.length) : null, meanRating: rated.length ? Math.round((rated.reduce((a, r) => a + (r.rating ?? 0), 0) / rated.length) * 10) / 10 : null, rated: rated.length },
      byType: (['WEEKLY', 'MONTHLY'] as const).map((t) => ({ type: t, ...reportTimeliness(rows.filter((r) => r.type === t).map((r) => ({ dueAt: r.dueAt, publishedAt: r.publishedAt })), from, new Date(to.getTime() + 1)) })),
    };
  }
}
