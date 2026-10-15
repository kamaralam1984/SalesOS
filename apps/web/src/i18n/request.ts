import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from './config';
import { MESSAGE_AREAS, mergeMessages } from './merge';

/** Cookie-based locale (no URL prefix): routes stay identical across languages. */
export default getRequestConfig(async () => {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const base = (await import(`../../messages/${locale}.json`)).default;
  // Domain message files (messages/<locale>.<area>.json) are deep-merged over the base so parallel domains never edit one big file.
  const extras = await Promise.all(
    MESSAGE_AREAS.map(async (area) => {
      try {
        return (await import(`../../messages/${locale}.${area}.json`)).default;
      } catch {
        return {};
      }
    }),
  );
  return { locale, messages: mergeMessages(base, ...extras), timeZone: 'Asia/Kolkata' };
});
