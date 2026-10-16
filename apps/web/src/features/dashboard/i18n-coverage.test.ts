import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import enBase from '../../../messages/en.json';
import hiBase from '../../../messages/hi.json';
import mrBase from '../../../messages/mr.json';
import { MESSAGE_AREAS, mergeMessages } from '../../i18n/merge';

type Tree = { [k: string]: string | Tree };
// domain files messages/<locale>.<area>.json are merged over the base exactly like the runtime does
const areaFiles = import.meta.glob('../../../messages/*.*.json', { eager: true, import: 'default' }) as Record<string, Tree>;
const withAreas = (locale: string, base: unknown): Tree =>
  mergeMessages(base as Tree, ...MESSAGE_AREAS.map((a) => areaFiles[`../../../messages/${locale}.${a}.json`] ?? {}));
const en = withAreas('en', enBase);
const hi = withAreas('hi', hiBase);
const mr = withAreas('mr', mrBase);
const get = (t: Tree, p: string): string | undefined => {
  let cur: string | Tree | undefined = t;
  for (const k of p.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = cur[k];
  }
  return typeof cur === 'string' ? cur : undefined;
};
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\s*[,}]/g)].map((m) => m[1]!).sort();

const dirs = [__dirname, path.join(__dirname, '../reporting')];
interface Use { file: string; ns: string; key: string; args: string[] }

function usages(): Use[] {
  const out: Use[] = [];
  for (const dir of dirs) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.tsx') && !x.endsWith('.test.tsx'))) {
      const src = readFileSync(path.join(dir, f), 'utf8');
      for (const seg of src.split(/\n(?=(?:export )?(?:default )?function )/)) {
        const binds = [...seg.matchAll(/const (\w+) = useTranslations\('([\w.]+)'\)/g)].map((m) => [m[1]!, m[2]!] as const);
        for (const [v, ns] of binds) {
          const re = new RegExp(`(?<![\\w.])${v}\\('([\\w.]+)'(?:,\\s*\\{([^}]*)\\})?`, 'g');
          for (const m of seg.matchAll(re)) {
            const args = (m[2] ?? '').split(',').map((a) => a.trim().split(':')[0]!.trim()).filter(Boolean);
            out.push({ file: f, ns, key: m[1]!, args });
          }
        }
      }
    }
  }
  return out;
}

describe('analytics UI strings', () => {
  const all = usages();
  it('finds the string usages (guards the extractor itself)', () => {
    expect(all.length).toBeGreaterThan(250);
  });
  it('every literal translation key exists in en, hi and mr with the same placeholders, and call sites pass them', () => {
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
      const missing = placeholders(e).filter((p) => !u.args.includes(p));
      if (missing.length) problems.push(`${u.file}: ${id} does not pass ${missing.join(', ')}`);
    }
    expect(problems).toEqual([]);
  });
  it('dynamic enumerations used by the UI are all translated', () => {
    const enums: Record<string, string[]> = {
      'analytics.pipeline.stages': ['OPEN', 'NEGOTIATION', 'PAYMENT_PENDING'],
      'analytics.tile.filter': ['teamId', 'programId', 'sourceId', 'ownerId'],
      'analytics.reasons': ['zeroDenominator', 'noTarget', 'noData', 'noSnapshot', 'insufficientResponses', 'notComputable'],
      'analytics.exports.state': ['QUEUED', 'RUNNING', 'READY', 'FAILED', 'EXPIRED'],
      'analytics.recon.status': ['PASS', 'FAIL', 'SKIPPED'],
      'analytics.dictionary.groups': ['REV', 'SAL', 'PRD', 'TEA', 'PRO', 'CX', 'FND', 'EXC'],
      'analytics.report.by': ['source', 'program', 'owner'],
      'analytics.admin.queue': ['outbox', 'notificationDeliveries', 'fileProcessing', 'reportExports', 'imports'],
      'analytics.admin.service': ['database', 'redis'],
      'analytics.reportNames': ['follow-ups', 'conversions', 'funnel', 'revenue', 'team-performance', 'weekly-founder', 'monthly-founder', 'reconciliation', 'kpis', 'exports'],
      'analytics.risks': ['overdueTasks', 'unassignedLeads', 'noNextActionLeads', 'staleLeads', 'openComplaints', 'p1Complaints', 'breachedComplaints', 'openEscalations', 'paymentsAwaitingVerification', 'refundsAwaitingDecision', 'dealsPastExpectedClose', 'highValueOpenDeals'],
    };
    for (const [ns, keys] of Object.entries(enums)) for (const k of keys) for (const tree of [en, hi, mr]) expect(get(tree as Tree, `${ns}.${k}`), `${ns}.${k}`).toBeTruthy();
    for (const r of ['follow-ups', 'conversions', 'funnel', 'revenue', 'team-performance', 'weekly-founder', 'monthly-founder', 'reconciliation', 'kpis', 'exports']) for (const tree of [en, hi, mr]) expect(get(tree as Tree, `analytics.reportNames.${r}Hint`), r).toBeTruthy();
  });
  it('Hindi and Marathi are translated, not copied English, for the headline strings', () => {
    for (const k of ['analytics.founder.title', 'analytics.teamLead.title', 'analytics.manager.title', 'analytics.executive.title', 'analytics.admin.title', 'analytics.recon.title', 'analytics.tile.restricted']) {
      expect(get(hi as Tree, k)).not.toBe(get(en as Tree, k));
      expect(get(mr as Tree, k)).not.toBe(get(en as Tree, k));
    }
  });
});
