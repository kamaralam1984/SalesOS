import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import en from '../../../messages/en.json';
import hi from '../../../messages/hi.json';
import mr from '../../../messages/mr.json';

// the catalogue keys live in packages/shared-types (read from source so the web app needs no extra dependency)
const NOTIFICATION_TYPES = [...fs.readFileSync(path.resolve(__dirname, '../../../../../packages/shared-types/src/events/platform.ts'), 'utf8').split('NOTIFICATION_TYPES = [')[1]!.split('] as const')[0]!.matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]!);

type Msgs = { platform: { notificationTypes: Record<string, { label: string; title: string }> } };

describe('notification type translations', () => {
  it('reads the catalogue', () => expect(NOTIFICATION_TYPES.length).toBeGreaterThan(30));
  for (const [name, m] of [['en', en], ['hi', hi], ['mr', mr]] as const) {
    it(`${name}: every catalogue type has a label and a generic title`, () => {
      const nt = (m as unknown as Msgs).platform.notificationTypes;
      const missing = NOTIFICATION_TYPES.filter((k) => !nt[k.replace(/\./g, '_')]?.label || !nt[k.replace(/\./g, '_')]?.title);
      expect(missing).toEqual([]);
    });
  }
  it('hi and mr differ from English (they are translated, not copied)', () => {
    const e = (en as unknown as Msgs).platform.notificationTypes;
    for (const m of [hi, mr]) {
      const t = (m as unknown as Msgs).platform.notificationTypes;
      const same = Object.keys(e).filter((k) => t[k]!.label === e[k]!.label);
      expect(same).toEqual([]);
    }
  });
});
