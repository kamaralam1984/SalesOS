import { Global, Module } from '@nestjs/common';
import { AttendanceModule } from './attendance/attendance.module';
import { DirectoryModule } from './directory/directory.module';
import { EarnedLeaveModule } from './earned-leave/earned-leave.module';
import { GoalsModule } from './goals/goals.module';
import { HolidaysModule } from './holidays/holidays.module';
import { HrModule } from './hr/hr.module';
import { LeaveModule } from './leave/leave.module';
import { PayrollModule } from './payroll/payroll.module';
import { ReportsModule } from './reports/reports.module';
import { WorkforceConfigService } from './common/workforce-config.service';
import { WorkforceSettingsController } from './settings/workforce-settings.controller';
import { WorkforceSettingsService } from './settings/workforce-settings.service';
import { TasksModule } from './tasks/tasks.module';

/** Workforce domain (DEC-048): attendance, holidays, leave, Earned Leave, goals, work tasks, payroll, directory/org chart, HR automation, reports. */
@Global()
@Module({
  imports: [AttendanceModule, HolidaysModule, LeaveModule, EarnedLeaveModule, GoalsModule, TasksModule, PayrollModule, DirectoryModule, HrModule, ReportsModule],
  controllers: [WorkforceSettingsController],
  providers: [WorkforceConfigService, WorkforceSettingsService],
  exports: [WorkforceConfigService, WorkforceSettingsService],
})
export class WorkforceModule {}
