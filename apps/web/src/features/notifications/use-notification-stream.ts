'use client';
import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL } from '@/lib/api/client';
import { pk } from '@/lib/api/hooks/platform';

export type StreamMode = 'live' | 'polling';

/**
 * Live updates through Server-Sent Events scoped to the signed-in user, with a polling fallback (30 s) whenever the
 * stream is unavailable. The mode is exposed so the UI can say whether updates are live. EventSource reconnects on its own.
 */
export function useNotificationStream(enabled: boolean, pollMs = 30_000): StreamMode {
  const qc = useQueryClient();
  const [mode, setMode] = React.useState<StreamMode>('polling');
  React.useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const refresh = () => void qc.invalidateQueries({ queryKey: pk.notifications });
    const startPolling = () => {
      setMode('polling');
      timer ??= setInterval(refresh, pollMs);
    };
    const stopPolling = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (typeof EventSource === 'undefined') {
      startPolling();
      return stopPolling;
    }
    es = new EventSource(`${API_BASE_URL}/notifications/stream`, { withCredentials: true });
    es.addEventListener('ready', (e) => {
      stopPolling();
      setMode('live');
      try {
        qc.setQueryData(pk.unread, (JSON.parse((e as MessageEvent).data) as { unreadCount: number }).unreadCount);
      } catch {
        /* ignore malformed frame */
      }
    });
    es.addEventListener('notification', refresh);
    es.addEventListener('unread', (e) => {
      try {
        qc.setQueryData(pk.unread, (JSON.parse((e as MessageEvent).data) as { unreadCount: number }).unreadCount);
      } catch {
        /* ignore */
      }
    });
    es.onerror = () => startPolling();
    return () => {
      es?.close();
      stopPolling();
    };
  }, [enabled, pollMs, qc]);
  return mode;
}
