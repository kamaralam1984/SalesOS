import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DEFAULT_WORKFORCE_CONFIG, partialWorkforceConfigSchema, workforceConfigSchema } from '@salesos/validation';
import { AuditService } from '../../../common/audit/audit.service';
import type { Principal } from '../../../common/authz';
import { AppError } from '../../../common/http/errors';
import { PrismaService } from '../../../common/prisma';
import { WorkforceConfigService } from '../common/workforce-config.service';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const merge = (base: unknown, over: unknown): unknown => {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out: Json = { ...base };
  for (const k of Object.keys(over)) out[k] = merge(base[k], over[k]);
  return out;
};

@Injectable()
export class WorkforceSettingsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly cfg: WorkforceConfigService) {}

  async get(user: Principal) {
    const row = await this.prisma.workforceSetting.findUnique({ where: { organizationId: user.organizationId } });
    const { config, version } = await this.cfg.getConfig(user.organizationId);
    return { effective: config, overrides: row?.config ?? {}, defaults: DEFAULT_WORKFORCE_CONFIG, version, updatedAt: row?.updatedAt ?? null, note: 'Defaults are proposed (DEC-048) and awaiting owner approval.' };
  }

  /** Partial update (arrays replace). Validated as a whole; the change is logged with user and time and bumps `version`. */
  async update(user: Principal, patch: unknown) {
    const parsed = partialWorkforceConfigSchema.safeParse(patch);
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Request validation failed', 400, parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    const row = await this.prisma.workforceSetting.findUnique({ where: { organizationId: user.organizationId } });
    const next = merge(row?.config ?? {}, parsed.data) as Prisma.InputJsonObject;
    const full = workforceConfigSchema.safeParse(merge(DEFAULT_WORKFORCE_CONFIG, next));
    if (!full.success) throw new AppError('VALIDATION_ERROR', 'The resulting policy is invalid', 422, full.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    const types = full.data.leave.types.map((t) => t.key);
    if (new Set(types).size !== types.length) throw new AppError('VALIDATION_ERROR', 'Leave type keys must be unique', 422);
    if (full.data.earnedLeave.enabled && !types.includes(full.data.earnedLeave.leaveTypeKey)) throw new AppError('VALIDATION_ERROR', 'earnedLeave.leaveTypeKey must be one of the leave types', 422);
    await this.prisma.$transaction(async (tx) => {
      const version = (row?.version ?? 0) + 1;
      await tx.workforceSetting.upsert({
        where: { organizationId: user.organizationId },
        create: { organizationId: user.organizationId, config: next, version, updatedById: user.userId },
        update: { config: next, version, updatedById: user.userId },
      });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'workforce.settings_updated', entityType: 'workforce_settings', entityId: user.organizationId, metadata: { sections: Object.keys(parsed.data), version } });
    });
    return this.get(user);
  }
}
