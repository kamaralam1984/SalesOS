import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  adjustBalanceSchema, balanceQuerySchema, cancelLeaveSchema, createLeaveRequestSchema, leaveCalendarQuerySchema, leaveDecisionSchema, ledgerQuerySchema, listLeaveRequestsQuerySchema,
} from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequireAnyPermission, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { LeaveBalancesService } from './balances.service';
import { LeaveService } from './leave.service';

@ApiTags('workforce-leave')
@Controller('workforce/leave')
export class LeaveController {
  constructor(
    private readonly svc: LeaveService,
    private readonly balances: LeaveBalancesService,
  ) {}

  @Get('types')
  @RequireAnyPermission('leave:apply', 'leave:view')
  types(@CurrentUser() u: Principal) {
    return this.balances.types(u);
  }

  @Get('balances')
  @RequirePermission('leave:view')
  getBalances(@CurrentUser() u: Principal, @Query(new ZodPipe(balanceQuerySchema)) q: z.infer<typeof balanceQuerySchema>) {
    return this.balances.balances(u, q);
  }

  @Post('balances/adjust')
  @RequirePermission('leave:balance:adjust')
  adjust(@CurrentUser() u: Principal, @Body(new ZodPipe(adjustBalanceSchema)) b: z.infer<typeof adjustBalanceSchema>) {
    return this.balances.adjust(u, b);
  }

  @Get('ledger')
  @RequirePermission('leave:view')
  ledger(@CurrentUser() u: Principal, @Query(new ZodPipe(ledgerQuerySchema)) q: z.infer<typeof ledgerQuerySchema>) {
    return this.balances.ledger(u, q);
  }

  @Get('calendar')
  @RequirePermission('leave:view')
  calendar(@CurrentUser() u: Principal, @Query(new ZodPipe(leaveCalendarQuerySchema)) q: z.infer<typeof leaveCalendarQuerySchema>) {
    return this.balances.calendar(u, q);
  }

  @Post('requests')
  @RequirePermission('leave:apply')
  create(@CurrentUser() u: Principal, @Body(new ZodPipe(createLeaveRequestSchema)) b: z.infer<typeof createLeaveRequestSchema>) {
    return this.svc.create(u, b);
  }

  @Get('requests')
  @RequirePermission('leave:view')
  list(@CurrentUser() u: Principal, @Query(new ZodPipe(listLeaveRequestsQuerySchema)) q: z.infer<typeof listLeaveRequestsQuerySchema>) {
    return this.svc.list(u, q);
  }

  @Get('requests/:id')
  @RequirePermission('leave:view')
  get(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u, id);
  }

  @Post('requests/:id/decision')
  @HttpCode(200)
  @RequireAnyPermission('leave:approve', 'leave:approve-hr')
  decide(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(leaveDecisionSchema)) b: z.infer<typeof leaveDecisionSchema>) {
    return this.svc.decide(u, id, b);
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  @RequireAnyPermission('leave:apply', 'leave:approve-hr')
  cancel(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cancelLeaveSchema)) b: z.infer<typeof cancelLeaveSchema>) {
    return this.svc.cancel(u, id, b);
  }
}
