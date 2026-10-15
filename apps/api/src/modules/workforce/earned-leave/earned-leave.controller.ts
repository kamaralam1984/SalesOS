import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { earnedLeaveProgressQuerySchema, earnedLeaveRunSchema, earnedLeaveTransactionsQuerySchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { EarnedLeaveService } from './earned-leave.service';

@ApiTags('workforce-earned-leave')
@Controller('workforce/earned-leave')
export class EarnedLeaveController {
  constructor(private readonly svc: EarnedLeaveService) {}

  @Get('progress')
  @RequirePermission('leave:view')
  progress(@CurrentUser() u: Principal, @Query(new ZodPipe(earnedLeaveProgressQuerySchema)) q: z.infer<typeof earnedLeaveProgressQuerySchema>) {
    return this.svc.progress(u, q);
  }

  @Get('transactions')
  @RequirePermission('leave:view')
  transactions(@CurrentUser() u: Principal, @Query(new ZodPipe(earnedLeaveTransactionsQuerySchema)) q: z.infer<typeof earnedLeaveTransactionsQuerySchema>) {
    return this.svc.transactions(u, q);
  }

  @Post('run')
  @HttpCode(200)
  @RequirePermission('leave:balance:adjust')
  run(@CurrentUser() u: Principal, @Body(new ZodPipe(earnedLeaveRunSchema)) b: z.infer<typeof earnedLeaveRunSchema>) {
    return this.svc.run(u, b);
  }
}
