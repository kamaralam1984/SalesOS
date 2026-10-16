import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { DevDashboardService } from './dashboard.service';

@ApiTags('dev-panel')
@Controller('dev-panel/dashboard')
export class DevDashboardController {
  constructor(private readonly svc: DevDashboardService) {}

  @Get()
  @RequirePermission('devpanel:access')
  snapshot(@CurrentUser() u: Principal) {
    return this.svc.snapshot(u);
  }

  @Get('integrations')
  @RequirePermission('devpanel:access', 'devpanel:config:view')
  integrations(@CurrentUser() u: Principal) {
    return this.svc.integrations(u);
  }

  @Get('backup')
  @RequirePermission('devpanel:access', 'devpanel:config:view')
  backup() {
    return this.svc.backup();
  }
}
