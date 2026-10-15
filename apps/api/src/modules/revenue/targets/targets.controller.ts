import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { asOfQuerySchema, createPeriodSchema, createTargetSchema, decideRevisionSchema, listPeriodsQuerySchema, listTargetsQuerySchema, reviseTargetSchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { TargetsService } from './targets.service';

@ApiTags('revenue/targets')
@Controller('targets')
export class TargetsController {
  constructor(private readonly targets: TargetsService) {}

  @Get('periods')
  @RequirePermission('targets:view')
  periods(@CurrentUser() user: Principal, @Query(new ZodPipe(listPeriodsQuerySchema)) q: z.infer<typeof listPeriodsQuerySchema>) {
    return this.targets.listPeriods(user, q);
  }

  @Post('periods')
  @RequirePermission('targets:create')
  createPeriod(@CurrentUser() user: Principal, @Body(new ZodPipe(createPeriodSchema)) b: z.infer<typeof createPeriodSchema>) {
    return this.targets.createPeriod(user, b);
  }

  @Get()
  @RequirePermission('targets:view')
  list(@CurrentUser() user: Principal, @Query(new ZodPipe(listTargetsQuerySchema)) q: z.infer<typeof listTargetsQuerySchema>) {
    return this.targets.list(user, q);
  }

  @Post()
  @RequirePermission('targets:create')
  create(@CurrentUser() user: Principal, @Body(new ZodPipe(createTargetSchema)) b: z.infer<typeof createTargetSchema>) {
    return this.targets.create(user, b);
  }

  @Get(':id')
  @RequirePermission('targets:view')
  get(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.targets.get(user, id);
  }

  /** Proposes a revision (reason required). The target value only changes when the revision is approved. */
  @Patch(':id')
  @RequirePermission('targets:update')
  revise(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reviseTargetSchema)) b: z.infer<typeof reviseTargetSchema>) {
    return this.targets.revise(user, id, b);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('targets:approve')
  approve(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(decideRevisionSchema)) b: z.infer<typeof decideRevisionSchema>) {
    return this.targets.decide(user, id, b);
  }

  @Get(':id/breakdown')
  @RequirePermission('targets:view')
  breakdown(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.targets.breakdown(user, id);
  }

  @Get(':id/revisions')
  @RequirePermission('targets:view')
  revisions(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.targets.revisions(user, id);
  }

  @Get(':id/achievement')
  @RequirePermission('targets:view')
  achievement(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Query(new ZodPipe(asOfQuerySchema)) q: z.infer<typeof asOfQuerySchema>) {
    return this.targets.achievement(user, id, q);
  }
}
