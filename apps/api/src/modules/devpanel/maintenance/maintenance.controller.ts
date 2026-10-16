import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, Public, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { Limited } from '../../../common/security/rate-limits';
import { MaintenanceService } from './maintenance.service';

const enableBody = z.object({
  message: z.string().trim().min(3).max(300),
  eta: z.string().datetime({ offset: true }).optional(),
});

@ApiTags('dev-panel')
@Controller('dev-panel/maintenance')
export class DevMaintenanceController {
  constructor(private readonly svc: MaintenanceService) {}

  @Get()
  @RequirePermission('devpanel:access')
  get(@CurrentUser() u: Principal) {
    return this.svc.detail(u.organizationId);
  }

  @Post('enable')
  @HttpCode(200)
  @Limited('ADMIN_ACTION')
  @RequirePermission('devpanel:access', 'devpanel:maintenance:manage')
  enable(@CurrentUser() u: Principal, @Body(new ZodPipe(enableBody)) b: z.infer<typeof enableBody>) {
    return this.svc.enable(u, b.message, b.eta);
  }

  @Post('disable')
  @HttpCode(200)
  @Limited('ADMIN_ACTION')
  @RequirePermission('devpanel:access', 'devpanel:maintenance:manage')
  disable(@CurrentUser() u: Principal) {
    return this.svc.disable(u);
  }
}

/** Public: lets the web show the maintenance screen before login. Leaks no actor info. */
@ApiTags('maintenance')
@Controller('maintenance')
export class MaintenancePublicController {
  constructor(private readonly svc: MaintenanceService) {}

  @Public()
  @Get('status')
  status() {
    return this.svc.publicStatus();
  }
}
