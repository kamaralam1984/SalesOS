import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_ENV } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import { AuditService } from '../../../common/audit/audit.service';
import type { Principal } from '../../../common/authz';
import { PrismaService } from '../../../common/prisma';
import { RedisService } from '../../../common/security/redis.module';
import { AppError } from '../../../common/http/errors';

export interface MaintenanceState {
  enabled: boolean;
  message: string | null;
  eta: string | null;
  enabledById: string | null;
  enabledAt: string | null;
}
export const MAINTENANCE_OFF: MaintenanceState = { enabled: false, message: null, eta: null, enabledById: null, enabledAt: null };
export const MAINTENANCE_ACTIONS = { ENABLED: 'devpanel.maintenance_enabled', DISABLED: 'devpanel.maintenance_disabled' } as const;

const CACHE_MS = 2000;
const REDIS_TIMEOUT_MS = 1000;

/** Parses the stored value; anything malformed is treated as OFF (fail open). */
export function parseMaintenance(raw: string | null): MaintenanceState | null {
  if (!raw) return MAINTENANCE_OFF;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== 'object' || typeof v.enabled !== 'boolean') return null;
    if (!v.enabled) return MAINTENANCE_OFF;
    if (typeof v.message !== 'string' || v.message.length < 1 || v.message.length > 300) return null;
    const eta = typeof v.eta === 'string' && !Number.isNaN(Date.parse(v.eta)) ? v.eta : null;
    return {
      enabled: true,
      message: v.message,
      eta,
      enabledById: typeof v.enabledById === 'string' ? v.enabledById : null,
      enabledAt: typeof v.enabledAt === 'string' ? v.enabledAt : null,
    };
  } catch {
    return null;
  }
}

/** Maintenance flag kept in Redis (no DB migration). Reads fail OPEN: a cache fault never locks the company out. */
@Injectable()
export class MaintenanceService {
  private readonly log = new Logger('Maintenance');
  private cache: { at: number; state: MaintenanceState } | null = null;
  private readonly key: string;

  constructor(private readonly redis: RedisService, private readonly audit: AuditService, private readonly prisma: PrismaService, @Inject(APP_ENV) env: Env) {
    this.key = `${env.BULLMQ_PREFIX}:devpanel:maintenance`;
  }

  /** For tests/ops: forget the in-memory copy. */
  resetCache() { this.cache = null; }
  get redisKey() { return this.key; }

  async current(): Promise<MaintenanceState> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < CACHE_MS) return this.cache.state;
    let state = MAINTENANCE_OFF;
    try {
      await this.redis.ensureConnected();
      const raw = await Promise.race([
        this.redis.get(this.key),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('redis timeout')), REDIS_TIMEOUT_MS).unref()),
      ]);
      const parsed = parseMaintenance(raw);
      if (parsed === null) this.log.warn('Maintenance state is malformed; treating maintenance as OFF');
      else state = parsed;
    } catch (e) {
      this.log.warn(`Maintenance state unavailable (${(e as Error).message}); treating maintenance as OFF`);
    }
    this.cache = { at: now, state };
    return state;
  }

  async publicStatus() {
    const s = await this.current();
    return s.enabled ? { enabled: true, message: s.message, eta: s.eta } : { enabled: false, message: null, eta: null };
  }

  async enable(actor: Principal, message: string, eta?: string) {
    if (eta && !(Date.parse(eta) > Date.now())) throw new AppError('VALIDATION_FAILED', 'ETA must be in the future', 422);
    const state: MaintenanceState = { enabled: true, message, eta: eta ? new Date(eta).toISOString() : null, enabledById: actor.userId, enabledAt: new Date().toISOString() };
    await this.write(JSON.stringify(state));
    this.cache = { at: Date.now(), state };
    await this.audit.record({ organizationId: actor.organizationId, actorId: actor.userId, action: MAINTENANCE_ACTIONS.ENABLED, entityType: 'maintenance', metadata: { message, eta: state.eta } });
    return this.detail(actor.organizationId, state);
  }

  async disable(actor: Principal) {
    try {
      await this.redis.ensureConnected();
      await this.redis.del(this.key);
    } catch {
      throw new AppError('SERVICE_UNAVAILABLE', 'Could not reach the state store; maintenance state unchanged', 503);
    }
    this.cache = { at: Date.now(), state: MAINTENANCE_OFF };
    await this.audit.record({ organizationId: actor.organizationId, actorId: actor.userId, action: MAINTENANCE_ACTIONS.DISABLED, entityType: 'maintenance', metadata: {} });
    return this.detail(actor.organizationId, MAINTENANCE_OFF);
  }

  async detail(organizationId: string, state?: MaintenanceState) {
    const s = state ?? (await this.current());
    let enabledBy: { id: string; name: string } | null = null;
    if (s.enabled && s.enabledById) {
      const u = await this.prisma.user.findFirst({ where: { id: s.enabledById, organizationId }, select: { id: true, name: true } }).catch(() => null);
      enabledBy = u;
    }
    return { enabled: s.enabled, message: s.message, eta: s.eta, enabledAt: s.enabledAt, enabledBy };
  }

  private async write(value: string) {
    try {
      await this.redis.ensureConnected();
      await this.redis.set(this.key, value);
    } catch {
      throw new AppError('SERVICE_UNAVAILABLE', 'Could not reach the state store; maintenance was NOT enabled', 503);
    }
  }
}
