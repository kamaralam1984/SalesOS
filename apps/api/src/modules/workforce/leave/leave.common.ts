import type { Prisma } from '@prisma/client';
import { roundDays } from '@salesos/workforce-core';
import { notFound } from '../../../common/http/errors';
import type { PrismaService, Tx } from '../../../common/prisma';

type Db = PrismaService | Tx;
const num = (v: { toString(): string } | null | undefined): number => (v == null ? 0 : Number(v.toString()));

/** Balance = SUM of the append-only ledger (never stored separately). */
export async function balanceOf(db: Db, organizationId: string, userId: string, typeKey: string): Promise<number> {
  const agg = await db.leaveBalanceTxn.aggregate({ where: { organizationId, userId, typeKey }, _sum: { amount: true } });
  return roundDays(num(agg._sum.amount));
}

/** Days reserved by the user's PENDING requests of a type (the part that will be debited: days - unpaidDays). */
export async function reservedOf(db: Db, organizationId: string, userId: string, typeKey: string, excludeId?: string): Promise<number> {
  const rows = await db.leaveRequest.findMany({
    where: { organizationId, userId, typeKey, status: { in: ['PENDING_MANAGER', 'PENDING_HR'] }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { days: true, unpaidDays: true },
  });
  return roundDays(rows.reduce((n, r) => n + num(r.days) - num(r.unpaidDays), 0));
}

export const lockUserLeave = (tx: Tx, userId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`leave:${userId}`}))`;

export type LeaveRow = Prisma.LeaveRequestGetPayload<{ include: { steps: true } }>;
export { num };

/** 404 (IDOR-safe, same answer for 'does not exist' and 'other organisation') unless `userId` belongs to the organisation. */
export async function assertEmployee(db: Db, organizationId: string, userId: string): Promise<void> {
  const found = await db.user.findFirst({ where: { id: userId, organizationId }, select: { id: true } });
  if (!found) throw notFound('Employee');
}
