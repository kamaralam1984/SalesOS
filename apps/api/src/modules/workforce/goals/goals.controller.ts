import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createGoalSchema, createMilestoneSchema, goalCancelSchema, goalCommentSchema, goalProgressSchema, goalReturnSchema, goalSubmitSchema, goalVerifySchema,
  listGoalsQuerySchema, updateGoalSchema, updateMilestoneSchema,
} from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequireAnyPermission, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { GoalsService } from './goals.service';

@ApiTags('workforce-goals')
@Controller('workforce/goals')
export class GoalsController {
  constructor(private readonly svc: GoalsService) {}

  @Post()
  @RequirePermission('goals:create')
  create(@CurrentUser() u: Principal, @Body(new ZodPipe(createGoalSchema)) b: z.infer<typeof createGoalSchema>) {
    return this.svc.create(u, b);
  }

  @Get()
  @RequirePermission('goals:view')
  list(@CurrentUser() u: Principal, @Query(new ZodPipe(listGoalsQuerySchema)) q: z.infer<typeof listGoalsQuerySchema>) {
    return this.svc.list(u, q);
  }

  @Get('summary')
  @RequirePermission('goals:view')
  summary(@CurrentUser() u: Principal) {
    return this.svc.summary(u);
  }

  @Get(':id')
  @RequirePermission('goals:view')
  get(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u, id);
  }

  @Patch(':id')
  @RequirePermission('goals:update')
  update(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateGoalSchema)) b: z.infer<typeof updateGoalSchema>) {
    return this.svc.update(u, id, b);
  }

  @Post(':id/progress')
  @HttpCode(200)
  @RequirePermission('goals:update')
  progress(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(goalProgressSchema)) b: z.infer<typeof goalProgressSchema>) {
    return this.svc.progress(u, id, b);
  }

  @Post(':id/milestones')
  @RequirePermission('goals:update')
  addMilestone(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(createMilestoneSchema)) b: z.infer<typeof createMilestoneSchema>) {
    return this.svc.addMilestone(u, id, b);
  }

  @Patch(':id/milestones/:milestoneId')
  @RequirePermission('goals:update')
  updateMilestone(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Param('milestoneId', ParseUUIDPipe) mid: string, @Body(new ZodPipe(updateMilestoneSchema)) b: z.infer<typeof updateMilestoneSchema>) {
    return this.svc.updateMilestone(u, id, mid, b);
  }

  @Post(':id/comment')
  @RequireAnyPermission('goals:update', 'goals:review')
  comment(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(goalCommentSchema)) b: z.infer<typeof goalCommentSchema>) {
    return this.svc.comment(u, id, b);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission('goals:update')
  submit(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(goalSubmitSchema)) b: z.infer<typeof goalSubmitSchema>) {
    return this.svc.submit(u, id, b);
  }

  @Post(':id/verify')
  @HttpCode(200)
  @RequirePermission('goals:review')
  verify(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(goalVerifySchema)) b: z.infer<typeof goalVerifySchema>) {
    return this.svc.verify(u, id, b);
  }

  @Post(':id/return')
  @HttpCode(200)
  @RequirePermission('goals:review')
  returnGoal(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(goalReturnSchema)) b: z.infer<typeof goalReturnSchema>) {
    return this.svc.returnGoal(u, id, b);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequireAnyPermission('goals:update', 'goals:review')
  cancel(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(goalCancelSchema)) b: z.infer<typeof goalCancelSchema>) {
    return this.svc.cancel(u, id, b);
  }
}
