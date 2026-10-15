import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createUserSchema, deactivateUserSchema, listUsersQuerySchema, setUserRolesSchema, updateUserSchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { Limited } from '../../../common/security/rate-limits';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('users:view')
  list(@CurrentUser() user: Principal, @Query(new ZodPipe(listUsersQuerySchema)) q: z.infer<typeof listUsersQuerySchema>) {
    return this.users.list(user, q);
  }

  @Get(':id')
  @RequirePermission('users:view')
  get(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(user, id);
  }

  @Post()
  @RequirePermission('users:create', 'users:role:assign')
  create(@CurrentUser() user: Principal, @Body(new ZodPipe(createUserSchema)) body: z.infer<typeof createUserSchema>) {
    return this.users.create(user, body);
  }

  @Post(':id/invite-link')
  @Limited('ADMIN_ACTION')
  @RequirePermission('users:create', 'users:role:assign')
  inviteLink(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.issueInviteLink(user, id);
  }

  @Patch(':id')
  @RequirePermission('users:update')
  update(
    @CurrentUser() user: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateUserSchema)) body: z.infer<typeof updateUserSchema>,
  ) {
    return this.users.update(user, id, body);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermission('users:deactivate')
  deactivate(
    @CurrentUser() user: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(deactivateUserSchema)) body: z.infer<typeof deactivateUserSchema>,
  ) {
    return this.users.deactivate(user, id, body.reason);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @RequirePermission('users:deactivate')
  reactivate(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.reactivate(user, id);
  }

  @Post(':id/roles')
  @HttpCode(200)
  @RequirePermission('users:role:assign')
  setRoles(
    @CurrentUser() user: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(setUserRolesSchema)) body: z.infer<typeof setUserRolesSchema>,
  ) {
    return this.users.setRoles(user, id, body.roles);
  }
}
