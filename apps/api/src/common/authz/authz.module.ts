import { Global, Module } from '@nestjs/common';
import { AccessService } from './access.service';
import { SessionService } from './session.service';
import { PermissionResolver } from './principal.loader';
import { CsrfGuard } from '../security/csrf.guard';

@Global()
@Module({
  providers: [AccessService, SessionService, PermissionResolver, CsrfGuard],
  exports: [AccessService, SessionService, PermissionResolver],
})
export class AuthzModule {}
