import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { Limited } from '../../../common/security/rate-limits';
import { LOGIN_HISTORY_ACTIONS, SecurityService } from './security.service';

const page = { limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(300).optional() };
const date = z.coerce.date();
const sessionsQuery = z.object({ ...page, userId: z.string().uuid().optional() });
const historyQuery = z.object({
  ...page,
  action: z.enum(LOGIN_HISTORY_ACTIONS).optional(),
  userId: z.string().uuid().optional(),
  from: date.optional(),
  to: date.optional(),
});
const lockedQuery = z.object({ minFailures: z.coerce.number().int().min(1).max(50).default(3) });
const auditQuery = z.object({
  ...page,
  action: z.string().trim().max(80).regex(/^devpanel\.[a-z0-9_.]+$/).optional(),
  actorId: z.string().uuid().optional(),
  from: date.optional(),
  to: date.optional(),
});

@ApiTags('dev-panel')
@Controller('dev-panel/security')
export class SecurityController {
  constructor(private readonly svc: SecurityService) {}

  @Get('sessions')
  @RequirePermission('devpanel:access', 'devpanel:security:view')
  sessions(@CurrentUser() u: Principal, @Query(new ZodPipe(sessionsQuery)) q: z.infer<typeof sessionsQuery>) {
    return this.svc.listSessions(u, q);
  }

  @Post('sessions/:id/revoke')
  @HttpCode(200)
  @Limited('ADMIN_ACTION')
  @RequirePermission('devpanel:access', 'devpanel:security:manage')
  revoke(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.revokeSession(u, id);
  }

  @Get('login-history')
  @RequirePermission('devpanel:access', 'devpanel:security:view')
  history(@CurrentUser() u: Principal, @Query(new ZodPipe(historyQuery)) q: z.infer<typeof historyQuery>) {
    return this.svc.loginHistory(u, q);
  }

  @Get('locked-accounts')
  @RequirePermission('devpanel:access', 'devpanel:security:view')
  locked(@CurrentUser() u: Principal, @Query(new ZodPipe(lockedQuery)) q: z.infer<typeof lockedQuery>) {
    return this.svc.lockedAccounts(u, q.minFailures);
  }

  @Post('users/:id/unlock')
  @HttpCode(200)
  @Limited('ADMIN_ACTION')
  @RequirePermission('devpanel:access', 'devpanel:security:manage')
  unlock(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.unlock(u, id);
  }

  @Post('users/:id/reset-link')
  @HttpCode(200)
  @Limited('ADMIN_ACTION')
  @RequirePermission('devpanel:access', 'devpanel:security:manage')
  resetLink(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.issueResetLink(u, id);
  }

  @Get('audit')
  @RequirePermission('devpanel:access', 'devpanel:security:view')
  audit(@CurrentUser() u: Principal, @Query(new ZodPipe(auditQuery)) q: z.infer<typeof auditQuery>) {
    return this.svc.auditTrail(u, q);
  }
}
