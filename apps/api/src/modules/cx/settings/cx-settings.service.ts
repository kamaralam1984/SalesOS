import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { cxConfigSchema, DEFAULT_CX_CONFIG, partialCxConfigSchema, resolveCxConfig } from '@salesos/cx-core';
import { AuditService } from '../../../common/audit/audit.service';
import type { Principal } from '../../../common/authz';
import { AppError } from '../../../common/http/errors';
import { PrismaService } from '../../../common/prisma';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const merge = (base: unknown, over: unknown): unknown => {
  if (!isObj(base) || !isObj(over)) return over;
  const out: Json = { ...base };
  for (const k of Object.keys(over)) out[k] = merge(base[k], over[k]);
  return out;
};

/** Configurable CX values (complaint SLA table, handover timers + checklist template, report cadence). Defaults are the DEC-017/026/028 proposals. */
@Injectable()
export class CxSettingsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async get(user: Principal) {
    const row = await this.prisma.cxSetting.findUnique({ where: { organizationId: user.organizationId } });
    return { effective: resolveCxConfig(row?.config), overrides: row?.config ?? {}, defaults: DEFAULT_CX_CONFIG, updatedAt: row?.updatedAt ?? null };
  }

  async update(user: Principal, patch: unknown) {
    const parsed = partialCxConfigSchema.safeParse(patch);
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Request validation failed', 400, parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    const row = await this.prisma.cxSetting.findUnique({ where: { organizationId: user.organizationId } });
    const next = merge(row?.config ?? {}, parsed.data) as Prisma.InputJsonObject;
    const full = cxConfigSchema.safeParse(merge(DEFAULT_CX_CONFIG, next));
    if (!full.success) throw new AppError('VALIDATION_ERROR', 'The resulting configuration is invalid', 422, full.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    await this.prisma.$transaction(async (tx) => {
      await tx.cxSetting.upsert({ where: { organizationId: user.organizationId }, create: { organizationId: user.organizationId, config: next, updatedById: user.userId }, update: { config: next, updatedById: user.userId } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'cx_settings.updated', entityType: 'cx_settings', entityId: user.organizationId, metadata: { keys: Object.keys(parsed.data) } });
    });
    return this.get(user);
  }
}
