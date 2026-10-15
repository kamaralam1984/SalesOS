import { Injectable } from '@nestjs/common';
import type { Principal } from '../../../common/authz';
import { AccessService } from '../../../common/authz';
import type { PermissionKey } from '../../../common/authz/permissions.catalogue';
import { AppError, forbidden, notFound } from '../../../common/http/errors';
import { PrismaService } from '../../../common/prisma';
import { MetricsService } from '../../revenue/metrics.service';
import { cacheCap, KpiCache } from './cache';
import { KPI_IMPLS, KPI_MAP, KPI_METAS } from './registry';
import { resolveWindow, ScopeService, type WindowInput } from './scope';
import { DEFAULT_KPI_CONFIG, FILTER_KEYS, type FilterInput, type KpiConfig, type KpiCtx, type KpiImpl, type KpiMeta, type KpiResult, type KpiScope } from './types';

export type KpiQuery = WindowInput & FilterInput;

const BREADTH: Record<KpiScope['level'], number> = { own: 1, team: 2, summary: 3, org: 3 };
const MIN_BREADTH = { own: 1, team: 2, org: 3 } as const;

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** One shared, role-scoped query layer: every dashboard, report and export gets its numbers here. */
@Injectable()
export class KpiService {
  private readonly inflight = new Map<string, Promise<Awaited<ReturnType<KpiImpl['compute']>>>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ScopeService,
    private readonly access: AccessService,
    private readonly metrics: MetricsService,
    private readonly cache: KpiCache,
  ) {}

  definitions(): KpiMeta[] {
    return [...KPI_METAS];
  }

  definition(id: string): KpiMeta {
    const k = KPI_MAP.get(id);
    if (!k) throw notFound('KPI');
    return k.meta;
  }

  /** Organisation-level overrides live in platform_settings key `kpi` (all optional, validated numerically). */
  async config(organizationId: string): Promise<KpiConfig> {
    const base: KpiConfig = { ...DEFAULT_KPI_CONFIG, excludeDemo: process.env.KPI_EXCLUDE_DEMO ? process.env.KPI_EXCLUDE_DEMO === 'true' : process.env.NODE_ENV === 'production' };
    const row = await this.prisma.platformSetting.findUnique({ where: { organizationId_key: { organizationId, key: 'kpi' } } });
    const v = (row?.value ?? {}) as Record<string, unknown>;
    const pick = <K extends keyof KpiConfig>(k: K): KpiConfig[K] => {
      const x = v[k as string];
      return (typeof base[k] === 'number' ? (num(x) ?? base[k]) : typeof base[k] === 'boolean' ? (typeof x === 'boolean' ? x : base[k]) : typeof x === 'string' ? x : base[k]) as KpiConfig[K];
    };
    return Object.fromEntries((Object.keys(base) as Array<keyof KpiConfig>).map((k) => [k, pick(k)])) as unknown as KpiConfig;
  }

  private cleanFilters(q: KpiQuery): FilterInput {
    const out: FilterInput = {};
    for (const k of FILTER_KEYS) if (q[k]) out[k] = q[k];
    return out;
  }

  /** Resolve scope for one KPI: kpi:view AND the KPI's domain permission, each intersected with the filters. */
  async scopeFor(user: Principal, meta: KpiMeta, filters: FilterInput): Promise<{ scope: KpiScope; restricted: boolean } | { blocked: 'FORBIDDEN' }> {
    if (!this.access.has(user, 'kpi:view')) return { blocked: 'FORBIDDEN' };
    if (meta.requires && !this.access.has(user, meta.requires)) return { blocked: 'FORBIDDEN' };
    let scope = await this.scopes.resolve(user, 'kpi:view', filters);
    let breadth = BREADTH[scope.level];
    if (meta.requires) {
      const dom = await this.scopes.resolve(user, meta.requires, filters);
      breadth = Math.min(breadth, BREADTH[dom.level]);
      scope = this.scopes.narrower(scope, dom);
    }
    return { scope, restricted: breadth < MIN_BREADTH[meta.minScope] };
  }

  /**
   * Context for reports / panels: the caller must hold EVERY listed permission; the scope is the narrowest of them, then the
   * filters are intersected with it (they can only narrow).
   */
  async contextFor(user: Principal, permissions: PermissionKey[], q: KpiQuery = {}): Promise<KpiCtx> {
    const filters = this.cleanFilters(q);
    let scope: KpiScope | null = null;
    for (const p of permissions) {
      if (!this.access.has(user, p)) throw forbidden();
      const s = await this.scopes.resolve(user, p, filters);
      scope = scope ? this.scopes.narrower(scope, s) : s;
    }
    if (!scope) throw forbidden();
    return this.context(user, scope, q, filters);
  }

  async context(user: Principal, scope: KpiScope, q: KpiQuery, filters: FilterInput): Promise<KpiCtx> {
    const w = resolveWindow(q);
    return {
      prisma: this.prisma,
      metrics: this.metrics,
      user,
      organizationId: user.organizationId,
      scope,
      window: w.window,
      period: w.period,
      asOf: w.asOf,
      now: new Date(),
      filters,
      config: await this.config(user.organizationId),
    };
  }

  private shell(meta: KpiMeta, ctx: Pick<KpiCtx, 'window' | 'period' | 'asOf'>, filters: FilterInput, scope: KpiScope | null, ignored: string[]) {
    return {
      id: meta.id,
      name: meta.name,
      unit: meta.unit,
      currency: meta.unit === 'CURRENCY' ? 'INR' : null,
      dateRange: { from: ctx.window.startsOn, to: ctx.window.endsOn, timezone: 'Asia/Kolkata' as const, asOf: ctx.asOf },
      period: ctx.period,
      filters: { applied: Object.fromEntries(Object.entries(filters).filter(([k]) => meta.filters.includes(k as never) && Boolean((filters as Record<string, string>)[k]))) as Record<string, string>, ignored, scopeLevel: scope?.level ?? ('own' as const), narrowedByFilter: scope?.narrowed ?? false },
      definition: { id: meta.id, summary: meta.definition, approvalStatus: meta.approvalStatus, formula: meta.formula, zeroDenominator: meta.zeroDenominator },
      isEstimate: Boolean(meta.isEstimate),
    };
  }

  /** Run one KPI for the caller. Throws 403 when the caller may not read it (use `runMany` for tile-style results). */
  async run(user: Principal, id: string, q: KpiQuery = {}, opts: { tile?: boolean } = {}): Promise<KpiResult> {
    const impl = KPI_MAP.get(id);
    if (!impl) throw notFound('KPI');
    return this.runImpl(user, impl, q, opts.tile ?? false);
  }

  async runMany(user: Principal, ids: string[], q: KpiQuery = {}): Promise<KpiResult[]> {
    const impls = ids.map((id) => KPI_MAP.get(id)).filter((x): x is KpiImpl => Boolean(x));
    // sequential per chunk keeps connection-pool pressure predictable on large datasets
    const out: KpiResult[] = [];
    const size = 8;
    for (let i = 0; i < impls.length; i += size) {
      out.push(...(await Promise.all(impls.slice(i, i + size).map((k) => this.runImpl(user, k, q, true)))));
    }
    return out;
  }

  all(): KpiImpl[] {
    return [...KPI_IMPLS];
  }

  private async runImpl(user: Principal, impl: KpiImpl, q: KpiQuery, tile: boolean): Promise<KpiResult> {
    const filters = this.cleanFilters(q);
    const ignored = Object.keys(filters).filter((k) => !impl.meta.filters.includes(k as never));
    const w = resolveWindow(q);
    const empty = (status: KpiResult['status'], note: string): KpiResult => ({
      ...this.shell(impl.meta, { window: w.window, period: w.period, asOf: w.asOf }, filters, null, ignored),
      status,
      value: null,
      numerator: null,
      denominator: null,
      nullReason: null,
      note,
      breakdown: null,
      caution: null,
      dataSource: null,
      computedAt: new Date().toISOString(),
      freshness: { kind: 'LIVE', computedAt: new Date().toISOString(), dataAsOf: new Date().toISOString(), ageSeconds: 0, cadence: impl.meta.refresh },
    });
    const resolved = await this.scopeFor(user, impl.meta, filters);
    if ('blocked' in resolved) {
      if (!tile) throw forbidden();
      return empty('FORBIDDEN', 'You do not have permission to view this KPI');
    }
    if (resolved.restricted) return empty('RESTRICTED', 'This KPI is only available as an organisation-level aggregate');
    const { scope } = resolved;
    const ctx = await this.context(user, scope, q, filters);
    const ttl = Math.min(impl.meta.cacheTtlSeconds ?? 0, cacheCap());
    let computed: Awaited<ReturnType<KpiImpl['compute']>> | null = null;
    let computedAt = new Date();
    let cached = false;
    let cacheKey: string | null = null;
    if (ttl > 0) {
      cacheKey = await this.cache.key(user.organizationId, impl.meta.id, this.cache.scopeFingerprint(scope), { w: ctx.window.startsOn + ctx.window.endsOn, p: ctx.period, a: ctx.asOf, f: { programId: filters.programId, sourceId: filters.sourceId }, cfg: ctx.config });
      const hit = cacheKey ? await this.cache.get(cacheKey) : null;
      if (hit) {
        computed = hit.computed;
        computedAt = new Date(hit.computedAt);
        cached = true;
      }
    }
    if (!computed) {
      try {
        // Single-flight: concurrent identical requests (same org, KPI, resolved-scope fingerprint and params) share one computation
        // instead of stampeding the database when the cache is cold or expired (perf evidence: docs/performance-evidence-l3.md).
        if (cacheKey && ttl > 0) {
          let flight = this.inflight.get(cacheKey);
          if (!flight) {
            const k = cacheKey;
            flight = impl.compute(ctx).finally(() => this.inflight.delete(k));
            this.inflight.set(cacheKey, flight);
          }
          computed = await flight;
        } else {
          computed = await impl.compute(ctx);
        }
      } catch (e) {
        if (e instanceof AppError) throw e;
        const msg = e instanceof Error ? e.message : String(e);
        return { ...empty('ERROR', 'This KPI could not be computed right now'), caution: process.env.NODE_ENV === 'production' ? null : msg.slice(0, 300) };
      }
      computedAt = new Date();
      if (cacheKey && ttl > 0) await this.cache.set(cacheKey, { computed, computedAt: computedAt.toISOString() }, ttl);
    }
    const range = computed.effectiveRange ?? { from: ctx.window.startsOn, to: ctx.window.endsOn };
    const shell = this.shell(impl.meta, ctx, filters, scope, ignored);
    const dataAsOf = computed.dataAsOf ?? computedAt;
    return {
      ...shell,
      currency: computed.currency === undefined ? shell.currency : computed.currency,
      dateRange: { ...shell.dateRange, from: range.from, to: range.to },
      status: computed.value === null && computed.nullReason ? 'NO_DATA' : 'OK',
      value: computed.value,
      numerator: computed.numerator ?? null,
      denominator: computed.denominator ?? null,
      nullReason: computed.value === null ? (computed.nullReason ?? 'NOT_COMPUTABLE') : null,
      note: computed.note ?? null,
      breakdown: computed.breakdown ?? null,
      caution: computed.caution ?? null,
      dataSource: computed.dataSource ?? null,
      computedAt: computedAt.toISOString(),
      freshness: { kind: cached ? 'CACHED' : 'LIVE', computedAt: computedAt.toISOString(), dataAsOf: dataAsOf.toISOString(), ageSeconds: Math.max(0, Math.round((Date.now() - computedAt.getTime()) / 1000)), cadence: impl.meta.refresh },
    };
  }
}
