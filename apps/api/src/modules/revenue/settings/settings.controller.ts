import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createInitiativeSchema, createPlanSchema, patchRevenueSettingsSchema, programThresholdSchema, updateInitiativeSchema, updatePlanSchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequireAnyPermission, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { SettingsService } from './settings.service';

@ApiTags('revenue/settings')
@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('revenue/settings')
  @RequireAnyPermission('forecasts:view', 'targets:view', 'deals:view')
  get(@CurrentUser() user: Principal) {
    return this.settings.get(user);
  }

  /** Founder only (proposals:approve is Founder-held): thresholds, fiscal year, stage probabilities. Audited. */
  @Patch('revenue/settings')
  @RequirePermission('proposals:approve')
  patch(@CurrentUser() user: Principal, @Body(new ZodPipe(patchRevenueSettingsSchema)) b: z.infer<typeof patchRevenueSettingsSchema>) {
    return this.settings.patch(user, b);
  }

  @Patch('revenue/programs/:programId/threshold')
  @RequirePermission('proposals:approve')
  programThreshold(@CurrentUser() user: Principal, @Param('programId', ParseUUIDPipe) programId: string, @Body(new ZodPipe(programThresholdSchema)) b: z.infer<typeof programThresholdSchema>) {
    return this.settings.setProgramThreshold(user, programId, b);
  }

  @Get('strategy-plans')
  @RequirePermission('targets:view')
  listPlans(@CurrentUser() user: Principal) {
    return this.settings.listPlans(user);
  }

  @Post('strategy-plans')
  @RequirePermission('targets:update')
  createPlan(@CurrentUser() user: Principal, @Body(new ZodPipe(createPlanSchema)) b: z.infer<typeof createPlanSchema>) {
    return this.settings.createPlan(user, b);
  }

  @Patch('strategy-plans/:id')
  @RequirePermission('targets:update')
  updatePlan(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updatePlanSchema)) b: z.infer<typeof updatePlanSchema>) {
    return this.settings.updatePlan(user, id, b);
  }

  @Post('strategy-plans/:id/initiatives')
  @RequirePermission('targets:update')
  addInitiative(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(createInitiativeSchema)) b: z.infer<typeof createInitiativeSchema>) {
    return this.settings.addInitiative(user, id, b);
  }

  @Patch('strategy-initiatives/:id')
  @RequirePermission('targets:update')
  updateInitiative(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateInitiativeSchema)) b: z.infer<typeof updateInitiativeSchema>) {
    return this.settings.updateInitiative(user, id, b);
  }
}
