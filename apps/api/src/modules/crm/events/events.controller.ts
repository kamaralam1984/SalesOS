import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { attendanceSchema, createEventSchema, listEventsQuerySchema, paginationQuerySchema, updateEventSchema } from '@salesos/validation';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { EventsService } from './events.service';

@ApiTags('crm: webinars, demos, events')
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @RequirePermission('events:view')
  list(@CurrentUser() u: Principal, @Query(new ZodPipe(listEventsQuerySchema)) q: z.infer<typeof listEventsQuerySchema>) {
    return this.events.list(u, q);
  }
  @Post()
  @RequirePermission('events:manage')
  create(@CurrentUser() u: Principal, @Body(new ZodPipe(createEventSchema)) b: z.infer<typeof createEventSchema>) {
    return this.events.create(u, b);
  }
  @Get(':id')
  @RequirePermission('events:view')
  get(@CurrentUser() u: Principal, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.events.get(u, id);
  }
  @Patch(':id')
  @RequirePermission('events:manage')
  update(@CurrentUser() u: Principal, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(updateEventSchema)) b: z.infer<typeof updateEventSchema>) {
    return this.events.update(u, id, b);
  }
  @Get(':id/attendance')
  @RequirePermission('events:view')
  attendees(@CurrentUser() u: Principal, @Param('id', new ParseUUIDPipe()) id: string, @Query(new ZodPipe(paginationQuerySchema)) q: { limit?: number; cursor?: string; page?: number }) {
    return this.events.attendees(u, id, q);
  }
  @Post(':id/attendance')
  @HttpCode(200)
  @RequirePermission('events:manage')
  setAttendance(@CurrentUser() u: Principal, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(attendanceSchema)) b: z.infer<typeof attendanceSchema>) {
    return this.events.setAttendance(u, id, b);
  }
}
