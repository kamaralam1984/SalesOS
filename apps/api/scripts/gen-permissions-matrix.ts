/**
 * Regenerates the machine-readable appendix of docs/permissions-matrix.md (per-role `permission@scope` lists + allKeys) from the
 * code catalogue, which is the source of truth. The tables above it are checked key-by-key by test/catalogue-matrix.spec.ts.
 *   pnpm --filter @salesos/api permissions:matrix          (write)
 *   pnpm --filter @salesos/api permissions:matrix -- --check   (exit 1 when out of date)
 */
import fs from 'node:fs';
import path from 'node:path';
import { PERMISSION_CATALOGUE } from '../src/common/authz/permissions.catalogue';

export const ROLES = ['FOUNDER_CEO', 'SALES_TEAM_LEAD', 'SALES_MANAGER', 'SALES_EXECUTIVE', 'ADMIN', 'FINANCE', 'HR', 'MARKETING', 'COMMUNITY', 'OPERATIONS', 'STUDENT_SUCCESS'] as const;

export function buildAppendix() {
  const roles: Record<string, string[]> = {};
  for (const r of ROLES) roles[r] = PERMISSION_CATALOGUE.filter((p) => p.grants[r]).map((p) => `${p.key}@${p.grants[r]}`);
  return { version: 1, roles, allKeys: PERMISSION_CATALOGUE.map((p) => p.key as string) };
}

const FILE = path.resolve(__dirname, '../../../docs/permissions-matrix.md');
const FENCE = /```json\n([\s\S]*?)\n```/;

export function renderMatrix(md: string): string {
  const current = JSON.parse(FENCE.exec(md)![1]!) as { date?: string };
  const next = { ...buildAppendix(), date: current.date ?? new Date().toISOString().slice(0, 10) };
  const ordered = { version: next.version, date: next.date, roles: next.roles, allKeys: next.allKeys };
  return md.replace(FENCE, () => '```json\n' + JSON.stringify(ordered, null, 1) + '\n```');
}

if (require.main === module) {
  const md = fs.readFileSync(FILE, 'utf8');
  const out = renderMatrix(md);
  if (process.argv.includes('--check')) {
    if (out !== md) { console.error('docs/permissions-matrix.md appendix is out of date: run pnpm --filter @salesos/api permissions:matrix'); process.exit(1); }
    console.log('permissions matrix appendix is up to date');
  } else {
    fs.writeFileSync(FILE, out);
    console.log(`wrote ${ROLES.length} role lists, ${buildAppendix().allKeys.length} keys`);
  }
}
