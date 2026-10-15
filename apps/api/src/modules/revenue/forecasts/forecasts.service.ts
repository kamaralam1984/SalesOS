import { Injectable } from '@nestjs/common';
import { Prisma, type Forecast, type ForecastSnapshot } from '@prisma/client';
import { REVENUE_EVENTS } from '@salesos/shared-types';
import type { z } from 'zod';
import type { createForecastSchema, forecastAccuracyQuerySchema, listForecastsQuerySchema, previewForecastQuerySchema } from '@salesos/validation';
import type { Principal } from '../../../common/authz';
import { AppError } from '../../../common/http/errors';
import { ok } from '../../../common/http/api-result';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { D, DEFAULT_STAGE_PROBABILITIES, FORECAST_METHOD, forecastAccuracy, forecastBias, forecastBounds, istDate, istRange, money, stageWeightedForecast, wape, type ForecastResult } from '../calc';
import { MetricsService } from '../metrics.service';
import { RevenueSupport, dateOnly, isUniqueViolation, iso, isoDay, primaryRole } from '../revenue.support';

const OPEN = ['OPEN', 'NEGOTIATION', 'PAYMENT_PENDING'] as const;
const LABEL = 'ESTIMATE - stage-weighted projection, not a fact';

@Injectable()
export class ForecastsService {
  constructor(
    private readonly s: RevenueSupport,
    private readonly metrics: MetricsService,
  ) {}

  private get prisma() {
    return this.s.prisma;
  }

  /** org scope -> whole organisation; team scope -> the caller's hierarchy (stable: no delegations). */
  private async scopeOf(user: Principal) {
    const level = this.s.access.scopeLevel(user, 'forecasts:create');
    if (level === 'org') return { scopeKey: 'ORG', scopeUserId: null as string | null, userIds: null as string[] | null };
    return { scopeKey: user.userId, scopeUserId: user.userId as string | null, userIds: await this.s.subtreeUserIds(user.organizationId, user.userId) };
  }

  private async compute(organizationId: string, periodType: 'WEEK' | 'MONTH', anchor: string | undefined, userIds: string[] | null) {
    const today = istDate(new Date());
    const bounds = forecastBounds(periodType, anchor ?? today);
    const asOf = today < bounds.startsOn ? bounds.startsOn : today > bounds.endsOn ? bounds.endsOn : today;
    const settings = await this.s.settings(this.prisma, organizationId);
    const probs = { ...DEFAULT_STAGE_PROBABILITIES, ...((settings.stageProbabilities as Record<string, string> | null) ?? {}) };
    const set = userIds ? new Set(userIds) : null;
    const win = istRange(bounds.startsOn, asOf);
    const [rev, deals] = await Promise.all([
      this.metrics.revenue(organizationId, win, set),
      this.prisma.deal.findMany({ where: { organizationId, stage: { in: [...OPEN] }, ...(userIds ? { ownerId: { in: userIds } } : {}) }, select: { id: true, ownerId: true, amount: true, stage: true, expectedCloseOn: true, lead: { select: { status: true } } } }),
    ]);
    const result = stageWeightedForecast({
      periodStart: bounds.startsOn, periodEnd: bounds.endsOn, asOf, bookedToDate: rev.net, probabilities: probs,
      deals: deals.map((d) => ({ id: d.id, ownerId: d.ownerId, amount: d.amount, stage: d.stage, leadStatus: d.lead.status, expectedCloseOn: isoDay(d.expectedCloseOn) })),
    });
    return { bounds, asOf, result, probs, bookedBreakdown: { booked: money(rev.booked), refundsApproved: money(rev.refundedApproved), wonDeals: rev.wonCount } };
  }

  private resultDto(r: ForecastResult, summaryOnly: boolean) {
    return {
      method: r.method,
      isEstimate: true,
      label: LABEL,
      currency: 'INR',
      total: money(r.total),
      bookedToDate: money(r.bookedToDate),
      weightedPipeline: money(r.weightedPipeline),
      unweightedPipeline: money(r.unweightedPipeline),
      byStage: summaryOnly ? [] : r.byStage,
      byOwner: summaryOnly ? [] : r.byOwner,
      unscheduled: r.unscheduled,
      overdue: r.overdue,
      dealCount: r.includedDealIds.length,
    };
  }

  async preview(user: Principal, q: z.infer<typeof previewForecastQuerySchema>) {
    const scope = await this.scopeOf(user);
    const c = await this.compute(user.organizationId, q.periodType, q.anchor, scope.userIds);
    return { periodType: q.periodType, periodStart: c.bounds.startsOn, periodEnd: c.bounds.endsOn, asOf: c.asOf, scope: scope.scopeKey === 'ORG' ? 'ORG' : 'TEAM', stored: false, ...this.resultDto(c.result, false), probabilities: c.probs, booked: c.bookedBreakdown, methodNote: 'Booked-to-date plus open deals expected to close in the remaining period, weighted by stage probability.' };
  }

  private snapDto(sn: ForecastSnapshot, summaryOnly: boolean, names?: Map<string, string>) {
    const b = sn.breakdown as { byStage?: unknown[]; byOwner?: unknown[]; unscheduled?: unknown; overdue?: unknown };
    return {
      id: sn.id,
      forecastId: sn.forecastId,
      kind: sn.kind,
      takenAt: iso(sn.takenAt),
      takenById: sn.takenById,
      takenByName: names?.get(sn.takenById) ?? null,
      isEstimate: true,
      label: LABEL,
      currency: sn.currency,
      total: money(sn.total),
      bookedToDate: money(sn.bookedToDate),
      weightedPipeline: money(sn.weightedPipeline),
      unweightedPipeline: money(sn.unweightedPipeline),
      byStage: summaryOnly ? [] : b.byStage ?? [],
      byOwner: summaryOnly ? [] : b.byOwner ?? [],
      unscheduled: b.unscheduled ?? null,
      overdue: b.overdue ?? null,
      inputs: summaryOnly ? null : sn.inputs,
    };
  }

  async create(user: Principal, b: z.infer<typeof createForecastSchema>) {
    const scope = await this.scopeOf(user);
    const c = await this.compute(user.organizationId, b.periodType, b.anchor, scope.userIds);
    const key = { organizationId: user.organizationId, periodType: b.periodType, periodStart: dateOnly(c.bounds.startsOn), scopeKey: scope.scopeKey };
    try {
      const out = await this.s.tx(async (tx) => {
        let f = await tx.forecast.findFirst({ where: key });
        if (!f) {
          await tx.forecast.createMany({ data: [{ ...key, periodEnd: dateOnly(c.bounds.endsOn), scopeUserId: scope.scopeUserId, method: FORECAST_METHOD, params: { probabilities: c.probs } as Prisma.InputJsonValue, createdById: user.userId }], skipDuplicates: true });
          f = await tx.forecast.findFirstOrThrow({ where: key });
        }
        const r = c.result;
        const snap = await tx.forecastSnapshot.create({
          data: {
            organizationId: user.organizationId, forecastId: f.id, kind: b.kind, takenById: user.userId, total: r.total, bookedToDate: r.bookedToDate, weightedPipeline: r.weightedPipeline, unweightedPipeline: r.unweightedPipeline, currency: 'INR',
            breakdown: { byStage: r.byStage, byOwner: r.byOwner, unscheduled: r.unscheduled, overdue: r.overdue, booked: c.bookedBreakdown } as unknown as Prisma.InputJsonValue,
            inputs: { method: FORECAST_METHOD, asOf: c.asOf, periodStart: c.bounds.startsOn, periodEnd: c.bounds.endsOn, probabilities: c.probs, scope: scope.scopeKey === 'ORG' ? 'ORG' : 'TEAM', dealIds: r.includedDealIds, takenByRole: primaryRole(user) } as unknown as Prisma.InputJsonValue,
          },
        });
        await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'forecast.snapshot_taken', entityType: 'forecast', entityId: f.id, metadata: { snapshotId: snap.id, kind: b.kind, total: money(r.total), periodType: b.periodType, periodStart: c.bounds.startsOn } });
        await this.s.publish(tx, { eventType: REVENUE_EVENTS.FORECAST_SNAPSHOT_TAKEN, aggregateType: 'forecast', aggregateId: f.id, organizationId: user.organizationId, payload: { forecastId: f.id, snapshotId: snap.id, periodType: b.periodType, periodStart: c.bounds.startsOn, periodEnd: c.bounds.endsOn, total: money(r.total), currency: 'INR', isEstimate: true }, idempotencyKey: `forecast.snapshot:${snap.id}` });
        return { f, snap };
      });
      return { forecast: this.forecastDto(out.f), snapshot: this.snapDto(out.snap, false) };
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError('SNAPSHOT_EXISTS', 'A period-start snapshot already exists for this forecast. Take an ad-hoc snapshot instead.', 409);
      throw e;
    }
  }

  private forecastDto(f: Forecast) {
    return { id: f.id, periodType: f.periodType, periodStart: isoDay(f.periodStart)!, periodEnd: isoDay(f.periodEnd)!, scope: f.scopeKey === 'ORG' ? 'ORG' : 'TEAM', scopeUserId: f.scopeUserId, method: f.method, createdById: f.createdById, createdAt: iso(f.createdAt) };
  }

  private userIdsFor(f: Forecast): Promise<string[] | null> | null {
    return f.scopeKey === 'ORG' || !f.scopeUserId ? null : this.s.subtreeUserIds(f.organizationId, f.scopeUserId);
  }

  /** Accuracy of one forecast from the period-start snapshot (else the earliest) vs the actual booked revenue (KPI-REV-001). */
  private async accuracyOf(f: Forecast, snaps: ForecastSnapshot[]) {
    const today = istDate(new Date());
    const closed = today > isoDay(f.periodEnd)!;
    const basis = snaps.find((x) => x.kind === 'PERIOD_START') ?? [...snaps].sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime())[0];
    const ids = this.userIdsFor(f);
    const userIds = ids ? new Set(await ids) : null;
    const win = istRange(isoDay(f.periodStart)!, isoDay(f.periodEnd)!);
    const actual = (await this.metrics.revenue(f.organizationId, win, userIds)).net;
    if (!basis) return { periodClosed: closed, basis: null, forecast: null, actual: money(actual), accuracyPct: null, biasPct: null, errorMetric: 'max(0, 1 - |F - A| / A)' };
    return {
      periodClosed: closed,
      basis: basis.kind === 'PERIOD_START' ? 'PERIOD_START_SNAPSHOT' : 'EARLIEST_SNAPSHOT',
      basisSnapshotId: basis.id,
      forecast: money(basis.total),
      actual: money(actual),
      accuracyPct: closed ? forecastAccuracy(basis.total, actual) : null,
      biasPct: closed ? forecastBias(basis.total, actual) : null,
      errorMetric: 'max(0, 1 - |F - A| / A)',
      note: closed ? null : 'The period is still open: accuracy is computed after it closes (actual so far shown).',
    };
  }

  private async scopedForecasts(user: Principal): Promise<Prisma.ForecastWhereInput> {
    const level = this.s.access.scopeLevel(user, 'forecasts:view');
    if (level === 'org' || level === 'summary') return { organizationId: user.organizationId };
    const v = await this.s.access.visibleUsers(user);
    return { organizationId: user.organizationId, scopeUserId: { in: v.ids } };
  }

  async list(user: Principal, q: z.infer<typeof listForecastsQuerySchema>) {
    const base = await this.scopedForecasts(user);
    const where: Prisma.ForecastWhereInput = { ...base, ...(q.periodType ? { periodType: q.periodType } : {}) };
    const rows = await this.prisma.forecast.findMany({ where, orderBy: [{ periodStart: 'desc' }, { id: 'desc' }], include: { snapshots: { orderBy: { takenAt: 'desc' } } }, ...pageArgs(q) });
    const total = q.page ? await this.prisma.forecast.count({ where }) : undefined;
    const res = pageResult(rows, q, total);
    const summaryOnly = this.s.access.isSummaryOnly(user, 'forecasts:view');
    const page = res.data as Array<Forecast & { snapshots: ForecastSnapshot[] }>;
    const out = [];
    for (const f of page) {
      out.push({ ...this.forecastDto(f), snapshotCount: f.snapshots.length, latest: f.snapshots[0] ? this.snapDto(f.snapshots[0], summaryOnly) : null, accuracy: summaryOnly ? null : await this.accuracyOf(f, f.snapshots) });
    }
    return ok(out, res.meta);
  }

  async snapshots(user: Principal, id: string) {
    const f = await this.prisma.forecast.findFirst({ where: { id, ...(await this.scopedForecasts(user)) }, include: { snapshots: { orderBy: { takenAt: 'desc' } } } });
    if (!f) throw new AppError('NOT_FOUND', 'Forecast not found', 404);
    const summaryOnly = this.s.access.isSummaryOnly(user, 'forecasts:view');
    const names = await this.s.userNames(f.snapshots.map((x) => x.takenById));
    return { forecast: this.forecastDto(f), snapshots: f.snapshots.map((sn) => this.snapDto(sn, summaryOnly, names)), accuracy: summaryOnly ? null : await this.accuracyOf(f, f.snapshots) };
  }

  /** WAPE and per-period accuracy over the last N CLOSED periods that have a stored snapshot. */
  async accuracy(user: Principal, q: z.infer<typeof forecastAccuracyQuerySchema>) {
    const base = await this.scopedForecasts(user);
    const today = istDate(new Date());
    const rows = await this.prisma.forecast.findMany({ where: { ...base, periodType: q.periodType, periodEnd: { lt: dateOnly(today) } }, orderBy: [{ periodStart: 'desc' }], take: q.last, include: { snapshots: true } });
    const periods = [];
    for (const f of rows) {
      const a = await this.accuracyOf(f, f.snapshots);
      periods.push({ forecastId: f.id, periodStart: isoDay(f.periodStart), periodEnd: isoDay(f.periodEnd), scope: f.scopeKey === 'ORG' ? 'ORG' : 'TEAM', ...a });
    }
    const pairs = periods.filter((p) => p.forecast !== null && D(p.actual).greaterThan(0)).map((p) => ({ forecast: p.forecast!, actual: p.actual! }));
    return { periodType: q.periodType, errorMetrics: { accuracy: 'max(0, 1 - |F - A| / A) per period', wape: 'sum|F-A| / sum A over the listed periods', bias: '(F - A) / A' }, wapePct: wape(pairs), periods, count: periods.length, note: 'Periods without a stored snapshot or with zero actual are shown without accuracy (never as 100%).' };
  }
}
