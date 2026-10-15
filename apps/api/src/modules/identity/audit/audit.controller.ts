import { Limited } from '../../../common/security/rate-limits';
import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { auditQuerySchema } from '@salesos/validation';
import type { Response } from 'express';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { redactAuditRow } from '../../../common/audit/audit-redaction';
import { AccessService, CurrentUser, RequirePermission, type PermissionKey, type Principal } from '../../../common/authz';
import { ApiResult } from '../../../common/http/api-result';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService } from '../../../common/prisma';

type Query_ = z.infer<typeof auditQuerySchema>;

/** Hard cap on one export (rows). Larger needs a narrower period/filter; the response says when it was truncated. */
export const AUDIT_EXPORT_MAX_ROWS = 10_000;
const exportCap = () => Math.min(AUDIT_EXPORT_MAX_ROWS, Number(process.env.AUDIT_EXPORT_MAX_ROWS) || AUDIT_EXPORT_MAX_ROWS);

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  // CSV/formula injection: a cell starting with = + - @ or tab/CR is neutralised
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

@ApiTags('audit')
@Controller('audit-logs')
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  private async where(user: Principal, permission: PermissionKey, q: Query_) {
    const scope = await this.access.scopedWhere(user, { permission, ownerField: 'actorId' });
    const where = {
      ...scope,
      ...(q.action ? { action: q.action } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    } as Record<string, unknown>;
    if (q.actorId) {
      // an extra actor filter can only narrow the scoped set
      where.AND = [...((where.AND as unknown[]) ?? []), { actorId: q.actorId }];
    }
    return where;
  }

  /** org scope: all logs; team scope: logs by actors in the caller's team; own: the caller's own actions. Money/HR metadata is redacted for callers without that domain's permission. */
  @Get()
  @RequirePermission('audit:view')
  async list(@CurrentUser() user: Principal, @Query(new ZodPipe(auditQuerySchema)) q: Query_) {
    const where = await this.where(user, 'audit:view', q);
    const rows = await this.prisma.auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const total = q.page ? await this.prisma.auditLog.count({ where }) : undefined;
    const res = pageResult(rows, q, total);
    return new ApiResult(res.data.map((r) => redactAuditRow(this.access, user, r)), res.meta);
  }

  /**
   * CSV export (audit:export: Founder, Admin). Same scope and redaction as the list, capped at AUDIT_EXPORT_MAX_ROWS,
   * and the export itself is audited (who, filters, row count, truncated).
   */
  @Limited('EXPORT')
  @Get('export')
  @RequirePermission('audit:export')
  async export(@CurrentUser() user: Principal, @Query(new ZodPipe(auditQuerySchema)) q: Query_, @Res() res: Response) {
    const where = await this.where(user, 'audit:export', q);
    const cap = exportCap();
    const rows = await this.prisma.auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: cap + 1 });
    const truncated = rows.length > cap;
    const page = (truncated ? rows.slice(0, cap) : rows).map((r) => redactAuditRow(this.access, user, r));
    const header = ['time_utc', 'actor_id', 'action', 'entity_type', 'entity_id', 'metadata', 'request_id'];
    const csv = [header.join(','), ...page.map((r) => [r.createdAt.toISOString(), r.actorId, r.action, r.entityType, r.entityId, r.metadata, r.requestId].map(csvCell).join(','))].join('\n') + '\n';
    await this.audit.record({
      organizationId: user.organizationId, actorId: user.userId, action: 'audit.exported', entityType: 'audit_log',
      metadata: { rows: page.length, truncated, filters: { action: q.action ?? null, entityType: q.entityType ?? null, actorId: q.actorId ?? null, from: q.from?.toISOString() ?? null, to: q.to?.toISOString() ?? null } },
    });
    res.status(200).type('text/csv').setHeader('content-disposition', 'attachment; filename="audit-log.csv"');
    res.setHeader('x-export-rows', String(page.length));
    res.setHeader('x-export-truncated', String(truncated));
    res.setHeader('cache-control', 'no-store');
    res.send(csv);
  }
}
