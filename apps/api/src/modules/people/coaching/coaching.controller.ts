import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  coachingHoursQuerySchema, createCoachingSessionSchema, createOneOnOneSchema, listActionsQuerySchema, listCoachingQuerySchema, listOneOnOnesQuerySchema, updateActionSchema, updateCoachingSessionSchema,
} from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { CoachingService } from './coaching.service';

@ApiTags('coaching')
@Controller('coaching')
export class CoachingController {
  constructor(private readonly svc: CoachingService) {}

  @Get('sessions')
  @RequirePermission('coaching:view')
  list(@CurrentUser() u: Principal, @Query(new ZodPipe(listCoachingQuerySchema)) q: z.infer<typeof listCoachingQuerySchema>) {
    return this.svc.listSessions(u, q);
  }

  @Post('sessions')
  @RequirePermission('coaching:create')
  create(@CurrentUser() u: Principal, @Body(new ZodPipe(createCoachingSessionSchema)) b: z.infer<typeof createCoachingSessionSchema>) {
    return this.svc.createSession(u, b);
  }

  @Get('sessions/:id')
  @RequirePermission('coaching:view')
  get(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getSession(u, id);
  }

  @Patch('sessions/:id')
  @RequirePermission('coaching:update')
  update(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateCoachingSessionSchema)) b: z.infer<typeof updateCoachingSessionSchema>) {
    return this.svc.updateSession(u, id, b);
  }

  @Get('one-on-ones')
  @RequirePermission('coaching:view')
  oneOnOnes(@CurrentUser() u: Principal, @Query(new ZodPipe(listOneOnOnesQuerySchema)) q: z.infer<typeof listOneOnOnesQuerySchema>) {
    return this.svc.listOneOnOnes(u, q);
  }

  @Post('one-on-ones')
  @RequirePermission('coaching:create')
  createOneOnOne(@CurrentUser() u: Principal, @Body(new ZodPipe(createOneOnOneSchema)) b: z.infer<typeof createOneOnOneSchema>) {
    return this.svc.createOneOnOne(u, b);
  }

  @Get('actions')
  @RequirePermission('coaching:view')
  actions(@CurrentUser() u: Principal, @Query(new ZodPipe(listActionsQuerySchema)) q: z.infer<typeof listActionsQuerySchema>) {
    return this.svc.listActions(u, q);
  }

  @Patch('actions/:id')
  @HttpCode(200)
  @RequirePermission('coaching:view')
  updateAction(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateActionSchema)) b: z.infer<typeof updateActionSchema>) {
    return this.svc.updateAction(u, id, b);
  }

  @Get('hours')
  @RequirePermission('coaching:view')
  hours(@CurrentUser() u: Principal, @Query(new ZodPipe(coachingHoursQuerySchema)) q: z.infer<typeof coachingHoursQuerySchema>) {
    return this.svc.hours(u, q);
  }
}
