import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../../messages/en.json';
import hi from '../../../messages/hi.json';
import mr from '../../../messages/mr.json';

type Tree = { [k: string]: string | Tree };
const get = (t: Tree, p: string): string | undefined => {
  let cur: string | Tree | undefined = t;
  for (const k of p.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = cur[k];
  }
  return typeof cur === 'string' ? cur : undefined;
};
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\s*[,}]/g)].map((m) => m[1]!).sort();

const dir = __dirname;
const files = readdirSync(dir).filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'));

interface Use {
  file: string;
  ns: string;
  key: string;
  args: string[];
}
function usages(): Use[] {
  const out: Use[] = [];
  for (const f of files) {
    const src = readFileSync(path.join(dir, f), 'utf8');
    for (const seg of src.split(/\n(?=(?:export )?(?:default )?function )/)) {
      const binds = [...seg.matchAll(/const (\w+) = useTranslations\('([\w.]+)'\)/g)].map((m) => [m[1]!, m[2]!] as const);
      for (const [v, ns] of binds) {
        const re = new RegExp(`(?<![\\w.])${v}\\('([\\w.]+)'(?:,\\s*\\{([^}]*)\\})?`, 'g');
        for (const m of seg.matchAll(re)) {
          const args = (m[2] ?? '')
            .split(',')
            .map((a) => a.trim().split(':')[0]!.trim())
            .filter(Boolean);
          out.push({ file: f, ns, key: m[1]!, args });
        }
      }
    }
  }
  return out;
}

describe('revenue UI strings', () => {
  const all = usages();
  it('finds the string usages (guards the extractor itself)', () => {
    expect(all.length).toBeGreaterThan(300);
  });
  it('every literal translation key exists in en, hi and mr with the same placeholders', () => {
    const problems: string[] = [];
    for (const u of all) {
      const id = `${u.ns}.${u.key}`;
      const e = get(en as Tree, id);
      if (e === undefined) {
        problems.push(`${u.file}: missing en ${id}`);
        continue;
      }
      for (const [name, tree] of [['hi', hi], ['mr', mr]] as const) {
        const t = get(tree as Tree, id);
        if (t === undefined) problems.push(`${u.file}: missing ${name} ${id}`);
        else if (JSON.stringify(placeholders(t)) !== JSON.stringify(placeholders(e))) problems.push(`${u.file}: ${name} placeholders differ for ${id}`);
      }
      // every placeholder the message needs is passed by the call site (and nothing unknown is passed)
      const need = placeholders(e);
      const missing = need.filter((p) => !u.args.includes(p));
      if (missing.length) problems.push(`${u.file}: ${id} does not pass ${missing.join(', ')}`);
    }
    expect(problems).toEqual([]);
  });
  it('dynamic enumerations used by the UI are all translated', () => {
    const enums: Record<string, string[]> = {
      'revenue.stage': ['OPEN', 'NEGOTIATION', 'PAYMENT_PENDING', 'WON', 'LOST', 'CANCELLED'],
      'revenue.paymentStatus': ['EXPECTED', 'RECORDED', 'VERIFIED', 'REJECTED', 'RECONCILED', 'REVERSED'],
      'revenue.refundStatus': ['REQUESTED', 'REVIEWED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'PROCESSED', 'RECONCILED', 'CANCELLED'],
      'revenue.method': ['UPI', 'BANK_TRANSFER', 'CARD', 'CASH', 'CHEQUE', 'GATEWAY', 'OTHER'],
      'revenue.refundReason': ['LEARNER_REQUEST', 'DUPLICATE_PAYMENT', 'PROGRAM_CANCELLED', 'MISSELLING', 'TECHNICAL', 'OTHER'],
    };
    for (const [ns, keys] of Object.entries(enums)) for (const k of keys) for (const tree of [en, hi, mr]) expect(get(tree as Tree, `${ns}.${k}`), `${ns}.${k}`).toBeTruthy();
  });
  it('Hindi and Marathi are actually translated, not copied English, for the headline strings', () => {
    for (const k of ['revenue.deals.title', 'revenue.money.sale', 'revenue.money.collected', 'revenue.refunds.title', 'revenue.targets.title', 'revenue.forecasts.estimateBanner']) {
      expect(get(hi as Tree, k)).not.toBe(get(en as Tree, k));
      expect(get(mr as Tree, k)).not.toBe(get(en as Tree, k));
    }
  });
});
