import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { APP_ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { unauthorized } from '../http/errors';
import { IS_PUBLIC } from './decorators';
import type { AuthedRequest } from './principal';
import { SessionService } from './session.service';
import { setSessionCookies } from './cookies';

/** Resolves the session cookie into req.principal. Public routes skip it (but a valid cookie is still honoured). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    const req = ctx.switchToHttp().getRequest<Request & AuthedRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const token = (req.cookies as Record<string, string> | undefined)?.[this.env.SESSION_COOKIE_NAME];

    if (!token) {
      if (isPublic) return true;
      throw unauthorized();
    }
    const auth = await this.sessions.authenticate(token);
    if (!auth) {
      if (isPublic) return true;
      throw unauthorized('Session expired or invalid');
    }
    req.principal = auth.principal;
    if (auth.rotatedToken) {
      setSessionCookies(res, this.env, auth.rotatedToken, this.sessions.csrfTokenFor(auth.principal.sessionFamilyId), auth.absoluteExpiresAt);
    }
    return true;
  }
}
