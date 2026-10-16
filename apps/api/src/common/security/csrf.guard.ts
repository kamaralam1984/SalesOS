import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CSRF_HEADER } from '@salesos/shared-types';
import type { Request } from 'express';
import { APP_ENV } from '../../config/config.module';
import { isAllowedOrigin, type Env } from '../../config/env';
import { AppError } from '../http/errors';
import { SessionService } from '../authz/session.service';
import type { AuthedRequest } from '../authz/principal';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF for cookie sessions, two layers:
 *  1. Origin/Referer check: if a browser sends Origin it must be an allowed CORS origin.
 *  2. Signed token bound to the session family, sent in the `x-csrf-token` header (double-submit style:
 *     the token is also exposed in the `salesos_csrf` cookie and /auth/me).
 * Unauthenticated public endpoints (login...) get layer 1 only.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & AuthedRequest>();
    if (SAFE.has(req.method)) return true;

    const origin = req.headers.origin;
    if (typeof origin === 'string' && !isAllowedOrigin(this.env, origin)) {
      throw new AppError('CSRF_ORIGIN', 'Origin not allowed', 403);
    }
    if (!req.principal) return true; // public endpoint: no session to protect
    const presented = req.headers[CSRF_HEADER];
    const token = Array.isArray(presented) ? presented[0] : presented;
    if (!this.sessions.verifyCsrf(req.principal.sessionFamilyId, token)) {
      throw new AppError('CSRF_INVALID', 'Missing or invalid CSRF token', 403);
    }
    return true;
  }
}
