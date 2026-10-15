import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  acknowledgeReviewSchema, createKpiDefinitionSchema, createReviewSchema, listKpiAssignmentsQuerySchema, listReviewsQuerySchema, listScorecardsQuerySchema, updateReviewSchema, upsertKpiAssignmentSchema, upsertScorecardSchema,
} from '@salesos/validation';
import { z } from 'zod';
import { CurrentUser, RequireAnyPermission, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { PerformanceService } from './performance.service';

const updateCompetencySchema = z.object({ description: z.string().trim().max(1000).optional(), isActive: z.boolean().optional() });

@ApiTags('people-performance')
@Controller('people')
export class PerformanceController {
  constructor(private readonly svc: PerformanceService) {}

  @Get('competencies')
  @RequireAnyPermission('reviews:view', 'hiring:view', 'onboarding:view')
  competencies(@CurrentUser() u: Principal) {
    return this.svc.competencies(u);
  }

  @Patch('competencies/:id')
  @RequirePermission('reviews:approve')
  updateCompetency(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateCompetencySchema)) b: z.infer<typeof updateCompetencySchema>) {
    return this.svc.updateCompetency(u, id, b);
  }

  @Get('team-members')
  @RequireAnyPermission('coaching:view', 'kpi-assignments:view')
  teamMembers(@CurrentUser() u: Principal) {
    return this.svc.teamMembers(u);
  }

  @Get('kpi-definitions')
  @RequirePermission('kpi-assignments:view')
  kpiDefinitions(@CurrentUser() u: Principal) {
    return this.svc.listKpiDefinitions(u);
  }

  @Post('kpi-definitions')
  @RequirePermission('kpi-assignments:manage')
  createKpiDefinition(@CurrentUser() u: Principal, @Body(new ZodPipe(createKpiDefinitionSchema)) b: z.infer<typeof createKpiDefinitionSchema>) {
    return this.svc.createKpiDefinition(u, b);
  }

  @Get('kpi-assignments')
  @RequirePermission('kpi-assignments:view')
  kpiAssignments(@CurrentUser() u: Principal, @Query(new ZodPipe(listKpiAssignmentsQuerySchema)) q: z.infer<typeof listKpiAssignmentsQuerySchema>) {
    return this.svc.listKpiAssignments(u, q);
  }

  @Post('kpi-assignments')
  @HttpCode(200)
  @RequirePermission('kpi-assignments:manage')
  setKpiAssignment(@CurrentUser() u: Principal, @Body(new ZodPipe(upsertKpiAssignmentSchema)) b: z.infer<typeof upsertKpiAssignmentSchema>) {
    return this.svc.upsertKpiAssignment(u, b);
  }

  @Get('scorecards')
  @RequirePermission('scorecards:view')
  scorecards(@CurrentUser() u: Principal, @Query(new ZodPipe(listScorecardsQuerySchema)) q: z.infer<typeof listScorecardsQuerySchema>) {
    return this.svc.listScorecards(u, q);
  }

  @Post('scorecards')
  @HttpCode(200)
  @RequirePermission('kpi-assignments:manage')
  saveScorecard(@CurrentUser() u: Principal, @Body(new ZodPipe(upsertScorecardSchema)) b: z.infer<typeof upsertScorecardSchema>) {
    return this.svc.upsertScorecard(u, b);
  }

  @Get('reviews')
  @RequirePermission('reviews:view')
  reviews(@CurrentUser() u: Principal, @Query(new ZodPipe(listReviewsQuerySchema)) q: z.infer<typeof listReviewsQuerySchema>) {
    return this.svc.listReviews(u, q);
  }

  @Post('reviews')
  @RequirePermission('reviews:create')
  createReview(@CurrentUser() u: Principal, @Body(new ZodPipe(createReviewSchema)) b: z.infer<typeof createReviewSchema>) {
    return this.svc.createReview(u, b);
  }

  @Get('reviews/:id')
  @RequirePermission('reviews:view')
  review(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getReview(u, id);
  }

  @Patch('reviews/:id')
  @RequirePermission('reviews:create')
  updateReview(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateReviewSchema)) b: z.infer<typeof updateReviewSchema>) {
    return this.svc.updateReview(u, id, b);
  }

  @Post('reviews/:id/submit')
  @HttpCode(200)
  @RequirePermission('reviews:create')
  submitReview(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.submitReview(u, id);
  }

  @Post('reviews/:id/approve')
  @HttpCode(200)
  @RequirePermission('reviews:approve')
  approveReview(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.approveReview(u, id);
  }

  @Post('reviews/:id/acknowledge')
  @HttpCode(200)
  @RequirePermission('reviews:view')
  acknowledgeReview(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(acknowledgeReviewSchema)) b: z.infer<typeof acknowledgeReviewSchema>) {
    return this.svc.acknowledgeReview(u, id, b);
  }
}
