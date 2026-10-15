import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createSalaryStructureSchema, listStructuresQuerySchema } from '@salesos/validation';
import { localDay, monthEnd } from '@salesos/workforce-core';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import type { Principal } from '../../../common/authz';
import { ok } from '../../../common/http/api-result';
import { AppError, notFound } from '../../../common/http/errors';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService } from '../../../common/prisma';
import { WorkforceConfigService } from '../common/workforce-config.service';
import { asComponents, dateOnly, dayOf, isUniqueViolation, monthlyDeductions, monthlyEarnings } from './payroll.support';

type Row = Prisma.SalaryStructureGetPayload<object>;

/** Salary structures: append-only versions per employee (a DB trigger blocks UPDATE/DELETE). Statutory items are NOT computed. */
@Injectable()
export class PayrollStructuresService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly cfg: WorkforceConfigService) {}

  private dto(r: Row, names: Map<string, string>) {
    const components = asComponents(r.components);
    return {
      id: r.id,
      userId: r.userId,
      effectiveFrom: dayOf(r.effectiveFrom),
      currency: r.currency,
      components,
      monthlyEarnings: monthlyEarnings(components),
      monthlyDeductions: monthlyDeductions(components),
      note: r.note,
      createdById: r.createdById,
      createdByName: names.get(r.createdById) ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private async names(ids: string[]) {
    const rows = await this.prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
    return new Map(rows.map((u) => [u.id, u.name]));
  }

  /** Active employees with their CURRENT structure (newest version effective today or earlier) or null. */
  async listCurrent(user: Principal, q: z.infer<typeof listStructuresQuerySchema>) {
    const { config } = await this.cfg.getConfig(user.organizationId);
    const today = localDay(new Date(), config.timezone);
    const where: Prisma.UserWhereInput = { organizationId: user.organizationId, isActive: true, ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}) };
    const rows = await this.prisma.user.findMany({
      where,
      select: { id: true, name: true, department: true, employeeProfileUser: { select: { employeeCode: true, positionTitle: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      ...pageArgs(q),
    });
    const res = pageResult(rows, q);
    const page = res.data as typeof rows;
    const ids = page.map((u) => u.id);
    const [current, upcoming] = await Promise.all([
      this.prisma.salaryStructure.findMany({ where: { organizationId: user.organizationId, userId: { in: ids }, effectiveFrom: { lte: dateOnly(today) } }, orderBy: [{ userId: 'asc' }, { effectiveFrom: 'desc' }], distinct: ['userId'] }),
      this.prisma.salaryStructure.groupBy({ by: ['userId'], where: { organizationId: user.organizationId, userId: { in: ids }, effectiveFrom: { gt: dateOnly(today) } }, _count: { _all: true } }),
    ]);
    const cur = new Map(current.map((c) => [c.userId, c]));
    const up = new Map(upcoming.map((u) => [u.userId, u._count._all]));
    const names = await this.names(current.map((c) => c.createdById));
    return ok(
      page.map((u) => ({
        userId: u.id,
        name: u.name,
        department: u.department,
        employeeCode: u.employeeProfileUser[0]?.employeeCode ?? null,
        designation: u.employeeProfileUser[0]?.positionTitle ?? null,
        current: cur.has(u.id) ? this.dto(cur.get(u.id)!, names) : null,
        upcomingVersions: up.get(u.id) ?? 0,
      })),
      res.meta,
    );
  }

  async history(user: Principal, userId: string) {
    const target = await this.prisma.user.findFirst({ where: { id: userId, organizationId: user.organizationId }, select: { id: true, name: true } });
    if (!target) throw notFound('Employee');
    const rows = await this.prisma.salaryStructure.findMany({ where: { organizationId: user.organizationId, userId }, orderBy: { effectiveFrom: 'desc' }, take: 200 });
    const names = await this.names(rows.map((r) => r.createdById));
    return { userId: target.id, name: target.name, versions: rows.map((r) => this.dto(r, names)) };
  }

  async create(user: Principal, b: z.infer<typeof createSalaryStructureSchema>) {
    const target = await this.prisma.user.findFirst({ where: { id: b.userId, organizationId: user.organizationId }, select: { id: true } });
    if (!target) throw notFound('Employee');
    // A version may not rewrite a month that is already approved or paid for this employee.
    const locked = await this.prisma.payslip.findFirst({ where: { organizationId: user.organizationId, userId: b.userId, run: { status: { in: ['APPROVED', 'PAID'] } } }, orderBy: { run: { month: 'desc' } }, select: { run: { select: { month: true } } } });
    if (locked && b.effectiveFrom <= monthEnd(locked.run.month)) throw new AppError('STRUCTURE_BACKDATED', 'This employee already has an approved or paid payroll run up to a later date; use an effective date after it', 422, { lockedThrough: monthEnd(locked.run.month) });
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.salaryStructure.create({
          data: { organizationId: user.organizationId, userId: b.userId, effectiveFrom: dateOnly(b.effectiveFrom), currency: b.currency, components: b.components as unknown as Prisma.InputJsonValue, note: b.note ?? null, createdById: user.userId },
        });
        // no amounts in audit metadata
        await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'payroll.structure_created', entityType: 'salary_structure', entityId: row.id, metadata: { userId: b.userId, effectiveFrom: b.effectiveFrom, componentCount: b.components.length } });
        return row;
      });
      return this.dto(created, await this.names([created.createdById]));
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError('STRUCTURE_VERSION_EXISTS', 'A structure version already exists for this effective date; versions are append-only, pick a later date', 409);
      throw e;
    }
  }
}
