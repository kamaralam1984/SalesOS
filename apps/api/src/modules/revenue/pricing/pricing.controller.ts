import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createProposalSchema, decideProposalSchema, listProposalsQuerySchema, withdrawProposalSchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequireAnyPermission, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { PricingService } from './pricing.service';

@ApiTags('revenue/pricing')
@Controller()
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get('revenue/programs')
  @RequireAnyPermission('deals:view', 'proposals:view', 'targets:view')
  programs(@CurrentUser() user: Principal) {
    return this.pricing.programs(user);
  }

  @Get('pricing/prices')
  @RequirePermission('proposals:view')
  prices(@CurrentUser() user: Principal) {
    return this.pricing.currentPrices(user);
  }

  @Get('pricing/programs/:programId/prices')
  @RequirePermission('proposals:view')
  history(@CurrentUser() user: Principal, @Param('programId', ParseUUIDPipe) programId: string) {
    return this.pricing.priceHistory(user, programId);
  }

  @Get('proposals')
  @RequirePermission('proposals:view')
  list(@CurrentUser() user: Principal, @Query(new ZodPipe(listProposalsQuerySchema)) q: z.infer<typeof listProposalsQuerySchema>) {
    return this.pricing.list(user, q);
  }

  @Post('proposals')
  @RequirePermission('proposals:create')
  create(@CurrentUser() user: Principal, @Body(new ZodPipe(createProposalSchema)) b: z.infer<typeof createProposalSchema>) {
    return this.pricing.create(user, b);
  }

  @Get('proposals/:id')
  @RequirePermission('proposals:view')
  get(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.pricing.get(user, id);
  }

  @Post('proposals/:id/submit')
  @HttpCode(200)
  @RequirePermission('proposals:create')
  submit(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.pricing.submit(user, id);
  }

  @Post('proposals/:id/withdraw')
  @HttpCode(200)
  @RequirePermission('proposals:create')
  withdraw(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(withdrawProposalSchema)) b: z.infer<typeof withdrawProposalSchema>) {
    return this.pricing.withdraw(user, id, b);
  }

  @Post('proposals/:id/decision')
  @HttpCode(200)
  @RequirePermission('proposals:approve')
  decide(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(decideProposalSchema)) b: z.infer<typeof decideProposalSchema>) {
    return this.pricing.decide(user, id, b);
  }
}
