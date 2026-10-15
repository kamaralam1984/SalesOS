import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { RULE_DESCRIPTIONS, RULE_KEYS, RULE_SCHEMAS, defaultRule, ensureCrmDefaults, isRuleKey, type RuleKey } from '@salesos/crm-core';
import type { z } from 'zod';
import type {
  createCampaignSchema,
  createLostReasonSchema,
  createProgramSchema,
  createSourceSchema,
  createStageSchema,
  updateAutomationRuleSchema,
  updateLostReasonSchema,
  updateProgramSchema,
  updateSourceSchema,
  updateStageSchema,
  upsertAssignmentRuleSchema,
  upsertAutomationRuleSchema,
} from '@salesos/validation';
import type { Principal } from '../../../common/authz';
import { AppError, notFound } from '../../../common/http/errors';
import { CrmSupport } from '../crm.support';

@Injectable()
export class ConfigService {
  constructor(private readonly s: CrmSupport) {}
  private get prisma() {
    return this.s.prisma;
  }

  private audit(user: Principal, action: string, entityType: string, entityId: string | null, metadata: Record<string, unknown>) {
    return this.prisma.$transaction((tx) => this.s.deps.audit(tx, { organizationId: user.organizationId, actorId: user.userId, action, entityType, entityId, metadata }));
  }

  // ---- sources / campaigns ----------------------------------------------------------------------------------------
  listSources(user: Principal) {
    return this.prisma.leadSource.findMany({ where: { organizationId: user.organizationId }, orderBy: [{ name: 'asc' }], include: { campaigns: { where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, startsAt: true, endsAt: true } } } });
  }
  async createSource(user: Principal, b: z.infer<typeof createSourceSchema>) {
    try {
      const row = await this.prisma.leadSource.create({ data: { organizationId: user.organizationId, name: b.name, type: b.type } });
      await this.audit(user, 'source.created', 'lead_source', row.id, { name: b.name });
      return row;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new AppError('DUPLICATE', 'A source with that name already exists', 409);
      throw e;
    }
  }
  async updateSource(user: Principal, id: string, b: z.infer<typeof updateSourceSchema>) {
    const ex = await this.prisma.leadSource.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!ex) throw notFound('Source');
    const row = await this.prisma.leadSource.update({ where: { id }, data: b });
    await this.audit(user, 'source.updated', 'lead_source', id, { fields: Object.keys(b) });
    return row;
  }
  async createCampaign(user: Principal, b: z.infer<typeof createCampaignSchema>) {
    const src = await this.prisma.leadSource.findFirst({ where: { id: b.sourceId, organizationId: user.organizationId } });
    if (!src) throw notFound('Source');
    try {
      const row = await this.prisma.leadCampaign.create({ data: { organizationId: user.organizationId, sourceId: b.sourceId, name: b.name, startsAt: b.startsAt ?? null, endsAt: b.endsAt ?? null } });
      await this.audit(user, 'campaign.created', 'lead_campaign', row.id, { name: b.name, sourceId: b.sourceId });
      return row;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new AppError('DUPLICATE', 'A campaign with that name already exists for the source', 409);
      throw e;
    }
  }
  listCampaigns(user: Principal) {
    return this.prisma.leadCampaign.findMany({ where: { organizationId: user.organizationId }, orderBy: [{ name: 'asc' }] });
  }

  // ---- programs ---------------------------------------------------------------------------------------------------
  listPrograms(user: Principal) {
    return this.prisma.program.findMany({ where: { organizationId: user.organizationId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }
  async createProgram(user: Principal, b: z.infer<typeof createProgramSchema>) {
    try {
      const row = await this.prisma.program.create({ data: { organizationId: user.organizationId, code: b.code.toUpperCase(), name: b.name, kind: b.kind, description: b.description ?? null, sortOrder: b.sortOrder } });
      await this.audit(user, 'program.created', 'program', row.id, { code: row.code });
      return row;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new AppError('DUPLICATE', 'A program with that code already exists', 409);
      throw e;
    }
  }
  async updateProgram(user: Principal, id: string, b: z.infer<typeof updateProgramSchema>) {
    const ex = await this.prisma.program.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!ex) throw notFound('Program');
    const row = await this.prisma.program.update({ where: { id }, data: b });
    await this.audit(user, 'program.updated', 'program', id, { fields: Object.keys(b) });
    return row;
  }

  // ---- stages / lost reasons ----------------------------------------------------------------------------------------
  async listStages(user: Principal) {
    await this.prisma.$transaction((tx) => ensureCrmDefaults(tx, user.organizationId));
    return this.prisma.leadStageConfig.findMany({ where: { organizationId: user.organizationId }, orderBy: { sortOrder: 'asc' } });
  }
  async createStage(user: Principal, b: z.infer<typeof createStageSchema>) {
    await this.prisma.$transaction((tx) => ensureCrmDefaults(tx, user.organizationId));
    try {
      const row = await this.prisma.leadStageConfig.create({ data: { organizationId: user.organizationId, key: b.key, label: b.label, category: b.category, sortOrder: b.sortOrder, skippable: b.skippable, canClose: b.canClose, allowedNext: b.allowedNext } });
      await this.audit(user, 'org.settings_changed', 'lead_stage', row.id, { change: 'stage.created', key: b.key });
      return row;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new AppError('DUPLICATE', 'A stage with that key already exists', 409);
      throw e;
    }
  }
  async updateStage(user: Principal, id: string, b: z.infer<typeof updateStageSchema>) {
    const ex = await this.prisma.leadStageConfig.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!ex) throw notFound('Stage');
    if (b.isActive === false) {
      if (ex.isSystem && ['NEW', 'WON', 'LOST', 'CONTACT_ATTEMPTED'].includes(ex.key)) throw new AppError('INVALID_STATE', 'This core stage cannot be deactivated', 409);
      const inUse = await this.prisma.lead.count({ where: { organizationId: user.organizationId, status: ex.key, mergedIntoId: null } });
      if (inUse > 0) throw new AppError('STAGE_IN_USE', `${inUse} lead(s) are in this stage; move them first`, 409);
    }
    const row = await this.prisma.leadStageConfig.update({ where: { id }, data: b });
    await this.audit(user, 'org.settings_changed', 'lead_stage', id, { change: 'stage.updated', key: ex.key, fields: Object.keys(b) });
    return row;
  }
  async listLostReasons(user: Principal) {
    await this.prisma.$transaction((tx) => ensureCrmDefaults(tx, user.organizationId));
    return this.prisma.lostReasonConfig.findMany({ where: { organizationId: user.organizationId }, orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }] });
  }
  async createLostReason(user: Principal, b: z.infer<typeof createLostReasonSchema>) {
    await this.prisma.$transaction((tx) => ensureCrmDefaults(tx, user.organizationId));
    try {
      const row = await this.prisma.lostReasonConfig.create({ data: { organizationId: user.organizationId, ...b } });
      await this.audit(user, 'org.settings_changed', 'lost_reason', row.id, { change: 'lost_reason.created', key: b.key });
      return row;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new AppError('DUPLICATE', 'A lost reason with that key already exists', 409);
      throw e;
    }
  }
  async updateLostReason(user: Principal, id: string, b: z.infer<typeof updateLostReasonSchema>) {
    const ex = await this.prisma.lostReasonConfig.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!ex) throw notFound('Lost reason');
    const row = await this.prisma.lostReasonConfig.update({ where: { id }, data: b });
    await this.audit(user, 'org.settings_changed', 'lost_reason', id, { change: 'lost_reason.updated', key: ex.key, fields: Object.keys(b) });
    return row;
  }

  // ---- automation rules ---------------------------------------------------------------------------------------------
  /** Org-level rows (or the documented DEC-026 defaults when never customised) + team overrides. */
  async listRules(user: Principal) {
    const rows = await this.prisma.automationRule.findMany({ where: { organizationId: user.organizationId }, orderBy: [{ ruleKey: 'asc' }, { scopeKey: 'asc' }] });
    const org = RULE_KEYS.map((key) => {
      const row = rows.find((r) => r.ruleKey === key && r.teamId === null);
      return { id: row?.id ?? null, ruleKey: key, teamId: null, description: RULE_DESCRIPTIONS[key], config: row ? row.config : defaultRule(key), isActive: row?.isActive ?? true, isDefault: !row, updatedAt: row?.updatedAt.toISOString() ?? null };
    });
    const teams = rows.filter((r) => r.teamId).map((r) => ({ id: r.id, ruleKey: r.ruleKey, teamId: r.teamId, description: isRuleKey(r.ruleKey) ? RULE_DESCRIPTIONS[r.ruleKey] : '', config: r.config, isActive: r.isActive, isDefault: false, updatedAt: r.updatedAt.toISOString() }));
    return [...org, ...teams];
  }
  private parseConfig(ruleKey: string, config: unknown) {
    if (!isRuleKey(ruleKey)) throw new AppError('VALIDATION_ERROR', `Unknown rule ${ruleKey}`, 422);
    const parsed = RULE_SCHEMAS[ruleKey].safeParse(config);
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid rule configuration', 422, parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    return parsed.data as Prisma.InputJsonValue;
  }
  async upsertRule(user: Principal, b: z.infer<typeof upsertAutomationRuleSchema>) {
    const config = this.parseConfig(b.ruleKey, b.config);
    if (b.teamId && !(await this.prisma.team.findFirst({ where: { id: b.teamId, organizationId: user.organizationId } }))) throw notFound('Team');
    const scopeKey = b.teamId ?? 'ORG';
    const row = await this.prisma.automationRule.upsert({
      where: { organizationId_scopeKey_ruleKey: { organizationId: user.organizationId, scopeKey, ruleKey: b.ruleKey } },
      create: { organizationId: user.organizationId, teamId: b.teamId ?? null, scopeKey, ruleKey: b.ruleKey, config, isActive: b.isActive, updatedById: user.userId },
      update: { config, isActive: b.isActive, updatedById: user.userId },
    });
    await this.audit(user, 'org.settings_changed', 'automation_rule', row.id, { change: 'automation_rule.upserted', ruleKey: b.ruleKey, teamId: b.teamId ?? null });
    return row;
  }
  async updateRule(user: Principal, id: string, b: z.infer<typeof updateAutomationRuleSchema>) {
    const ex = await this.prisma.automationRule.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!ex) throw notFound('Automation rule');
    const data: Prisma.AutomationRuleUncheckedUpdateInput = { updatedById: user.userId };
    if (b.config) data.config = this.parseConfig(ex.ruleKey, b.config);
    if (b.isActive !== undefined) data.isActive = b.isActive;
    const row = await this.prisma.automationRule.update({ where: { id }, data });
    await this.audit(user, 'org.settings_changed', 'automation_rule', id, { change: 'automation_rule.updated', ruleKey: ex.ruleKey, teamId: ex.teamId });
    return row;
  }

  // ---- round-robin ------------------------------------------------------------------------------------------------
  async listAssignmentRules(user: Principal) {
    return this.prisma.assignmentRule.findMany({ where: { organizationId: user.organizationId }, orderBy: { teamId: 'asc' } });
  }
  async upsertAssignmentRule(user: Principal, b: z.infer<typeof upsertAssignmentRuleSchema>) {
    if (!(await this.prisma.team.findFirst({ where: { id: b.teamId, organizationId: user.organizationId } }))) throw notFound('Team');
    const { teamId, ...rest } = b;
    const row = await this.prisma.assignmentRule.upsert({
      where: { organizationId_teamId: { organizationId: user.organizationId, teamId } },
      create: { organizationId: user.organizationId, teamId, ...rest },
      update: rest,
    });
    await this.audit(user, 'org.settings_changed', 'assignment_rule', row.id, { change: 'round_robin.updated', teamId, isEnabled: b.isEnabled, dailyCap: b.dailyCap });
    return row;
  }
}

export type { RuleKey };
