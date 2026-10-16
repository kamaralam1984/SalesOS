import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { roleKeySchema } from '@salesos/validation';
import { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../common/authz';
import { ZodPipe } from '../../common/http/zod.pipe';
import { Limited } from '../../common/security/rate-limits';
import { DevPanelService } from './devpanel.service';

const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  role: roleKeySchema.optional(),
  isActive: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
const rolesBody = z.object({ roles: z.array(roleKeySchema).max(12) });
const forceLogoutBody = z.object({ reason: z.string().trim().min(3).max(300) });

@ApiTags('dev-panel')
@Controller('dev-panel')
export class DevPanelController {
  constructor(private readonly svc: DevPanelService) {}

  @Get('overview')
  @RequirePermission('devpanel:access')
  overview(@CurrentUser() u: Principal) {
    return this.svc.overview(u);
  }

  @Get('users')
  @RequirePermission('devpanel:access')
  users(@CurrentUser() u: Principal, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.svc.listUsers(u, q);
  }

  @Post('users/:id/roles')
  @HttpCode(200)
  @Limited('ADMIN_ACTION')
  @RequirePermission('devpanel:access', 'devpanel:roles:manage')
  setRoles(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(rolesBody)) b: z.infer<typeof rolesBody>) {
    return this.svc.setRoles(u, id, b.roles);
  }

  @Post('users/:id/revoke-sessions')
  @HttpCode(200)
  @Limited('ADMIN_ACTION')
  @RequirePermission('devpanel:access', 'devpanel:sessions:revoke')
  revoke(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.revokeUserSessions(u, id);
  }

  @Post('sessions/force-logout-all')
  @HttpCode(200)
  @Limited('ADMIN_ACTION')
  @RequirePermission('devpanel:access', 'devpanel:sessions:revoke')
  forceLogout(@CurrentUser() u: Principal, @Body(new ZodPipe(forceLogoutBody)) b: z.infer<typeof forceLogoutBody>) {
    return this.svc.forceLogoutAll(u, b.reason);
  }

  @Get('server')
  @RequirePermission('devpanel:access', 'devpanel:server:view')
  server() {
    return this.svc.serverStatus();
  }
}
