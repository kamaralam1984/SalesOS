import { Module } from '@nestjs/common';
import { EMAIL_PROVIDER, OutboxEmailProvider } from '../../common/outbox/email.provider';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';
import { TeamsController } from './teams/teams.controller';
import { TeamsService } from './teams/teams.service';
import { OrgController } from './org/org.controller';
import { OrgService } from './org/org.service';
import { AuditController } from './audit/audit.controller';
import { PermissionsController } from './permissions/permissions.controller';
import { DelegationsController } from './delegations/delegations.controller';
import { PasswordService } from './password.service';
import { RolesService } from './roles.service';

/** Identity domain (Agent B): auth, users, teams, org settings, audit read API, permission catalogue. */
@Module({
  controllers: [AuthController, UsersController, TeamsController, OrgController, AuditController, PermissionsController, DelegationsController],
  providers: [
    AuthService, UsersService, TeamsService, OrgService, PasswordService, RolesService,
    { provide: EMAIL_PROVIDER, useClass: OutboxEmailProvider },
  ],
  exports: [PasswordService, RolesService, OrgService, UsersService],
})
export class IdentityModule {}
