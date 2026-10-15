import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Principal } from '../../common/authz';
import { AppError } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma';
import { SessionService } from '../../common/authz/session.service';
import { toNotificationDto } from './notifications.service';

const POLL_MS = Number(process.env.NOTIFICATION_STREAM_POLL_MS ?? 2000);
const HEARTBEAT_MS = 15_000;
const MAX_AGE_MS = 5 * 60_000;
const MAX_PER_USER = 5;

/**
 * SSE stream scoped to the authenticated user: the server re-queries only THAT user's rows
 * (organization + user filter) on a short interval, so notifications created by the API, the worker or any other
 * process arrive without cross-process pub/sub. Clients fall back to GET /notifications?since= when SSE is unavailable.
 * Connections are capped per user and recycled every few minutes (EventSource reconnects automatically).
 */
@Injectable()
export class NotificationStreamService implements OnModuleDestroy {
  private readonly open_ = new Map<string, Set<Response>>();
  constructor(private readonly prisma: PrismaService, private readonly sessions: SessionService) {}

  async open(user: Principal, req: Request, res: Response): Promise<void> {
    const set = this.open_.get(user.userId) ?? new Set<Response>();
    if (set.size >= MAX_PER_USER) throw new AppError('TOO_MANY_STREAMS', 'Too many open notification streams', 429);
    set.add(res);
    this.open_.set(user.userId, set);

    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const since = req.query.since ? new Date(String(req.query.since)) : new Date();
    let cursor = Number.isNaN(since.getTime()) ? new Date() : since;
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const unread = async () => this.prisma.notification.count({ where: { organizationId: user.organizationId, userId: user.userId, status: 'UNREAD' } });
    res.write('retry: 5000\n\n');
    send('ready', { unreadCount: await unread(), at: new Date().toISOString() });

    let busy = false;
    const tick = async () => {
      if (busy || res.writableEnded) return;
      busy = true;
      try {
        if (!(await this.sessions.stillValid(user))) { res.end(); return; }
        const rows = await this.prisma.notification.findMany({
          where: { organizationId: user.organizationId, userId: user.userId, lastRaisedAt: { gt: cursor } },
          orderBy: { lastRaisedAt: 'asc' }, take: 50,
        });
        if (rows.length) {
          cursor = rows[rows.length - 1]!.lastRaisedAt;
          for (const r of rows) send('notification', toNotificationDto(r));
          send('unread', { unreadCount: await unread() });
        }
      } catch {
        /* transient DB error: next tick retries */
      } finally {
        busy = false;
      }
    };
    const poll = setInterval(() => void tick(), POLL_MS);
    const beat = setInterval(() => res.write(': keep-alive\n\n'), HEARTBEAT_MS);
    const stop = setTimeout(() => res.end(), MAX_AGE_MS);
    const cleanup = () => {
      clearInterval(poll); clearInterval(beat); clearTimeout(stop);
      set.delete(res);
      if (set.size === 0) this.open_.delete(user.userId);
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
  }

  onModuleDestroy() {
    for (const set of this.open_.values()) for (const res of set) res.end();
    this.open_.clear();
  }
}
