import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createInsightSchema, createPlanLinkSchema, listInsightsQuerySchema, listPlanLinksQuerySchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../common/authz';
import { ZodPipe } from '../../common/http/zod.pipe';
import { InsightsService } from './insights/insights.service';
import { PlanLinksService } from './plan/plan-links.service';

@ApiTags('collaboration')
@Controller()
export class CollaborationController {
  constructor(private readonly plans: PlanLinksService, private readonly insights: InsightsService) {}

  @Get('collaboration/plan-links')
  @RequirePermission('xf-tasks:view')
  listPlans(@CurrentUser() u: Principal, @Query(new ZodPipe(listPlanLinksQuerySchema)) q: z.infer<typeof listPlanLinksQuerySchema>) {
    return this.plans.list(u, q);
  }

  @Post('collaboration/plan-links')
  @RequirePermission('xf-tasks:create')
  createPlan(@CurrentUser() u: Principal, @Body(new ZodPipe(createPlanLinkSchema)) b: z.infer<typeof createPlanLinkSchema>) {
    return this.plans.create(u, b);
  }

  @Get('cx/insights')
  @RequirePermission('insights:share')
  listInsights(@CurrentUser() u: Principal, @Query(new ZodPipe(listInsightsQuerySchema)) q: z.infer<typeof listInsightsQuerySchema>) {
    return this.insights.list(u, q);
  }

  @Post('cx/insights')
  @RequirePermission('insights:share')
  createInsight(@CurrentUser() u: Principal, @Body(new ZodPipe(createInsightSchema)) b: z.infer<typeof createInsightSchema>) {
    return this.insights.create(u, b);
  }
}
