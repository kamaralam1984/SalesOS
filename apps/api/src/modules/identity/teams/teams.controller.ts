import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { addTeamMemberSchema, createTeamSchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { TeamsService } from './teams.service';

@ApiTags('teams')
@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  @RequirePermission('teams:view')
  list(@CurrentUser() user: Principal) {
    return this.teams.list(user);
  }

  @Post()
  @RequirePermission('teams:create')
  create(@CurrentUser() user: Principal, @Body(new ZodPipe(createTeamSchema)) body: z.infer<typeof createTeamSchema>) {
    return this.teams.create(user, body);
  }

  @Get(':id')
  @RequirePermission('teams:view')
  get(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.teams.get(user, id);
  }

  @Get(':id/members')
  @RequirePermission('teams:view')
  members(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.teams.listMembers(user, id);
  }

  @Post(':id/members')
  @RequirePermission('teams:update')
  addMember(
    @CurrentUser() user: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(addTeamMemberSchema)) body: z.infer<typeof addTeamMemberSchema>,
  ) {
    return this.teams.addMember(user, id, body);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermission('teams:delete')
  remove(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.teams.remove(user, id);
  }

  @Delete(':id/members/:userId')
  @HttpCode(200)
  @RequirePermission('teams:update')
  removeMember(
    @CurrentUser() user: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.teams.removeMember(user, id, userId);
  }
}
