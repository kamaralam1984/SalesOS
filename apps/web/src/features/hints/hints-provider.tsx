'use client';
import * as React from 'react';

/**
 * Hint state: one global "Show hints" switch plus the list of page hints the user dismissed.
 * Stored only in this browser's localStorage under a per-user key. The data is a boolean and a list of hint ids:
 * nothing private. Every storage access is wrapped in try/catch, and the UI works (hints on, nothing remembered) without it.
 */

export interface HintsState {
  enabled: boolean;
  dismissed: string[];
}
const DEFAULT_STATE: HintsState = { enabled: true, dismissed: [] };

export const HINTS_STORAGE_PREFIX = 'salesos.hints.v1.';
export const storageKeyFor = (userId: string | null | undefined) =>
  `${HINTS_STORAGE_PREFIX}${userId ?? 'anonymous'}`;

function parse(raw: string | null | undefined): HintsState {
  if (!raw) return DEFAULT_STATE;
  try {
    const v = JSON.parse(raw) as Partial<HintsState> | null;
    return {
      enabled: typeof v?.enabled === 'boolean' ? v.enabled : true,
      dismissed: Array.isArray(v?.dismissed)
        ? v.dismissed.filter((x): x is string => typeof x === 'string').slice(0, 500)
        : [],
    };
  } catch {
    return DEFAULT_STATE;
  }
}

/**
 * Tiny external store over localStorage. Snapshots are the raw JSON string (a primitive, so React can compare them).
 * If storage is unavailable the value is kept in memory for the session.
 */
const memory = new Map<string, string>();
const listeners = new Set<() => void>();
function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}
function writeRaw(key: string, raw: string) {
  try {
    window.localStorage.setItem(key, raw);
  } catch {
    /* storage unavailable (private window, blocked, quota): keep working in memory */
    memory.set(key, raw);
  }
  listeners.forEach((l) => l());
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener('storage', cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', cb);
  };
}

export interface HintsApi {
  /** False until the saved choice was read (avoids a flash of an already dismissed hint). */
  ready: boolean;
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  toggle: () => void;
  isDismissed: (id: string) => boolean;
  dismiss: (id: string) => void;
  restore: (id: string) => void;
  /** Show hints again and forget every dismissal. */
  reset: () => void;
}

const NOOP_API: HintsApi = {
  ready: true,
  enabled: true,
  setEnabled: () => {},
  toggle: () => {},
  isDismissed: () => false,
  dismiss: () => {},
  restore: () => {},
  reset: () => {},
};
const HintsCtx = React.createContext<HintsApi | null>(null);

export function HintsProvider({
  userId,
  children,
}: {
  userId?: string | null;
  children: React.ReactNode;
}) {
  const key = storageKeyFor(userId);
  // null on the server and during hydration, so a dismissed hint never flashes.
  const raw = React.useSyncExternalStore(
    subscribe,
    () => readRaw(key) ?? '',
    () => null,
  );
  const ready = raw !== null;
  const state = React.useMemo(() => parse(raw), [raw]);

  const update = React.useCallback(
    (fn: (s: HintsState) => HintsState) => writeRaw(key, JSON.stringify(fn(parse(readRaw(key))))),
    [key],
  );

  const api = React.useMemo<HintsApi>(
    () => ({
      ready,
      enabled: state.enabled,
      setEnabled: (v) => update((s) => ({ ...s, enabled: v })),
      toggle: () => update((s) => ({ ...s, enabled: !s.enabled })),
      isDismissed: (id) => state.dismissed.includes(id),
      dismiss: (id) =>
        update((s) => (s.dismissed.includes(id) ? s : { ...s, dismissed: [...s.dismissed, id] })),
      restore: (id) => update((s) => ({ ...s, dismissed: s.dismissed.filter((x) => x !== id) })),
      reset: () => update(() => DEFAULT_STATE),
    }),
    [state, ready, update],
  );
  return <HintsCtx.Provider value={api}>{children}</HintsCtx.Provider>;
}

/** Works without a provider (for example in the style guide): hints on, nothing remembered. */
export function useHints(): HintsApi {
  return React.useContext(HintsCtx) ?? NOOP_API;
}
