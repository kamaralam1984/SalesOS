import { Body, Controller, Delete, Get, HttpCode, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ROLE_KEYS, type RoleKey } from '@salesos/shared-types';
import { homeLayoutSchema, type HomeLayoutInput } from '@salesos/validation';
import { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../common/authz';
import { ZodPipe } from '../../common/http/zod.pipe';
import { HomeLayoutService } from './homelayout.service';

const roleParam = new ZodPipe(z.enum(ROLE_KEYS));

@ApiTags('home-layout')
@Controller('home-layout')
export class HomeLayoutController {
  constructor(private readonly svc: HomeLayoutService) {}

  /** The layout the caller's own phone home uses. */
  @Get()
  @RequirePermission('home-layout:view')
  mine(@CurrentUser() user: Principal) {
    return this.svc.mine(user);
  }

  /** Founder / Developer: every role's layout plus which widgets apply to it. */
  @Get('roles')
  @RequirePermission('home-layout:manage')
  overview(@CurrentUser() user: Principal) {
    return this.svc.overview(user);
  }

  @Put('roles/:role')
  @RequirePermission('home-layout:manage')
  save(@CurrentUser() user: Principal, @Param('role', roleParam) role: RoleKey, @Body(new ZodPipe(homeLayoutSchema)) body: HomeLayoutInput) {
    return this.svc.save(user, role, body);
  }

  @Delete('roles/:role')
  @HttpCode(200)
  @RequirePermission('home-layout:manage')
  reset(@CurrentUser() user: Principal, @Param('role', roleParam) role: RoleKey) {
    return this.svc.reset(user, role);
  }
}
