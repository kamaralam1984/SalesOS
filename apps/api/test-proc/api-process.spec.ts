import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

/**
 * The compiled API as a real process: structured JSON logs with request ids, and SIGTERM draining.
 * Uses the dedicated test database `salesos_agentl_test` (created/migrated by the api suite) and port API_PORT (default 4212).
 */
const root = path.resolve(__dirname, '..');
const PORT = Number(process.env.API_PORT ?? 4212);
const DB = process.env.TEST_DATABASE_URL ?? 'postgresql://salesos:salesos_dev_only@127.0.0.1:5533/salesos_agentl_test?schema=public';
let child: ChildProcess;
const out: string[] = [];
let exitCode: number | null | undefined;
let exited: Promise<void>;

const until = async (fn: () => Promise<boolean> | boolean, ms = 60_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };
const httpGet = (p: string, headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, { headers });

beforeAll(async () => {
  child = spawn('node', ['dist-l2/main.js'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'development', PORT: String(PORT), DATABASE_URL: DB, REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6391', SESSION_SECRET: 'proc-session-secret-proc-session-secret-0123456789', CORS_ORIGINS: 'http://localhost:3100', LOG_LEVEL: 'info', THROTTLE_STORAGE: 'memory' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let buf = '';
  child.stdout!.on('data', (d: Buffer) => { buf += d.toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { out.push(buf.slice(0, i)); buf = buf.slice(i + 1); } });
  child.stderr!.on('data', (d: Buffer) => out.push(`STDERR ${d.toString()}`));
  exited = new Promise((r) => child.on('exit', (c) => { exitCode = c; r(); }));
  const up = await until(async () => { try { return (await httpGet('/api/v1/health')).status === 200; } catch { return false; } });
  if (!up) throw new Error(`API did not start: ${out.slice(-20).join('\n')}`);
});
afterAll(() => { if (exitCode === undefined) child.kill('SIGKILL'); });

const json = (l: string) => { try { return JSON.parse(l) as Record<string, any>; } catch { return null; } };

describe('structured logs', () => {
  it('emits one JSON object per line with level, time, service and the request id; redacts secrets', async () => {
    const res = await httpGet('/api/v1/health', { 'x-request-id': 'proc-test-req-0001', authorization: 'Bearer SUPERSECRETVALUE', cookie: 'salesos_session=SUPERSECRETCOOKIE' });
    expect(res.headers.get('x-request-id')).toBe('proc-test-req-0001');
    expect(await until(() => out.some((l) => l.includes('proc-test-req-0001')), 5000)).toBe(true);
    const line = out.map(json).find((o) => o?.req?.id === 'proc-test-req-0001');
    expect(line).toBeTruthy();
    expect(line).toMatchObject({ service: 'salesos-api', res: { statusCode: 200 } });
    expect(typeof line!.level).toBe('number');
    expect(typeof line!.time).toBe('number');
    expect(typeof line!.responseTime).toBe('number');
    expect(line!.req.url).toBe('/api/v1/health');
    expect(out.join('\n')).not.toMatch(/SUPERSECRET/);
  });
  it('never logs query strings', async () => {
    await httpGet('/api/v1/health?token=QUERYSECRET123', { 'x-request-id': 'proc-test-req-0002' });
    await until(() => out.some((l) => l.includes('proc-test-req-0002')), 5000);
    expect(out.join('\n')).not.toContain('QUERYSECRET123');
  });
});

describe('graceful shutdown', () => {
  it('SIGTERM: an in-flight request is completed, new connections are refused, the process exits 0 within the grace period', async () => {
    // open a request and leave its body unfinished => in flight when SIGTERM arrives
    const sock = net.connect(PORT, '127.0.0.1');
    let response = '';
    sock.on('data', (d) => (response += d.toString()));
    const body = JSON.stringify({ email: 'nobody@example.com', password: 'Wrong-password-123' });
    await new Promise<void>((r) => sock.once('connect', () => r()));
    sock.write(`POST /api/v1/auth/login HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: http://localhost:3100\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body.slice(0, 10)}`);
    await new Promise((r) => setTimeout(r, 500));
    const t0 = Date.now();
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 700));
    expect(exitCode).toBeUndefined(); // still draining: the request is open
    const refused = await fetch(`http://127.0.0.1:${PORT}/api/v1/health`).then(() => false, () => true);
    expect(refused).toBe(true);
    sock.write(body.slice(10)); // finish the request
    await Promise.race([exited, new Promise((r) => setTimeout(r, 25_000))]);
    expect(response).toMatch(/^HTTP\/1\.1 (200|401|400)/); // answered, not dropped
    expect(exitCode).toBe(0);
    expect(Date.now() - t0).toBeLessThan(25_000);
    sock.destroy();
  });
});
