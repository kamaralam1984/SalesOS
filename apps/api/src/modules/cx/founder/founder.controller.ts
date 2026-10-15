import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createActionItemSchema, createFounderReportSchema, createRiskSchema, listActionItemsQuerySchema, listFounderReportsQuerySchema, listRisksQuerySchema, metricsQuerySchema,
  reviewFounderReportSchema, updateActionItemSchema, updateFounderReportSchema, updateRiskSchema,
} from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { ActionItemsService } from './action-items.service';
import { FounderReportsService } from './founder-reports.service';
import { RisksService } from './risks.service';

@ApiTags('founder-reporting')
@Controller()
export class FounderController {
  constructor(private readonly reports: FounderReportsService, private readonly risks: RisksService, private readonly items: ActionItemsService) {}

  // ---- reports (static segments before :id)
  @Get('founder-reports')
  @RequirePermission('founder-reports:view')
  list(@CurrentUser() u: Principal, @Query(new ZodPipe(listFounderReportsQuerySchema)) q: z.infer<typeof listFounderReportsQuerySchema>) {
    return this.reports.list(u, q);
  }

  @Get('founder-reports/metrics')
  @RequirePermission('founder-reports:view')
  metrics(@CurrentUser() u: Principal, @Query(new ZodPipe(metricsQuerySchema)) q: z.infer<typeof metricsQuerySchema>) {
    return this.reports.metrics(u, q);
  }

  @Post('founder-reports')
  @RequirePermission('founder-reports:create')
  create(@CurrentUser() u: Principal, @Body(new ZodPipe(createFounderReportSchema)) b: z.infer<typeof createFounderReportSchema>) {
    return this.reports.create(u, b);
  }

  @Get('founder-reports/:id')
  @RequirePermission('founder-reports:view')
  get(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.get(u, id);
  }

  @Patch('founder-reports/:id')
  @RequirePermission('founder-reports:create')
  update(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateFounderReportSchema)) b: z.infer<typeof updateFounderReportSchema>) {
    return this.reports.update(u, id, b);
  }

  @Post('founder-reports/:id/submit')
  @HttpCode(200)
  @RequirePermission('founder-reports:create')
  submit(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.publish(u, id);
  }

  @Get('founder-reports/:id/snapshot')
  @RequirePermission('founder-reports:view')
  snapshot(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.snapshot(u, id);
  }

  @Post('founder-reports/:id/new-version')
  @RequirePermission('founder-reports:create')
  newVersion(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.newVersion(u, id);
  }

  @Post('founder-reports/:id/review')
  @HttpCode(200)
  @RequirePermission('founder-reports:review')
  review(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reviewFounderReportSchema)) b: z.infer<typeof reviewFounderReportSchema>) {
    return this.reports.review(u, id, b);
  }

  // ---- risk register
  @Get('risk-register')
  @RequirePermission('founder-reports:view')
  listRisks(@CurrentUser() u: Principal, @Query(new ZodPipe(listRisksQuerySchema)) q: z.infer<typeof listRisksQuerySchema>) {
    return this.risks.list(u, q);
  }

  @Post('risk-register')
  @RequirePermission('founder-reports:create')
  createRisk(@CurrentUser() u: Principal, @Body(new ZodPipe(createRiskSchema)) b: z.infer<typeof createRiskSchema>) {
    return this.risks.create(u, b);
  }

  @Patch('risk-register/:id')
  @RequirePermission('founder-reports:create')
  updateRisk(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateRiskSchema)) b: z.infer<typeof updateRiskSchema>) {
    return this.risks.update(u, id, b);
  }

  // ---- action items
  @Get('action-items')
  @RequirePermission('action-items:view')
  listItems(@CurrentUser() u: Principal, @Query(new ZodPipe(listActionItemsQuerySchema)) q: z.infer<typeof listActionItemsQuerySchema>) {
    return this.items.list(u, q);
  }

  @Get('action-items/metrics')
  @RequirePermission('action-items:view')
  itemMetrics(@CurrentUser() u: Principal, @Query(new ZodPipe(metricsQuerySchema)) q: z.infer<typeof metricsQuerySchema>) {
    return this.items.metrics(u, q);
  }

  @Post('action-items')
  @RequirePermission('action-items:create')
  createItem(@CurrentUser() u: Principal, @Body(new ZodPipe(createActionItemSchema)) b: z.infer<typeof createActionItemSchema>) {
    return this.items.create(u, b);
  }

  @Get('action-items/:id')
  @RequirePermission('action-items:view')
  getItem(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.items.get(u, id);
  }

  @Patch('action-items/:id')
  @RequirePermission('action-items:update')
  updateItem(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateActionItemSchema)) b: z.infer<typeof updateActionItemSchema>) {
    return this.items.update(u, id, b);
  }
}
