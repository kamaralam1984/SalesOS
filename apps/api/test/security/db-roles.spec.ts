import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { CSRF_HEADER } from '@salesos/shared-types';
import { createOrg, createUser, TEST_PASSWORD } from '../helpers';

/**
 * Least-privilege database roles + production-mode boot, proven end to end:
 *   1. a throw-away database is created, OWNED by a migration role; `prisma migrate deploy` runs as that role (no superuser)
 *   2. prisma/sql/db-roles.sql (the file operations run) creates the application role
 *   3. the real API boots in NODE_ENV=production as the APPLICATION role (DB_AUTO_DDL off: it only verifies the guards)
 *   4. the application role can do CRUD, but cannot CREATE/ALTER/DROP/TRUNCATE, cannot touch _prisma_migrations, cannot rewrite audit history
 *   5. production headers / cookie attributes are asserted against that running app
 * Cluster-level roles are named per test run and dropped afterwards.
 */
const ROOT = path.resolve(__dirname, '../../../..');
const base = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!);
const run = randomBytes(3).toString('hex');
const DB = `salesos_agentk_roles_${run}`;
const MIG = `sk_mig_${run}`;
const APP = `sk_app_${run}`;
const MIG_PW = randomBytes(18).toString('base64url') + 'aZ9';
const APP_PW = randomBytes(18).toString('base64url') + 'bY8';
const urlFor = (user: string, pw: string, db: string) => { const u = new URL(base.toString()); u.username = user; u.password = pw; u.pathname = `/${db}`; u.searchParams.set('schema', 'public'); return u.toString(); };
const adminUrl = (db: string) => { const u = new URL(base.toString()); u.pathname = `/${db}`; u.search = ''; return u.toString(); };
const MIG_URL = urlFor(MIG, MIG_PW, DB);
const APP_URL = urlFor(APP, APP_PW, DB);

let admin: PrismaClient;
let owner: PrismaClient;
let app: PrismaClient;
let nest: import('../helpers').TestApp | undefined;
const saved: Record<string, string | undefined> = {};
const PROD_ENV = (): Record<string, string> => ({
  NODE_ENV: 'production',
  DATABASE_URL: APP_URL,
  SESSION_SECRET: randomBytes(48).toString('base64'),
  PLATFORM_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  CORS_ORIGINS: 'https://sales.example.test',
  APP_BASE_URL: 'https://sales.example.test',
  THROTTLE_STORAGE: 'redis',
  S3_ENDPOINT: 'http://127.0.0.1:9100',
  S3_BUCKET: `salesos-agentk-${run}`,
  S3_ACCESS_KEY: 'agentk-access-key-xyz',
  S3_SECRET_KEY: 'agentk-secret-key-0123456789',
  LOG_LEVEL: 'silent',
});

beforeAll(async () => {
  admin = new PrismaClient({ datasourceUrl: adminUrl('postgres') });
  await admin.$executeRawUnsafe(`CREATE ROLE ${MIG} LOGIN PASSWORD '${MIG_PW}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
  await admin.$executeRawUnsafe(`CREATE DATABASE ${DB} OWNER ${MIG}`);
  // 1. migrations run as the (non-superuser) migration role
  const mig = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy', '--schema', 'prisma/schema'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: MIG_URL } });
  if (mig.status !== 0) throw new Error(`migrate deploy as migration role failed:\n${mig.stdout}\n${mig.stderr}`);
  // 2. the DBA script
  execFileSync('psql', [adminUrl(DB), '-v', 'ON_ERROR_STOP=1', '-v', `dbname=${DB}`, '-v', `migrator_role=${MIG}`, '-v', `app_role=${APP}`, '-v', `migrator_password=${MIG_PW}`, '-v', `app_password=${APP_PW}`, '-q', '-f', path.join(ROOT, 'prisma/sql/db-roles.sql')], { stdio: 'pipe' });
  owner = new PrismaClient({ datasourceUrl: MIG_URL });
  app = new PrismaClient({ datasourceUrl: APP_URL });
  // 3. production boot as the application role
  for (const [k, v] of Object.entries(PROD_ENV())) { saved[k] = process.env[k]; process.env[k] = v; }
  const { createTestApp } = await import('../helpers');
  nest = await createTestApp();
}, 300_000);

afterAll(async () => {
  await nest?.close().catch(() => undefined);
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await app?.$disconnect();
  await owner?.$disconnect();
  await admin?.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await admin?.$executeRawUnsafe(`DROP OWNED BY ${APP}`).catch(() => undefined);
  await admin?.$executeRawUnsafe(`DROP ROLE IF EXISTS ${APP}`);
  await admin?.$executeRawUnsafe(`DROP ROLE IF EXISTS ${MIG}`);
  await admin?.$disconnect();
}, 120_000);

const expectDenied = async (p: Promise<unknown>, re = /permission denied|must be owner|append-only|not allowed/i) => {
  await expect(p).rejects.toThrow(re);
};

describe('migration role vs application role', () => {
  it('the application role is not a superuser, cannot create databases or roles, and owns nothing', async () => {
    const [r] = await admin.$queryRawUnsafe<Array<{ rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolbypassrls: boolean }>>(`SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = '${APP}'`);
    expect(r).toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false });
    const owned = await owner.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint n FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = '${APP}'`);
    expect(Number(owned[0]!.n)).toBe(0);
  });

  it('the application role has NO DDL: CREATE / ALTER / DROP / TRUNCATE / TRIGGER changes are denied', async () => {
    await expectDenied(app.$executeRawUnsafe('CREATE TABLE evil (id int)'));
    await expectDenied(app.$executeRawUnsafe('ALTER TABLE leads ADD COLUMN evil int'));
    await expectDenied(app.$executeRawUnsafe('DROP TABLE leads'));
    await expectDenied(app.$executeRawUnsafe('TRUNCATE leads CASCADE'));
    await expectDenied(app.$executeRawUnsafe('DROP TRIGGER audit_logs_append_only ON audit_logs'));
    await expectDenied(app.$executeRawUnsafe('CREATE INDEX evil_idx ON leads (created_at)'));
    await expectDenied(app.$executeRawUnsafe('CREATE FUNCTION evil() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql'));
    await expectDenied(app.$queryRawUnsafe('SELECT * FROM _prisma_migrations'));
    await expectDenied(app.$executeRawUnsafe('DROP SCHEMA public CASCADE'));
  });

  it('the application role still has plain DML on business tables', async () => {
    const org = await owner.organization.create({ data: { name: '[TEST] roles', slug: `roles-${run}` } });
    const viaApp = await app.team.create({ data: { organizationId: org.id, name: 'via app role' } });
    await app.team.update({ where: { id: viaApp.id }, data: { name: 'renamed' } });
    expect((await app.team.findUniqueOrThrow({ where: { id: viaApp.id } })).name).toBe('renamed');
    await app.team.delete({ where: { id: viaApp.id } });
  });

  it('audit_logs is append-only for EVERY role: privilege-level for the application role, trigger-level even for the owner', async () => {
    const org = await owner.organization.create({ data: { name: '[TEST] audit', slug: `audit-${run}` } });
    const row = await app.auditLog.create({ data: { organizationId: org.id, action: 'roles.test', entityType: 'test' } });
    await expectDenied(app.auditLog.update({ where: { id: row.id }, data: { action: 'tampered' } }), /permission denied/i);
    await expectDenied(app.auditLog.delete({ where: { id: row.id } }), /permission denied/i);
    await expectDenied(app.$executeRawUnsafe('TRUNCATE audit_logs'), /permission denied/i);
    // the migration role OWNS the table and could grant itself anything; the triggers still hold
    await expectDenied(owner.auditLog.update({ where: { id: row.id }, data: { action: 'tampered' } }), /append-only/i);
    await expectDenied(owner.auditLog.delete({ where: { id: row.id } }), /append-only/i);
    await expectDenied(owner.$executeRawUnsafe('TRUNCATE audit_logs CASCADE'), /append-only/i);
    expect((await app.auditLog.findUniqueOrThrow({ where: { id: row.id } })).action).toBe('roles.test');
  });

  it('money history tables are append-only for the application role as well (privilege level)', async () => {
    for (const table of ['payment_events', 'refund_events', 'deal_status_history', 'founder_report_snapshots', 'sales_credits']) {
      await expectDenied(app.$executeRawUnsafe(`UPDATE ${table} SET id = id WHERE false`), /permission denied/i);
      await expectDenied(app.$executeRawUnsafe(`DELETE FROM ${table} WHERE false`), /permission denied/i);
      await expectDenied(app.$executeRawUnsafe(`TRUNCATE ${table}`), /permission denied|append-only/i);
    }
  });

  it('migrations can still be applied by the migration role afterwards (a no-op re-run) and new tables get app privileges by default', async () => {
    const again = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy', '--schema', 'prisma/schema'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: MIG_URL } });
    expect(again.stdout).toMatch(/No pending migrations/);
    await owner.$executeRawUnsafe('CREATE TABLE zz_future_table (id int primary key)');
    await app.$executeRawUnsafe('INSERT INTO zz_future_table VALUES (1)');
    await expectDenied(app.$executeRawUnsafe('TRUNCATE zz_future_table'), /permission denied/i);
    await owner.$executeRawUnsafe('DROP TABLE zz_future_table');
  });

  it('db-roles.sql is idempotent (second run, new passwords) and the migration is the copy of prisma/sql/security-guards.sql', () => {
    execFileSync('psql', [adminUrl(DB), '-v', 'ON_ERROR_STOP=1', '-v', `dbname=${DB}`, '-v', `migrator_role=${MIG}`, '-v', `app_role=${APP}`, '-v', `migrator_password=${MIG_PW}`, '-v', `app_password=${APP_PW}`, '-q', '-f', path.join(ROOT, 'prisma/sql/db-roles.sql')], { stdio: 'pipe' });
    const mig = fs.readFileSync(path.join(ROOT, 'prisma/schema/migrations/20261015140000_security_hardening/migration.sql'), 'utf8');
    expect(mig).toBe(fs.readFileSync(path.join(ROOT, 'prisma/sql/security-guards.sql'), 'utf8'));
  });
});

describe('the real API in NODE_ENV=production, connected as the application role', () => {
  const http = () => request(nest!.app.getHttpServer());
  let cookie = '';
  let csrf = '';

  it('boots without DDL rights (guards verified, not created) and serves health', async () => {
    const res = await http().get('/api/v1/health');
    expect(res.status).toBe(200);
  });

  it('login sets Secure + HttpOnly + SameSite session cookie and a Secure readable csrf cookie; HSTS and security headers are present', async () => {
    const org = await createOrg(owner);
    const u = await createUser(owner, org, { roles: ['SALES_EXECUTIVE'] });
    const res = await http().post('/api/v1/auth/login').set('Origin', 'https://sales.example.test').send({ email: u.email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const session = cookies.find((c) => c.startsWith('salesos_session='))!;
    const csrfCookie = cookies.find((c) => c.startsWith('salesos_csrf='))!;
    for (const c of [session, csrfCookie]) {
      expect(c).toMatch(/;\s*Secure/i);
      expect(c).toMatch(/SameSite=(Lax|Strict)/i);
      expect(c).toMatch(/Path=\//);
      expect(c).toMatch(/Expires=/i);
    }
    expect(session).toMatch(/HttpOnly/i);
    expect(csrfCookie).not.toMatch(/HttpOnly/i);
    expect(res.headers['strict-transport-security']).toMatch(/max-age=31536000;\s*includeSubDomains/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['content-security-policy']).not.toContain('unsafe-inline');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-site');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['cache-control']).toContain('no-store');
    cookie = session.split(';')[0]!;
    csrf = res.body.data.csrfToken;
  });

  it('CORS: only the configured https origin is echoed, credentials allowed; any other origin gets no CORS headers (also for preflight)', async () => {
    const ok = await http().options('/api/v1/auth/me').set('Origin', 'https://sales.example.test').set('Access-Control-Request-Method', 'GET');
    expect(ok.headers['access-control-allow-origin']).toBe('https://sales.example.test');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    for (const origin of ['https://evil.example', 'http://sales.example.test', 'https://sales.example.test.evil.example', 'null', 'http://localhost:3100']) {
      const r = await http().options('/api/v1/auth/me').set('Origin', origin).set('Access-Control-Request-Method', 'GET');
      expect(r.headers['access-control-allow-origin'], origin).toBeUndefined();
      const g = await http().get('/api/v1/health').set('Origin', origin);
      expect(g.headers['access-control-allow-origin'], origin).toBeUndefined();
    }
    expect(ok.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('Swagger / OpenAPI are NOT served in production, errors carry no stack or SQL, malformed bodies are 400 not 500', async () => {
    for (const p of ['/api/docs', '/api/docs-json', '/api/v1/openapi.json']) expect((await http().get(p)).status, p).toBe(404);
    const res = await http().post('/api/v1/auth/login').set('Origin', 'https://sales.example.test').set('content-type', 'application/json').send('{"email": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(JSON.stringify(res.body)).not.toMatch(/SyntaxError|\bat \w+|node_modules|\.ts:\d/);
    const big = await http().post('/api/v1/auth/login').set('Origin', 'https://sales.example.test').send({ email: 'a@b.co', password: 'x'.repeat(2_000_000) });
    expect(big.status).toBe(413);
    const authed = await http().get('/api/v1/leads/not-a-uuid').set('Cookie', cookie);
    expect(authed.status).toBe(400);
    expect(JSON.stringify(authed.body)).not.toMatch(/prisma|SELECT|stack/i);
  });

  it('CSRF is enforced in production mode too', async () => {
    const no = await http().post('/api/v1/auth/logout').set('Cookie', cookie).set('Origin', 'https://sales.example.test');
    expect(no.status).toBe(403);
    const yes = await http().post('/api/v1/auth/logout').set('Cookie', cookie).set('Origin', 'https://sales.example.test').set(CSRF_HEADER, csrf);
    expect(yes.status).toBe(200);
    expect((await http().get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('a database without the guard triggers makes the API refuse to start (fail closed), it does not try to create them', async () => {
    await owner.$executeRawUnsafe('DROP TRIGGER audit_logs_append_only ON audit_logs');
    try {
      const { createTestApp } = await import('../helpers');
      await expect(createTestApp()).rejects.toThrow(/Database guards missing \(audit_logs_append_only/);
    } finally {
      await owner.$executeRawUnsafe(`CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION salesos_block_audit_mutation()`);
    }
  });
});
