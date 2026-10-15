import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { renderMatrix } from '../scripts/gen-permissions-matrix';
import { PERMISSION_CATALOGUE } from '../src/common/authz/permissions.catalogue';

const COLS = ['FOUNDER_CEO', 'SALES_TEAM_LEAD', 'SALES_MANAGER', 'SALES_EXECUTIVE', 'ADMIN', 'FINANCE', 'HR', 'MARKETING', 'COMMUNITY', 'OPERATIONS', 'STUDENT_SUCCESS'];
/** Keys that intentionally exist only in code (none: every key has a row in the tables). */
const CODE_ONLY = new Set<string>();

function parseMatrix() {
  const file = path.resolve(__dirname, '../../../docs/permissions-matrix.md');
  const body = fs.readFileSync(file, 'utf8').split('## Action coverage')[0]!;
  const out = new Map<string, Record<string, string>>();
  for (const line of body.split('\n')) {
    const m = line.match(/^\| `([^`]+)` \| (.*?) \|(.*)\|\s*$/);
    if (!m) continue;
    const cells = m[3]!.split('|').map((c) => c.trim());
    if (cells.length !== 11) continue;
    out.set(m[1]!, Object.fromEntries(COLS.flatMap((c, i) => (cells[i] !== '-' ? [[c, cells[i]!]] : []))));
  }
  return out;
}

describe('permission catalogue stays in sync with docs/permissions-matrix.md', () => {
  const matrix = parseMatrix();
  it('parses a non-trivial matrix', () => expect(matrix.size).toBeGreaterThan(100));
  it('every matrix key exists in code with identical role grants', () => {
    const byKey = new Map(PERMISSION_CATALOGUE.map((p) => [p.key as string, p]));
    const diffs: string[] = [];
    for (const [key, grants] of matrix) {
      const code = byKey.get(key);
      if (!code) { diffs.push(`${key}: missing in code`); continue; }
      if (JSON.stringify(Object.entries(code.grants).sort()) !== JSON.stringify(Object.entries(grants).sort())) {
        diffs.push(`${key}: code=${JSON.stringify(code.grants)} matrix=${JSON.stringify(grants)}`);
      }
    }
    expect(diffs, diffs.join('\n')).toEqual([]);
  });
  it('code has no keys absent from the matrix (except documented tightenings)', () => {
    const extra = PERMISSION_CATALOGUE.map((p) => p.key as string).filter((k) => !matrix.has(k) && !CODE_ONLY.has(k));
    expect(extra).toEqual([]);
  });
  it('ADMIN never holds a sensitive (HR / payments / incentives / refunds) permission', () => {
    const bad = PERMISSION_CATALOGUE.filter((p) => p.sensitive && p.grants.ADMIN).map((p) => p.key);
    expect(bad).toEqual([]);
  });
  it('the machine-readable per-role appendix is regenerated from the catalogue (run pnpm --filter @salesos/api permissions:matrix)', () => {
    const file = path.resolve(__dirname, '../../../docs/permissions-matrix.md');
    const md = fs.readFileSync(file, 'utf8');
    expect(renderMatrix(md) === md, 'appendix drift: run pnpm --filter @salesos/api permissions:matrix').toBe(true);
  });
  it('relationships:update and users:role:assign-sensitive are in the tables and the appendix', () => {
    const md = fs.readFileSync(path.resolve(__dirname, '../../../docs/permissions-matrix.md'), 'utf8');
    for (const k of ['relationships:update', 'users:role:assign-sensitive']) {
      expect(matrix.has(k), k).toBe(true);
      expect(md.includes(`"${k}`), k).toBe(true);
    }
  });
});
