import { createHash } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CreateExportDto } from '@salesos/validation';
import { AuditService, AUDIT_ACTIONS } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { PermissionResolver } from '../../../common/authz/principal.loader';
import { AppError, forbidden, notFound } from '../../../common/http/errors';
import { PrismaService } from '../../../common/prisma';
import type { RoleKey } from '@salesos/shared-types';
import { KpiService } from '../kpi/kpi.service';
import { ReportsService } from '../reports/reports.service';
import { CONTENT_TYPES, toCsv, toXlsx } from './writers';

/** Row caps (documented in docs/analytics-report.md). Overridable by env for tests and deployments. */
export const exportLimits = () => ({
  syncRows: Number(process.env.EXPORT_SYNC_ROWS ?? 1000),
  csvMax: Number(process.env.EXPORT_MAX_ROWS_CSV ?? 100_000),
  xlsxMax: Number(process.env.EXPORT_MAX_ROWS_XLSX ?? 50_000),
  retentionHours: Number(process.env.EXPORT_RETENTION_HOURS ?? 72),
  maxAttempts: 3,
});

const safeName = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 80);

type ExportRow = Awaited<ReturnType<PrismaService['reportExport']['findFirstOrThrow']>>;

export function exportDto(e: Omit<ExportRow, 'content'>) {
  return {
    id: e.id,
    report: e.report,
    format: e.format,
    status: e.status,
    params: e.params,
    appliedFilters: e.appliedFilters,
    scopeLevel: e.scopeLevel,
    rowCap: e.rowCap,
    rowCount: e.rowCount,
    truncated: e.truncated,
    fileName: e.fileName,
    sizeBytes: e.sizeBytes,
    sha256: e.contentSha256,
    error: e.error,
    requestedAt: e.requestedAt,
    completedAt: e.completedAt,
    expiresAt: e.expiresAt,
    downloadCount: e.downloadCount,
    downloadable: e.status === 'READY' && e.expiresAt > new Date(),
  };
}

@Injectable()
export class ExportsService {
  private readonly log = new Logger('Exports');
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly kpis: KpiService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly resolver: PermissionResolver,
  ) {}

  /**
   * Create an export. Permission and scope are checked NOW (403 before anything is queued) and again when the file is generated,
   * so a revoked permission or deactivated user cannot get a file out of the queue. Small exports are generated inline.
   */
  async create(user: Principal, dto: CreateExportDto) {
    const def = this.reports.def(dto.report);
    const lim = exportLimits();
    // server-side permission + scope check; also yields the filters that will really be applied
    const ctx = await this.kpis.contextFor(user, [...def.requires, 'reports:export'], { ...dto.params });
    const formatMax = dto.format === 'CSV' ? lim.csvMax : lim.xlsxMax;
    const rowCap = Math.min(dto.maxRows ?? formatMax, formatMax);
    const applied = { ...Object.fromEntries(Object.entries(ctx.filters).filter(([, v]) => Boolean(v))), window: { from: ctx.window.startsOn, to: ctx.window.endsOn }, period: ctx.period.type, by: dto.params.by ?? null };
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.reportExport.create({
        data: {
          organizationId: user.organizationId,
          requestedById: user.userId,
          report: dto.report,
          format: dto.format,
          params: dto.params as Prisma.InputJsonValue,
          appliedFilters: applied as Prisma.InputJsonValue,
          scopeLevel: ctx.scope.level,
          rowCap,
          expiresAt: new Date(Date.now() + lim.retentionHours * 3_600_000),
        },
        select: { id: true },
      });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: AUDIT_ACTIONS.EXPORT_CREATED, entityType: 'report_export', entityId: created.id, metadata: { report: dto.report, format: dto.format, filters: applied, scopeLevel: ctx.scope.level, rowCap } });
      return created;
    });
    // small export: do it now. Large export: stays QUEUED for the background runner.
    const probe = await this.generate(row.id, lim.syncRows, true);
    return this.get(user, row.id, probe);
  }

  /** Atomic claim of queued exports (and RUNNING ones whose lease expired) for the background runner. */
  async claim(limit = 2): Promise<string[]> {
    const { maxAttempts } = exportLimits();
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE report_exports SET status = 'RUNNING', attempts = attempts + 1, locked_until = now() + interval '5 minutes', started_at = coalesce(started_at, now())
      WHERE id IN (SELECT id FROM report_exports WHERE (status = 'QUEUED' OR (status = 'RUNNING' AND locked_until < now())) AND attempts < ${maxAttempts}::int ORDER BY requested_at LIMIT ${limit}::int FOR UPDATE SKIP LOCKED)
      RETURNING id::text AS id`);
    // exhausted retries -> FAILED
    await this.prisma.reportExport.updateMany({ where: { status: { in: ['QUEUED', 'RUNNING'] }, attempts: { gte: maxAttempts }, OR: [{ status: 'QUEUED' }, { lockedUntil: { lt: new Date() } }] }, data: { status: 'FAILED', error: 'Gave up after repeated failures', completedAt: new Date() } });
    return rows.map((r) => r.id);
  }

  private async principalFor(userId: string, organizationId: string): Promise<Principal | null> {
    const u = await this.prisma.user.findFirst({ where: { id: userId, organizationId, isActive: true }, include: { roleAssignments: { include: { role: true } } } });
    if (!u) return null;
    const roles = u.roleAssignments.map((a) => a.role.key as RoleKey);
    return { userId: u.id, organizationId: u.organizationId, email: u.email, name: u.name, managerId: u.managerId, roles, permissions: this.resolver.effective(roles), sessionId: 'export-runner', sessionFamilyId: 'export-runner' };
  }

  /**
   * Generate the file. `probeLimit` (inline mode): if the report has more rows than the limit the export is left QUEUED for the runner.
   * Returns true when the file was produced.
   */
  async generate(id: string, probeLimit?: number, inline = false): Promise<boolean> {
    const row = await this.prisma.reportExport.findUnique({ where: { id } });
    if (!row) return false;
    if (!inline && row.status !== 'RUNNING') return false;
    const fail = async (message: string) => {
      await this.prisma.reportExport.update({ where: { id }, data: { status: 'FAILED', error: message.slice(0, 300), completedAt: new Date(), lockedUntil: null } });
      await this.audit.record({ organizationId: row.organizationId, actorId: row.requestedById, action: 'export.failed', entityType: 'report_export', entityId: id, metadata: { report: row.report, reason: message.slice(0, 200) } });
      return false;
    };
    const principal = await this.principalFor(row.requestedById, row.organizationId);
    if (!principal) return fail('The requesting user is no longer active');
    if (!this.access.has(principal, 'reports:export')) return fail('The requesting user no longer holds the export permission');
    const limit = probeLimit !== undefined ? Math.min(probeLimit, row.rowCap) : row.rowCap;
    let result;
    try {
      result = await this.reports.run(principal, row.report, { ...(row.params as Record<string, string>), limit }, { extraPermissions: ['reports:export'], maxLimit: Math.max(limit, 1) });
    } catch (e) {
      if (e instanceof AppError && (e.getStatus() === 403 || e.getStatus() === 404)) return fail('Permission denied when generating the export');
      if (inline) {
        this.log.warn(`inline export ${id} failed, leaving it for the runner: ${(e as Error).message}`);
        return false;
      }
      return fail(e instanceof Error ? e.message : 'Export failed');
    }
    if (probeLimit !== undefined && result.truncated && probeLimit < row.rowCap) return false; // too big for inline but within the cap: the runner does it
    const buf = row.format === 'CSV' ? toCsv(result) : await toXlsx(result, { generatedFor: principal.name });
    const fileName = `${safeName(row.report)}_${result.meta.dateRange.from}_${result.meta.dateRange.to}.${row.format === 'CSV' ? 'csv' : 'xlsx'}`;
    await this.prisma.reportExport.update({
      where: { id },
      data: { status: 'READY', rowCount: result.rowCount, truncated: result.truncated, fileName, contentType: CONTENT_TYPES[row.format], sizeBytes: buf.length, contentSha256: createHash('sha256').update(buf).digest('hex'), content: new Uint8Array(buf), completedAt: new Date(), lockedUntil: null, error: null },
    });
    await this.audit.record({ organizationId: row.organizationId, actorId: row.requestedById, action: 'export.completed', entityType: 'report_export', entityId: id, metadata: { report: row.report, format: row.format, rowCount: result.rowCount, truncated: result.truncated, sizeBytes: buf.length, filters: row.appliedFilters, scopeLevel: row.scopeLevel } });
    return true;
  }

  async get(user: Principal, id: string, _produced?: boolean) {
    const { content: _c, ...row } = (await this.prisma.reportExport.findFirst({ where: { id, organizationId: user.organizationId, requestedById: user.userId } })) ?? ({} as never);
    if (!(row as { id?: string }).id) throw notFound('Export');
    return exportDto(row as never);
  }

  async list(user: Principal, limit: number) {
    const rows = await this.prisma.reportExport.findMany({ where: { organizationId: user.organizationId, requestedById: user.userId }, orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }], take: limit, select: { id: true, organizationId: true, requestedById: true, report: true, format: true, status: true, params: true, appliedFilters: true, scopeLevel: true, rowCap: true, rowCount: true, truncated: true, fileName: true, contentType: true, sizeBytes: true, contentSha256: true, error: true, attempts: true, lockedUntil: true, requestedAt: true, startedAt: true, completedAt: true, expiresAt: true, downloadCount: true, lastDownloadedAt: true } });
    return rows.map((r) => exportDto(r));
  }

  /** Authorised download: requester only, still holding the export permission, file READY and not expired. Audited. */
  async download(user: Principal, id: string) {
    if (!this.access.has(user, 'reports:export')) throw forbidden();
    const row = await this.prisma.reportExport.findFirst({ where: { id, organizationId: user.organizationId, requestedById: user.userId } });
    if (!row) throw notFound('Export');
    if (row.status === 'EXPIRED' || (row.status === 'READY' && row.expiresAt <= new Date())) throw new AppError('EXPORT_EXPIRED', 'This export has expired; create a new one', 410);
    if (row.status !== 'READY' || !row.content) throw new AppError('EXPORT_NOT_READY', `Export is ${row.status.toLowerCase()}`, 409);
    await this.prisma.reportExport.update({ where: { id }, data: { downloadCount: { increment: 1 }, lastDownloadedAt: new Date() } });
    await this.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'export.downloaded', entityType: 'report_export', entityId: id, metadata: { report: row.report, format: row.format, rowCount: row.rowCount } });
    return { data: Buffer.from(row.content), contentType: row.contentType ?? 'application/octet-stream', fileName: row.fileName ?? `export.${row.format.toLowerCase()}` };
  }

  /** Purge: drop file bytes of expired exports (the row and its audit trail stay). */
  async expire(): Promise<number> {
    const r = await this.prisma.reportExport.updateMany({ where: { expiresAt: { lt: new Date() }, status: { in: ['READY', 'QUEUED', 'FAILED'] } }, data: { status: 'EXPIRED', content: null } });
    return r.count;
  }
}

/** Background execution of queued (large) exports. DB-claimed with a lease: crash-safe, multi-instance-safe, idempotent. */
@Injectable()
export class ExportRunner implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly log = new Logger('ExportRunner');
  constructor(private readonly exports: ExportsService) {}

  onModuleInit() {
    const enabled = process.env.EXPORT_RUNNER ? process.env.EXPORT_RUNNER === 'on' : process.env.NODE_ENV !== 'test';
    if (!enabled) return;
    const every = Number(process.env.EXPORT_RUNNER_INTERVAL_MS ?? 5000);
    this.timer = setInterval(() => void this.tick(), every);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<number> {
    let done = 0;
    try {
      for (const id of await this.exports.claim(2)) {
        try {
          if (await this.exports.generate(id)) done += 1;
        } catch (e) {
          this.log.warn(`export ${id} failed: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      this.log.warn(`export tick failed: ${(e as Error).message}`);
    }
    return done;
  }
}
