import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../authz/decorators';
import { OpsProbeService } from '../observability/ops-probe.service';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly probe: OpsProbeService) {}

  /** Liveness: process is up. No dependencies checked. */
  @Public()
  @Get('health')
  live() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  /**
   * Readiness: DB and Redis reachable. 503 when any dependency is down (the process stays alive and keeps serving /health).
   * The worker heartbeat is reported for operators but does NOT fail readiness: with the worker down the API still serves
   * requests; background work queues up in the outbox (alert on salesos_worker_heartbeat_age_seconds instead).
   */
  @Public()
  /** Also served at GET /ready (alias required by docs/api-catalogue.md). */
  @Get(['health/ready', 'ready'])
  async ready() {
    const [database, redis, worker] = await Promise.all([this.probe.database(), this.probe.redisUp(), this.probe.worker()]);
    const checks: Record<string, 'ok' | 'down'> = { database: database ? 'ok' : 'down', redis: redis ? 'ok' : 'down' };
    const ready = database && redis;
    if (!ready) throw new ServiceUnavailableException({ code: 'NOT_READY', message: 'Dependencies unavailable', details: { ...checks, worker: worker.status } });
    return { status: 'ready', checks, worker };
  }
}
