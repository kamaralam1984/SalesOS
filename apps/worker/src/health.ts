import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import type { Logger } from './logger';

/** Mirrors apps/api ops-probe: key `<BULLMQ_PREFIX>:worker:heartbeat:<instance>` with a 30 s TTL, refreshed every WORKER_HEARTBEAT_MS. */
export const heartbeatKey = (prefix: string, instance: string) => `${prefix}:worker:heartbeat:${instance}`;

export function startHeartbeat(redis: Redis, prefix: string, everyMs: number, log: Logger, meta: { release?: string } = {}) {
  const instance = `${process.pid}-${randomUUID().slice(0, 8)}`;
  const key = heartbeatKey(prefix, instance);
  const state = { lastBeatAt: 0, lastOk: false };
  const beat = async () => {
    try {
      await redis.set(key, JSON.stringify({ at: Date.now(), pid: process.pid, release: meta.release }), 'EX', 30);
      state.lastBeatAt = Date.now();
      state.lastOk = true;
    } catch (err) {
      state.lastOk = false;
      log.warn({ err: (err as Error).message }, 'heartbeat failed');
    }
  };
  void beat();
  const timer = setInterval(() => void beat(), everyMs);
  timer.unref();
  return {
    state,
    async stop() {
      clearInterval(timer);
      await redis.del(key).catch(() => undefined);
    },
  };
}

/** GET /health = liveness. GET /ready = DB + Redis reachable and the last heartbeat is recent. Bind to loopback/internal network only. */
export function startHealthServer(port: number, deps: { prisma: PrismaClient; redis: Redis; heartbeat: { state: { lastBeatAt: number } }; heartbeatMs: number }, log: Logger): Server {
  const server = createServer((req, res) => {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/health') return send(200, { status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
    if (req.url === '/ready') {
      void (async () => {
        const checks = { database: 'down', redis: 'down', heartbeat: 'stale' } as Record<string, string>;
        try { await deps.prisma.$queryRaw`SELECT 1`; checks.database = 'ok'; } catch { /* down */ }
        try { if ((await deps.redis.ping()) === 'PONG') checks.redis = 'ok'; } catch { /* down */ }
        if (Date.now() - deps.heartbeat.state.lastBeatAt < deps.heartbeatMs * 3) checks.heartbeat = 'ok';
        const ok = Object.values(checks).every((v) => v === 'ok');
        send(ok ? 200 : 503, { status: ok ? 'ready' : 'not_ready', checks });
      })();
      return;
    }
    send(404, { error: 'not_found' });
  });
  server.listen(port, '0.0.0.0', () => log.info({ port }, 'worker health server listening'));
  return server;
}
