import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge proxy (Next 16 "proxy", formerly middleware):
 *  1. Content-Security-Policy with a per-request nonce.
 *  2. Coarse route guard: no session cookie -> /login?next=... (the real check is /auth/me in AuthProvider and,
 *     above all, the API's own authorization. A cookie being present proves nothing.)
 */
const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? 'salesos_session';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100/api/v1';

const PUBLIC_PREFIXES = [
  '/login',
  '/forgot-password',
  '/reset-password',
  '/invite',
  '/offline',
  '/dev',
];

function apiOrigin(): string {
  try {
    return new URL(API_URL).origin;
  } catch {
    return '';
  }
}

export function buildCsp(nonce: string, isDev: boolean): string {
  const api = apiOrigin();
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // Inline styles are required by Next/Framer Motion/Recharts (style attributes); scripts stay strict.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self' ${api}${isDev ? ' ws: wss:' : ''}`,
    `worker-src 'self'`,
    `manifest-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ];
  return directives.join('; ');
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isDev = process.env.NODE_ENV !== 'production';

  const isPublic =
    pathname === '/'
      ? false
      : PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
  if (!isPublic && !request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    if (pathname !== '/') url.searchParams.set('next', pathname + search);
    return NextResponse.redirect(url);
  }

  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce, isDev);
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  matcher: [
    {
      source:
        '/((?!api/v1/|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/|brand/|offline.html).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
