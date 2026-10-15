import { Injectable } from '@nestjs/common';
import type { earnedLeaveProgressQuerySchema, earnedLeaveRunSchema, earnedLeaveTransactionsQuerySchema } from '@salesos/validation';
import { asElDb, roundDays, runEarnedLeaveForUser, runEarnedLeaveYearEnd, type ElRunResult } from '@salesos/workforce-core';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService } from '../../../common/prisma';
import { asPage, assertTargetInScope, isoDay } from '../../people/common/helpers';
import { WorkforceConfigService } from '../common/workforce-config.service';
import { assertEmployee, balanceOf, num } from '../leave/leave.common';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;
const RUN_ALL_CAP = 5000;

@Injectable()
export class EarnedLeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly cfg: WorkforceConfigService,
  ) {}

  /** Eligible days so far, days to the next credit and the per-day explanation of the open period. Read-only. */
  async progress(user: Principal, q: Dto<typeof earnedLeaveProgressQuerySchema>) {
    const targetId = q.userId ?? user.userId;
    await assertTargetInScope(this.access, user, 'leave:view', targetId);
    await assertEmployee(this.prisma, user.organizationId, targetId);
    const { config } = await this.cfg.getConfig(user.organizationId);
    const el = config.earnedLeave;
    const row = await this.prisma.earnedLeaveProgress.findUnique({ where: { userId: targetId } });
    const eligible = row ? num(row.eligibleDays) : 0;
    return {
      userId: targetId, enabled: el.enabled, requiredEligibleDays: el.requiredEligibleDays, creditDays: el.creditDays, leaveTypeKey: el.leaveTypeKey,
      eligibleDays: roundDays(eligible), daysToNextCredit: roundDays(Math.max(0, el.requiredEligibleDays - eligible)), creditsGiven: row?.creditsGiven ?? 0,
      processedThrough: isoDay(row?.processedThrough), periodStart: isoDay(row?.periodStart), balance: await balanceOf(this.prisma, user.organizationId, targetId, el.leaveTypeKey),
      dayLog: Array.isArray(row?.dayLog) ? row!.dayLog : [],
    };
  }

  async transactions(user: Principal, q: Dto<typeof earnedLeaveTransactionsQuerySchema>) {
    const targetId = q.userId ?? user.userId;
    await assertTargetInScope(this.access, user, 'leave:view', targetId);
    await assertEmployee(this.prisma, user.organizationId, targetId);
    const rows = await this.prisma.leaveBalanceTxn.findMany({
      where: { organizationId: user.organizationId, userId: targetId, kind: { in: ['CREDIT_EARNED', 'EXPIRY'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q),
    });
    const res = pageResult(rows, q);
    return asPage(res, res.data.map((r) => ({
      id: r.id, kind: r.kind, typeKey: r.typeKey, amount: r.amount.toString(), balanceBefore: r.balanceBefore.toString(), balanceAfter: r.balanceAfter.toString(),
      periodStart: isoDay(r.periodStart), periodEnd: isoDay(r.periodEnd), eligibleDays: r.eligibleDays?.toString() ?? null, calculation: r.calculation, policyVersion: r.policyVersion, note: r.note, createdAt: r.createdAt,
    })));
  }

  /** Runs the same engine as the nightly job now (idempotent: processed days are never evaluated twice, credits have a unique key). */
  async run(user: Principal, dto: Dto<typeof earnedLeaveRunSchema>) {
    let userIds: string[];
    if (dto.userId) {
      await assertEmployee(this.prisma, user.organizationId, dto.userId);
      userIds = [dto.userId];
    } else {
      userIds = (await this.prisma.user.findMany({ where: { organizationId: user.organizationId, isActive: true }, select: { id: true }, orderBy: { id: 'asc' }, take: RUN_ALL_CAP })).map((u) => u.id);
    }
    const db = asElDb(this.prisma);
    const results: Array<{ userId: string } & ElRunResult> = [];
    for (const id of userIds) {
      results.push({ userId: id, ...(await runEarnedLeaveForUser(db, { organizationId: user.organizationId, userId: id, actorId: user.userId })) });
      await runEarnedLeaveYearEnd(db, { organizationId: user.organizationId, userId: id });
    }
    const credits = results.flatMap((r) => r.credits);
    await this.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'earned_leave.run', entityType: 'earned_leave', metadata: { users: userIds.length, credits: credits.length, targetUserId: dto.userId ?? null } });
    return { users: userIds.length, credits: credits.length, results: dto.userId ? results : results.filter((r) => r.credits.length > 0) };
  }
}
