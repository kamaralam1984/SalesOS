import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

/** Workforce attendance (area A, DEC-048): web check-in/out, month view, team summary, audited HR/manager corrections. */
@Module({ controllers: [AttendanceController], providers: [AttendanceService] })
export class AttendanceModule {}
