/**
 * Theme model (Light / Dark / System). Pure helpers shared by the inline pre-paint script, the provider and tests.
 * Preference lives in localStorage (per browser; never sent to the server, no PII). The inline script resolves
 * "system" to a concrete `data-theme` before first paint; CSS also honours `prefers-color-scheme` when JS is off.
 */
export const THEME_STORAGE_KEY = 'salesos.theme.v1';
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = 'light' | 'dark';

/** Browser chrome colours (match --canvas in tokens.css). */
export const THEME_COLORS: Record<ResolvedTheme, string> = { light: '#fbf8f2', dark: '#14110d' };

export function isThemePreference(v: unknown): v is ThemePreference {
  return typeof v === 'string' && (THEME_PREFERENCES as readonly string[]).includes(v);
}

export function resolveTheme(pref: ThemePreference, systemDark: boolean): ResolvedTheme {
  return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
}

/** Storage-safe read: blocked / throwing / garbage storage all fall back to "system". */
export function readStoredPreference(storage: Pick<Storage, 'getItem'> | null | undefined): ThemePreference {
  try {
    const v = storage?.getItem(THEME_STORAGE_KEY);
    return isThemePreference(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Storage-safe write. Returns false when the choice could not be persisted (it still applies for this page view). */
export function writeStoredPreference(storage: Pick<Storage, 'setItem'> | null | undefined, pref: ThemePreference): boolean {
  try {
    if (!storage) return false;
    storage.setItem(THEME_STORAGE_KEY, pref);
    return true;
  } catch {
    return false;
  }
}

/** Applies the resolved theme to <html>: data-theme, data-theme-pref, color-scheme and <meta name="theme-color">. */
export function applyTheme(pref: ThemePreference, resolved: ResolvedTheme, doc: Document = document): void {
  const root = doc.documentElement;
  root.setAttribute('data-theme', resolved);
  root.setAttribute('data-theme-pref', pref);
  root.style.colorScheme = resolved;
  doc.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', THEME_COLORS[resolved]));
}

/**
 * Tiny synchronous script for <head>; runs before first paint so there is no flash of the wrong theme.
 * Static string (no user data), emitted with the per-request CSP nonce.
 */
export const THEME_INIT_SCRIPT =
  '(function(){try{var p=null;try{p=localStorage.getItem(' +
  JSON.stringify(THEME_STORAGE_KEY) +
  ')}catch(e){}if(p!=="light"&&p!=="dark")p="system";var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.setAttribute("data-theme",d?"dark":"light");r.setAttribute("data-theme-pref",p);r.style.colorScheme=d?"dark":"light";var m=document.querySelectorAll(\'meta[name="theme-color"]\');for(var i=0;i<m.length;i++)m[i].setAttribute("content",d?' +
  JSON.stringify(THEME_COLORS.dark) +
  ':' +
  JSON.stringify(THEME_COLORS.light) +
  ')}catch(e){}})();';
