'use client';
import * as React from 'react';

/** Registers the service worker in production builds only. The worker never caches /api or authenticated HTML. */
export function ServiceWorkerRegister() {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
      /* non-fatal: the app works without the worker */
    });
  }, []);
  return null;
}
