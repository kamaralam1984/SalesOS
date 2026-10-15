import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { adjustmentSchema, closeDealSchema, createDealSchema, decideAdjustmentSchema, escalateDealSchema, listDealsQuerySchema, reopenDealSchema, resolveBlockerSchema, updateDealSchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { AppError } from '../../../common/http/errors';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { DealsService } from './deals.service';

export function idempotencyKeyOf(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const k = raw.trim();
  if (k.length < 8 || k.length > 120 || !/^[\w.:-]+$/.test(k)) throw new AppError('VALIDATION_ERROR', 'Idempotency-Key must be 8-120 characters (letters, digits, . _ : -)', 400);
  return k;
}

@ApiTags('revenue/deals')
@Controller()
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  @Get('deals')
  @RequirePermission('deals:view')
  list(@CurrentUser() user: Principal, @Query(new ZodPipe(listDealsQuerySchema)) q: z.infer<typeof listDealsQuerySchema>) {
    return this.deals.list(user, q);
  }

  @Get('deals/pipeline')
  @RequirePermission('deals:view')
  pipeline(@CurrentUser() user: Principal) {
    return this.deals.pipeline(user);
  }

  @Get('leads/:id/deals')
  @RequirePermission('deals:view')
  forLead(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Query(new ZodPipe(listDealsQuerySchema)) q: z.infer<typeof listDealsQuerySchema>) {
    return this.deals.listForLead(user, id, q);
  }

  @Post('leads/:id/deals')
  @RequirePermission('deals:create')
  create(
    @CurrentUser() user: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(createDealSchema)) b: z.infer<typeof createDealSchema>,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.deals.createForLead(user, id, b, idempotencyKeyOf(key));
  }

  @Get('deals/:id')
  @RequirePermission('deals:view')
  get(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.deals.get(user, id);
  }

  @Patch('deals/:id')
  @RequirePermission('deals:update')
  update(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateDealSchema)) b: z.infer<typeof updateDealSchema>) {
    return this.deals.update(user, id, b);
  }

  /** Closes the deal won/lost in ONE transaction (deal, sales record, lead status history, expected payments, tasks, audit, outbox). */
  @Post('deals/:id/close')
  @HttpCode(200)
  @RequirePermission('deals:close')
  close(
    @CurrentUser() user: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(closeDealSchema)) b: z.infer<typeof closeDealSchema>,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.deals.close(user, id, b, idempotencyKeyOf(key));
  }

  @Post('deals/:id/escalate')
  @RequirePermission('deals:escalate')
  escalate(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(escalateDealSchema)) b: z.infer<typeof escalateDealSchema>) {
    return this.deals.escalate(user, id, b);
  }

  @Post('deals/:id/blockers/:blockerId/resolve')
  @HttpCode(200)
  @RequirePermission('deals:escalate')
  resolveBlocker(
    @CurrentUser() user: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('blockerId', ParseUUIDPipe) blockerId: string,
    @Body(new ZodPipe(resolveBlockerSchema)) b: z.infer<typeof resolveBlockerSchema>,
  ) {
    return this.deals.resolveBlocker(user, id, blockerId, b);
  }

  @Post('deals/:id/reopen')
  @HttpCode(200)
  @RequirePermission('deals:update')
  reopen(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reopenDealSchema)) b: z.infer<typeof reopenDealSchema>) {
    return this.deals.reopen(user, id, b);
  }

  @Post('deals/:id/adjustments')
  @RequirePermission('sales-adjustments:create')
  adjust(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(adjustmentSchema)) b: z.infer<typeof adjustmentSchema>) {
    return this.deals.createAdjustment(user, id, b);
  }

  @Post('deals/:id/adjustments/:adjustmentId/decision')
  @HttpCode(200)
  @RequirePermission('sales-adjustments:create')
  decideAdjustment(
    @CurrentUser() user: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('adjustmentId', ParseUUIDPipe) adjustmentId: string,
    @Body(new ZodPipe(decideAdjustmentSchema)) b: z.infer<typeof decideAdjustmentSchema>,
  ) {
    return this.deals.decideAdjustment(user, id, adjustmentId, b);
  }
}
