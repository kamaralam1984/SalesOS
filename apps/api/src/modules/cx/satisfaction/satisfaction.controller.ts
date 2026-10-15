import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createSatisfactionSchema, createSurveyTemplateSchema, listRefundsViewQuerySchema, listSatisfactionQuerySchema, refundAnalyticsQuerySchema, satisfactionStatsQuerySchema, tagRefundRootCauseSchema, updateSurveyTemplateSchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { RefundsViewService } from './refunds-view.service';
import { SatisfactionService } from './satisfaction.service';

@ApiTags('cx-satisfaction')
@Controller('cx')
export class SatisfactionController {
  constructor(private readonly svc: SatisfactionService, private readonly refunds: RefundsViewService) {}

  @Get('satisfaction')
  @RequirePermission('satisfaction:view')
  list(@CurrentUser() u: Principal, @Query(new ZodPipe(listSatisfactionQuerySchema)) q: z.infer<typeof listSatisfactionQuerySchema>) {
    return this.svc.list(u, q);
  }

  @Get('satisfaction/stats')
  @RequirePermission('satisfaction:view')
  stats(@CurrentUser() u: Principal, @Query(new ZodPipe(satisfactionStatsQuerySchema)) q: z.infer<typeof satisfactionStatsQuerySchema>) {
    return this.svc.stats(u, q);
  }

  @Post('satisfaction')
  @RequirePermission('satisfaction:create')
  create(@CurrentUser() u: Principal, @Body(new ZodPipe(createSatisfactionSchema)) b: z.infer<typeof createSatisfactionSchema>) {
    return this.svc.create(u, b);
  }

  @Get('survey-templates')
  @RequirePermission('satisfaction:view')
  templates(@CurrentUser() u: Principal) {
    return this.svc.templates(u);
  }

  @Post('survey-templates')
  @RequirePermission('settings:update')
  createTemplate(@CurrentUser() u: Principal, @Body(new ZodPipe(createSurveyTemplateSchema)) b: z.infer<typeof createSurveyTemplateSchema>) {
    return this.svc.createTemplate(u, b);
  }

  @Patch('survey-templates/:id')
  @RequirePermission('settings:update')
  updateTemplate(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateSurveyTemplateSchema)) b: z.infer<typeof updateSurveyTemplateSchema>) {
    return this.svc.updateTemplate(u, id, b);
  }

  // ---- refund tracking view (reads the revenue domain)
  @Get('refunds')
  @RequirePermission('refunds:view')
  listRefunds(@CurrentUser() u: Principal, @Query(new ZodPipe(listRefundsViewQuerySchema)) q: z.infer<typeof listRefundsViewQuerySchema>) {
    return this.refunds.list(u, q);
  }

  @Get('refunds/analytics')
  @RequirePermission('refunds:view')
  refundAnalytics(@CurrentUser() u: Principal, @Query(new ZodPipe(refundAnalyticsQuerySchema)) q: z.infer<typeof refundAnalyticsQuerySchema>) {
    return this.refunds.analytics(u, q);
  }

  @Post('refunds/:refundId/root-cause')
  @HttpCode(200)
  @RequirePermission('refunds:view', 'complaints:update')
  tagRootCause(@CurrentUser() u: Principal, @Param('refundId', ParseUUIDPipe) refundId: string, @Body(new ZodPipe(tagRefundRootCauseSchema)) b: z.infer<typeof tagRefundRootCauseSchema>) {
    return this.refunds.tagRootCause(u, refundId, b);
  }
}
