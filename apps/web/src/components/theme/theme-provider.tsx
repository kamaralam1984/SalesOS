'use client';
import * as React from 'react';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  readStoredPreference,
  resolveTheme,
  writeStoredPreference,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme';

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

const DARK_QUERY = '(prefers-color-scheme: dark)';

function getStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

/** Short-lived attribute that suppresses CSS transitions so the whole page flips at once. */
function withoutTransitions(fn: () => void) {
  const root = document.documentElement;
  root.setAttribute('data-theme-switching', '');
  fn();
  window.setTimeout(() => root.removeAttribute('data-theme-switching'), 60);
}

// External stores (so the server render and first client render agree on "system"/light, with no setState-in-effect).
const prefListeners = new Set<() => void>();
let prefOverride: ThemePreference | null = null; // in-memory choice, used when storage is blocked
const notifyPref = () => prefListeners.forEach((l) => l());

function subscribePref(cb: () => void) {
  prefListeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY) {
      prefOverride = null; // another tab changed it
      cb();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    prefListeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}
/** Test helper: forget the in-memory choice used while storage is blocked. */
export function resetThemeMemoryForTests() {
  prefOverride = null;
}
const getPref = (): ThemePreference => prefOverride ?? readStoredPreference(getStorage());
const getServerPref = (): ThemePreference => 'system';

function subscribeSystem(cb: () => void) {
  let mq: MediaQueryList;
  try {
    mq = window.matchMedia(DARK_QUERY);
  } catch {
    return () => {};
  }
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
const getServerDark = () => false;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const preference = React.useSyncExternalStore(subscribePref, getPref, getServerPref);
  const systemDark = React.useSyncExternalStore(subscribeSystem, systemPrefersDark, getServerDark);
  const resolved = resolveTheme(preference, systemDark);

  React.useEffect(() => {
    applyTheme(preference, resolved);
  }, [preference, resolved]);

  const setPreference = React.useCallback((p: ThemePreference) => {
    withoutTransitions(() => {
      // Failure is non-fatal: the choice still applies for this session via the in-memory override.
      prefOverride = writeStoredPreference(getStorage(), p) ? null : p;
      notifyPref();
      applyTheme(p, resolveTheme(p, systemPrefersDark()));
    });
  }, []);

  const value = React.useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
