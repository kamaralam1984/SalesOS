import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { RoleKey } from '@salesos/shared-types';
import { PermissionResolver } from '../../../common/authz/principal.loader';
import type { Principal } from '../../../common/authz';
import { PrismaService } from '../../../common/prisma';
import { istDate } from '../../revenue/calc';
import { ExportsService } from '../exports/exports.service';
import { KpiService } from '../kpi/kpi.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { KPI_IDS } from '../kpi/registry';

const DATE = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** KPIs worth keeping a daily organisation-level history for (trends, "timeliness" evidence). Point-in-time ones are snapshotted as of the day. */
@Injectable()
export class SnapshotService {
  constructor(private readonly prisma: PrismaService, private readonly kpis: KpiService, private readonly resolver: PermissionResolver) {}

  /** A system principal for scheduled work: an active Founder of the organisation (scheduled runs are audited with actor = null). */
  async systemPrincipal(organizationId: string): Promise<Principal | null> {
    const u = await this.prisma.user.findFirst({ where: { organizationId, isActive: true, roleAssignments: { some: { role: { key: 'FOUNDER_CEO' } } } }, include: { roleAssignments: { include: { role: true } } }, orderBy: { createdAt: 'asc' } });
    if (!u) return null;
    const roles = u.roleAssignments.map((a) => a.role.key as RoleKey);
    return { userId: u.id, organizationId, email: u.email, name: u.name, managerId: u.managerId, roles, permissions: this.resolver.effective(roles), sessionId: 'scheduler', sessionFamilyId: 'scheduler' };
  }

  /** Org-wide KPI values for the period containing `asOf` (month-to-date). Idempotent per (kpi, period, asOf). */
  async take(organizationId: string, asOf = istDate(new Date())): Promise<{ stored: number; skipped: number }> {
    const p = await this.systemPrincipal(organizationId);
    if (!p) return { stored: 0, skipped: KPI_IDS.length };
    const results = await this.kpis.runMany(p, [...KPI_IDS], { asOf, to: asOf, period: 'MONTH' });
    let stored = 0;
    let skipped = 0;
    for (const r of results) {
      if (r.status !== 'OK' && r.status !== 'NO_DATA') {
        skipped += 1;
        continue;
      }
      const data = {
        organizationId,
        kpiId: r.id,
        scopeKey: 'ORG',
        periodStart: DATE(r.dateRange.from),
        periodEnd: DATE(r.dateRange.to),
        value: r.value,
        numerator: r.numerator,
        denominator: r.denominator,
        unit: r.unit,
        payload: { status: r.status, nullReason: r.nullReason, asOf } as Prisma.InputJsonValue,
        computedAt: new Date(),
      };
      await this.prisma.kpiSnapshot.upsert({ where: { organizationId_kpiId_scopeKey_periodStart_periodEnd: { organizationId, kpiId: r.id, scopeKey: 'ORG', periodStart: data.periodStart, periodEnd: data.periodEnd } }, create: data, update: { value: data.value, numerator: data.numerator, denominator: data.denominator, payload: data.payload, computedAt: data.computedAt } });
      stored += 1;
    }
    return { stored, skipped };
  }

  async history(organizationId: string, kpiId: string, limit = 60) {
    const rows = await this.prisma.kpiSnapshot.findMany({ where: { organizationId, kpiId, scopeKey: 'ORG' }, orderBy: { periodEnd: 'desc' }, take: limit });
    return rows.reverse().map((r) => ({ periodStart: r.periodStart.toISOString().slice(0, 10), periodEnd: r.periodEnd.toISOString().slice(0, 10), value: r.value?.toString() ?? null, numerator: r.numerator?.toString() ?? null, denominator: r.denominator?.toString() ?? null, unit: r.unit, computedAt: r.computedAt.toISOString() }));
  }
}

/** Scheduled maintenance inside the API process (the KPI engine lives here): nightly reconciliation, daily snapshots, export expiry. */
@Injectable()
export class ReportingScheduler implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly log = new Logger('ReportingScheduler');
  constructor(private readonly prisma: PrismaService, private readonly snapshots: SnapshotService, private readonly recon: ReconciliationService, private readonly exports: ExportsService) {}

  onModuleInit() {
    const enabled = process.env.ANALYTICS_SCHEDULER ? process.env.ANALYTICS_SCHEDULER === 'on' : process.env.NODE_ENV !== 'test';
    if (!enabled) return;
    this.timer = setInterval(() => void this.tick(), Number(process.env.ANALYTICS_SCHEDULER_INTERVAL_MS ?? 300_000));
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass (also called by tests). Cheap when nothing is due. */
  async tick(now = new Date(), onlyOrgs?: string[]): Promise<{ reconciled: number; snapshotted: number; expired: number }> {
    const out = { reconciled: 0, snapshotted: 0, expired: 0 };
    try {
      out.expired = await this.exports.expire();
      const istHour = new Date(now.getTime() + 5.5 * 3_600_000).getUTCHours();
      const today = istDate(now);
      const orgs = await this.prisma.organization.findMany({ where: onlyOrgs ? { id: { in: onlyOrgs } } : {}, select: { id: true } });
      for (const o of orgs) {
        const p = await this.snapshots.systemPrincipal(o.id);
        if (!p) continue;
        if (istHour >= 3) {
          const last = await this.prisma.kpiReconciliationRun.findFirst({ where: { organizationId: o.id, trigger: 'SCHEDULED' }, orderBy: { ranAt: 'desc' } });
          if (!last || istDate(last.ranAt) < today) {
            await this.recon.run(p, { asOf: today, to: today, period: 'MONTH' }, 'SCHEDULED');
            out.reconciled += 1;
          }
          const have = await this.prisma.kpiSnapshot.count({ where: { organizationId: o.id, computedAt: { gte: new Date(`${today}T00:00:00+05:30`) } } });
          if (have === 0) {
            await this.snapshots.take(o.id, today);
            out.snapshotted += 1;
          }
        }
      }
    } catch (e) {
      this.log.warn(`scheduler pass failed: ${(e as Error).message}`);
    }
    return out;
  }
}
