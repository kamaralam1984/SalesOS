import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createMeetingSchema, listMeetingsQuerySchema, type CreateMeetingInput, type ListMeetingsQuery } from '@salesos/validation';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { Limited } from '../../../common/security/rate-limits';
import { MeetingsService } from './meetings.service';

@ApiTags('workforce-meetings')
@Controller('meetings')
export class MeetingsController {
  constructor(private readonly svc: MeetingsService) {}

  /** Meetings on now or coming up: shown on everyone's home page. */
  @Get('active')
  @RequirePermission('meetings:view')
  active(@CurrentUser() user: Principal) {
    return this.svc.active(user);
  }

  /** The person pressed Join: recorded once, only for people the meeting was addressed to. */
  @Post(':id/join')
  @HttpCode(200)
  @RequirePermission('meetings:view')
  join(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.join(user, id);
  }

  /** Choices for the "who is it for" pickers. Declared before `:id`. */
  @Get('options')
  @RequirePermission('meetings:manage')
  options(@CurrentUser() user: Principal) {
    return this.svc.options(user);
  }

  @Get()
  @RequirePermission('meetings:manage')
  list(@CurrentUser() user: Principal, @Query(new ZodPipe(listMeetingsQuerySchema)) q: ListMeetingsQuery) {
    return this.svc.list(user, q);
  }

  /** Who the meeting reached and who has joined. */
  @Get(':id')
  @RequirePermission('meetings:manage')
  detail(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.detail(user, id);
  }

  @Post()
  @Limited('ADMIN_ACTION')
  @RequirePermission('meetings:manage')
  create(@CurrentUser() user: Principal, @Body(new ZodPipe(createMeetingSchema)) body: CreateMeetingInput) {
    return this.svc.create(user, body);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermission('meetings:manage')
  cancel(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancel(user, id);
  }
}
