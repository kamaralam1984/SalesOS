import { Controller, Get, Inject, NotFoundException, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { APP_ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { Public } from '../authz/decorators';
import { MetricsService } from './metrics.service';
import { OpsProbeService } from './ops-probe.service';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * GET /metrics (root, NOT under /api/v1) - Prometheus text format.
 *  - METRICS_TOKEN set: requires `Authorization: Bearer <token>` (any environment).
 *  - no token + production: 404 (deny by default; never expose by accident).
 *  - no token + non-production: loopback clients only.
 * The reverse proxy must additionally NOT route /metrics publicly (infra/nginx example does `deny all`).
 */
@ApiExcludeController()
@Controller()
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly probe: OpsProbeService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  @Public()
  @Get('metrics')
  async scrape(@Req() req: Request, @Res() res: Response) {
    const token = this.env.METRICS_TOKEN;
    if (token) {
      const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
      if (!m || !safeEqual(m[1]!, token)) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Metrics token required' });
    } else if (this.env.isProd || !LOOPBACK.has(req.socket.remoteAddress ?? '')) {
      throw new NotFoundException();
    }
    const [db, redis, worker, outbox] = await Promise.all([this.probe.database(), this.probe.redisUp(), this.probe.worker(), this.probe.outbox()]);
    const extra = [
      { name: 'salesos_dependency_up', help: '1 when the dependency answers.', value: db ? 1 : 0, labels: { dependency: 'database' } },
      { name: 'salesos_dependency_up', help: '1 when the dependency answers.', value: redis ? 1 : 0, labels: { dependency: 'redis' } },
      { name: 'salesos_worker_heartbeat_age_seconds', help: 'Age of the newest worker heartbeat (-1 = none seen).', value: worker.lastHeartbeatAgeSeconds ?? -1 },
      { name: 'salesos_worker_instances', help: 'Workers with a live heartbeat key.', value: worker.instances },
      ...(outbox
        ? [
            { name: 'salesos_outbox_pending', help: 'PENDING outbox events.', value: outbox.pending },
            { name: 'salesos_outbox_dead', help: 'DEAD outbox events (need replay).', value: outbox.dead },
            { name: 'salesos_outbox_oldest_pending_seconds', help: 'Age of the oldest due PENDING event.', value: outbox.oldestPendingSeconds },
          ]
        : []),
    ];
    res.status(200).type('text/plain; version=0.0.4; charset=utf-8').send(this.metrics.render(extra));
  }
}
