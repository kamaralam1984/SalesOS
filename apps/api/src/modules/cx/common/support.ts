import type { Prisma } from '@prisma/client';
import { loadCxConfig, type CxConfig } from '@salesos/cx-core';
import type { WorkingHours } from '@salesos/crm-core';
import type { PermissionKey, AccessService, Principal } from '../../../common/authz';
import { AppError, forbidden, notFound } from '../../../common/http/errors';
import type { PrismaService } from '../../../common/prisma';
import { ApiResult } from '../../../common/http/api-result';

export const hasRole = (user: Principal, ...roles: string[]) => user.roles.some((r) => roles.includes(r));

/** Users whose records the caller may see for `key`: null = whole organization (org/summary), else explicit ids. */
export async function scopeUserIds(access: AccessService, user: Principal, key: PermissionKey): Promise<string[] | null> {
  const level = access.scopeLevel(user, key);
  if (!level) throw forbidden();
  if (level === 'org' || level === 'summary') return null;
  if (level === 'own') return [user.userId];
  return (await access.visibleUsers(user)).ids;
}

/** Prisma fragment: records whose ANY of `fields` (user-id columns) falls in the caller's scope; organization always pinned. */
export async function scopedByUsers(access: AccessService, user: Principal, key: PermissionKey, fields: string[]): Promise<Record<string, unknown>> {
  const ids = await scopeUserIds(access, user, key);
  const base: Record<string, unknown> = { organizationId: user.organizationId };
  if (ids === null) return base;
  return { ...base, OR: fields.map((f) => ({ [f]: { in: ids } })) };
}

export async function canActOnUser(access: AccessService, user: Principal, key: PermissionKey, targetUserId: string): Promise<boolean> {
  const ids = await scopeUserIds(access, user, key);
  return ids === null || ids.includes(targetUserId);
}

export async function userNameMap(prisma: PrismaService, organizationId: string, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((i): i is string => !!i))];
  if (uniq.length === 0) return new Map();
  const rows = await prisma.user.findMany({ where: { organizationId, id: { in: uniq } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** 400 unless every id is an ACTIVE user of the organization. */
export async function assertOrgUsers(prisma: PrismaService, organizationId: string, ids: string[]): Promise<void> {
  const uniq = [...new Set(ids)];
  const count = await prisma.user.count({ where: { organizationId, id: { in: uniq }, isActive: true } });
  if (count !== uniq.length) throw new AppError('INVALID_USER', 'One or more users were not found in this organization', 400);
}

/** The lead (learner/prospect) the caller may see under `leads:view`; 404 otherwise (IDOR-safe). summary scope counts as visible. */
export async function loadVisibleLead(prisma: PrismaService, access: AccessService, user: Principal, leadId: string) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, organizationId: user.organizationId, mergedIntoId: null } });
  if (!lead || !(await access.canAccessRecord(user, 'leads:view', { organizationId: lead.organizationId, ownerId: lead.assignedToId, teamId: lead.teamId }))) throw notFound('Lead');
  return lead;
}

export async function cxConfig(prisma: PrismaService, organizationId: string): Promise<{ cfg: CxConfig; wh: WorkingHours }> {
  return loadCxConfig(prisma, organizationId);
}

export const money = (v: { toString(): string } | null | undefined): string | null => (v == null ? null : v.toString());

export function withData<T, U>(res: ApiResult<T[]>, data: U[]): ApiResult<U[]> {
  return new ApiResult(data, res.meta);
}

export function fieldsRequired(fields: string[]): AppError {
  return new AppError('FIELDS_REQUIRED', `Missing required fields: ${fields.join(', ')}`, 422, fields.map((f) => ({ path: f, message: 'required' })));
}

export const illegalTransition = (from: string, to: string) => new AppError('ILLEGAL_TRANSITION', `Cannot move from ${from} to ${to}`, 409);

export type Json = Prisma.InputJsonValue;

/** 422 unless every given reference exists in the caller's organization (integrity only; visibility is checked where data is returned). */
export async function assertOrgRefs(prisma: PrismaService, organizationId: string, refs: { dealId?: string | null; refundId?: string | null; complaintId?: string | null; handoverId?: string | null; programId?: string | null }): Promise<void> {
  const checks: Array<Promise<number>> = [];
  if (refs.dealId) checks.push(prisma.deal.count({ where: { id: refs.dealId, organizationId } }));
  if (refs.refundId) checks.push(prisma.refund.count({ where: { id: refs.refundId, organizationId } }));
  if (refs.complaintId) checks.push(prisma.complaint.count({ where: { id: refs.complaintId, organizationId } }));
  if (refs.handoverId) checks.push(prisma.handoverRecord.count({ where: { id: refs.handoverId, organizationId } }));
  if (refs.programId) checks.push(prisma.program.count({ where: { id: refs.programId, organizationId } }));
  const counts = await Promise.all(checks);
  if (counts.some((n) => n !== 1)) throw new AppError('INVALID_REFERENCE', 'A linked deal / refund / complaint / handover / programme does not exist in this organization', 422);
}
