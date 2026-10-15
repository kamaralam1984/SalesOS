import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createFeedbackSchema, createGrowthSchema, listFeedbackQuerySchema, listGrowthQuerySchema, updateFeedbackSchema, updateGrowthSchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { IntelService } from './intel.service';

@ApiTags('revenue/market-intel')
@Controller()
export class IntelController {
  constructor(private readonly intel: IntelService) {}

  @Get('feedback')
  @RequirePermission('market-intel:view')
  listFeedback(@CurrentUser() user: Principal, @Query(new ZodPipe(listFeedbackQuerySchema)) q: z.infer<typeof listFeedbackQuerySchema>) {
    return this.intel.listFeedback(user, q);
  }

  @Post('feedback')
  @RequirePermission('market-intel:create')
  createFeedback(@CurrentUser() user: Principal, @Body(new ZodPipe(createFeedbackSchema)) b: z.infer<typeof createFeedbackSchema>) {
    return this.intel.createFeedback(user, b);
  }

  @Patch('feedback/:id')
  @RequirePermission('market-intel:create')
  updateFeedback(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateFeedbackSchema)) b: z.infer<typeof updateFeedbackSchema>) {
    return this.intel.updateFeedback(user, id, b);
  }

  @Get('growth-opportunities')
  @RequirePermission('market-intel:view')
  listGrowth(@CurrentUser() user: Principal, @Query(new ZodPipe(listGrowthQuerySchema)) q: z.infer<typeof listGrowthQuerySchema>) {
    return this.intel.listGrowth(user, q);
  }

  @Post('growth-opportunities')
  @RequirePermission('market-intel:create')
  createGrowth(@CurrentUser() user: Principal, @Body(new ZodPipe(createGrowthSchema)) b: z.infer<typeof createGrowthSchema>) {
    return this.intel.createGrowth(user, b);
  }

  @Patch('growth-opportunities/:id')
  @RequirePermission('market-intel:create')
  updateGrowth(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateGrowthSchema)) b: z.infer<typeof updateGrowthSchema>) {
    return this.intel.updateGrowth(user, id, b);
  }
}
