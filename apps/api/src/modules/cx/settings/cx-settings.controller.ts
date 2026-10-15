import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { CxSettingsService } from './cx-settings.service';

@ApiTags('cx-settings')
@Controller('cx/settings')
export class CxSettingsController {
  constructor(private readonly svc: CxSettingsService) {}

  @Get()
  @RequirePermission('settings:view')
  get(@CurrentUser() u: Principal) {
    return this.svc.get(u);
  }

  @Patch()
  @RequirePermission('settings:update')
  update(@CurrentUser() u: Principal, @Body() body: unknown) {
    return this.svc.update(u, body);
  }
}
