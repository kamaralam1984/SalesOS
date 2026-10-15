import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  completeProbationReviewSchema, createExpectationSchema, createOnboardingPlanSchema, createOnboardingTemplateSchema, listOnboardingQuerySchema, updateOnboardingItemSchema,
} from '@salesos/validation';
import { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { OnboardingService } from './onboarding.service';

const expectationsQuery = z.object({ roleKey: z.string().max(60).optional() });

@ApiTags('people-onboarding')
@Controller('people')
export class OnboardingController {
  constructor(private readonly svc: OnboardingService) {}

  @Get('onboarding')
  @RequirePermission('onboarding:view')
  plans(@CurrentUser() u: Principal, @Query(new ZodPipe(listOnboardingQuerySchema)) q: z.infer<typeof listOnboardingQuerySchema>) {
    return this.svc.listPlans(u, q);
  }

  @Post('onboarding')
  @RequirePermission('onboarding:manage')
  createPlan(@CurrentUser() u: Principal, @Body(new ZodPipe(createOnboardingPlanSchema)) b: z.infer<typeof createOnboardingPlanSchema>) {
    return this.svc.createPlan(u, b);
  }

  @Get('onboarding/templates')
  @RequirePermission('onboarding:view')
  templates(@CurrentUser() u: Principal) {
    return this.svc.listTemplates(u);
  }

  @Post('onboarding/templates')
  @RequirePermission('onboarding:manage')
  createTemplate(@CurrentUser() u: Principal, @Body(new ZodPipe(createOnboardingTemplateSchema)) b: z.infer<typeof createOnboardingTemplateSchema>) {
    return this.svc.createTemplate(u, b);
  }

  @Patch('onboarding/items/:id')
  @RequirePermission('onboarding:view')
  updateItem(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateOnboardingItemSchema)) b: z.infer<typeof updateOnboardingItemSchema>) {
    return this.svc.updateItem(u, id, b);
  }

  @Get('probation')
  @RequirePermission('onboarding:view')
  probation(@CurrentUser() u: Principal, @Query(new ZodPipe(listOnboardingQuerySchema)) q: z.infer<typeof listOnboardingQuerySchema>) {
    return this.svc.listProbation(u, q);
  }

  @Post('probation/:id/complete')
  @HttpCode(200)
  @RequirePermission('onboarding:manage')
  completeProbation(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(completeProbationReviewSchema)) b: z.infer<typeof completeProbationReviewSchema>) {
    return this.svc.completeProbation(u, id, b);
  }

  @Get('expectations')
  @RequirePermission('onboarding:view')
  expectations(@CurrentUser() u: Principal, @Query(new ZodPipe(expectationsQuery)) q: z.infer<typeof expectationsQuery>) {
    return this.svc.expectations(u, q.roleKey);
  }

  /** Adoption of the ownership / accountability expectations (counts; names within scope). */
  @Get('expectations/adoption')
  @RequirePermission('onboarding:view')
  expectationAdoption(@CurrentUser() u: Principal) {
    return this.svc.expectationAdoption(u);
  }

  /** The employee acknowledges their own role's expectation (JD-HR-009). */
  @Post('expectations/:id/acknowledge')
  @HttpCode(200)
  @RequirePermission('onboarding:view')
  acknowledgeExpectation(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.acknowledgeExpectation(u, id);
  }

  @Post('expectations')
  @RequirePermission('onboarding:manage')
  createExpectation(@CurrentUser() u: Principal, @Body(new ZodPipe(createExpectationSchema)) b: z.infer<typeof createExpectationSchema>) {
    return this.svc.createExpectation(u, b);
  }
}
