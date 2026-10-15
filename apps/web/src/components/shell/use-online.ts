'use client';
import * as React from 'react';

/** Reflects navigator.onLine. Returns true during SSR to avoid a flash of the offline banner. */
export function useOnline(): boolean {
  return React.useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}
