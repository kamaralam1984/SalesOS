import { Module } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service';
import { DashboardService } from './dashboard.service';
import { AnnouncementsController, DirectoryController, OrgChartController, WorkforceDashboardController } from './directory.controller';
import { DirectoryService } from './directory.service';
import { OrgChartService } from './org-chart.service';

/** Workforce directory, Employee 360, organisation chart, hub dashboard and announcements (area D1, DEC-048). Reads other areas' tables read-only. */
@Module({
  controllers: [DirectoryController, OrgChartController, WorkforceDashboardController, AnnouncementsController],
  providers: [DirectoryService, OrgChartService, DashboardService, AnnouncementsService],
  exports: [AnnouncementsService],
})
export class DirectoryModule {}
