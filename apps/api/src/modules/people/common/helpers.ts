import { AppError } from '../../../common/http/errors';
import type { PrismaService } from '../../../common/prisma';

export const toDate = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
export const isoDay = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);
export const todayUtc = (): Date => toDate(new Date().toISOString().slice(0, 10));
export const addDays = (d: Date, days: number): Date => new Date(d.getTime() + days * 86_400_000);
/** Monday (UTC) of the week containing d. */
export function mondayOf(d: Date): Date {
  const day = d.getUTCDay();
  return addDays(toDate(d.toISOString().slice(0, 10)), -((day + 6) % 7));
}

export async function userNameMap(prisma: PrismaService, organizationId: string, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((i): i is string => !!i))];
  if (uniq.length === 0) return new Map();
  const rows = await prisma.user.findMany({ where: { organizationId, id: { in: uniq } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Throws 400 when any id is not an ACTIVE user of the organization. */
export async function assertOrgUsers(prisma: PrismaService, organizationId: string, ids: string[], opts: { active?: boolean } = {}): Promise<void> {
  const uniq = [...new Set(ids)];
  const count = await prisma.user.count({ where: { organizationId, id: { in: uniq }, ...(opts.active === false ? {} : { isActive: true }) } });
  if (count !== uniq.length) throw new AppError('INVALID_USER', 'One or more users were not found in this organization', 400);
}

export const money = (v: { toString(): string } | null | undefined): string | null => (v == null ? null : v.toString());

/** Strips keys with undefined values (Prisma treats undefined as "do not touch" already, this is for responses). */
export function pick<T extends object, K extends keyof T>(o: T, keys: K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = o[k];
  return out;
}

import type { AccessService, Principal, PermissionKey } from '../../../common/authz';
import { forbidden, notFound } from '../../../common/http/errors';

/** Users whose records the caller may see for `key`: `null` = whole organization, else explicit ids (own => [self]). */
export async function scopeUserIds(access: AccessService, user: Principal, key: PermissionKey): Promise<string[] | null> {
  const level = access.scopeLevel(user, key);
  if (!level) throw forbidden();
  if (level === 'org' || level === 'summary') return null;
  if (level === 'own') return [user.userId];
  return (await access.visibleUsers(user)).ids;
}

/** 404 (IDOR-safe) unless `targetUserId` is inside the caller's `key` scope. */
export async function assertTargetInScope(access: AccessService, user: Principal, key: PermissionKey, targetUserId: string, what = 'Employee'): Promise<void> {
  const ids = await scopeUserIds(access, user, key);
  if (ids && !ids.includes(targetUserId)) throw notFound(what);
}

export const hasRole = (user: Principal, ...roles: string[]) => user.roles.some((r) => roles.includes(r));

import { ApiResult } from '../../../common/http/api-result';
/** Re-wrap a page result with mapped rows, keeping the pagination meta (spreading an ApiResult would lose the class). */
export function asPage<T>(res: ApiResult<unknown[]>, data: T[]): ApiResult<T[]> {
  return new ApiResult(data, res.meta);
}
