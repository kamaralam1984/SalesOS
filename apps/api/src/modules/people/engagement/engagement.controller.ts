import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createSurveySchema, engagementResultsQuerySchema, submitSurveyResponseSchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { EngagementService } from './engagement.service';

@ApiTags('engagement')
@Controller('engagement')
export class EngagementController {
  constructor(private readonly svc: EngagementService) {}

  @Get('surveys')
  @RequirePermission('engagement:respond')
  surveys(@CurrentUser() u: Principal) {
    return this.svc.openSurveys(u);
  }

  @Post('surveys')
  @RequirePermission('hr:records:manage')
  createSurvey(@CurrentUser() u: Principal, @Body(new ZodPipe(createSurveySchema)) b: z.infer<typeof createSurveySchema>) {
    return this.svc.createSurvey(u, b);
  }

  @Post('responses')
  @HttpCode(200)
  @RequirePermission('engagement:respond')
  respond(@CurrentUser() u: Principal, @Body(new ZodPipe(submitSurveyResponseSchema)) b: z.infer<typeof submitSurveyResponseSchema>) {
    return this.svc.respond(u, b);
  }

  @Get('results')
  @RequirePermission('engagement:view')
  results(@CurrentUser() u: Principal, @Query(new ZodPipe(engagementResultsQuerySchema)) q: z.infer<typeof engagementResultsQuerySchema>) {
    return this.svc.results(u, q.surveyId);
  }
}
