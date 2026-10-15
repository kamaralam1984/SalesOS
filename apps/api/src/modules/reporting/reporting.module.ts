import { Module, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma';
import { RevenueModule } from '../revenue/revenue.module';
import { DashboardsService } from './dashboards/dashboards.service';
import { ExportRunner, ExportsService } from './exports/exports.service';
import { AnalyticsReportDataProvider } from './founder/report-data.provider';
import { KpiCache } from './kpi/cache';
import { FilterOptionsService } from './kpi/filter-options.service';
import { KpiService } from './kpi/kpi.service';
import { ScopeService } from './kpi/scope';
import { ReconciliationService } from './reconciliation/reconciliation.service';
import { ReportsService } from './reports/reports.service';
import { DashboardsController, KpisController, ReportsController } from './reporting.controllers';
import { SavedFiltersService } from './saved-filters/saved-filters.service';
import { ensureAnalyticsIndexes } from './analytics-indexes';
import { autoDdlEnabled } from '../../common/prisma/auto-ddl';
import { ReportingScheduler, SnapshotService } from './snapshots/snapshots.service';

/**
 * Reporting / analytics domain (Phase 5): the shared role-scoped KPI engine, dashboards, reports, exports, reconciliation.
 * Pure money maths is reused from modules/revenue/calc via the revenue MetricsService; nothing here re-implements it.
 * `AnalyticsReportDataProvider` is the real implementation of the CX module's REPORT_DATA_PROVIDER seam (see docs/analytics-report.md).
 */
@Module({
  imports: [RevenueModule],
  controllers: [DashboardsController, KpisController, ReportsController],
  providers: [ScopeService, FilterOptionsService, KpiCache, KpiService, ReportsService, ReconciliationService, DashboardsService, ExportsService, ExportRunner, SavedFiltersService, SnapshotService, ReportingScheduler, AnalyticsReportDataProvider],
  exports: [KpiService, KpiCache, ScopeService, ReportsService, AnalyticsReportDataProvider],
})
export class ReportingModule implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}
  async onModuleInit() {
    if (autoDdlEnabled()) await ensureAnalyticsIndexes(this.prisma);
  }
}
