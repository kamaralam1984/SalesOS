import { Injectable } from '@nestjs/common';
import { addMonths } from '@salesos/workforce-core';
import { upsertEmployeeProfileSchema, type HrProfilePatch } from '@salesos/validation';
import type { Principal } from '../../../common/authz';
import { AppError, notFound } from '../../../common/http/errors';
import { PrismaService } from '../../../common/prisma';
import { HiringService } from '../../people/hiring/hiring.service';
import { isoDay } from '../../people/common/helpers';
import { WorkforceConfigService } from '../common/workforce-config.service';
import { ProbationService } from './probation.service';

/**
 * HR profile fields for the workforce platform. Reads and writes go through the existing people employee-profile service
 * (`hr:records:view|manage`, per-read audit `hr.record_viewed`, `hr.record_saved` with field names only), so there is one HR record, not two.
 */
@Injectable()
export class HrService {
  constructor(private readonly hiring: HiringService, private readonly prisma: PrismaService, private readonly cfg: WorkforceConfigService, private readonly probation: ProbationService) {}

  async getProfile(user: Principal, userId: string) {
    const p = await this.hiring.getEmployee(user, userId);
    return { ...p, probation: await this.probation.forProfile(user.organizationId, userId) };
  }

  async patchProfile(user: Principal, userId: string, dto: HrProfilePatch) {
    const current = await this.prisma.employeeProfile.findUnique({ where: { userId } });
    if (current && current.organizationId !== user.organizationId) throw notFound('Employee');
    const u = await this.prisma.user.findFirst({ where: { id: userId, organizationId: user.organizationId }, select: { id: true } });
    if (!u) throw notFound('Employee');
    const patch: Record<string, unknown> = { ...dto };
    // probation end follows joinDate + months unless HR/an extension already set a different end that these fields do not touch
    if (dto.joinDate !== undefined || dto.probationMonths !== undefined) {
      const join = dto.joinDate ?? isoDay(current?.joinDate);
      if (join) {
        const { config } = await this.cfg.getConfig(user.organizationId);
        const months = (dto.probationMonths === undefined ? current?.probationMonths : dto.probationMonths) ?? config.hr.probationDefaultMonths;
        patch['probationEndDate'] = addMonths(join, months);
      }
    }
    const parsed = upsertEmployeeProfileSchema.safeParse(patch);
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Request validation failed', 400, parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    // do not let the schema default of employmentType overwrite an existing value
    const data = { ...parsed.data, ...(current ? { employmentType: current.employmentType } : {}) };
    const saved = await this.hiring.upsertEmployee(user, userId, data);
    return { ...saved, probation: await this.probation.forProfile(user.organizationId, userId) };
  }
}
