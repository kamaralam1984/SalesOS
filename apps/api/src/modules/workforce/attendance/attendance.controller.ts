import { Body, Controller, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { attendanceCorrectionSchema, attendanceMonthQuerySchema, checkInSchema, checkOutSchema, correctionsQuerySchema, teamSummaryQuerySchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { AttendanceService } from './attendance.service';

@ApiTags('workforce-attendance')
@Controller('workforce/attendance')
export class AttendanceController {
  constructor(private readonly svc: AttendanceService) {}

  @Post('check-in')
  @RequirePermission('attendance:self')
  checkIn(@CurrentUser() u: Principal, @Body(new ZodPipe(checkInSchema)) b: z.infer<typeof checkInSchema>) {
    return this.svc.checkIn(u, b);
  }

  @Post('check-out')
  @HttpCode(200)
  @RequirePermission('attendance:self')
  checkOut(@CurrentUser() u: Principal, @Body(new ZodPipe(checkOutSchema)) _b: z.infer<typeof checkOutSchema>) {
    return this.svc.checkOut(u);
  }

  @Get('today')
  @RequirePermission('attendance:self')
  today(@CurrentUser() u: Principal) {
    return this.svc.today(u);
  }

  @Get('month')
  @RequirePermission('attendance:view')
  month(@CurrentUser() u: Principal, @Query(new ZodPipe(attendanceMonthQuerySchema)) q: z.infer<typeof attendanceMonthQuerySchema>) {
    return this.svc.month(u, q);
  }

  @Get('team-summary')
  @RequirePermission('attendance:view')
  teamSummary(@CurrentUser() u: Principal, @Query(new ZodPipe(teamSummaryQuerySchema)) q: z.infer<typeof teamSummaryQuerySchema>) {
    return this.svc.teamSummary(u, q);
  }

  @Put('records')
  @HttpCode(200)
  @RequirePermission('attendance:correct')
  correct(@CurrentUser() u: Principal, @Body(new ZodPipe(attendanceCorrectionSchema)) b: z.infer<typeof attendanceCorrectionSchema>) {
    return this.svc.correct(u, b);
  }

  @Get('corrections')
  @RequirePermission('attendance:view')
  corrections(@CurrentUser() u: Principal, @Query(new ZodPipe(correctionsQuerySchema)) q: z.infer<typeof correctionsQuerySchema>) {
    return this.svc.corrections(u, q);
  }
}
