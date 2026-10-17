import type { Prisma } from '@prisma/client';
import type { RoleKey } from '@salesos/shared-types';

export const userInclude = { roleAssignments: { include: { role: true } } } satisfies Prisma.UserInclude;
type UserWithRoles = Prisma.UserGetPayload<{ include: typeof userInclude }>;

/** Minimum-data projection for `summary` scope (e.g. HR on users:view): no email, hierarchy or login data. */
export function toUserSummary(u: UserWithRoles) {
  return { id: u.id, name: u.name, isActive: u.isActive };
}

/** Never includes passwordHash or lockout internals. */
export function toUserDto(u: UserWithRoles) {
  return {
    id: u.id,
    organizationId: u.organizationId,
    email: u.email,
    name: u.name,
    isActive: u.isActive,
    managerId: u.managerId,
    department: u.department,
    roles: u.roleAssignments.map((a) => a.role.key as RoleKey),
    hasPassword: !!u.passwordHash,
    approvalStatus: u.approvalStatus,
    lastLoginAt: u.lastLoginAt,
    deactivatedAt: u.deactivatedAt,
    createdAt: u.createdAt,
  };
}
