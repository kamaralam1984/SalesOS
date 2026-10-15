import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { deviceRegisterSchema, type DeviceRegisterInput } from '@salesos/validation';
import { z } from 'zod';
import { AccessService, CurrentUser, RequireAnyPermission, RequirePermission, type Principal } from '../../common/authz';
import { ZodPipe } from '../../common/http/zod.pipe';
import { DevicesService } from './devices.service';

const settingsPatch = z.object({ enabled: z.boolean() });

@ApiTags('devices')
@Controller('devices')
export class DevicesController {
  constructor(private readonly svc: DevicesService, private readonly access: AccessService) {}

  @Get('settings')
  @RequirePermission('integrations:manage')
  settings(@CurrentUser() user: Principal) {
    return this.svc.settings(user.organizationId);
  }

  @Patch('settings')
  @RequirePermission('integrations:manage')
  setEnabled(@CurrentUser() user: Principal, @Body(new ZodPipe(settingsPatch)) body: z.infer<typeof settingsPatch>) {
    return this.svc.setEnabled(user, body.enabled);
  }

  @Post('register')
  @RequirePermission('devices:register')
  register(@CurrentUser() user: Principal, @Body(new ZodPipe(deviceRegisterSchema)) body: DeviceRegisterInput) {
    return this.svc.register(user, body);
  }

  /** Own devices; holders of integrations:manage see every device in the organisation. */
  @Get()
  @RequireAnyPermission('devices:register', 'integrations:manage')
  list(@CurrentUser() user: Principal) {
    return this.svc.list(user, this.access.has(user, 'integrations:manage'));
  }

  @Post(':id/approve')
  @RequirePermission('integrations:manage')
  approve(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.approve(user, id);
  }

  @Delete(':id')
  @RequireAnyPermission('devices:register', 'integrations:manage')
  revoke(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.revoke(user, id, this.access.has(user, 'integrations:manage'));
  }
}
