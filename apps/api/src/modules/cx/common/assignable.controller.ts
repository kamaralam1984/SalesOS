import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AccessService, CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { PrismaService } from '../../../common/prisma';
import { scopeUserIds } from './support';

const q = z.object({ purpose: z.enum(['complaint', 'action-item', 'escalation-target']).default('complaint') });

/**
 * Who can the caller assign CX work to? Active users inside the caller's scope for the purpose (org-wide for Founder / Team Lead,
 * the reporting tree for managers, self for executives). Returns id + name only (minimum data).
 */
@ApiTags('cx')
@Controller('cx/assignable-users')
export class AssignableUsersController {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService) {}

  @Get()
  @RequirePermission('complaints:create')
  async list(@CurrentUser() u: Principal, @Query(new ZodPipe(q)) query: z.infer<typeof q>) {
    if (query.purpose === 'escalation-target') {
      // complaints are escalated UP: Team Leads and the Founder (id + name only), regardless of the caller's reporting tree
      return this.prisma.user.findMany({
        where: { organizationId: u.organizationId, isActive: true, roleAssignments: { some: { role: { key: { in: ['SALES_TEAM_LEAD', 'FOUNDER_CEO'] } } } } },
        select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 50,
      });
    }
    const key = query.purpose === 'action-item' ? 'action-items:create' : 'complaints:create';
    if (!this.access.has(u, key)) return [];
    const ids = await scopeUserIds(this.access, u, key);
    return this.prisma.user.findMany({
      where: { organizationId: u.organizationId, isActive: true, ...(ids ? { id: { in: ids } } : {}) },
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 300,
    });
  }
}
