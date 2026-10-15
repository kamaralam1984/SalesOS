import { describe, expect, it } from 'vitest';
import enBase from '../../messages/en.json';
import hiBase from '../../messages/hi.json';
import mrBase from '../../messages/mr.json';
import { MESSAGE_AREAS, mergeMessages } from './merge';

type Tree = { [k: string]: string | Tree };
// domain files messages/<locale>.<area>.json are merged exactly like the runtime does
const areaFiles = import.meta.glob('../../messages/*.*.json', { eager: true, import: 'default' }) as Record<string, Tree>;
const withAreas = (locale: string, base: unknown): Tree =>
  mergeMessages(base as Tree, ...MESSAGE_AREAS.map((a) => areaFiles[`../../messages/${locale}.${a}.json`] ?? {}));
const en = withAreas('en', enBase);
const hi = withAreas('hi', hiBase);
const mr = withAreas('mr', mrBase);
const flat = (t: Tree, p = ''): string[] =>
  Object.entries(t).flatMap(([k, v]) => (typeof v === 'string' ? [p + k] : flat(v, `${p}${k}.`)));
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\s*[,}]/g)].map((m) => m[1]).sort();
const get = (t: Tree, path: string) =>
  path.split('.').reduce<string | Tree>((a, k) => (a as Tree)[k]!, t) as string;

describe('i18n message files', () => {
  const keys = flat(en as Tree);
  for (const [name, msgs] of [
    ['hi', hi],
    ['mr', mr],
  ] as const) {
    it(`${name} has exactly the same keys as en`, () => {
      expect(flat(msgs as Tree).sort()).toEqual([...keys].sort());
    });
    it(`${name} keeps every ICU placeholder`, () => {
      for (const k of keys) {
        expect(placeholders(get(msgs as Tree, k)), `${name}:${k}`).toEqual(
          placeholders(get(en as Tree, k)),
        );
      }
    });
    it(`${name} is actually translated (not copied English) for shell and nav`, () => {
      for (const k of ['nav.dashboard', 'shell.signOut', 'auth.signIn', 'common.cancel']) {
        expect(get(msgs as Tree, k)).not.toBe(get(en as Tree, k));
      }
    });
  }
});
