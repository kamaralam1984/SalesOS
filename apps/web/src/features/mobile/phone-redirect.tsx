'use client';
import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';

const CLASSIC_KEY = 'salesos.classic-ui';
const PHONE_QUERY = '(max-width: 767px)';

const isHomeRoute = (p: string) => p === '/' || p === '/dashboard' || p.startsWith('/dashboard/');

/**
 * Phones land on the mobile home (/m) instead of the role dashboards. Only the home routes are redirected (every other
 * page keeps its standard UI), desktop is untouched, and `?classic=1` opts out for the rest of the browser session.
 * Storage may be unavailable (private mode), so every access is guarded and the app still works without it.
 */
export function PhoneRedirect() {
  const pathname = usePathname();
  const router = useRouter();
  React.useEffect(() => {
    if (!isHomeRoute(pathname)) return;
    let classic = false;
    try {
      if (new URLSearchParams(window.location.search).get('classic') === '1') window.sessionStorage.setItem(CLASSIC_KEY, '1');
      classic = window.sessionStorage.getItem(CLASSIC_KEY) === '1';
    } catch {
      classic = new URLSearchParams(window.location.search).get('classic') === '1';
    }
    if (classic) return;
    if (window.matchMedia(PHONE_QUERY).matches) router.replace('/m');
  }, [pathname, router]);
  return null;
}
