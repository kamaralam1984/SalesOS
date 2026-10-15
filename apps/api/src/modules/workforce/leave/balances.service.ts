import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { adjustBalanceSchema, balanceQuerySchema, leaveCalendarQuerySchema, ledgerQuerySchema } from '@salesos/validation';
import { roundDays } from '@salesos/workforce-core';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { AppError, conflict, forbidden } from '../../../common/http/errors';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService } from '../../../common/prisma';
import { asPage, assertTargetInScope, isoDay, scopeUserIds, toDate, userNameMap } from '../../people/common/helpers';
import { WorkforceConfigService } from '../common/workforce-config.service';
import { assertEmployee, balanceOf, lockUserLeave, num } from './leave.common';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;

@Injectable()
export class LeaveBalancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly cfg: WorkforceConfigService,
  ) {}

  async types(user: Principal) {
    const { config } = await this.cfg.getConfig(user.organizationId);
    return config.leave.types.filter((t) => t.active).map((t) => ({ key: t.key, name: t.name, isPaid: t.isPaid, needsBalance: t.needsBalance, maxConsecutiveDays: t.maxConsecutiveDays }));
  }

  /** Per type: ledger balance, days reserved by pending requests and what is still available. */
  async balances(user: Principal, q: Dto<typeof balanceQuerySchema>) {
    const targetId = q.userId ?? user.userId;
    await assertTargetInScope(this.access, user, 'leave:view', targetId);
    await assertEmployee(this.prisma, user.organizationId, targetId);
    const { config } = await this.cfg.getConfig(user.organizationId);
    const [sums, pending] = await Promise.all([
      this.prisma.leaveBalanceTxn.groupBy({ by: ['typeKey'], where: { organizationId: user.organizationId, userId: targetId }, _sum: { amount: true } }),
      this.prisma.leaveRequest.findMany({ where: { organizationId: user.organizationId, userId: targetId, status: { in: ['PENDING_MANAGER', 'PENDING_HR'] } }, select: { typeKey: true, days: true, unpaidDays: true } }),
    ]);
    const bal = new Map(sums.map((s) => [s.typeKey, num(s._sum.amount)]));
    const keys = [...config.leave.types.map((t) => t.key), ...[...bal.keys()].filter((k) => !config.leave.types.some((t) => t.key === k))];
    const data = keys.map((key) => {
      const t = config.leave.types.find((x) => x.key === key);
      const balance = roundDays(bal.get(key) ?? 0);
      const reserved = roundDays(pending.filter((p) => p.typeKey === key).reduce((n, p) => n + num(p.days) - num(p.unpaidDays), 0));
      const pendingDays = roundDays(pending.filter((p) => p.typeKey === key).reduce((n, p) => n + num(p.days), 0));
      return { typeKey: key, name: t?.name ?? key, isPaid: t?.isPaid ?? true, needsBalance: t?.needsBalance ?? true, active: t?.active ?? false, balance, pending: pendingDays, available: roundDays(balance - reserved) };
    });
    return { userId: targetId, balances: data };
  }

  async ledger(user: Principal, q: Dto<typeof ledgerQuerySchema>) {
    const targetId = q.userId ?? user.userId;
    await assertTargetInScope(this.access, user, 'leave:view', targetId);
    await assertEmployee(this.prisma, user.organizationId, targetId);
    const rows = await this.prisma.leaveBalanceTxn.findMany({
      where: { organizationId: user.organizationId, userId: targetId, ...(q.typeKey ? { typeKey: q.typeKey } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q),
    });
    const res = pageResult(rows, q);
    const names = await userNameMap(this.prisma, user.organizationId, res.data.map((r) => r.createdById));
    return asPage(res, res.data.map((r) => ({
      id: r.id, typeKey: r.typeKey, kind: r.kind, amount: r.amount.toString(), balanceBefore: r.balanceBefore.toString(), balanceAfter: r.balanceAfter.toString(),
      leaveRequestId: r.leaveRequestId, periodStart: isoDay(r.periodStart), periodEnd: isoDay(r.periodEnd), eligibleDays: r.eligibleDays?.toString() ?? null,
      note: r.note, createdById: r.createdById, createdByName: r.createdById ? names.get(r.createdById) ?? null : 'System rule', createdAt: r.createdAt,
    })));
  }

  async adjust(user: Principal, dto: Dto<typeof adjustBalanceSchema>) {
    if (dto.userId === user.userId) throw forbidden('You cannot adjust your own leave balance');
    await assertEmployee(this.prisma, user.organizationId, dto.userId);
    const { config } = await this.cfg.getConfig(user.organizationId);
    if (!config.leave.types.some((t) => t.key === dto.typeKey)) throw new AppError('INVALID_LEAVE_TYPE', 'Unknown leave type', 400);
    const amount = Number(dto.amount);
    const txn = await this.prisma.$transaction(async (tx) => {
      await lockUserLeave(tx, dto.userId);
      const before = await balanceOf(tx, user.organizationId, dto.userId, dto.typeKey);
      const after = roundDays(before + amount);
      if (after < 0) throw new AppError('NEGATIVE_BALANCE', 'The adjustment would make the balance negative', 409, { balance: before });
      if (dto.kind === 'OPENING' && amount < 0) throw new AppError('INVALID_OPENING', 'An opening balance cannot be negative', 400);
      const existing = dto.kind === 'OPENING' ? await tx.leaveBalanceTxn.findFirst({ where: { organizationId: user.organizationId, uniqueKey: `OPENING:${dto.userId}:${dto.typeKey}` } }) : null;
      if (existing) throw conflict('OPENING_EXISTS', 'An opening balance was already set for this employee and leave type; use an adjustment');
      const row = await tx.leaveBalanceTxn.create({
        data: {
          organizationId: user.organizationId, userId: dto.userId, typeKey: dto.typeKey, kind: dto.kind, amount, balanceBefore: before, balanceAfter: after,
          note: dto.reason, createdById: user.userId, ...(dto.kind === 'OPENING' ? { uniqueKey: `OPENING:${dto.userId}:${dto.typeKey}` } : {}),
        },
      });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'leave.balance_adjusted', entityType: 'leave_balance_txn', entityId: row.id, metadata: { userId: dto.userId, typeKey: dto.typeKey, kind: dto.kind, amount, balanceBefore: before, balanceAfter: after } });
      return row;
    });
    return { id: txn.id, userId: txn.userId, typeKey: txn.typeKey, kind: txn.kind, amount: txn.amount.toString(), balanceBefore: txn.balanceBefore.toString(), balanceAfter: txn.balanceAfter.toString(), note: txn.note, createdAt: txn.createdAt };
  }

  /** Who is on leave in a window, limited to the viewer's leave:view scope. Reasons are never included. */
  async calendar(user: Principal, q: Dto<typeof leaveCalendarQuerySchema>) {
    const ids = await scopeUserIds(this.access, user, 'leave:view');
    const where: Prisma.LeaveRequestWhereInput = {
      organizationId: user.organizationId, ...(ids ? { userId: { in: ids } } : {}),
      status: { in: ['APPROVED', 'PENDING_MANAGER', 'PENDING_HR'] }, startDate: { lte: toDate(q.to) }, endDate: { gte: toDate(q.from) },
    };
    const rows = await this.prisma.leaveRequest.findMany({ where, orderBy: [{ startDate: 'asc' }, { id: 'asc' }], take: 500 });
    const names = await userNameMap(this.prisma, user.organizationId, rows.map((r) => r.userId));
    return { from: q.from, to: q.to, entries: rows.map((r) => ({ requestId: r.id, userId: r.userId, userName: names.get(r.userId) ?? null, typeKey: r.typeKey, startDate: isoDay(r.startDate), endDate: isoDay(r.endDate), halfDay: r.halfDay, status: r.status === 'APPROVED' ? 'APPROVED' : 'PENDING' })) };
  }
}
