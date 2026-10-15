import { Injectable } from '@nestjs/common';
import { Prisma, type Holiday } from '@prisma/client';
import type { createHolidaySchema, holidaysQuerySchema, suggestHolidaysSchema, updateHolidaySchema } from '@salesos/validation';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { AppError, conflict, notFound } from '../../../common/http/errors';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService, type Tx } from '../../../common/prisma';
import { asPage, isoDay, toDate } from '../../people/common/helpers';
import { WorkforceConfigService } from '../common/workforce-config.service';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;

/** Fixed-date national holidays (the same date every year). Moveable festivals are entered by HR; nothing here counts until approved. */
export const FIXED_NATIONAL_HOLIDAYS: ReadonlyArray<{ rule: string; month: number; day: number; name: string }> = [
  { rule: 'IN_REPUBLIC_DAY', month: 1, day: 26, name: 'Republic Day' },
  { rule: 'IN_INDEPENDENCE_DAY', month: 8, day: 15, name: 'Independence Day' },
  { rule: 'IN_GANDHI_JAYANTI', month: 10, day: 2, name: 'Gandhi Jayanti' },
];

const view = (h: Holiday) => ({
  id: h.id, date: isoDay(h.date)!, name: h.name, kind: h.kind, location: h.location, status: h.status, suggested: h.status === 'SUGGESTED' && !!h.sourceRule,
  approvedAt: h.approvedAt, createdAt: h.createdAt,
});
const snapshot = (h: Holiday) => ({ date: isoDay(h.date), name: h.name, kind: h.kind, location: h.location, status: h.status });

@Injectable()
export class HolidaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly cfg: WorkforceConfigService,
  ) {}

  private canManage = (u: Principal) => this.access.has(u, 'holidays:manage');

  async list(user: Principal, q: Dto<typeof holidaysQuerySchema>) {
    const year = q.year ?? new Date().getUTCFullYear();
    // suggestions are visible to the people who manage holidays only; everyone else sees the real calendar
    const status = this.canManage(user) ? q.status : 'APPROVED';
    const rows = await this.prisma.holiday.findMany({
      where: { organizationId: user.organizationId, date: { gte: toDate(`${year}-01-01`), lte: toDate(`${year}-12-31`) }, ...(status ? { status } : {}) },
      orderBy: [{ date: 'asc' }, { id: 'asc' }], ...pageArgs(q),
    });
    const res = pageResult(rows, q);
    return asPage(res, res.data.map(view));
  }

  private async load(user: Principal, id: string): Promise<Holiday> {
    const h = await this.prisma.holiday.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!h) throw notFound('Holiday');
    return h;
  }

  private async dup<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('HOLIDAY_EXISTS', 'A holiday with this date and name already exists');
      throw e;
    }
  }

  async create(user: Principal, dto: Dto<typeof createHolidaySchema>) {
    const h = await this.dup(() =>
      this.prisma.$transaction(async (tx) => {
        const row = await tx.holiday.create({
          data: {
            organizationId: user.organizationId, date: toDate(dto.date), name: dto.name, kind: dto.kind, location: dto.location ?? null, status: dto.status, createdById: user.userId,
            ...(dto.status === 'APPROVED' ? { approvedById: user.userId, approvedAt: new Date() } : {}),
          },
        });
        await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'holiday.created', entityType: 'holiday', entityId: row.id, metadata: { after: snapshot(row) } });
        return row;
      }),
    );
    return view(h);
  }

  async update(user: Principal, id: string, dto: Dto<typeof updateHolidaySchema>) {
    const before = await this.load(user, id);
    const h = await this.dup(() =>
      this.prisma.$transaction(async (tx) => {
        const row = await tx.holiday.update({ where: { id }, data: { ...(dto.date ? { date: toDate(dto.date) } : {}), ...(dto.name ? { name: dto.name } : {}), ...(dto.kind ? { kind: dto.kind } : {}), ...(dto.location !== undefined ? { location: dto.location } : {}) } });
        await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'holiday.updated', entityType: 'holiday', entityId: id, metadata: { before: snapshot(before), after: snapshot(row) } });
        return row;
      }),
    );
    return view(h);
  }

  async remove(user: Principal, id: string) {
    const before = await this.load(user, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.holiday.delete({ where: { id } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'holiday.deleted', entityType: 'holiday', entityId: id, metadata: { before: snapshot(before) } });
    });
    return { id, deleted: true };
  }

  async approve(user: Principal, id: string) {
    const before = await this.load(user, id);
    if (before.status === 'APPROVED') throw conflict('ALREADY_APPROVED', 'This holiday is already approved');
    const h = await this.prisma.$transaction(async (tx: Tx) => {
      const upd = await tx.holiday.updateMany({ where: { id, status: 'SUGGESTED' }, data: { status: 'APPROVED', approvedById: user.userId, approvedAt: new Date() } });
      if (upd.count !== 1) throw conflict('ALREADY_APPROVED', 'This holiday is already approved');
      const row = await tx.holiday.findUniqueOrThrow({ where: { id } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'holiday.approved', entityType: 'holiday', entityId: id, metadata: { before: snapshot(before), after: snapshot(row) } });
      return row;
    });
    return view(h);
  }

  /** Generates SUGGESTED rows for the fixed national holidays of a year. Never touches an existing row; never counts until approved. */
  async suggest(user: Principal, dto: Dto<typeof suggestHolidaysSchema>) {
    const { config } = await this.cfg.getConfig(user.organizationId);
    if (!config.holidays.suggestFixedNational) throw new AppError('SUGGESTIONS_DISABLED', 'Holiday suggestions are turned off in the workforce policy', 409);
    const created = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.holiday.findMany({ where: { organizationId: user.organizationId, date: { gte: toDate(`${dto.year}-01-01`), lte: toDate(`${dto.year}-12-31`) } }, select: { date: true, sourceRule: true } });
      const taken = new Set(existing.map((e) => `${isoDay(e.date)}|${e.sourceRule ?? ''}`));
      const takenDates = new Set(existing.filter((e) => e.sourceRule).map((e) => isoDay(e.date)));
      const out: Holiday[] = [];
      for (const f of FIXED_NATIONAL_HOLIDAYS) {
        const date = `${dto.year}-${String(f.month).padStart(2, '0')}-${String(f.day).padStart(2, '0')}`;
        if (taken.has(`${date}|${f.rule}`) || takenDates.has(date)) continue;
        // a holiday HR already entered by hand on the same date and name is left alone (unique key)
        const r = await tx.holiday.createMany({ data: [{ organizationId: user.organizationId, date: toDate(date), name: f.name, kind: 'NATIONAL', status: 'SUGGESTED', sourceRule: f.rule, createdById: user.userId }], skipDuplicates: true });
        if (r.count === 1) out.push(await tx.holiday.findFirstOrThrow({ where: { organizationId: user.organizationId, date: toDate(date), name: f.name } }));
      }
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'holiday.suggested', entityType: 'holiday', entityId: null, metadata: { year: dto.year, created: out.length } });
      return out;
    });
    return { year: dto.year, created: created.map(view), skipped: FIXED_NATIONAL_HOLIDAYS.length - created.length };
  }
}
