import { Injectable, OnModuleInit } from '@nestjs/common';
import { ROLE_KEYS, type RoleKey } from '@salesos/shared-types';
import { PrismaService } from '../../common/prisma';
import { PERMISSION_CATALOGUE, grantsForRole } from '../../common/authz/permissions.catalogue';

const ROLE_NAMES: Record<RoleKey, string> = {
  DEVELOPER: 'Developer (Super Admin)',
  FOUNDER_CEO: 'Founder / CEO',
  SALES_TEAM_LEAD: 'Sales Team Lead',
  SALES_MANAGER: 'Sales Manager',
  SALES_EXECUTIVE: 'Sales Executive',
  ADMIN: 'Admin',
  FINANCE: 'Finance',
  HR: 'HR',
  MARKETING: 'Marketing',
  COMMUNITY: 'Community',
  OPERATIONS: 'Operations',
  STUDENT_SUCCESS: 'Student Success',
};

/** Mirrors the code catalogue (authoritative) into roles/permissions/role_permissions. Idempotent. */
export async function syncCatalogue(prisma: PrismaService | import('@prisma/client').PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(727001)`;
    await tx.role.createMany({
      data: ROLE_KEYS.map((key) => ({ key, name: ROLE_NAMES[key] })),
      skipDuplicates: true,
    });
    await tx.permission.createMany({
      data: PERMISSION_CATALOGUE.map((p) => ({
        key: p.key,
        domain: p.domain,
        description: p.description,
        sensitive: p.sensitive ?? false,
      })),
      skipDuplicates: true,
    });
    const roles = await tx.role.findMany();
    const perms = await tx.permission.findMany();
    const permId = new Map(perms.map((p) => [p.key, p.id]));
    const rows = roles.flatMap((r) =>
      Object.entries(grantsForRole(r.key as RoleKey)).flatMap(([key, scope]) => {
        const permissionId = permId.get(key);
        return permissionId ? [{ roleId: r.id, permissionId, scope }] : [];
      }),
    );
    await tx.rolePermission.deleteMany({});
    await tx.rolePermission.createMany({ data: rows });
  });
}

@Injectable()
export class RolesService implements OnModuleInit {
  private ids = new Map<string, string>();
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await syncCatalogue(this.prisma);
  }

  async idFor(key: RoleKey): Promise<string> {
    let id = this.ids.get(key);
    if (!id) {
      const role = await this.prisma.role.findUniqueOrThrow({ where: { key } });
      id = role.id;
      this.ids.set(key, id);
    }
    return id;
  }
}
