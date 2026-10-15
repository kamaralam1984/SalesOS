import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { streamQuerySchema } from '@salesos/validation';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { SessionService } from '../../../common/authz/session.service';
import { AppError } from '../../../common/http/errors';
import { StreamService, type StreamEvent } from './stream.service';

const MAX_STREAMS_PER_USER = 5;
const openStreams = new Map<string, number>();

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

@ApiTags('crm: live updates')
@Controller()
export class StreamController {
  constructor(private readonly stream: StreamService, private readonly sessions: SessionService) {}

  /**
   * Server-Sent Events: task changes (scoped), in-app notifications for the caller, exception count.
   * Resume with `Last-Event-ID` (= last cursor) or ?since=. Connection lifetime is bounded so permission/session
   * changes take effect on reconnect. Clients fall back to GET /stream/poll.
   */
  @Get('stream')
  @RequirePermission('notifications:view')
  async sse(@CurrentUser() user: Principal, @Req() req: Request, @Res() res: Response, @Query(new ZodPipe(streamQuerySchema)) q: z.infer<typeof streamQuerySchema>) {
    // Each stream polls the DB every few seconds: cap concurrent streams per user (DoS / connection exhaustion).
    if ((openStreams.get(user.userId) ?? 0) >= num(process.env.CRM_STREAM_MAX_PER_USER, MAX_STREAMS_PER_USER)) throw new AppError('TOO_MANY_STREAMS', 'Too many open live-update streams', 429);
    openStreams.set(user.userId, (openStreams.get(user.userId) ?? 0) + 1);
    const pollMs = num(process.env.CRM_STREAM_POLL_MS, 3000);
    const maxMs = num(process.env.CRM_STREAM_MAX_MS, 10 * 60_000);
    const lastId = req.headers['last-event-id'];
    let since = q.since ?? (typeof lastId === 'string' && !Number.isNaN(Date.parse(lastId)) ? new Date(lastId) : new Date());
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const write = (e: { id?: string; event: string; data: unknown }) => {
      if (res.writableEnded) return;
      res.write(`${e.id ? `id: ${e.id}\n` : ''}event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
    };
    res.write(`retry: 5000\n\n`);
    write({ event: 'ready', id: since.toISOString(), data: { cursor: since.toISOString(), pollMs } });
    let lastCount: number | null = null;
    const sent = new Set<string>(); // de-duplicate the look-back overlap: task id@updatedAt, notification id
    let busy = false;
    const tick = async () => {
      if (busy || res.writableEnded) return;
      busy = true;
      try {
        if (!(await this.sessions.stillValid(user))) {
          write({ event: 'bye', data: { reason: 'session-ended' } });
          res.end();
          return;
        }
        const { cursor, events } = await this.stream.collect(user, since);
        for (const e of events) {
          if (e.type === 'exceptions') {
            const c = e.data.openCount as number;
            if (c === lastCount) continue;
            lastCount = c;
          }
          const key = e.type === 'task' ? `t:${e.data.id}@${e.data.updatedAt}` : e.type === 'notification' ? `n:${e.data.id}:${e.data.status}` : null;
          if (key) {
            if (sent.has(key)) continue;
            sent.add(key);
            if (sent.size > 5000) sent.delete(sent.values().next().value as string);
          }
          write({ event: e.type, data: e.data });
        }
        since = new Date(cursor);
        write({ event: 'cursor', id: cursor, data: { cursor } });
      } catch {
        write({ event: 'error', data: { message: 'stream temporarily unavailable' } });
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void tick(), pollMs);
    const ping = setInterval(() => !res.writableEnded && res.write(': ping\n\n'), 15_000);
    const stop = setTimeout(() => {
      write({ event: 'bye', data: { reason: 'max-lifetime; reconnect' } });
      res.end();
    }, maxMs);
    let released = false;
    const cleanup = () => {
      if (!released) {
        released = true;
        const n = (openStreams.get(user.userId) ?? 1) - 1;
        if (n <= 0) openStreams.delete(user.userId); else openStreams.set(user.userId, n);
      }
      clearInterval(timer);
      clearInterval(ping);
      clearTimeout(stop);
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
  }

  /** Polling fallback with identical payloads (also used when EventSource is unavailable). */
  @Get('stream/poll')
  @RequirePermission('notifications:view')
  async poll(@CurrentUser() user: Principal, @Query(new ZodPipe(streamQuerySchema)) q: z.infer<typeof streamQuerySchema>): Promise<{ cursor: string; events: StreamEvent[] }> {
    return this.stream.collect(user, q.since ?? new Date(Date.now() - 60_000));
  }

  @Get('crm-notifications')
  @RequirePermission('notifications:view')
  list(@CurrentUser() user: Principal) {
    return this.stream.notifications(user);
  }

  @Post('crm-notifications/:id/read')
  @HttpCode(200)
  @RequirePermission('notifications:view')
  read(@CurrentUser() user: Principal, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.stream.markRead(user, id);
  }
}
