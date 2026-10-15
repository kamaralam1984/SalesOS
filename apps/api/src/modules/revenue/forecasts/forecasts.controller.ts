import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createForecastSchema, forecastAccuracyQuerySchema, listForecastsQuerySchema, previewForecastQuerySchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { ForecastsService } from './forecasts.service';

/** Stage-weighted revenue forecast (DEC-030). Everything returned here is an ESTIMATE, labelled as such. */
@ApiTags('revenue/forecasts')
@Controller('forecasts')
export class ForecastsController {
  constructor(private readonly f: ForecastsService) {}

  @Get()
  @RequirePermission('forecasts:view')
  list(@CurrentUser() user: Principal, @Query(new ZodPipe(listForecastsQuerySchema)) q: z.infer<typeof listForecastsQuerySchema>) {
    return this.f.list(user, q);
  }

  @Get('preview')
  @RequirePermission('forecasts:create')
  preview(@CurrentUser() user: Principal, @Query(new ZodPipe(previewForecastQuerySchema)) q: z.infer<typeof previewForecastQuerySchema>) {
    return this.f.preview(user, q);
  }

  @Get('accuracy')
  @RequirePermission('forecasts:view')
  accuracy(@CurrentUser() user: Principal, @Query(new ZodPipe(forecastAccuracyQuerySchema)) q: z.infer<typeof forecastAccuracyQuerySchema>) {
    return this.f.accuracy(user, q);
  }

  @Post()
  @RequirePermission('forecasts:create')
  create(@CurrentUser() user: Principal, @Body(new ZodPipe(createForecastSchema)) b: z.infer<typeof createForecastSchema>) {
    return this.f.create(user, b);
  }

  @Get(':id/snapshots')
  @RequirePermission('forecasts:view')
  snapshots(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.f.snapshots(user, id);
  }
}
