import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

interface Model { name: string; body: string; file: string }
function models(): Model[] {
  const dir = path.join(ROOT, 'prisma/schema');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.prisma')).flatMap((file) => {
    const s = fs.readFileSync(path.join(dir, file), 'utf8');
    return [...s.matchAll(/^model (\w+) \{\n([\s\S]*?)^\}/gm)].map((m) => ({ name: m[1]!, body: m[2]!, file }));
  });
}

describe('schema conventions (BP-DATA-008): UUID keys, UTC timestamps, organisation scope, real foreign keys', () => {
  const all = models();
  it('every model has a UUID primary key (or a composite key of UUIDs)', () => {
    // a key is either `id` (uuid, default uuid()), a UUID column that IS the foreign key (settings tables keyed by user/org), or a composite of UUIDs
    const bad = all.filter((m) => !/^\s+id\s+String\s+@id\s+@default\(uuid\(\)\)\s+@db\.Uuid/m.test(m.body) && !/^\s+\w+\s+String\s+@id\s+@map\("\w+"\)\s+@db\.Uuid/m.test(m.body) && !/@@id\(/.test(m.body)).map((m) => m.name);
    expect(bad).toEqual([]);
  });
  it('every DateTime column is TIMESTAMPTZ(6) (or a date-only @db.Date)', () => {
    const bad: string[] = [];
    for (const m of all) for (const line of m.body.split('\n')) {
      if (/^\s+\w+\s+DateTime\??\s/.test(line) && !/@db\.(Timestamptz\(6\)|Date)/.test(line)) bad.push(`${m.name}: ${line.trim()}`);
    }
    expect(bad).toEqual([]);
  });
  it('every tenant table carries organization_id as a real foreign key to organizations (Restrict)', () => {
    // global (no tenant) or child tables whose tenant is implied by their parent
    const noOrg = new Set(['Organization', 'Role', 'Permission', 'RolePermission', 'TeamMembership', 'AuthToken', 'ImportError', 'NotificationDeliveryEvent', 'EngagementParticipation']);
    const withOrgColumn = all.filter((m) => /^\s+organizationId\s+String\??\s/m.test(m.body));
    const missingFk = withOrgColumn.filter((m) => !/fields: \[organizationId\], references: \[id\], onDelete: Restrict/.test(m.body)).map((m) => m.name);
    const undeclared = all.filter((m) => !withOrgColumn.includes(m) && !noOrg.has(m.name)).map((m) => m.name);
    expect({ missingFk, undeclared }).toEqual({ missingFk: [], undeclared: [] });
  });
  it('no plain user / team id column is left without a foreign key (crm, revenue, people, cx, platform, analytics)', () => {
    const userish = /^(createdById|updatedById|userId|ownerId|assignedToId|authorId|actorId|employeeId|reviewerId|approvedById|decidedById|requestedById|recipientId|teamId)$/;
    const bad: string[] = [];
    for (const m of all.filter((x) => ['crm', 'revenue', 'people', 'cx', 'platform', 'analytics'].includes(x.file.replace('.prisma', '')))) {
      const related = new Set([...m.body.matchAll(/fields: \[(\w+)\]/g)].map((r) => r[1]!));
      for (const line of m.body.split('\n')) {
        const f = /^\s+(\w+)\s+String\??\s.*@db\.Uuid/.exec(line);
        if (f && userish.test(f[1]!) && !related.has(f[1]!)) bad.push(`${m.name}.${f[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('.env.example documents every environment variable the code reads (MS-DOC-004)', () => {
  it('lists each variable (commented placeholders count), and contains no real secrets', () => {
    const example = read('.env.example');
    const sources = ['apps/api/src', 'apps/worker/src', 'apps/web/src', 'packages/platform-core/src', 'packages/crm-core/src', 'packages/cx-core/src'];
    const names = new Set<string>();
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) { if (!['node_modules', 'dist', '__tests__'].includes(e.name)) walk(rel); continue; }
        if (!/\.(ts|tsx)$/.test(e.name) || /\.(test|spec)\./.test(e.name)) continue;
        for (const m of read(rel).matchAll(/process\.env\.([A-Z][A-Z0-9_]{3,})/g)) names.add(m[1]!);
      }
    };
    sources.forEach(walk);
    // the zod env schemas list their keys as object properties
    for (const f of ['apps/api/src/config/env.ts', 'apps/worker/src/config.ts']) for (const m of read(f).matchAll(/^\s+([A-Z][A-Z0-9_]{3,}):/gm)) names.add(m[1]!);
    const ignore = new Set(['NODE_ENV', 'CI', 'PORT_', 'HOME']);
    const missing = [...names].filter((n) => !ignore.has(n) && !new RegExp(`\\b${n}\\b`).test(example));
    expect(missing).toEqual([]);
    expect(example).not.toMatch(/sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN (RSA |EC )?PRIVATE KEY/);
  });
  it('the root .gitignore keeps real environment files out of git', () => {
    const ignore = read('.gitignore').split('\n').map((l) => l.trim());
    expect(ignore).toContain('.env');
    expect(ignore).toContain('!.env.example');
  });
});
