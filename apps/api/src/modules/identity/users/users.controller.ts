import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createUserSchema, rejectUserSchema, resetDirectSchema, deactivateUserSchema, listUsersQuerySchema, setUserRolesSchema, updateUserSchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { Limited } from '../../../common/security/rate-limits';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { AccountAccessService } from './account-access.service';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService, private readonly access: AccountAccessService) {}

  /** Accounts waiting for approval (HR / Founder / Developer). Declared before `:id` so it is not read as an id. */
  @Get('pending')
  @RequirePermission('users:approve')
  pending(@CurrentUser() user: Principal) {
    return this.access.pending(user);
  }

  @Get('password-resets')
  @RequirePermission('users:password:reset')
  resetRequests(@CurrentUser() user: Principal) {
    return this.access.resetRequests(user);
  }

  @Post('password-resets/direct')
  @HttpCode(201)
  @Limited('ADMIN_ACTION')
  @RequirePermission('users:password:reset')
  resetDirect(@CurrentUser() user: Principal, @Body(new ZodPipe(resetDirectSchema)) body: z.infer<typeof resetDirectSchema>) {
    return this.access.issueDirect(user, body.email);
  }

  @Post('password-resets/:requestId/issue')
  @HttpCode(201)
  @Limited('ADMIN_ACTION')
  @RequirePermission('users:password:reset')
  issueReset(@CurrentUser() user: Principal, @Param('requestId', ParseUUIDPipe) requestId: string) {
    return this.access.issueFromRequest(user, requestId);
  }

  @Post('password-resets/:requestId/dismiss')
  @HttpCode(200)
  @RequirePermission('users:password:reset')
  dismissReset(@CurrentUser() user: Principal, @Param('requestId', ParseUUIDPipe) requestId: string) {
    return this.access.dismiss(user, requestId);
  }

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
  @RequirePermission('users:create')
  create(@CurrentUser() user: Principal, @Body(new ZodPipe(createUserSchema)) body: z.infer<typeof createUserSchema>) {
    return this.users.create(user, body);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Limited('ADMIN_ACTION')
  @RequirePermission('users:approve')
  approve(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.access.approve(user, id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermission('users:approve')
  reject(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(rejectUserSchema)) body: z.infer<typeof rejectUserSchema>) {
    return this.access.reject(user, id, body.reason);
  }

  @Post(':id/invite-link')
  @Limited('ADMIN_ACTION')
  @RequirePermission('users:create')
  inviteLink(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.access.reissueInvite(user, id);
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
