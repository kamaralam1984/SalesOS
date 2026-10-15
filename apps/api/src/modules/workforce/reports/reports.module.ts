import { Module } from '@nestjs/common';
import { HrModule } from '../hr/hr.module';
import { WorkforceExportService } from './export.service';
import { WorkforceReportsController } from './reports.controller';
import { WorkforceReportsService } from './reports.service';

/** Workforce / reports and exports (DEC-048 area D2). Read-only over the area tables; scope comes from workforce:reports:view. */
@Module({
  imports: [HrModule],
  controllers: [WorkforceReportsController],
  providers: [WorkforceReportsService, WorkforceExportService],
})
export class ReportsModule {}
