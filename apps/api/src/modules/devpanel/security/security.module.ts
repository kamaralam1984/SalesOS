import { Module } from '@nestjs/common';
import { EMAIL_PROVIDER } from '../../../common/outbox/email.provider';
import { AuthService } from '../../identity/auth/auth.service';
import { IdentityModule } from '../../identity/identity.module';
import { SecurityController } from './security.controller';
import { SecurityService } from './security.service';

/**
 * Developer Panel / security: live sessions, login history, locked accounts, reset links, devpanel audit trail.
 * AuthService is re-provided here (IdentityModule does not export it) only to reuse the single-use token logic; reset links are
 * issued with sendEmail:false so the email provider is never called.
 */
@Module({
  imports: [IdentityModule],
  controllers: [SecurityController],
  providers: [
    SecurityService,
    AuthService,
    { provide: EMAIL_PROVIDER, useValue: { send: async () => { throw new Error('email is never sent from the developer panel'); } } },
  ],
})
export class DevSecurityModule {}
