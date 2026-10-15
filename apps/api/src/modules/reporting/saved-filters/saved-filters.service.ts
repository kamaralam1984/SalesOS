import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { SavedFilterDto } from '@salesos/validation';
import type { Principal } from '../../../common/authz';
import { AppError, notFound } from '../../../common/http/errors';
import { PrismaService } from '../../../common/prisma';

const MAX_PER_USER = 50;

/**
 * Saved filters are a per-user convenience. They store a filter set, nothing else: every use goes through the normal query
 * endpoints, which intersect the filters with the caller's CURRENT scope, so a saved filter can never widen access.
 */
@Injectable()
export class SavedFiltersService {
  constructor(private readonly prisma: PrismaService) {}

  private dto(r: { id: string; name: string; target: string; filters: Prisma.JsonValue; isDefault: boolean; updatedAt: Date }) {
    return { id: r.id, name: r.name, target: r.target, filters: r.filters, isDefault: r.isDefault, updatedAt: r.updatedAt };
  }

  async list(user: Principal, target?: string) {
    const rows = await this.prisma.savedFilter.findMany({ where: { organizationId: user.organizationId, userId: user.userId, ...(target ? { target } : {}) }, orderBy: [{ target: 'asc' }, { name: 'asc' }], take: MAX_PER_USER });
    return rows.map((r) => this.dto(r));
  }

  async create(user: Principal, dto: SavedFilterDto) {
    const count = await this.prisma.savedFilter.count({ where: { organizationId: user.organizationId, userId: user.userId } });
    if (count >= MAX_PER_USER) throw new AppError('LIMIT_REACHED', `You can keep at most ${MAX_PER_USER} saved filters`, 409);
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.isDefault) await tx.savedFilter.updateMany({ where: { organizationId: user.organizationId, userId: user.userId, target: dto.target }, data: { isDefault: false } });
        return this.dto(await tx.savedFilter.create({ data: { organizationId: user.organizationId, userId: user.userId, name: dto.name, target: dto.target, filters: dto.filters as Prisma.InputJsonValue, isDefault: dto.isDefault ?? false } }));
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new AppError('CONFLICT', 'You already have a saved filter with this name for this view', 409);
      throw e;
    }
  }

  async remove(user: Principal, id: string) {
    const r = await this.prisma.savedFilter.deleteMany({ where: { id, organizationId: user.organizationId, userId: user.userId } });
    if (r.count === 0) throw notFound('Saved filter');
    return { id, deleted: true };
  }
}
