import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { acceptInviteSchema, forgotPasswordSchema, loginSchema, resetPasswordSchema } from '@salesos/validation';
import type { z } from 'zod';
import { APP_ENV } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import { CurrentUser, Public, RequirePermission, type Principal } from '../../../common/authz';
import { clearSessionCookies, setSessionCookies } from '../../../common/authz/cookies';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { AuthService } from './auth.service';

const AUTH_THROTTLE = { default: { limit: Number(process.env.THROTTLE_LOGIN_LIMIT ?? 10), ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(200)
  @Post('login')
  async login(
    @Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.auth.login(body.email, body.password, { ip: req.ip, userAgent: req.headers['user-agent'], presentedToken: (req.cookies as Record<string, string> | undefined)?.[this.env.SESSION_COOKIE_NAME] });
    setSessionCookies(res, this.env, r.token, r.csrfToken, r.absoluteExpiresAt);
    return { user: r.user, csrfToken: r.csrfToken };
  }

  @RequirePermission('auth:session:revoke-own')
  @HttpCode(200)
  @Post('logout')
  async logout(@CurrentUser() user: Principal, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies as Record<string, string> | undefined)?.[this.env.SESSION_COOKIE_NAME];
    await this.auth.logout(user, token);
    clearSessionCookies(res, this.env);
    return { loggedOut: true };
  }

  @RequirePermission('auth:me:view')
  @Get('me')
  me(@CurrentUser() user: Principal) {
    return this.auth.me(user);
  }

  /** Current CSRF token for the session (also in /auth/me and the salesos_csrf cookie). */
  @RequirePermission('auth:me:view')
  @Get('csrf')
  csrf(@CurrentUser() user: Principal) {
    return this.auth.csrf(user);
  }

  /** Revoke the caller's OTHER sessions (e.g. lost device). The current session stays valid. */
  @RequirePermission('auth:session:revoke-own')
  @HttpCode(200)
  @Post('sessions/revoke')
  async revokeOthers(@CurrentUser() user: Principal) {
    return { revoked: await this.auth.revokeOtherSessions(user) };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(200)
  @Post('password/forgot')
  async forgot(@Body(new ZodPipe(forgotPasswordSchema)) body: z.infer<typeof forgotPasswordSchema>) {
    await this.auth.forgotPassword(body.email);
    return { message: 'If the account exists, a reset link has been sent.' };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(200)
  @Post('password/reset')
  async reset(@Body(new ZodPipe(resetPasswordSchema)) body: z.infer<typeof resetPasswordSchema>) {
    await this.auth.consumeToken(body.token, body.password, 'PASSWORD_RESET');
    return { message: 'Password updated. Please sign in.' };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(200)
  @Post('invite/accept')
  async accept(@Body(new ZodPipe(acceptInviteSchema)) body: z.infer<typeof acceptInviteSchema>) {
    await this.auth.consumeToken(body.token, body.password, 'INVITE');
    return { message: 'Account activated. Please sign in.' };
  }
}
