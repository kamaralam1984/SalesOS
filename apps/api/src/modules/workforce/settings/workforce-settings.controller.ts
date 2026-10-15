import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { WorkforceSettingsService } from './workforce-settings.service';

@ApiTags('workforce-settings')
@Controller('workforce/settings')
export class WorkforceSettingsController {
  constructor(private readonly svc: WorkforceSettingsService) {}

  @Get()
  @RequirePermission('workforce:settings:view')
  get(@CurrentUser() u: Principal) {
    return this.svc.get(u);
  }

  @Patch()
  @RequirePermission('workforce:settings:manage')
  update(@CurrentUser() u: Principal, @Body() body: unknown) {
    return this.svc.update(u, body);
  }
}
