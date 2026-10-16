import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { DevAccessService } from './access.service';

/** Developer Panel / Access map. Read-only; DEVELOPER only. */
@ApiTags('dev-panel')
@Controller('dev-panel/access')
export class DevAccessController {
  constructor(private readonly svc: DevAccessService) {}

  @Get('matrix')
  @RequirePermission('devpanel:config:view')
  matrix() {
    return this.svc.matrix();
  }

  @Get('matrix/user/:id')
  @RequirePermission('devpanel:config:view')
  userEffective(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.userEffective(u, id);
  }

  @Get('flags')
  @RequirePermission('devpanel:config:view')
  flags() {
    return this.svc.flags();
  }

  @Get('runbook')
  @RequirePermission('devpanel:config:view')
  runbook() {
    return this.svc.runbook();
  }
}
