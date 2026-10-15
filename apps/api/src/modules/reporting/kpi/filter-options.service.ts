import { Injectable } from '@nestjs/common';
import type { Principal } from '../../../common/authz';
import { PrismaService } from '../../../common/prisma';
import { ScopeService } from './scope';

/**
 * Choices for the dashboard / report filter bar. Teams and owners are limited to what the caller's scope already contains, so the
 * UI can never offer (and the server never honours) a filter outside it. Programs and sources are organisation catalogue data.
 */
@Injectable()
export class FilterOptionsService {
  constructor(private readonly prisma: PrismaService, private readonly scopes: ScopeService) {}

  async get(user: Principal) {
    const scope = await this.scopes.resolve(user, 'kpi:view');
    const org = user.organizationId;
    const ids = scope.userIds;
    const [teams, programs, sources, owners] = await Promise.all([
      this.prisma.team.findMany({
        where: { organizationId: org, ...(ids === null ? {} : { OR: [{ id: { in: scope.teamIds } }, { memberships: { some: { userId: { in: ids } } } }] }) },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
        take: 200,
      }),
      this.prisma.program.findMany({ where: { organizationId: org, isActive: true }, select: { id: true, name: true, code: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], take: 200 }),
      this.prisma.leadSource.findMany({ where: { organizationId: org, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 200 }),
      scope.detail
        ? this.prisma.user.findMany({
            where: { organizationId: org, isActive: true, ...(ids === null ? {} : { id: { in: ids } }), roleAssignments: { some: { role: { key: { in: ['SALES_TEAM_LEAD', 'SALES_MANAGER', 'SALES_EXECUTIVE'] } } } } },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
            take: 500,
          })
        : Promise.resolve([]),
    ]);
    return { scopeLevel: scope.level, teams, programs, sources, owners };
  }
}
