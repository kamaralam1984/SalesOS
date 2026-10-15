import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { dailyCollectionsQuerySchema, listPaymentsQuerySchema, reconcileRunSchema, reconciliationQuerySchema, recordPaymentSchema, rejectPaymentSchema, reversePaymentSchema, verifyPaymentSchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { idempotencyKeyOf } from '../deals/deals.controller';
import { CollectionsService } from './collections.service';

@ApiTags('revenue/collections')
@Controller('collections')
export class CollectionsController {
  constructor(private readonly c: CollectionsService) {}

  @Get()
  @RequirePermission('collections:view')
  list(@CurrentUser() user: Principal, @Query(new ZodPipe(listPaymentsQuerySchema)) q: z.infer<typeof listPaymentsQuerySchema>) {
    return this.c.list(user, q);
  }

  @Get('daily')
  @RequirePermission('collections:view')
  daily(@CurrentUser() user: Principal, @Query(new ZodPipe(dailyCollectionsQuerySchema)) q: z.infer<typeof dailyCollectionsQuerySchema>) {
    return this.c.daily(user, q);
  }

  @Get('reconciliation')
  @RequirePermission('collections:reconcile')
  reconciliation(@CurrentUser() user: Principal, @Query(new ZodPipe(reconciliationQuerySchema)) q: z.infer<typeof reconciliationQuerySchema>) {
    return this.c.reconciliation(user, q);
  }

  @Post('reconciliation/run')
  @HttpCode(200)
  @RequirePermission('collections:reconcile')
  run(@CurrentUser() user: Principal, @Body(new ZodPipe(reconcileRunSchema)) b: z.infer<typeof reconcileRunSchema>) {
    return this.c.runReconciliation(user, b);
  }

  @Post()
  @RequirePermission('collections:create')
  record(@CurrentUser() user: Principal, @Body(new ZodPipe(recordPaymentSchema)) b: z.infer<typeof recordPaymentSchema>, @Headers('idempotency-key') key?: string) {
    return this.c.record(user, b, idempotencyKeyOf(key));
  }

  @Get(':id')
  @RequirePermission('collections:view')
  get(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.c.get(user, id);
  }

  @Post(':id/verify')
  @HttpCode(200)
  @RequirePermission('collections:verify')
  verify(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(verifyPaymentSchema)) b: z.infer<typeof verifyPaymentSchema>) {
    return this.c.verify(user, id, b);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermission('collections:verify')
  reject(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(rejectPaymentSchema)) b: z.infer<typeof rejectPaymentSchema>) {
    return this.c.reject(user, id, b);
  }

  @Post(':id/reverse')
  @HttpCode(200)
  @RequirePermission('collections:reconcile')
  reverse(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reversePaymentSchema)) b: z.infer<typeof reversePaymentSchema>) {
    return this.c.reverse(user, id, b);
  }
}
