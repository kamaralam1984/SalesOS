import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createIncentivePolicySchema, createIncentiveRecommendationSchema, incentiveTransitionSchema, listIncentivesQuerySchema, markPaidSchema, updateIncentivePolicySchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequireAnyPermission, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { IncentivesService } from './incentives.service';

@ApiTags('incentives')
@Controller('incentives')
export class IncentivesController {
  constructor(private readonly svc: IncentivesService) {}

  @Get('policies')
  @RequirePermission('incentives:policy:view')
  policies(@CurrentUser() u: Principal) {
    return this.svc.listPolicies(u);
  }

  @Post('policies')
  @RequirePermission('incentives:policy:manage')
  createPolicy(@CurrentUser() u: Principal, @Body(new ZodPipe(createIncentivePolicySchema)) b: z.infer<typeof createIncentivePolicySchema>) {
    return this.svc.createPolicy(u, b);
  }

  @Patch('policies/:id')
  @RequirePermission('incentives:policy:manage')
  updatePolicy(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateIncentivePolicySchema)) b: z.infer<typeof updateIncentivePolicySchema>) {
    return this.svc.updatePolicy(u, id, b);
  }

  @Post('policies/:id/approve')
  @HttpCode(200)
  @RequirePermission('incentives:policy:approve')
  approvePolicy(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.approvePolicy(u, id);
  }

  @Get('recommendations')
  @RequirePermission('incentives:recommendation:view')
  list(@CurrentUser() u: Principal, @Query(new ZodPipe(listIncentivesQuerySchema)) q: z.infer<typeof listIncentivesQuerySchema>) {
    return this.svc.list(u, q);
  }

  @Post('recommendations')
  @RequirePermission('incentives:recommendation:create')
  create(@CurrentUser() u: Principal, @Body(new ZodPipe(createIncentiveRecommendationSchema)) b: z.infer<typeof createIncentiveRecommendationSchema>) {
    return this.svc.create(u, b);
  }

  @Get('recommendations/:id')
  @RequirePermission('incentives:recommendation:view')
  get(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u, id);
  }

  @Post('recommendations/:id/transition')
  @HttpCode(200)
  @RequireAnyPermission('incentives:recommendation:create', 'incentives:recommendation:approve', 'incentives:recommendation:mark-paid')
  transition(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(incentiveTransitionSchema)) b: z.infer<typeof incentiveTransitionSchema>) {
    return this.svc.transition(u, id, b);
  }

  @Post('recommendations/:id/mark-paid')
  @HttpCode(200)
  @RequirePermission('incentives:recommendation:mark-paid')
  markPaid(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(markPaidSchema)) b: z.infer<typeof markPaidSchema>) {
    return this.svc.markPaid(u, id, b);
  }

  @Get('adjustments')
  @RequirePermission('incentives:recommendation:view')
  adjustments(@CurrentUser() u: Principal) {
    return this.svc.adjustments(u);
  }
}
