import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createHolidaySchema, holidaysQuerySchema, suggestHolidaysSchema, updateHolidaySchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { HolidaysService } from './holidays.service';

@ApiTags('workforce-holidays')
@Controller('workforce/holidays')
export class HolidaysController {
  constructor(private readonly svc: HolidaysService) {}

  @Get()
  @RequirePermission('holidays:view')
  list(@CurrentUser() u: Principal, @Query(new ZodPipe(holidaysQuerySchema)) q: z.infer<typeof holidaysQuerySchema>) {
    return this.svc.list(u, q);
  }

  @Post()
  @RequirePermission('holidays:manage')
  create(@CurrentUser() u: Principal, @Body(new ZodPipe(createHolidaySchema)) b: z.infer<typeof createHolidaySchema>) {
    return this.svc.create(u, b);
  }

  @Post('suggest')
  @HttpCode(200)
  @RequirePermission('holidays:manage')
  suggest(@CurrentUser() u: Principal, @Body(new ZodPipe(suggestHolidaysSchema)) b: z.infer<typeof suggestHolidaysSchema>) {
    return this.svc.suggest(u, b);
  }

  @Patch(':id')
  @RequirePermission('holidays:manage')
  update(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateHolidaySchema)) b: z.infer<typeof updateHolidaySchema>) {
    return this.svc.update(u, id, b);
  }

  @Delete(':id')
  @RequirePermission('holidays:manage')
  remove(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(u, id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('holidays:manage')
  approve(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.approve(u, id);
  }
}
