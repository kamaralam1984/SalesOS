import type { Prisma } from '@prisma/client';
import type { WorkforceConfig } from '@salesos/validation';
import type { PrismaService } from '../../../common/prisma';
import { localDay } from '@salesos/workforce-core';
import type { DirectoryStatus } from '@salesos/validation';
import type { AccessService, PermissionKey, Principal } from '../../../common/authz';

export const dayToDate = (d: string): Date => new Date(`${d}T00:00:00.000Z`);
export const isoDay = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);
export const todayIn = (timezone: string): string => localDay(new Date(), timezone);

export interface ProfileLite {
  userId: string;
  employeeCode: string | null;
  positionTitle: string | null;
  exitDate: Date | null;
  probationEndDate: Date | null;
}

/** EXITED = deactivated or exit date reached; PROBATION = probation end date not yet passed; otherwise ACTIVE. */
export function employmentStatus(isActive: boolean, profile: Pick<ProfileLite, 'exitDate' | 'probationEndDate'> | undefined, today: string): DirectoryStatus {
  if (!isActive) return 'EXITED';
  if (profile?.exitDate && isoDay(profile.exitDate)! <= today) return 'EXITED';
  if (profile?.probationEndDate && isoDay(profile.probationEndDate)! >= today) return 'PROBATION';
  return 'ACTIVE';
}

/** Prisma filter for one status (mirrors `employmentStatus`). `today` is the business-timezone day. */
export function statusWhere(status: DirectoryStatus, today: string): Prisma.UserWhereInput {
  const t = dayToDate(today);
  const exitedProfile: Prisma.UserWhereInput = { employeeProfileUser: { some: { exitDate: { lte: t } } } };
  const probationProfile: Prisma.UserWhereInput = { employeeProfileUser: { some: { probationEndDate: { gte: t } } } };
  if (status === 'EXITED') return { OR: [{ isActive: false }, exitedProfile] };
  if (status === 'PROBATION') return { AND: [{ isActive: true }, { NOT: exitedProfile }, probationProfile] };
  return { AND: [{ isActive: true }, { NOT: exitedProfile }, { NOT: probationProfile }] };
}

/** The viewer's scope level for a key, or null. */
export const levelOf = (access: AccessService, user: Principal, key: PermissionKey) => access.scopeLevel(user, key);

/** True when the target user (same organisation) is inside the viewer's scope for `key`. */
export const inScope = (access: AccessService, user: Principal, key: PermissionKey, targetId: string) => access.canSeeUser(user, key, targetId, user.organizationId);

/**
 * Users the viewer may see for `key`: `null` = whole organisation, else explicit ids; `undefined` = the key is not held at all.
 */
export async function scopeIds(access: AccessService, user: Principal, key: PermissionKey): Promise<string[] | null | undefined> {
  const level = access.scopeLevel(user, key);
  if (!level) return undefined;
  if (level === 'org' || level === 'summary') return null;
  if (level === 'own') return [user.userId];
  return (await access.visibleUsers(user)).ids;
}

const num = (v: { toString(): string } | null | undefined): number => (v == null ? 0 : Number(v.toString()));

/** Leave balances per type: remaining = SUM(ledger), used = approved paid days this year, pending = open requests. Read-only. */
export async function leaveBalanceSummary(prisma: PrismaService, orgId: string, userId: string, config: WorkforceConfig, today: string) {
  const year = today.slice(0, 4);
  const [txn, approved, pending] = await Promise.all([
    prisma.leaveBalanceTxn.groupBy({ by: ['typeKey'], where: { organizationId: orgId, userId }, _sum: { amount: true } }),
    prisma.leaveRequest.groupBy({ by: ['typeKey'], where: { organizationId: orgId, userId, status: 'APPROVED', startDate: { gte: dayToDate(`${year}-01-01`), lte: dayToDate(`${year}-12-31`) } }, _sum: { days: true, unpaidDays: true } }),
    prisma.leaveRequest.groupBy({ by: ['typeKey'], where: { organizationId: orgId, userId, status: { in: ['PENDING_MANAGER', 'PENDING_HR'] } }, _sum: { days: true } }),
  ]);
  const types = config.leave.types.filter((t) => t.active);
  const keys = [...new Set([...types.map((t) => t.key), ...txn.map((t) => t.typeKey), ...approved.map((a) => a.typeKey), ...pending.map((p) => p.typeKey)])];
  const balances = keys.map((key) => {
    const a = approved.find((x) => x.typeKey === key);
    return {
      typeKey: key,
      name: types.find((t) => t.key === key)?.name ?? key,
      remaining: num(txn.find((t) => t.typeKey === key)?._sum.amount),
      used: num(a?._sum.days) - num(a?._sum.unpaidDays),
      pending: num(pending.find((p) => p.typeKey === key)?._sum.days),
    };
  });
  return { year, hasData: txn.length > 0 || approved.length > 0 || pending.length > 0, balances };
}

/** Days until the next occurrence of the birthday (day + month only), or null if more than `window` days away. */
export function birthdayDaysAway(dob: Date, today: string, window: number): number | null {
  const mm = String(dob.getUTCMonth() + 1).padStart(2, '0');
  const dd = dob.getUTCDate();
  const ty = Number(today.slice(0, 4));
  for (const y of [ty, ty + 1]) {
    let day = dd;
    const last = new Date(Date.UTC(y, Number(mm), 0)).getUTCDate();
    if (day > last) day = last;
    const cand = `${y}-${mm}-${String(day).padStart(2, '0')}`;
    if (cand >= today) {
      const diff = Math.round((dayToDate(cand).getTime() - dayToDate(today).getTime()) / 86_400_000);
      return diff <= window ? diff : null;
    }
  }
  return null;
}
