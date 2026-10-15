import { useLocale, useTranslations } from 'next-intl';
import en from '../../../messages/en.json';

const typeKey = (type: string) => type.replace(/\./g, '_');
type TypeText = Record<string, { label: string; title: string }>;
const EN = (en as unknown as { platform: { notificationTypes: TypeText } }).platform.notificationTypes;

/**
 * Server-generated alerts are English (KI-F-03). The generic title/label of every catalogue type is translated here; a title
 * that was customised by the producer (an event with its own wording) is shown as sent.
 */
export function useNotificationText() {
  const t = useTranslations('platform.notificationTypes');
  const locale = useLocale();
  const has = (type: string) => !!EN[typeKey(type)];
  return {
    /** Label of a notification type (preferences, filters). Falls back to the server's English label. */
    label(type: string, fallback: string): string {
      return has(type) ? t(`${typeKey(type)}.label`) : fallback;
    },
    /** Title of an alert: translated when it is the type's generic title, as sent otherwise. */
    title(n: { type: string; title: string }): string {
      if (locale === 'en' || !has(n.type)) return n.title;
      return n.title === EN[typeKey(n.type)]!.title ? t(`${typeKey(n.type)}.title`) : n.title;
    },
  };
}
