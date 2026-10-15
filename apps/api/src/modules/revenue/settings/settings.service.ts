import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import type { createInitiativeSchema, createPlanSchema, patchRevenueSettingsSchema, programThresholdSchema, updateInitiativeSchema, updatePlanSchema } from '@salesos/validation';
import type { Principal } from '../../../common/authz';
import { AppError, notFound } from '../../../common/http/errors';
import { DEFAULT_STAGE_PROBABILITIES, money, round2 } from '../calc';
import { RevenueSupport, dateOnly, iso, isoDay } from '../revenue.support';

@Injectable()
export class SettingsService {
  constructor(private readonly s: RevenueSupport) {}

  private get prisma() {
    return this.s.prisma;
  }

  private settingsDto(r: Awaited<ReturnType<RevenueSupport['settings']>>) {
    return {
      fiscalYearStartMonth: r.fiscalYearStartMonth,
      stageProbabilities: { ...DEFAULT_STAGE_PROBABILITIES, ...((r.stageProbabilities as Record<string, string> | null) ?? {}) },
      stageProbabilitiesAreDefaults: !r.stageProbabilities,
      defaultHighValueThreshold: r.defaultHighValueThreshold ? money(r.defaultHighValueThreshold) : null,
      refundFounderThreshold: r.refundFounderThreshold ? money(r.refundFounderThreshold) : null,
      paymentTolerance: money(r.paymentTolerance),
      defaultPaymentDueDays: r.defaultPaymentDueDays,
      currency: 'INR',
      decisions: ['DEC-001', 'DEC-019', 'DEC-027', 'DEC-030'],
      status: 'default - awaiting owner approval',
    };
  }

  async get(user: Principal) {
    return this.settingsDto(await this.s.settings(this.prisma, user.organizationId));
  }

  async patch(user: Principal, b: z.infer<typeof patchRevenueSettingsSchema>) {
    const before = await this.s.settings(this.prisma, user.organizationId);
    const after = await this.s.tx(async (tx) => {
      const u = await tx.revenueSettings.update({
        where: { organizationId: user.organizationId },
        data: {
          ...(b.fiscalYearStartMonth !== undefined ? { fiscalYearStartMonth: b.fiscalYearStartMonth } : {}),
          ...(b.stageProbabilities !== undefined ? { stageProbabilities: b.stageProbabilities as Prisma.InputJsonValue } : {}),
          ...(b.defaultHighValueThreshold !== undefined ? { defaultHighValueThreshold: b.defaultHighValueThreshold === null ? null : round2(b.defaultHighValueThreshold) } : {}),
          ...(b.refundFounderThreshold !== undefined ? { refundFounderThreshold: b.refundFounderThreshold === null ? null : round2(b.refundFounderThreshold) } : {}),
          ...(b.paymentTolerance !== undefined ? { paymentTolerance: round2(b.paymentTolerance) } : {}),
          ...(b.defaultPaymentDueDays !== undefined ? { defaultPaymentDueDays: b.defaultPaymentDueDays } : {}),
          updatedById: user.userId,
        },
      });
      await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'org.settings_changed', entityType: 'revenue_settings', entityId: u.id, metadata: { changed: Object.keys(b), before: this.settingsDto(before), after: this.settingsDto(u) } });
      return u;
    });
    return this.settingsDto(after);
  }

  async setProgramThreshold(user: Principal, programId: string, b: z.infer<typeof programThresholdSchema>) {
    const prog = await this.prisma.program.findFirst({ where: { id: programId, organizationId: user.organizationId }, select: { id: true } });
    if (!prog) throw notFound('Program');
    const v = b.highValueThreshold === null ? null : round2(b.highValueThreshold);
    await this.s.tx(async (tx) => {
      await tx.programRevenueConfig.upsert({ where: { programId }, create: { organizationId: user.organizationId, programId, highValueThreshold: v, updatedById: user.userId }, update: { highValueThreshold: v, updatedById: user.userId } });
      await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'org.settings_changed', entityType: 'program_revenue_config', entityId: programId, metadata: { highValueThreshold: v ? money(v) : null } });
    });
    return { programId, highValueThreshold: v ? money(v) : null };
  }

  // ---- strategy plans (JD-STRAT-001) -----------------------------------------------------------------------------
  private async plansDto(organizationId: string, ids?: string[]) {
    const rows = await this.prisma.strategyPlan.findMany({ where: { organizationId, ...(ids ? { id: { in: ids } } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { initiatives: { orderBy: { createdAt: 'asc' } }, period: true }, take: 100 });
    const names = await this.s.userNames(rows.flatMap((p) => [p.ownerId, ...p.initiatives.map((i) => i.ownerId)]));
    return rows.map((p) => ({
      id: p.id, title: p.title, summary: p.summary, status: p.status, ownerId: p.ownerId, ownerName: names.get(p.ownerId) ?? null, periodId: p.periodId, periodLabel: p.period?.label ?? null, createdAt: iso(p.createdAt),
      initiatives: p.initiatives.map((i) => ({ id: i.id, title: i.title, notes: i.notes, ownerId: i.ownerId, ownerName: names.get(i.ownerId) ?? null, status: i.status, dueOn: isoDay(i.dueOn) })),
    }));
  }

  listPlans(user: Principal) {
    const level = this.s.access.scopeLevel(user, 'targets:view');
    if (level !== 'org' && level !== 'team') throw new AppError('FORBIDDEN', 'Strategy plans are visible to managers and above', 403);
    return this.plansDto(user.organizationId);
  }

  async createPlan(user: Principal, b: z.infer<typeof createPlanSchema>) {
    if (b.periodId && !(await this.prisma.targetPeriod.findFirst({ where: { id: b.periodId, organizationId: user.organizationId }, select: { id: true } }))) throw notFound('Target period');
    const p = await this.s.tx(async (tx) => {
      const created = await tx.strategyPlan.create({ data: { organizationId: user.organizationId, title: b.title, summary: b.summary, status: b.status, periodId: b.periodId ?? null, ownerId: user.userId } });
      await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'strategy_plan.created', entityType: 'strategy_plan', entityId: created.id, metadata: { title: b.title } });
      return created;
    });
    return (await this.plansDto(user.organizationId, [p.id]))[0];
  }

  async updatePlan(user: Principal, id: string, b: z.infer<typeof updatePlanSchema>) {
    const found = await this.prisma.strategyPlan.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!found) throw notFound('Plan');
    await this.prisma.strategyPlan.update({ where: { id }, data: b });
    await this.s.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'strategy_plan.updated', entityType: 'strategy_plan', entityId: id, metadata: { fields: Object.keys(b) } });
    return (await this.plansDto(user.organizationId, [id]))[0];
  }

  async addInitiative(user: Principal, planId: string, b: z.infer<typeof createInitiativeSchema>) {
    const plan = await this.prisma.strategyPlan.findFirst({ where: { id: planId, organizationId: user.organizationId } });
    if (!plan) throw notFound('Plan');
    const ownerId = b.ownerId ? (await this.s.assertUserInScope(user, 'targets:create', b.ownerId)).id : user.userId;
    await this.prisma.strategyInitiative.create({ data: { organizationId: user.organizationId, planId, title: b.title, notes: b.notes ?? null, ownerId, dueOn: b.dueOn ? dateOnly(b.dueOn) : null } });
    await this.s.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'strategy_initiative.created', entityType: 'strategy_plan', entityId: planId, metadata: { title: b.title } });
    return (await this.plansDto(user.organizationId, [planId]))[0];
  }

  async updateInitiative(user: Principal, id: string, b: z.infer<typeof updateInitiativeSchema>) {
    const i = await this.prisma.strategyInitiative.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!i) throw notFound('Initiative');
    if (b.status === undefined && b.notes === undefined && b.dueOn === undefined) throw new AppError('VALIDATION_ERROR', 'Nothing to update', 400);
    await this.prisma.strategyInitiative.update({ where: { id }, data: { ...(b.status ? { status: b.status } : {}), ...(b.notes !== undefined ? { notes: b.notes } : {}), ...(b.dueOn !== undefined ? { dueOn: b.dueOn ? dateOnly(b.dueOn) : null } : {}) } });
    await this.s.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'strategy_initiative.updated', entityType: 'strategy_plan', entityId: i.planId, metadata: { initiativeId: id, status: b.status ?? null } });
    return (await this.plansDto(user.organizationId, [i.planId]))[0];
  }
}
