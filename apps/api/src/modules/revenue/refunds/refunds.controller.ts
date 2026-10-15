import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { approveRefundSchema, closeRefundSchema, createRefundSchema, listRefundsQuerySchema, processRefundSchema, reconcileRefundSchema, rejectRefundSchema, reviewRefundSchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { idempotencyKeyOf } from '../deals/deals.controller';
import { RefundsService } from './refunds.service';

/** Refund state machine: requested -> reviewed -> approved/rejected -> processed -> reconciled. No automatic payout. */
@ApiTags('revenue/refunds')
@Controller('refunds')
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Get()
  @RequirePermission('refunds:view')
  list(@CurrentUser() user: Principal, @Query(new ZodPipe(listRefundsQuerySchema)) q: z.infer<typeof listRefundsQuerySchema>) {
    return this.refunds.list(user, q);
  }

  @Post()
  @RequirePermission('refunds:request')
  request(@CurrentUser() user: Principal, @Body(new ZodPipe(createRefundSchema)) b: z.infer<typeof createRefundSchema>, @Headers('idempotency-key') key?: string) {
    return this.refunds.request(user, b, idempotencyKeyOf(key));
  }

  @Get(':id')
  @RequirePermission('refunds:view')
  get(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.refunds.get(user, id);
  }

  @Post(':id/review')
  @HttpCode(200)
  @RequirePermission('refunds:review')
  review(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reviewRefundSchema)) b: z.infer<typeof reviewRefundSchema>) {
    return this.refunds.review(user, id, b);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('refunds:approve')
  approve(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(approveRefundSchema)) b: z.infer<typeof approveRefundSchema>) {
    return this.refunds.approve(user, id, b);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermission('refunds:approve')
  reject(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(rejectRefundSchema)) b: z.infer<typeof rejectRefundSchema>) {
    return this.refunds.reject(user, id, b);
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  @RequirePermission('refunds:request')
  withdraw(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(closeRefundSchema)) b: z.infer<typeof closeRefundSchema>) {
    return this.refunds.withdraw(user, id, b);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('refunds:approve')
  cancel(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(closeRefundSchema)) b: z.infer<typeof closeRefundSchema>) {
    return this.refunds.cancel(user, id, b);
  }

  @Post(':id/process')
  @HttpCode(200)
  @RequirePermission('refunds:process')
  process(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(processRefundSchema)) b: z.infer<typeof processRefundSchema>) {
    return this.refunds.process(user, id, b);
  }

  @Post(':id/reconcile')
  @HttpCode(200)
  @RequirePermission('refunds:reconcile')
  reconcile(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reconcileRefundSchema)) b: z.infer<typeof reconcileRefundSchema>) {
    return this.refunds.reconcile(user, id, b);
  }
}
