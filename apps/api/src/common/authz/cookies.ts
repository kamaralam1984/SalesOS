import type { Response } from 'express';
import type { Env } from '../../config/env';

export const CSRF_COOKIE_NAME = 'salesos_csrf';

export function setSessionCookies(res: Response, env: Env, token: string, csrf: string, absoluteExpiresAt: Date) {
  const base = {
    secure: env.isProd,
    sameSite: env.SESSION_COOKIE_SAMESITE,
    domain: env.SESSION_COOKIE_DOMAIN,
    path: '/',
    expires: absoluteExpiresAt,
  } as const;
  res.cookie(env.SESSION_COOKIE_NAME, token, { ...base, httpOnly: true });
  // Readable by the SPA (double-submit); useless without the HttpOnly session cookie.
  res.cookie(CSRF_COOKIE_NAME, csrf, { ...base, httpOnly: false });
  res.setHeader('x-csrf-token', csrf);
}

export function clearSessionCookies(res: Response, env: Env) {
  const opts = { secure: env.isProd, sameSite: env.SESSION_COOKIE_SAMESITE, domain: env.SESSION_COOKIE_DOMAIN, path: '/' } as const;
  res.clearCookie(env.SESSION_COOKIE_NAME, { ...opts, httpOnly: true });
  res.clearCookie(CSRF_COOKIE_NAME, opts);
}
