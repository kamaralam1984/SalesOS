export const LOCALES = ['en', 'hi', 'mr'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'NEXT_LOCALE';
/** Endonyms: always shown in the language's own script so users can find their language. */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', hi: 'हिन्दी', mr: 'मराठी' };
export const isLocale = (v: unknown): v is Locale =>
  typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
