import { Limited } from '../../common/security/rate-limits';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { analyticsQuerySchema, createExportSchema, exportListQuerySchema, kpiListQuerySchema, reportQuerySchema, savedFilterQuerySchema, savedFilterSchema } from '@salesos/validation';
import type { Response } from 'express';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../common/authz';
import { forbidden, notFound } from '../../common/http/errors';
import { AccessService } from '../../common/authz';
import { ZodPipe } from '../../common/http/zod.pipe';
import { DashboardsService } from './dashboards/dashboards.service';
import { ExportsService } from './exports/exports.service';
import { FilterOptionsService } from './kpi/filter-options.service';
import { KpiService } from './kpi/kpi.service';
import { KPI_MAP } from './kpi/registry';
import { ReconciliationService } from './reconciliation/reconciliation.service';
import { ReportsService } from './reports/reports.service';
import { SavedFiltersService } from './saved-filters/saved-filters.service';
import { SnapshotService } from './snapshots/snapshots.service';

type Q = z.infer<typeof analyticsQuerySchema>;
type RQ = z.infer<typeof reportQuerySchema>;

/** Role dashboards. All numbers come from the shared KPI layer; admin gets operational health only. */
@ApiTags('analytics/dashboards')
@Controller('dashboard')
export class DashboardsController {
  constructor(private readonly d: DashboardsService) {}

  @Get('ceo')
  @RequirePermission('dashboard:ceo:view')
  ceo(@CurrentUser() user: Principal, @Query(new ZodPipe(analyticsQuerySchema)) q: Q) {
    return this.d.founder(user, q);
  }

  @Get('team-lead')
  @RequirePermission('dashboard:team-lead:view')
  teamLead(@CurrentUser() user: Principal, @Query(new ZodPipe(analyticsQuerySchema)) q: Q) {
    return this.d.teamLead(user, q);
  }

  @Get('manager')
  @RequirePermission('dashboard:manager:view')
  manager(@CurrentUser() user: Principal, @Query(new ZodPipe(analyticsQuerySchema)) q: Q) {
    return this.d.manager(user, q);
  }

  @Get('salesperson')
  @RequirePermission('dashboard:salesperson:view')
  salesperson(@CurrentUser() user: Principal, @Query(new ZodPipe(analyticsQuerySchema)) q: Q) {
    return this.d.executive(user, q);
  }

  @Get('admin')
  @RequirePermission('dashboard:system-health:view')
  admin(@CurrentUser() user: Principal) {
    return this.d.systemHealth(user);
  }

  @Get('system-health')
  @RequirePermission('dashboard:system-health:view')
  systemHealth(@CurrentUser() user: Principal) {
    return this.d.systemHealth(user);
  }
}

@ApiTags('analytics/kpis')
@Controller('kpis')
export class KpisController {
  constructor(private readonly kpis: KpiService, private readonly snapshots: SnapshotService, private readonly access: AccessService, private readonly options: FilterOptionsService) {}

  /** The dictionary: definitions only, no values (so ADMIN and every secondary role can read how numbers are defined). */
  @Get('definitions')
  @RequirePermission('kpi:definitions:view')
  definitions() {
    return this.kpis.definitions();
  }

  @Get()
  @RequirePermission('kpi:view')
  async list(@CurrentUser() user: Principal, @Query(new ZodPipe(kpiListQuerySchema)) q: z.infer<typeof kpiListQuerySchema>) {
    const { ids, group, ...rest } = q;
    const metas = this.kpis.definitions().filter((m) => (!ids || ids.includes(m.id)) && (!group || m.group === group));
    const results = await this.kpis.runMany(user, metas.map((m) => m.id), rest);
    return { definitions: metas, results };
  }

  /** Choices for the filter bar, limited to the caller's own scope. */
  @Get('filter-options')
  @RequirePermission('kpi:view')
  filterOptions(@CurrentUser() user: Principal) {
    return this.options.get(user);
  }

  @Get(':id/history')
  @RequirePermission('kpi:view')
  async history(@CurrentUser() user: Principal, @Param('id') id: string) {
    if (!KPI_MAP.has(id)) throw notFound('KPI');
    // snapshots are organisation-wide values: only org-scope viewers may read them (narrower scopes compute live)
    if (this.access.scopeLevel(user, 'kpi:view') !== 'org') throw forbidden();
    return { id, scope: 'ORG', points: await this.snapshots.history(user.organizationId, id) };
  }

  @Get(':id')
  @RequirePermission('kpi:view')
  one(@CurrentUser() user: Principal, @Param('id') id: string, @Query(new ZodPipe(analyticsQuerySchema)) q: Q) {
    return this.kpis.run(user, id, q);
  }
}

@ApiTags('analytics/reports')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly recon: ReconciliationService,
    private readonly exports: ExportsService,
    private readonly saved: SavedFiltersService,
  ) {}

  @Get()
  @RequirePermission('reports:view')
  catalogue() {
    return this.reports.catalogue();
  }

  @Get('follow-ups')
  @RequirePermission('reports:view', 'kpi:view')
  followUps(@CurrentUser() user: Principal, @Query(new ZodPipe(reportQuerySchema)) q: RQ) {
    return this.reports.run(user, 'follow-ups', q);
  }

  @Get('conversions')
  @RequirePermission('reports:view', 'kpi:view')
  conversions(@CurrentUser() user: Principal, @Query(new ZodPipe(reportQuerySchema)) q: RQ) {
    return this.reports.run(user, 'conversions', q);
  }

  @Get('funnel')
  @RequirePermission('reports:view', 'kpi:view')
  funnel(@CurrentUser() user: Principal, @Query(new ZodPipe(reportQuerySchema)) q: RQ) {
    return this.reports.run(user, 'funnel', q);
  }

  @Get('revenue')
  @RequirePermission('kpi:view', 'targets:view')
  revenue(@CurrentUser() user: Principal, @Query(new ZodPipe(reportQuerySchema)) q: RQ) {
    return this.reports.run(user, 'revenue', q);
  }

  @Get('team-performance')
  @RequirePermission('reports:view', 'kpi:view')
  teamPerformance(@CurrentUser() user: Principal, @Query(new ZodPipe(reportQuerySchema)) q: RQ) {
    return this.reports.run(user, 'team-performance', q);
  }

  @Get('weekly-founder')
  @RequirePermission('reports:view', 'kpi:view')
  weekly(@CurrentUser() user: Principal, @Query(new ZodPipe(reportQuerySchema)) q: RQ) {
    return this.reports.run(user, 'weekly-founder', q);
  }

  @Get('monthly-founder')
  @RequirePermission('reports:view', 'kpi:view')
  monthly(@CurrentUser() user: Principal, @Query(new ZodPipe(reportQuerySchema)) q: RQ) {
    return this.reports.run(user, 'monthly-founder', q);
  }

  @Get('reconciliation')
  @RequirePermission('reports:view', 'kpi:view')
  reconciliation(@CurrentUser() user: Principal, @Query(new ZodPipe(analyticsQuerySchema)) q: Q) {
    return this.recon.check(user, q);
  }

  @Limited('REPORT')
  @Post('reconciliation/run')
  @RequirePermission('reports:view', 'kpi:view')
  reconciliationRun(@CurrentUser() user: Principal, @Body(new ZodPipe(analyticsQuerySchema)) q: Q) {
    return this.recon.run(user, q, 'MANUAL');
  }

  // ---- exports (declared before dynamic :id routes)
  @Limited('EXPORT')
  @Post('exports')
  @RequirePermission('reports:export')
  createExport(@CurrentUser() user: Principal, @Body(new ZodPipe(createExportSchema)) body: z.infer<typeof createExportSchema>) {
    return this.exports.create(user, body);
  }

  @Get('exports')
  @RequirePermission('reports:export')
  listExports(@CurrentUser() user: Principal, @Query(new ZodPipe(exportListQuerySchema)) q: z.infer<typeof exportListQuerySchema>) {
    return this.exports.list(user, q.limit);
  }

  @Get('exports/:id')
  @RequirePermission('reports:export')
  getExport(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.exports.get(user, id);
  }

  @Limited('DOWNLOAD')
  @Get('exports/:id/download')
  @RequirePermission('reports:export')
  async download(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const d = await this.exports.download(user, id);
    res.status(200).set({
      'Content-Type': d.contentType,
      'Content-Length': String(d.data.length),
      'Content-Disposition': `attachment; filename="${d.fileName.replace(/[^\w. ()\-+]/g, '_')}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    res.end(d.data);
  }

  // ---- saved filters
  @Get('saved-filters')
  @RequirePermission('reports:view')
  listSaved(@CurrentUser() user: Principal, @Query(new ZodPipe(savedFilterQuerySchema)) q: z.infer<typeof savedFilterQuerySchema>) {
    return this.saved.list(user, q.target);
  }

  @Post('saved-filters')
  @RequirePermission('reports:view')
  createSaved(@CurrentUser() user: Principal, @Body(new ZodPipe(savedFilterSchema)) body: z.infer<typeof savedFilterSchema>) {
    return this.saved.create(user, body);
  }

  @Delete('saved-filters/:id')
  @RequirePermission('reports:view')
  deleteSaved(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.saved.remove(user, id);
  }
}
