import { Injectable } from '@nestjs/common';
import { addDays, addMonths, localDay, probationEnd, probationState, type Day, type ProbationDecisionKind, type ProbationState } from '@salesos/workforce-core';
import type { probationListQuerySchema, ProbationDecisionInput } from '@salesos/validation';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { ApiResult } from '../../../common/http/api-result';
import { conflict, forbidden, notFound } from '../../../common/http/errors';
import { PrismaService } from '../../../common/prisma';
import { assertTargetInScope, isoDay, scopeUserIds, toDate, userNameMap } from '../../people/common/helpers';
import { WorkforceConfigService } from '../common/workforce-config.service';

/** Decision rows live in `probation_reviews` with checkpointDay >= DECISION_BASE (checkpoint reviews use 7..365), so the existing tables are reused. */
export const DECISION_BASE = 1000;
const OUTCOME_OF: Record<ProbationDecisionKind, 'CONFIRM' | 'EXTEND' | 'CONCERNS'> = { CONFIRM: 'CONFIRM', EXTEND: 'EXTEND', MARK_FOR_REVIEW: 'CONCERNS' };
const DECISION_OF = (o: string | null): ProbationDecisionKind | null => (o === 'CONFIRM' ? 'CONFIRM' : o === 'EXTEND' ? 'EXTEND' : o === 'CONCERNS' ? 'MARK_FOR_REVIEW' : null);

export interface ProbationRow {
  userId: string;
  name: string;
  department: string | null;
  managerId: string | null;
  managerName: string | null;
  positionTitle: string | null;
  startDate: Day;
  months: number;
  endDate: Day;
  state: ProbationState;
  daysLeft: number;
  latestDecision: { decision: ProbationDecisionKind; at: string } | null;
  extensions: number;
}

@Injectable()
export class ProbationService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService, private readonly cfg: WorkforceConfigService) {}

  /** Rows for active employees that have a joining date. `ids` null = whole organisation. */
  async rows(organizationId: string, ids: string[] | null, soonDays: number, only?: string): Promise<{ rows: ProbationRow[]; today: Day }> {
    const { config } = await this.cfg.getConfig(organizationId);
    const today = localDay(new Date(), config.timezone);
    const profiles = await this.prisma.employeeProfile.findMany({
      where: { organizationId, joinDate: { not: null }, exitDate: null, ...(only ? { userId: only } : ids ? { userId: { in: ids } } : {}) },
      take: 5000,
      orderBy: [{ joinDate: 'desc' }, { id: 'asc' }],
    });
    const users = await this.prisma.user.findMany({ where: { organizationId, isActive: true, id: { in: profiles.map((p) => p.userId) } }, select: { id: true, name: true, department: true, managerId: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    const decisions = await this.prisma.probationReview.findMany({
      where: { organizationId, checkpointDay: { gte: DECISION_BASE }, employeeId: { in: [...byId.keys()] } },
      orderBy: [{ checkpointDay: 'asc' }],
      select: { employeeId: true, outcome: true, completedAt: true, checkpointDay: true },
    });
    const names = await userNameMap(this.prisma, organizationId, users.map((u) => u.managerId));
    const out: ProbationRow[] = [];
    for (const p of profiles) {
      const u = byId.get(p.userId);
      if (!u || !p.joinDate) continue;
      const mine = decisions.filter((d) => d.employeeId === p.userId);
      const last = mine[mine.length - 1];
      const latest = last ? DECISION_OF(last.outcome) : null;
      const months = p.probationMonths ?? config.hr.probationDefaultMonths;
      const endDate = probationEnd(isoDay(p.joinDate)!, months, isoDay(p.probationEndDate));
      const { state, daysLeft } = probationState(endDate, today, soonDays, latest);
      out.push({
        userId: u.id, name: u.name, department: u.department, managerId: u.managerId, managerName: u.managerId ? names.get(u.managerId) ?? null : null, positionTitle: p.positionTitle,
        startDate: isoDay(p.joinDate)!, months, endDate, state, daysLeft,
        latestDecision: last && latest ? { decision: latest, at: (last.completedAt ?? new Date()).toISOString() } : null,
        extensions: mine.filter((d) => d.outcome === 'EXTEND').length,
      });
    }
    return { rows: out, today };
  }

  /** Probation block shown on an HR profile (null when no joining date is recorded). */
  async forProfile(organizationId: string, userId: string): Promise<ProbationRow | null> {
    const { rows } = await this.rows(organizationId, null, 30, userId);
    return rows[0] ?? null;
  }

  async list(user: Principal, q: z.infer<typeof probationListQuerySchema>) {
    const ids = await scopeUserIds(this.access, user, 'workforce:reports:view');
    const { rows, today } = await this.rows(user.organizationId, ids, q.days);
    const filtered = rows.filter((r) => (q.status === 'ALL' ? true : q.status === 'ACTIVE' ? r.state !== 'CONFIRMED' : r.state === q.status));
    filtered.sort((a, b) => a.endDate.localeCompare(b.endDate) || a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
    const total = filtered.length;
    const start = (q.page - 1) * q.limit;
    const data = filtered.slice(start, start + q.limit);
    const counts = rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.state]: (m[r.state] ?? 0) + 1 }), {});
    return new ApiResult(data, { today, counts, pagination: { mode: 'page', limit: q.limit, page: q.page, hasMore: start + q.limit < total, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) } });
  }

  /** CONFIRM / EXTEND / MARK_FOR_REVIEW with history. Never changes the employee's account status or role. */
  async decide(user: Principal, userId: string, dto: ProbationDecisionInput) {
    if (userId === user.userId) throw forbidden('You cannot decide your own probation');
    await assertTargetInScope(this.access, user, 'onboarding:manage', userId);
    const { rows: curRows, today } = await this.rows(user.organizationId, null, 30, userId);
    const cur = curRows[0];
    if (!cur) throw notFound('Probation record');
    if (cur.state === 'CONFIRMED') throw conflict('PROBATION_CONFIRMED', 'This employee is already confirmed');
    const newEnd = dto.decision === 'EXTEND' ? addMonths(cur.endDate, dto.months!) : cur.endDate;
    const id = await this.prisma.$transaction(async (tx) => {
      const count = await tx.probationReview.count({ where: { employeeId: userId, checkpointDay: { gte: DECISION_BASE } } });
      const row = await tx.probationReview.create({
        data: {
          organizationId: user.organizationId, employeeId: userId, checkpointDay: DECISION_BASE + count + 1, dueDate: toDate(newEnd), status: 'COMPLETED',
          outcome: OUTCOME_OF[dto.decision], notes: dto.note ?? null, reviewerId: user.userId, completedAt: new Date(),
        },
      });
      if (dto.decision === 'EXTEND') await tx.employeeProfile.update({ where: { userId }, data: { probationEndDate: toDate(newEnd) } });
      // an early confirmation closes probation (the directory shows PROBATION only while the end date has not passed); the previous end stays in the audit row
      if (dto.decision === 'CONFIRM' && cur.endDate >= today) await tx.employeeProfile.update({ where: { userId }, data: { probationEndDate: toDate(addDays(today, -1)) } });
      await this.audit.recordTx(tx, {
        organizationId: user.organizationId, actorId: user.userId, action: 'probation.decision', entityType: 'probation_review', entityId: row.id,
        metadata: { employeeId: userId, decision: dto.decision, months: dto.months ?? null, previousEnd: cur.endDate, newEnd: dto.decision === 'CONFIRM' && cur.endDate >= today ? addDays(today, -1) : newEnd },
      });
      return row.id;
    });
    const after = (await this.rows(user.organizationId, null, 30, userId)).rows[0]!;
    return { id, ...after };
  }

  async history(user: Principal, userId: string) {
    await assertTargetInScope(this.access, user, 'onboarding:manage', userId);
    const target = await this.prisma.user.findFirst({ where: { id: userId, organizationId: user.organizationId }, select: { id: true } });
    if (!target) throw notFound('Employee');
    const rows = await this.prisma.probationReview.findMany({ where: { organizationId: user.organizationId, employeeId: userId, checkpointDay: { gte: DECISION_BASE } }, orderBy: [{ checkpointDay: 'asc' }], take: 100 });
    const audits = await this.prisma.auditLog.findMany({ where: { organizationId: user.organizationId, action: 'probation.decision', entityId: { in: rows.map((r) => r.id) } }, select: { entityId: true, metadata: true } });
    const meta = new Map(audits.map((a) => [a.entityId, (a.metadata ?? {}) as { months?: number | null; previousEnd?: string; newEnd?: string }]));
    const names = await userNameMap(this.prisma, user.organizationId, rows.map((r) => r.reviewerId));
    return rows.map((r) => ({
      id: r.id, decision: DECISION_OF(r.outcome), months: meta.get(r.id)?.months ?? null, previousEnd: meta.get(r.id)?.previousEnd ?? null, newEnd: isoDay(r.dueDate),
      note: r.notes, decidedBy: r.reviewerId ? names.get(r.reviewerId) ?? null : null, decidedAt: r.completedAt,
    }));
  }
}
